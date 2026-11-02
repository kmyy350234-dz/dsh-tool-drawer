// role-inbox.js — 从子代理的**首条消息**里读角色标记 `[role:xxx]`，在首轮组装前收紧它的工具面。
//
// 为什么要有这个文件（2026-11-03 半夜定案，全部有实测来源）：
//   ① 宿主不给 `subagent` 工具传 preset / metadata ⇒ 子代理都继承父会话的 preset，
//      「按 preset 分角色」对子代理完全失效（基线实验：两个不同角色的子代理，工具面一模一样）；
//   ② 子会话日志证明：事件 `agent/inbox/spliced` 的 payload 里带着**整段首条消息正文**，
//      而且发生在 `turn/start` 之前 ⇒ 时序上够在第一轮组装前改工具表；
//   ③ 所以角色走一条显式约定：父会话派工时在提示首行写 `[role:xxx]`。
//
// 纪律：
//   · **只在子会话上生效**（header.parentSession 存在）——用户在普通会话里手打 `[role:]` 不该改自己的工具；
//   · 角色定义**复用 Policy 里的 managedRoles**（不新增配置项）：`managedRoles[xxx] = { allowGroups, unknown }`；
//   · 失败方向放开：读不到 / 认不出 / 没配 → 什么都不做，退回现有行为；但**配了标记却没配角色要响**（记一条错误）；
//   · 事件若是 waterfall 形态，必须把 next 传下去（#77：探针漏调 next() 把宿主链路干崩过）。

/** `[role:researcher]` —— 允许字母数字下划线短横，限制 32 字符防乱写。 */
const ROLE_PATTERN = /^\s*\[role:([A-Za-z0-9_-]{1,32})\]/i

/** 把一条消息的 content 里所有 text 块拼起来（真实形状：`content: [{type:'text',text}]`）。 */
export function textOfMessage(message) {
  if (!message || !Array.isArray(message.content)) return ''
  return message.content
    .filter((block) => block && block.type === 'text')
    .map((block) => String(block.text || ''))
    .join('')
}

/**
 * 从 inbox 事件的 payload 里取出这次插入的消息列表。
 * 实测形状：`{ data: { inserted: [ { content: [...] } ] } }`；
 * 另外兼容 `{ message }` 和裸消息，免得宿主改一处就彻底失效。
 */
export function messagesOfPayload(payload) {
  const data = payload && payload.data ? payload.data : payload
  if (data && Array.isArray(data.inserted)) return data.inserted
  if (data && data.message) return [data.message]
  if (data && Array.isArray(data.content)) return [data]
  return []
}

/**
 * 从 agent 上读「是不是子会话」以及会话 id。
 * 宿主给 agent 的形状没在公开文档里写死，所以每一步都兜底。
 */
function headerOf(agent) {
  try {
    return (agent && agent.session && agent.session.header) || null
  } catch {
    return null
  }
}

/**
 * 判断这个 agent 是不是子会话（只有子会话吃角色标记）。
 * 读不到 header ⇒ 当作不是子会话（宁可不动，也不乱改）。
 */
export function isSubagentSession(agent) {
  const header = headerOf(agent)
  return !!(header && header.parentSession)
}

/** 事件可能把 agent 放在 payload.agent / 第二个参数 / session id 里 —— 三路都试。 */
function resolveAgent(payload, extra, list) {
  const direct = (payload && payload.agent) || (extra && extra.ctx ? extra : null)
  if (direct && direct.ctx) return direct
  const data = payload && payload.data ? payload.data : payload
  const sid =
    (data && (data.session || data.sessionId)) ||
    (payload && (payload.session || payload.sessionId)) ||
    null
  if (!sid || !Array.isArray(list)) return null
  const wanted = String(sid)
  const match = list.find((agent) => {
    const header = headerOf(agent)
    const id = (agent && agent.session && agent.session.id) || (header && header.id) || (agent && agent.id)
    return id && String(id) === wanted
  })
  return match || null
}

/**
 * 挂上监听。
 *
 * @param {object} ctx       插件根上下文（要 ctx.on）
 * @param {object} deps
 * @param {object} deps.host  host 契约（agentList / record / log）
 * @param {object} deps.policy  策略（读 managedRoles）
 * @param {Function} deps.stateFor  agent => 会话状态
 * @param {Function} deps.rebuild    agent => 重算工具面（会 lift + 重新 restrict）
 * @param {Function} deps.logger    可选：额外日志
 * @returns {boolean} 是否挂上
 */
export function mountRoleInbox(ctx, deps) {
  const { host, policy, stateFor, rebuild } = deps
  if (!ctx || typeof ctx.on !== 'function') return false
  const warned = new Set()

  const onInsert = (payload, second) => {
    // 事件若是 waterfall 形态，next 可能是第二个参数；若是普通事件，第二个参数可能是 agent。
    const next = typeof second === 'function' ? second : null
    try {
      const agent = resolveAgent(payload, second, host.agentList())
      if (agent && isSubagentSession(agent)) {
        const messages = messagesOfPayload(payload)
        // 只看**第一条**：角色标记约定在派工提示的首行；后面的消息（追问、补充）不该再改工具面。
        const match = messages.length ? ROLE_PATTERN.exec(textOfMessage(messages[0])) : null
        if (match) {
          const key = match[1]
          const role = policy && policy.managedRoles ? policy.managedRoles[key] : null
          if (role) {
            const st = stateFor(agent)
            st.managed = { key, role, source: 'prompt' }
            st.injectedRole = key
            rebuild(agent)
            host.log('info', `role-inbox: 子会话按 [role:${key}] 收紧工具面`)
          } else if (!warned.has(key)) {
            warned.add(key)
            // 写了标记却没配角色 = 配置错误，必须响（红字三：失败必须响），而且不改任何工具。
            host.record(
              'role-inbox',
              new Error(`子会话带了 [role:${key}]，但 managedRoles 里没有这个键 —— 已忽略（工具面不变）；请把该角色写进 ~/.dsh/lazy-tools.policy.json`),
            )
          }
        }
      }
    } catch (error) {
      host.record('role-inbox', error)
    }
    // waterfall 形态必须继续链路
    return next ? next() : undefined
  }

  try {
    ctx.on('agent/inbox/spliced', onInsert)
    ctx.on('agent/inbox/inserted', onInsert)
    return true
  } catch (error) {
    host.record('role-inbox', error)
    return false
  }
}
