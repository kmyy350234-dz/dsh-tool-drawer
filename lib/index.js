// lazy-tools — 把「很重但平时不用」的工具组从上下文里收起来，需要时再开。
//
// 机制：每个 agent 创建时，按配置把该组里的工具从**它自己的作用域**里 restrict 掉
// （DSH 的 restrict 只能藏全局工具，藏不了自己 scope 注册的）；enable/disable 就是
// 解除 / 重建这条限制。宿主契约全在 host.js，这里只管组逻辑和五个工具。
//
// 六个工具：status / enable / disable / scan / list / health
// 契约与实测记录：perf-\lazy-tools-接线说明-20261022.md

import { createHost } from './host.js'
import { Config } from './config.js'

export const name = 'lazy-tools'
export const inject = ['tools']
// 设置页：DSH 从这份 schema 自动渲染全局设置（档位 / 天数 / 最小工具数 / 永不自动收）。
// 组定义仍然留在 profile 配置里 —— 嵌套数组在设置页里画不好看。
export { Config }

// 模块级状态：同一进程内 ESM 模块是缓存的，只有**重启**才会重新 import；
// 配置改动触发的只是再次 apply，模块对象还是同一个。所以这里存得住东西。
// 用途：上一次 apply 给某个 agent 建的作用域限制，新实例既看不见（工具已隐藏）
// 也拿不到解除函数 —— 不先解除就是孤儿（表现为 matched:0、enable 假成功）。
// 2026-10-23 实测：改一次 patch 就会踩一次。
const PROCESS_LIFTS = new WeakMap()

// 切分依据（2026-10-22 实测 56 个真名，19 + 37，零重叠、零遗漏）：
//   screen = 只读观察：get_* / list_* / check_permissions / health_report /
//            debug_window_info / clipboard_read / verify_state
//   input  = 一切会改变状态的：点击、键盘、滚动、窗口/会话/录制/配置控制
//   （`page` 归 input：它能执行页面 JS，不是只读）
const CUA_SCREEN =
  're:^cua_driver_native__(get_|list_|check_permissions|health_report|debug_window_info|clipboard_read|verify_state)'
const CUA_INPUT =
  're:^cua_driver_native__(bring_to_front|browser_(click|dialog|download|navigate|pointer|prepare|set_input_files|type)|click|clipboard_write|double_click|drag|end_session|escalate_session|hotkey|install_ffmpeg|invoke_menu|kill_app|launch_app|move_cursor|page|press_key|replay_trajectory|right_click|scroll|set_(agent_cursor_(enabled|motion|theme)|config|value|window_frame)|start_(recording|session)|stop_recording|type_text|zoom)$'

const DEFAULT_GROUPS = [
  {
    id: 'cua-screen',
    match: [CUA_SCREEN],
    title: '桌面·看',
    hint: '截图 / 窗口树 / 列应用 / 读剪贴板 —— 只读，先开这个',
    defaultOn: false,
  },
  {
    id: 'cua-input',
    match: [CUA_INPUT],
    title: '桌面·点',
    hint: '点击 / 键盘 / 窗口与会话控制 —— 会改状态，确认要看再开',
    defaultOn: false,
  },
]

// 匹配式：普通 glob（`*` 通配、整串锚定），或 `re:` 前缀的直接正则。
// 正则写错不许把插件带崩 —— 返回 null，由 apply 记账。
function matcherFor(pattern) {
  const source = String(pattern)
  try {
    if (source.startsWith('re:')) return new RegExp(source.slice(3))
    const escaped = source.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    return new RegExp('^' + escaped.replace(/\*/g, '.*') + '$')
  } catch {
    return null
  }
}

function text(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }]
}

function nowIso() {
  try {
    return new Date().toISOString()
  } catch {
    return null
  }
}

