// roles.js — 受管会话（router / worker / subagent）的角色策略。
//
// 设计约束（2026-11-01）：
//   1. 默认关闭：policy.managedRoles 为空 ⇒ 完全走原来的热度逻辑，行为不变。
//   2. 只认结构信号：preset id（来自 agentPresets.composedPreset）与 session.header.parentSession；
//      不认插件名、不认工单标题。
//   3. 封闭默认：角色没授权的组、以及没有归组的工具，一律隐藏。
//   4. 真源在配置里（管理员写），不在代码里；本模块只做解析，不做判断。
//
// 为什么不给每个 agent 单独写策略：真源保持“角色 → 组”这一层；每个 agent 的结果是
// 从角色模板派生出来的（确定性、可 diff），而不是各自手写一份。

/** 校验并归一化 managedRoles；无效条目直接丢掉（失败方向放开）。 */
export function normalizeManagedRoles(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key !== 'string' || !key) continue
    if (!value || typeof value !== 'object') continue
    const allow = Array.isArray(value.allowGroups)
      ? value.allowGroups.filter((item) => typeof item === 'string' && item.length > 0)
      : []
    if (!allow.length) continue
    out[key] = {
      allowGroups: [...new Set(allow)],
      // 未归组工具的默认：hide（角色纪律）| show（人用会话不适用；留作显式逃生口）
      unknown: value.unknown === 'show' ? 'show' : 'hide',
      // 2026-11-03：AI 自动配的角色必须**能自证来源**（谁配的 / 什么时候 / 依据），
      // 否则又变成"权限从模型嘴里长出来、事后无从追"。这三个字段只记账，不改行为。
      ...(typeof value.createdBy === 'string' && value.createdBy ? { createdBy: value.createdBy } : {}),
      ...(typeof value.at === 'string' && value.at ? { at: value.at } : {}),
      ...(typeof value.basis === 'string' && value.basis ? { basis: value.basis } : {}),
    }
  }
  return Object.keys(out).length ? out : null
}

/**
 * 从会话标签里取角色键（2026-11-03 加，**厂商无关**）。
 *
 * 为什么要有它：各家编排器给子会话打标签的写法不一样，但形状高度一致——
 *   MyGO：`dsh-my-go:hermes` · team-conductor：`team:reviewer` · 别的可能用 `/` 或空格。
 * 我们**不认厂商名**，只认一条规则：**取最后一段**（`: / | 空白` 分隔），小写。
 * 于是任何编排器只要把「角色名放在标签末尾」，不用改一行代码就能被我们认出来。
 *
 * 安全前提：调用方只在 `managedRoles` 里**配过这个键**时才生效 —— 认错了也只是不生效，
 * 不会给错权限（失败方向放开）。
 */
export function roleFromLabel(label) {
  if (typeof label !== 'string' || !label.trim()) return null
  const parts = label
    .trim()
    .split(/[:/|\\\s]+/)
    .filter(Boolean)
  if (!parts.length) return null
  const last = parts[parts.length - 1].toLowerCase()
  return /^[a-z0-9_-]{1,32}$/.test(last) ? last : null
}

/**
 * 取会话标签。**2026-11-03 冷读红 1**：宿主的 `SessionHeader` 里**没有** `label` 字段
 * （HEADER_*_KEYS 实测只有 type/version/id/createdAt/isSeeded/delegationDepth/cwd/parentSession/origin/agentPreset），
 * 只有 `header.label` 这一条通道会让"按 label 配的角色"在真机上**永远不生效**（还是 fail-open 方向）。
 * 所以这里多认两处：`session.subagent.label`（descriptor 事件折叠出来的投影）和 `agent.subagent.label`。
 * 三处都没有 ⇒ null（不猜）。
 */
export function labelOfSession(agent, header) {
  try {
    if (header && typeof header.label === 'string' && header.label) return header.label
    const projected = agent && agent.session && agent.session.subagent
    if (projected && typeof projected.label === 'string' && projected.label) return projected.label
    const direct = agent && agent.subagent
    if (direct && typeof direct.label === 'string' && direct.label) return direct.label
    // **真机唯一可用的通道（2026-11-03 冷读第二轮核实）**：label 在 `sessionProjections` 服务的
    // `subagent` 投影里（`stateOf(session,'subagent').identity.label`），既不在 Session 也不在 Agent 上。
    // 宿主时序保证 descriptor 在 `agent/created` 之前 append，所以这里读得到。
    const ctx = agent && agent.ctx
    const svc =
      (ctx && ctx.sessionProjections) || (ctx && typeof ctx.get === 'function' ? ctx.get('sessionProjections') : null)
    if (svc && typeof svc.stateOf === 'function' && agent && agent.session) {
      const state = svc.stateOf(agent.session, 'subagent')
      const label = state && state.identity && state.identity.label
      if (typeof label === 'string' && label) return label
    }
  } catch {
    /* 读不到就当没有 */
  }
  return null
}