export function apply(ctx, config) {
  const host = createHost(ctx)
  const cfg = config && typeof config === 'object' ? config : {}
  // 设置页里那几个全局字段：先读进来、报给 health，行为（会话开始收敛）下一步接。
  const policy = {
    level: typeof cfg.level === 'string' ? cfg.level : 'medium',
    idleDays: Number.isFinite(cfg.idleDays) ? cfg.idleDays : 14,
    minTools: Number.isFinite(cfg.minTools) ? cfg.minTools : 3,
    neverAutoClose: Array.isArray(cfg.neverAutoClose) ? cfg.neverAutoClose : [],
  }
  const groups = (Array.isArray(cfg.groups) && cfg.groups.length ? cfg.groups : DEFAULT_GROUPS)
    .filter((g) => g && typeof g.id === 'string' && Array.isArray(g.match) && g.match.length)
    .map((g) => {
      const res = []
      for (const pattern of g.match) {
        const re = matcherFor(pattern)
        if (re) res.push(re)
        else host.record('group pattern', new Error(`无效的匹配式 ${JSON.stringify(String(pattern))}（组 ${g.id}），已忽略`))
      }
      return { ...g, res }
    })
    .filter((g) => g.res.length)

  if (!groups.length) return

  const states = new WeakMap()
  const stats = { hideEvents: 0, autoOpened: 0, lastHidden: null }

  const groupOf = (toolName) => {
    for (const g of groups) if (g.res.some((re) => re.test(toolName))) return g.id
    return null
  }

  const stateFor = (agent) => {
    let st = states.get(agent)
    if (!st) {
      // modes：每个组当前怎么处理 —— 'hide'（整组收起）/ 'only'（只放 names 里这几个）/ 没有记录就是全开。
      // hiddenNames 记住「上一次被我们收起来的是谁」：组关着时工具不可见，
      // 没有这份记录，status/list 就只能报 0，看的人会以为组里没东西。
      st = {
        modes: new Map(groups.filter((g) => g.defaultOn === false).map((g) => [g.id, { mode: 'hide', names: new Set() }])),
        lifts: [],
        hiddenNames: [],
      }
      states.set(agent, st)
    }
    return st
  }

  // 这个工具名现在该不该藏：没被任何组匹配 → 不藏；组没记录 → 全开；
  // 'hide' → 藏；'only' → 不在白名单里的才藏。
  const hiddenBy = (st, name) => {
    const gid = groupOf(name)
    if (!gid) return false
    const m = st.modes.get(gid)
    if (!m) return false
    if (m.mode === 'hide') return true
    return !m.names.has(name)
  }

  const rebuild = (agent) => {
    const st = stateFor(agent)
    for (const lift of st.lifts) {
      try {
        lift()
      } catch (error) {
        host.record('lift', error)
      }
    }
    st.lifts = []
    PROCESS_LIFTS.delete(agent)
    const hidden = host.toolNames(agent).filter((name) => hiddenBy(st, name))
    let applied = false
    if (hidden.length) {
      const lift = host.hideTools(agent, hidden)
      if (lift) {
        st.lifts.push(lift)
        PROCESS_LIFTS.set(agent, lift)
        stats.hideEvents += 1
        applied = true
      }
    }
    st.hiddenNames = hidden.slice()
    stats.lastHidden = {
      agentId: agent && agent.id ? String(agent.id) : null,
      hidden: hidden.length,
      applied,
      at: nowIso(),
    }
    // applied 必须跟 hidden 一起打：2026-10-23 实测出现过「restrict 失败、
    // 日志里却照样写 hidden=102」，这种账不能留。
    host.log(
      'info',
      `agent=${String(agent && agent.id)} hidden=${hidden.length} applied=${applied ? 'yes' : 'no'} groups=${[...st.modes.keys()].join(',') || '-'}`,
    )
  }

  // 最长公共前缀：用来猜「这一组工具的名字家族」。
  // 例如 cua 组已知名的公共前缀是 `cua_driver_native__`，那么之后新出现的
  // `cua_driver_native__xxx` 只要没被组匹配，就该被当成漏网报出来。
  const commonPrefix = (list) => {
    if (!list.length) return ''
    let prefix = list[0]
    for (const name of list.slice(1)) {
      let i = 0
      while (i < prefix.length && i < name.length && prefix[i] === name[i]) i += 1
      prefix = prefix.slice(0, i)
      if (!prefix) break
    }
    return prefix
  }

  // 漏网：名字长得像某组成员（共享家族前缀）却没有任何组匹配它 ——
  // 上游升级新增工具、正则写漏、组被删，都会在这里冒头。
  //
  // 注意「常驻工具」（含在该组前缀里、但故意留着的，如浏览器 open/content）不算漏网：
  // 它们要么被某组匹配、要么写在某个组的 keep 里。2026-10-23 真机首测就是被这 18 个
  // 常驻工具打成 healthy:false 的假阳性，所以 keep 是必须显式写出来的。
  const keepers = new Set()
  for (const g of groups) for (const name of Array.isArray(g.keep) ? g.keep : []) keepers.add(name)

  const strayNames = (known, visible) => {
    const stray = new Set()
    for (const g of groups) {
      const inGroup = known.filter((name) => g.res.some((re) => re.test(name)))
      if (inGroup.length < 2) continue
      const prefix = commonPrefix(inGroup)
      const cut = Math.max(prefix.lastIndexOf('__'), prefix.lastIndexOf('_')) + 1
      const family = cut >= 3 ? prefix.slice(0, cut) : prefix
      if (family.length < 3) continue
      for (const name of visible) {
        if (keepers.has(name)) continue
        if (!name.startsWith(family)) continue
        if (groups.some((other) => other.res.some((re) => re.test(name)))) continue
        stray.add(name)
      }
    }
    return [...stray].sort()
  }

  const groupsView = (agent) => {
    const visible = host.toolNames(agent)
    const st = agent ? stateFor(agent) : { modes: new Map(), hiddenNames: [] }
    const known = [...new Set([...visible, ...st.hiddenNames])]
    return groups.map((g) => {
      const inGroup = known.filter((name) => g.res.some((re) => re.test(name)))
      const m = st.modes.get(g.id)
      const mode = m ? m.mode : 'all'
      const entry = {
        id: g.id,
        title: g.title || g.id,
        on: mode === 'all',
        mode,
        onlyCount: mode === 'only' ? m.names.size : 0,
        matched: inGroup.length,
        visible: inGroup.filter((name) => visible.includes(name)).length,
      }
      if (typeof g.expect === 'number') {
        entry.expect = g.expect
        entry.expectOk = inGroup.length === g.expect
      }
      return entry
    })
  }

  // 组选择器：单个 group 或批量 groups（二选一）；only 只允许配单个组。
  const selectorSchema = (extra) => ({
    type: 'object',
    properties: {
      group: { type: 'string', description: '组 id（单个）' },
      groups: { type: 'array', items: { type: 'string' }, description: '多个组 id（批量，与 group 二选一）' },
      ...extra,
    },
    additionalProperties: false,
  })

  const idsFrom = (args) => {
    const single = args && typeof args.group === 'string' && args.group ? [args.group] : []
    const many = args && Array.isArray(args.groups) ? args.groups.filter((id) => typeof id === 'string' && id) : []
    return [...new Set([...single, ...many])]
  }

  // 用量：给「以后要不要做 TTL」攒数据，不做任何自动回收。
  const usage = new Map()
  const touch = (id, kind) => {
    const entry = usage.get(id) || { enables: 0, disables: 0, lastAt: null }
    if (kind === 'enable') entry.enables += 1
    if (kind === 'disable') entry.disables += 1
    entry.lastAt = nowIso()
    usage.set(id, entry)
  }
  const usageView = () =>
    [...usage.entries()].map(([id, u]) => ({ id, enables: u.enables, disables: u.disables, lastAt: u.lastAt }))

  host.onAgentCreated((agent) => {
    if (agent && agent.ctx && agent.ctx.tools) rebuild(agent)
  })

  // 时序兜底：插件可能比工具先加载（第一次算出的 hidden 会是 0），上游升级新增工具也会走这里。
  // 只在「发现漏网」（本该藏却可见）时才重建；重建后漏网消失，所以不会自激循环。
  // 加 3 秒冷却，防止 restrict 自身触发的 tools/change 把这里打成死循环。
  const lastLeakCheck = new WeakMap()
  host.onToolsChange(() => {
    for (const agent of host.agentList()) {
      const st = states.get(agent)
      if (!st) continue
      const now = Date.now()
      if (now - (lastLeakCheck.get(agent) || 0) < 3000) continue
      lastLeakCheck.set(agent, now)
      if (host.toolNames(agent).some((name) => hiddenBy(st, name))) rebuild(agent)
    }
  })

  // 关键词预开：用户消息里出现某组的 autoHints，就把该组提前放出来 ——「用户一句话，
  // 工具自己出现」。只在组**完全关着**时动手（only 模式不动，那已经是精细状态），
  // 且必须显式配 autoHints；每次自动开都写日志，便于事后核对是不是误开。
  const hinted = groups.filter((g) => Array.isArray(g.autoHints) && g.autoHints.length)
  if (hinted.length) {
    host.onUserMessage((agent, text) => {
      if (!agent || !agent.ctx || !agent.ctx.tools) return
      const st = stateFor(agent)
      const lower = String(text).toLowerCase()
      const opened = []
      for (const g of hinted) {
        const m = st.modes.get(g.id)
        if (!m || m.mode !== 'hide') continue
        if (!g.autoHints.some((hint) => lower.includes(String(hint).toLowerCase()))) continue
        st.modes.delete(g.id)
        touch(g.id, 'enable')
        opened.push(g.id)
      }
      if (!opened.length) return
      rebuild(agent)
      stats.autoOpened += opened.length
      host.log('info', `auto-open by hint: ${opened.join(',')} agent=${String(agent.id)}`)
    })
  }

  host.registerTool({
    name: 'lazy_tools_status',
    description: '查看按需工具组：每组有多少工具、当前是开还是关。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
    execute: async (_args, exec) => ({ groups: groupsView(exec && exec.agent) }),
  })

  host.registerTool({
    name: 'lazy_tools_enable',
    description: '开启按需工具组（group 单个 / groups 批量）；给 only 就只放这几个工具（其余仍收起，只能配单个组）。下一轮起可用。',
    parameters: selectorSchema({
      only: { type: 'array', items: { type: 'string' }, description: '只放这些工具名，必须都属于该组；省略=整组开' },
    }),
    output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
    execute: async (args, exec) => {
      const ids = idsFrom(args)
      if (!ids.length) return { error: '要 group 或 groups 之一' }
      const unknown = ids.filter((id) => !groups.some((g) => g.id === id))
      if (unknown.length) return { error: `unknown group: ${unknown.join(', ')}` }
      const agent = exec && exec.agent
      if (!agent) return { error: 'no agent scope' }
      const st = stateFor(agent)
      const only = Array.isArray(args && args.only) ? args.only.filter((name) => typeof name === 'string') : null
      if (only && ids.length > 1) return { error: 'only 只能配单个组' }
      if (only) {
        if (!only.length) return { error: 'only 不能是空数组；要整组开就省掉 only，要关就用 disable' }
        const group = groups.find((g) => g.id === ids[0])
        const bad = only.filter((name) => !group.res.some((re) => re.test(name)))
        if (bad.length) return { error: `这些名字不属于组 ${ids[0]}：${bad.join(', ')}` }
        const known = new Set([...host.toolNames(agent), ...st.hiddenNames])
        const missing = only.filter((name) => !known.has(name))
        if (missing.length) return { error: `这些名字当前不认识（可能没加载或拼错）：${missing.join(', ')}` }
        st.modes.set(ids[0], { mode: 'only', names: new Set(only) })
        touch(ids[0], 'enable')
        rebuild(agent)
        return { enabled: ids[0], only }
      }
      for (const id of ids) st.modes.delete(id)
      for (const id of ids) touch(id, 'enable')
      rebuild(agent)
      return { enabled: ids.length === 1 ? ids[0] : ids }
    },
  })

  host.registerTool({
    name: 'lazy_tools_disable',
    description: '关闭按需工具组（group 单个 / groups 批量），把它从上下文里收回；也会清掉之前的 only 白名单。',
    parameters: selectorSchema(),
    output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
    execute: async (args, exec) => {
      const ids = idsFrom(args)
      if (!ids.length) return { error: '要 group 或 groups 之一' }
      const unknown = ids.filter((id) => !groups.some((g) => g.id === id))
      if (unknown.length) return { error: `unknown group: ${unknown.join(', ')}` }
      const agent = exec && exec.agent
      if (!agent) return { error: 'no agent scope' }
      const st = stateFor(agent)
      for (const id of ids) st.modes.set(id, { mode: 'hide', names: new Set() })
      for (const id of ids) touch(id, 'disable')
      rebuild(agent)
      return { disabled: ids.length === 1 ? ids[0] : ids }
    },
  })

  host.registerTool({
    name: 'lazy_tools_resolve',
    description:
      '按工具名一步开启：给一个工具名（或名字片段），找到它属于哪一组、并只把它一个放进来。工具报 unknown 时先试这个，比 status→list→enable 三步快。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '工具名，可以只给片段（如 browser_scrape）' },
        apply: { type: 'boolean', description: '默认 true；给 false 就只查不开' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
    execute: async (args, exec) => {
      const agent = exec && exec.agent
      if (!agent) return { error: 'no agent scope' }
      const query = String((args && args.name) || '').trim()
      if (!query) return { error: '要 name' }
      const st = stateFor(agent)
      const visible = host.toolNames(agent)
      const known = [...new Set([...visible, ...st.hiddenNames])]
      const exact = known.filter((name) => name === query)
      const matched = exact.length ? exact : known.filter((name) => name.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
      if (!matched.length) {
        return {
          found: false,
          query,
          hint: '这个名字没见过。先 lazy_tools_scan 看现有前缀，或者确认拼写；也可能它属于一个尚未加载的插件。',
        }
      }
      const target = matched[0]
      const group = groups.find((g) => g.res.some((re) => re.test(target)))
      const base = { found: true, tool: target, group: group ? group.id : null }
      if (matched.length > 1) base.matches = matched.slice(0, 8)
      if (!group) return { ...base, applied: false, hint: '它不在任何组里，本来就一直可见' }
      if (visible.includes(target)) return { ...base, applied: false, hint: '它本来就可用了' }
      if (args && args.apply === false) return { ...base, applied: false, hint: '只查不开（apply:false）' }
      st.modes.set(group.id, { mode: 'only', names: new Set([target]) })
      touch(group.id, 'enable')
      rebuild(agent)
      return { ...base, applied: true, hint: '已只放这一个进来，同组其余仍收起' }
    },
  })

  host.registerTool({
    name: 'lazy_tools_scan',
    description: '扫描当前可见工具，按前缀给出分组建议（用来往配置里加新组）。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
    execute: async (_args, exec) => {
      const names = host.toolNames(exec && exec.agent)
      const buckets = new Map()
      for (const n of names) {
        const key = n.includes('__') ? n.split('__')[0] : n.includes('_') ? n.split('_')[0] : n
        if (!buckets.has(key)) buckets.set(key, [])
        buckets.get(key).push(n)
      }
      return {
        total: names.length,
        buckets: [...buckets.entries()]
          .map(([prefix, list]) => ({ prefix, count: list.length, sample: list.slice(0, 4) }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 40),
      }
    },
  })

  host.registerTool({
    name: 'lazy_tools_list',
    description: '列出某个组里的工具名（被收起过的也算，visible 字段区分当前可不可见）。配 match 正则、挑单工具开关时用。',
    parameters: { type: 'object', properties: { group: { type: 'string', description: '组 id；省略则列出所有已知工具' } }, additionalProperties: false },
    output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
    execute: async (args, exec) => {
      const agent = exec && exec.agent
      const visible = host.toolNames(agent)
      const st = agent ? stateFor(agent) : { hiddenNames: [] }
      const known = [...new Set([...visible, ...st.hiddenNames])].sort()
      const id = args && typeof args.group === 'string' ? args.group : ''
      if (!id) return { group: null, count: known.length, visible: visible.length, names: known }
      const group = groups.find((g) => g.id === id)
      if (!group) return { error: `unknown group: ${id}` }
      const matched = known.filter((name) => group.res.some((re) => re.test(name)))
      return { group: id, count: matched.length, visible: matched.filter((name) => visible.includes(name)).length, names: matched }
    },
  })

  host.registerTool({
    name: 'lazy_tools_health',
    description: '自检：DSH 四个契约还在不在（register / schemas / restrict / agent 事件）、版本号、上次 hidden 数。升级排查先跑它。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
    execute: async (_args, exec) => {
      const agent = exec && exec.agent
      const probe = host.probe(agent)
      const names = host.toolNames(agent)
      const counters = host.counters()
      const errors = host.errors()
      const st = agent ? stateFor(agent) : { hiddenNames: [] }
      const known = [...new Set([...names, ...st.hiddenNames])]
      const stray = strayNames(known, names)
      const view = groupsView(agent)
      const warnings = []
      for (const g of view) {
        if (typeof g.expect === 'number' && !g.expectOk) {
          warnings.push(`${g.id}: matched ${g.matched} ≠ expect ${g.expect}${g.matched < g.expect ? '（少的那几个可能已改名/未加载）' : '（多出来的是新工具，正则可能要补）'}`)
        }
      }
      if (stray.length) warnings.push(`漏网 ${stray.length} 个：${stray.slice(0, 8).join(', ')}${stray.length > 8 ? ' …' : ''}`)
      const contracts = [
        { id: 'tools.register', ok: probe.register, detail: '注册工具用的入口' },
        { id: 'tools.schemas', ok: probe.schemas, detail: `可见工具 ${names.length} 个` },
        {
          id: 'agent.ctx.tools.restrict',
          ok: probe.restrict,
          detail: agent ? `已调用 ${counters.restrictCalls} 次 / 失败 ${counters.restrictFailures} 次` : '无 agent 作用域，无法判断',
        },
        {
          id: 'agent/created',
          ok: probe.agentEvent,
          detail: `监听已挂上；本进程已触发 ${counters.agentCreated} 次`,
        },
      ]
      return {
        ok: contracts.every((c) => c.ok),
        healthy: contracts.every((c) => c.ok) && errors.length === 0 && warnings.length === 0,
        checkedAt: nowIso(),
        contracts,
        groups: view,
        policy,
        warnings,
        stray,
        usage: usageView(),
        stats: {
          agentCreated: counters.agentCreated,
          toolsChanged: counters.toolsChanged,
          restrictCalls: counters.restrictCalls,
          restrictFailures: counters.restrictFailures,
          hideEvents: stats.hideEvents,
          autoOpened: stats.autoOpened,
          userMessages: counters.userMessages,
          lastHidden: stats.lastHidden,
        },
        errors,
      }
    },
  })

  // 先收回上一次 apply 留下的限制：同一进程里模块是缓存的，PROCESS_LIFTS 里记着
  // 上次建立的解除函数。不收回的话，新实例看不见那些工具（它们还藏着），
  // 于是 matched 会报 0、enable 也解不开 —— 孤儿限制，实测每次改 patch 都会踩。
  let reclaimed = 0
  for (const agent of host.agentList()) {
    const previous = PROCESS_LIFTS.get(agent)
    if (typeof previous === 'function') {
      try {
        previous()
      } catch (error) {
        host.record('lift(previous apply)', error)
      }
      PROCESS_LIFTS.delete(agent)
      reclaimed += 1
    }
  }

  // 补应用：插件可能是「会话已经在跑」之后才加载/重载的（改配置、升级插件、重启后恢复
  // 会话），这时 agent/created 不会再补发一次。所以活着的 agent 在这里补一遍，
  // 否则它们会一直带着默认开着的工具组（实测过：重载后老 agent 的 restrict 不追认）。
  let caughtUp = 0
  for (const existing of host.agentList()) {
    if (existing && existing.ctx && existing.ctx.tools) {
      rebuild(existing)
      caughtUp += 1
    }
  }

  // 常驻提示（约 40 tokens/轮）：让「工具组被收起」这件事不用靠我记着。
  // 拿不到 systemPrompt 服务就静默跳过 —— 这是可选项，不是必需能力。
  try {
    if (ctx && typeof ctx.inject === 'function') {
      ctx.inject(['systemPrompt'], (prompt) => {
        const promptText = () =>
          `按需工具组（lazy-tools）：${groups.map((g) => g.id).join(' / ')} 默认收起。` +
          '工具报 unknown 时先调 lazy_tools_status；需要时 lazy_tools_enable {group, only:[…]}；排查用 lazy_tools_health。'
        try {
          const section = { name: 'lazy-tools:groups', order: 3000, interpolate: false, text: promptText }
          if (prompt && prompt.systemPrompt && typeof prompt.systemPrompt.section === 'function') {
            if (typeof prompt.effect === 'function') {
              prompt.effect(() => prompt.systemPrompt.section(section), 'lazy-tools: prompt section')
            } else {
              prompt.systemPrompt.section(section)
            }
          } else {
            host.record('systemPrompt', new Error('systemPrompt.section is not available'))
          }
        } catch (error) {
          host.record('systemPrompt', error)
        }
      })
    }
  } catch (error) {
    host.record('systemPrompt', error)
  }

  host.log(
    'info',
    `loaded in root scope; groups=${groups.map((g) => g.id).join(',')} level=${policy.level} caughtUp=${caughtUp} reclaimed=${reclaimed}`,
  )
}