/**
 * 解析一个 agent 的受管角色。返回 { key, role, source } 或 null。
 *
 * 顺序（**每一级都要求 managedRoles 里配了该键**，配了才生效）：
 *   1. 子会话：`[role:xxx]` 提示标记（由 role-inbox 写进 state，这里不参与）
 *   2. 子会话：**label 尾段**（厂商无关，见 roleFromLabel）—— 比通用 subagent 键更精确
 *   3. 子会话：`subagent` 通用键
 *   4. 非子会话：preset id（composedPreset，退回 session.header.agentPreset）
 *
 * `source` 只用于可观测（health 里能看到"这个角色是从哪认来的"）。
 */
export function resolveManagedRole(agent, managedRoles) {
  if (!managedRoles || !agent) return null
  const header = agent.session && agent.session.header ? agent.session.header : null

  // 1) 派生会话（子代理）：先看 label，再看通用 subagent 键
  if (header && header.parentSession) {
    const fromLabel = roleFromLabel(labelOfSession(agent, header))
    if (fromLabel && managedRoles[fromLabel]) return { key: fromLabel, role: managedRoles[fromLabel], source: 'label' }
    const role = managedRoles.subagent
    return role ? { key: 'subagent', role, source: 'subagent' } : null
  }

  // 2) 角色 preset：优先问宿主服务，拿不到再退到 session header
  let presetId = null
  try {
    const presets = agent.ctx && typeof agent.ctx.get === 'function' ? agent.ctx.get('agentPresets') : null
    if (presets && typeof presets.composedPreset === 'function') {
      presetId = presets.composedPreset(agent.ctx) ?? null
    } else if (header && typeof header.agentPreset === 'string') {
      presetId = header.agentPreset
    }
  } catch {
    presetId = null
  }
  if (!presetId) return null

  const role = managedRoles[presetId]
  return role ? { key: presetId, role, source: 'preset' } : null
}

/** 通配：allowGroups 里写 '*' = 这个角色不按组设限（逃生口，2026-11-02 加）。 */
export const ALL_GROUPS = '*'

/** 这个工具在当前受管角色下是否允许。未归组按角色的 unknown 处理。 */
export function isAllowedByPolicy(managed, name, groupOf) {
  const role = managed && managed.role
  if (!role) return false
  if (Array.isArray(role.allowGroups) && role.allowGroups.includes(ALL_GROUPS)) return true
  const groupId = groupOf(name)
  if (groupId === null) return role.unknown === 'show'
  return role.allowGroups.includes(groupId)
}

/**
 * 校验 allowGroups 里的组 id 到底存不存在（2026-11-02 加，外部评审指出、复现属实）。
 *
 * 为什么必须有这道：受管会话里 `enable` / `disable` 被拒、自愈也不绕过 ⇒ 要是 allowGroups
 * 全写成不存在的 id（**照抄文档示例就会这样**），这个会话的工具面被收到只剩 CORE_TOOLS，
 * 会话内没有任何自救路径，只能改文件重启 —— 而且失败是完全静默的，违反红线三「失败必须响」。
 *
 * 失败方向放开：
 *   - 全部 id 都不认识 ⇒ 这个角色**不生效**（退回普通会话行为）+ 记一条错误；
 *   - 只有部分不认识   ⇒ 保留认识的，不认识的记出来；
 *   - allowGroups 含 '*' ⇒ 不设限，直接放行。
 *
 * 注：`auto-*` 是自动分组动态生成的 id，可能在 apply 之后才出现，这里不当成"写错"。
 *
 * @param {object|null} managedRoles 归一化后的角色表
 * @param {string[]} groupIds 当前已知的组 id
 * @returns {{unknown: Array<{role: string, ids: string[]}>, dropped: string[]}}
 */
export function auditManagedRoles(managedRoles, groupIds) {
  const known = new Set(Array.isArray(groupIds) ? groupIds : [])
  const out = { unknown: [], dropped: [] }
  if (!managedRoles || typeof managedRoles !== 'object') return out
  for (const [key, role] of Object.entries(managedRoles)) {
    const allow = Array.isArray(role && role.allowGroups) ? role.allowGroups : []
    if (!allow.length || allow.includes(ALL_GROUPS)) continue
    const miss = allow.filter((id) => !known.has(id))
    // 2026-11-03（冷读红 4a）：以前这里豁免 `auto-*`，理由是"自动组可能晚到"。
    // 但 mnemon 停用后 `auto-mnemon` 不再存在时，那个角色会**照常生效**却一个组都没允许
    // ⇒ 所有组 hide、只剩核心工具、enable/disable 还被拒 = #71 原地复活。
    // 正确做法：auto-* 和普通 id 一样参与"全都不存在就停用"的判定。
    if (!miss.length) continue
    out.unknown.push({ role: key, ids: miss })
    // 全部都不认识（去掉 auto- 占位后一个可用的都没有）⇒ 这个角色等于什么都没允许，
    // 必须停用而不是把会话锁死
    const usable = allow.filter((id) => id === ALL_GROUPS || !miss.includes(id))
    if (!usable.length) out.dropped.push(key)
  }
  return out
}
