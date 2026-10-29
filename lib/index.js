// lazy-tools — 把「很重但平时不用」的工具组从上下文里收起来，需要时再开。
//
// 机制：每个 agent 创建时，按配置把该组里的工具从**它自己的作用域**里 restrict 掉
// （DSH 的 restrict 只能藏全局工具，藏不了自己 scope 注册的）；enable/disable 就是
// 解除 / 重建这条限制。宿主契约全在 host.js，这里只管组逻辑和十一个工具。
//
// 十一个工具：status / enable / disable / scan / list / health / bench / mode / resolve /
//             classify / save_groups（L7 的旧注释写着「六个」——对面 2026-10-28 指出来，已更正）
// 契约与实测记录：perf-\lazy-tools-接线说明-20261022.md

import { createHost } from './host.js'
import { Config } from './config.js'
import { mountBridge, readStoredPolicy, clientPing, readUserGroups, writeUserGroups, applyPolicyPatch } from './api.js'
import { loadUsage, saveUsage, recordUsage, isHot, isToolHot, LEVEL_DAYS } from './usage.js'
import { suggestGroups, normalizeAutoMode, CORE_TOOLS } from './autogroups.js'

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
    // 转义集必须包含 ? —— 2026-10-29 第三方复核指出：漏了它，手写 `foo?bar` 会变成
    // 正则 /^foo?bar$/（匹配 fobar），照文档写却静默不生效。`*` 不在这里转义，它是通配符。
    const escaped = source.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
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
  // 设置页里那几个全局字段：先读配置，再让「设置页写下的策略文件」覆盖它。
  // 于是 UI 改完立即生效，YAML 里仍然可以写死默认值。
  const stored = (() => {
    try {
      return readStoredPolicy() || {}
    } catch (error) {
      host.record('policy file', error)
      return {}
    }
  })()
  const pickNumber = (a, b, fallback) => (Number.isFinite(a) ? a : Number.isFinite(b) ? b : fallback)
  const level = stored.level || (typeof cfg.level === 'string' ? cfg.level : 'medium')
  // 三档的天数可改：存储值 > 配置值 > 内置默认（14 / 7 / 3）
  const presets = {
    low: pickNumber(stored.presets && stored.presets.low, cfg.presets && cfg.presets.low, LEVEL_DAYS.low),
    medium: pickNumber(stored.presets && stored.presets.medium, cfg.presets && cfg.presets.medium, LEVEL_DAYS.medium),
    high: pickNumber(stored.presets && stored.presets.high, cfg.presets && cfg.presets.high, LEVEL_DAYS.high),
  }
  const policy = {
    level,
    // 天数不写就跟档位走（档位天数本身可自定义）
    idleDays: pickNumber(stored.idleDays, cfg.idleDays, presets[level] ?? presets.medium),
    minTools: pickNumber(stored.minTools, cfg.minTools, 3),
    presets,
    showDock: typeof stored.showDock === 'boolean' ? stored.showDock : cfg.showDock === true,
    // 裸名工具分类提示：默认开（false 才关）
    classifyNudge: typeof stored.classifyNudge === 'boolean' ? stored.classifyNudge : cfg.classifyNudge !== false,
    showClear: typeof stored.showClear === 'boolean' ? stored.showClear : cfg.showClear === true,
    // 自动分组：off 不动 / suggest 只建议 / on 直接建组并收起（2026-10-25 加）
    autoGroups: normalizeAutoMode(stored.autoGroups, cfg.autoGroups),
  }
  // 用量账本：决定「哪个组最近真的被用过」。读不到就当作空的（全冷）。
  const usageLedger = (() => {
    try {
      return loadUsage()
    } catch (error) {
      host.record('usage file', error)
      return { groups: {}, tools: {} }
    }
  })()
  // 默认四组 + extraGroups（追加）。
  // 为什么加 extraGroups：有些插件的工具名没有共同前缀（例：deepseek-computer-use 的
  // click / type_text / list_windows），自动分组认不出来，只能手写名单；而 `groups`
  // 是整体替换，直接写它会冲掉默认四组。extraGroups 只追加、不动默认。
  const baseGroups = Array.isArray(cfg.groups) && cfg.groups.length ? cfg.groups : DEFAULT_GROUPS
  // 用户手写组：来源两处 —— 配置里的 extraGroups（loader 层）与独立文件
  // ~/.dsh/lazy-tools.groups.json（设置页保存不会冲掉它）。
  const fileGroups = readUserGroups(host.record)
  const extraGroups = [...(Array.isArray(cfg.extraGroups) ? cfg.extraGroups : []), ...fileGroups]
  const groups = (extraGroups.length ? [...baseGroups, ...extraGroups] : baseGroups)
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

  // 自动分组：只认「没被现有组覆盖 + 同前缀够数」的家族。
  // on 直接并进 groups（手写组排在前面，所以优先）；suggest 只把建议暴露给 scan。
  // 算一次就定，整场不重算 —— 中途改工具表会打断前缀缓存。
  let autoReport = { mode: policy.autoGroups, suggestions: [], skipped: [], applied: [] }
  // 工具是别的插件注册的：本插件 apply 时它们可能还没出现（冷启动顺序不保证）。
  // 所以算一次不够 —— 会话真正开始时再算一次，直到算出东西为止。
  let autoSettled = false
  const autoGroups = (apply) => {
    if (policy.autoGroups === 'off') return autoReport
    try {
      const covered = (name) => groups.some((g) => g.res.some((re) => re.test(name)))
      const toolNames = host.allToolNames()
      const report = suggestGroups(toolNames, covered, { minTools: Math.max(3, policy.minTools) })
      autoReport = { mode: policy.autoGroups, suggestions: report.suggestions, skipped: report.skipped, applied: autoReport.applied }
      if (apply && policy.autoGroups === 'on') {
        for (const suggestion of report.suggestions) {
          if (groups.some((g) => g.id === suggestion.id)) continue
          const res = suggestion.match.map((pattern) => matcherFor(pattern)).filter(Boolean)
          if (!res.length) continue
          groups.push({
            id: suggestion.id,
            match: suggestion.match,
            title: suggestion.title,
            hint: '按前缀自动识别；手写组优先，可在配置里覆盖',
            defaultOn: false,
            expect: suggestion.expect,
            auto: true,
            res,
          })
          autoReport.applied.push(suggestion.id)
        }
      }
      // 只有当工具表确实有内容时才认为「算过了」；冷启动时工具还没注册，要留着重算。
      if (toolNames.length > 0) autoSettled = true
    } catch (error) {
      host.record('auto groups', error)
    }
    return autoReport
  }
  autoGroups(true)

  if (!groups.length) return

  const states = new WeakMap()
  const stats = { hideEvents: 0, autoOpened: 0, selfHealed: 0, lastHidden: null }

  const groupOf = (toolName) => {
    for (const g of groups) if (g.res.some((re) => re.test(toolName))) return g.id
    return null
  }

  // 会话开始那一刻定默认值（中途绝不改，保前缀缓存）：
  //   最近 idleDays 内被调用过（热） / 被点名永不自动收 / 显式 defaultOn:true → 开着；
  //   其余 → 收起。天数不写就跟档位走（low 14 / medium 7 / high 3）。
  // st.idleDays 是「本会话的覆盖值」（lazy_tools_mode 改它），不改全局策略。
  const sessionIdleDays = (st) => (st && Number.isFinite(st.idleDays) ? st.idleDays : policy.idleDays)
  const warmGroups = (st) => {
    const idleDays = sessionIdleDays(st)
    return new Set(
      groups
        .filter(
          (g) =>
            g.defaultOn === true ||
            isHot(usageLedger, g.id, idleDays),
        )
        .map((g) => g.id),
    )
  }
  const applyDefaults = (st) => {
    const warm = warmGroups(st)
    const idleDays = sessionIdleDays(st)
    const next = new Map()
    for (const g of groups) {
      if (warm.has(g.id)) continue
      // 单工具热度（2026-10-29）：组整体不热，但组里有几个工具最近真的被调用过 →
      // 只放这几个（only 白名单），其余继续收着。「桌面·点」37 个工具里只用 1 个时，
      // 不必为了那 1 个把 36 个一起放回来。最多放 3 个，避免把整组又拼回来。
      const hotTools = host
        .allToolNames()
        .filter((name) => g.res.some((re) => re.test(name)))
        .filter((name) => isToolHot(usageLedger, name, idleDays))
        .slice(0, 3)
      next.set(g.id, hotTools.length ? { mode: 'only', names: new Set(hotTools) } : { mode: 'hide', names: new Set() })
    }
    st.modes = next
  }
  const stateFor = (agent) => {
    let st = states.get(agent)
    if (!st) {
      // 会话开始的这一刻再算一次：apply() 时别的插件的工具可能还没注册完
      // （实测：DSH 2.0.20 冷启动时 mnemon 的工具晚于本插件）。autoGroups 按 id 去重，
      // 重复调用安全，所以这里不再用「算过一次就收手」的 settle 开关 —— 那会漏掉晚到的家族。
      autoGroups(true)
      st = { modes: new Map(), lifts: [], hiddenNames: [], seen: new Set(), level: null, idleDays: null }
      applyDefaults(st)
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
    // 解除旧限制：失败重试一次（学自 dsh-ops 的 clear()：孤儿限制比不解除更危险，
    // 它会让下一次 rebuild 叠在旧掩码上，出现"改了没生效"的假象）。
    const leftovers = []
    for (const lift of st.lifts) {
      let ok = false
      for (let attempt = 0; attempt < 2 && !ok; attempt += 1) {
        try {
          lift()
          ok = true
        } catch (error) {
          if (attempt === 1) {
            host.record('lift', error)
            leftovers.push(lift)
          }
        }
      }
    }
    st.lifts = leftovers
    if (leftovers.length) host.log('warn', `lift failed twice; ${leftovers.length} restriction(s) kept for retry`)
    PROCESS_LIFTS.delete(agent)
    // 用全局工具表算「该藏哪些」：agent 当前的可见表里缺的正是已经藏起来的。
    const all = host.allToolNames()
    const source = all.length ? all : host.toolNames(agent)
    const hidden = source.filter((name) => hiddenBy(st, name))
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
    // 记下「这个会话里真正挂载过的工具名」。用途只有一个：health 要能分清
    //   ① 宿主压根没挂到本会话（如 cua_driver_native__* 自 DSH 2.0.20 起挂不上）→ 静音待命；
    //   ② 挂过又不见了，且不是我们收的 → 真异常，必须响。
    // 没有这份记录，两种情况长得一模一样，只能一律报警 —— 报警久了就没人看了。
    if (!st.seen) st.seen = new Set()
    for (const name of host.toolNames(agent)) st.seen.add(name)
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

  // 没归任何组、也不是常驻/keep 的「裸名工具」—— 真正没人管的怪工具。
  // 只盯名字里没有下划线的（click / type_text / list_windows 这类）：
  // 有前缀但只有一两个的（weather / research / cache_search）是通用单例，
  // 分组没意义，也不该每轮催用户去分。
  const unclassifiedNames = (agent) => {
    const all = host.allToolNames()
    const source = all.length ? all : host.toolNames(agent)
    const kept = new Set()
    for (const g of groups) for (const name of Array.isArray(g.keep) ? g.keep : []) kept.add(name)
    return source
      .filter((name) => !CORE_TOOLS.has(name))
      .filter((name) => !kept.has(name))
      .filter((name) => !name.includes('_'))
      .filter((name) => !groups.some((g) => g.res.some((re) => re.test(name))))
      .sort()
  }

  const groupsView = (agent) => {
    const visible = host.toolNames(agent)
    const st = agent ? stateFor(agent) : { modes: new Map(), hiddenNames: [] }
    const all = host.allToolNames()
    const known = all.length ? all : [...new Set([...visible, ...st.hiddenNames])]
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
        hot: isHot(usageLedger, g.id, policy.idleDays),
        lastUsed: usageLedger.groups[g.id] || null,
      }
      // only 模式是有意的部分开启（自愈就靠它），别拿它去对 expect 的总数。
      if (typeof g.expect === 'number' && mode !== 'only') {
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
  // 3 秒冷却防的是「restrict 自己触发的 tools/change」打成死循环 —— 所以冷却必须盖在
  // **重建**上，不能盖在**检查**上。
  // 2026-10-28 对面复现的坑：原实现先盖时间戳再检查，冷启动时上游插件挤在 3 秒内注册的工具
  // 会被冷却吞掉；而之后不再有 tools/change 事件，那个工具整场可见、静默烧 token。
  const lastLeakCheck = new WeakMap()
  host.onToolsChange(() => {
    for (const agent of host.agentList()) {
      const st = states.get(agent)
      if (!st) continue
      const now = Date.now()
      if (now - (lastLeakCheck.get(agent) || 0) < 3000) continue
      const leaked = host.toolNames(agent).filter((name) => hiddenBy(st, name))
      if (!leaked.length) continue
      lastLeakCheck.set(agent, now)
      rebuild(agent)
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

  // 记「谁真的被调用过」：旁听 tools/pre-execute，只记账、不改决定。
  // 写盘节流 30 秒，避免每次调用都碰磁盘。
  let lastUsageSave = 0
  // 某个组**第一次**被记到时立刻落盘：组变热是稀疏事件，不该卡在 30 秒节流里。
  const savedGroups = new Set()
  host.onPreExecute((exec) => {
    const name = exec && exec.name
    if (!name) return
    const groupId = groupOf(name)
    const firstForGroup = Boolean(groupId) && !savedGroups.has(groupId)
    recordUsage(usageLedger, name, groupId)
    if (groupId) savedGroups.add(groupId)
    const now = Date.now()
    if (firstForGroup || now - lastUsageSave > 30000) {
      lastUsageSave = now
      if (!saveUsage(usageLedger)) host.log('warn', 'usage file write failed (kept in memory)')
    }
  })

  // 自愈：模型要调一个被我们藏起来的工具时，在 dispatch 前把它放出来，让它重试一次。
  // 用户全程无感。万一宿主对「未知工具」不跑守卫，这里也只是不生效，不会有副作用。
  host.onDispatchGuard((exec) => {
    const name = exec && exec.name
    const agent = exec && (exec.agent || exec.caller)
    if (!name || !agent) return null
    const groupId = groupOf(name)
    if (!groupId) return null
    const st = stateFor(agent)
    const m = st.modes.get(groupId)
    if (!m) return null
    if (m.mode === 'only' && m.names.has(name)) return null
    const names = m.mode === 'only' ? new Set([...m.names, name]) : new Set([name])
    st.modes.set(groupId, { mode: 'only', names })
    stats.selfHealed += 1
    host.log('info', `self-heal: revealed ${name} (group ${groupId})`)
    rebuild(agent)
    return `工具 ${name} 属于组 ${groupId}，已自动为你打开。请立刻用原参数重新调用同一个工具；不要向用户解释这次重试，也不要停下来等确认。`
  })

  // 斜杠命令：用户直接敲 /lazy-tools high，不必经过模型。
  try {
    const commands = ctx && typeof ctx.get === 'function' ? ctx.get('commands') : null
    if (commands && typeof commands.register === 'function') {
      const describe = (view) => {
        const on = (view.groups || []).filter((g) => g.on).map((g) => g.title || g.id)
        const which = view.session.level ? `档位 ${view.session.level}` : `跟随全局 ${view.session.idleDays} 天`
        return `工具抽屉：${which}${on.length ? `；开着 ${on.join('、')}` : '；全部收起'}`
      }
      host.own(
        commands.register({
          name: 'lazy-tools',
          description: '改当前会话的工具抽屉：high / medium / low / reset / off / <天数>',
          input: { hint: 'high | medium | low | reset | off | 7' },
          handler: (invocation) => {
            const agent = invocation && invocation.agent
            if (!agent) return { kind: 'error', text: '没有会话' }
            const raw = String((invocation && invocation.rawInput) || '').trim()
            const word = raw.toLowerCase()
            if (!raw) return { kind: 'success', text: describe(sessionView(agent)) }
            let spec = null
            if (word === 'reset' || word === '默认') spec = { reset: true }
            else if (word === 'off' || word === '全收' || word === '收起') spec = { collapseAll: true }
            else if (Object.prototype.hasOwnProperty.call(policy.presets, word)) spec = { level: word }
            else if (/^\d+$/.test(word)) spec = { idleDays: Number(word) }
            if (!spec) return { kind: 'error', text: `看不懂「${raw}」；可用：high / medium / low / reset / off / <天数>` }
            const result = applySessionPolicy(agent, spec)
            if (result.error) return { kind: 'error', text: result.error }
            return { kind: 'success', text: describe(result) }
          },
        }),
      )
      host.log('info', 'slash command /lazy-tools registered')
    }
  } catch (error) {
    host.record('commands.register', error)
  }
  // 设置页那条桥：客户端面板读写策略。webServer 没就绪时它会自己等。
  try {
    const unmountBridge = mountBridge(ctx, host, {
      getState: () => ({
        policy,
        groups: groups.map((g) => ({ id: g.id, title: g.title || g.id, expect: g.expect ?? null })),
        // 设置页「基础」那一页要显示的一句账。
        // 注意两件事：① states 是 WeakMap，没有 values()，只能走 host.agentList()；
        // ② 取**最大值**而不是求和 —— 每个会话/子 agent 各有一份自己的限制，
        //    相加会出现「已收纳 96 个」这种用户看不懂的数（实测两个会话各 48）。
        summary: {
          hidden: host.agentList().reduce((max, agent) => {
            const st = states.get(agent)
            const n = st && st.hiddenNames ? st.hiddenNames.length : 0
            return n > max ? n : max
          }, 0),
          selfHealed: stats.selfHealed,
        },
        app: 'dsh-lazy-tools',
      }),
      getSession: (sessionId) => {
        const agent = agentsGet(sessionId)
        return agent ? sessionView(agent) : { error: 'session not found' }
      },
      applySession: (sessionId, spec) => {
        const agent = agentsGet(sessionId)
        return agent ? applySessionPolicy(agent, spec) : { error: 'session not found' }
      },
      applyPolicy: (next) => {
        // 走 applyPolicyPatch：只改档位时天数跟着档位走（详见 api.js 里的注释）
        applyPolicyPatch(policy, next)
        host.log('info', `policy updated via settings: ${JSON.stringify(policy)}`)
      },
      record: (where, error) => host.record(where, error),
    })
    // 桥的返回值原来没人接（对面 2026-10-29 指出是死代码）：插件卸载后它还在回请求。
    // 挂到 ctx.effect 上，随插件生命周期一起关掉。
    if (typeof unmountBridge === 'function' && ctx && typeof ctx.effect === 'function') {
      ctx.effect(() => unmountBridge)
    }
  } catch (error) {
    host.record('bridge mount', error)
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
      const known = host.allToolNames().length ? host.allToolNames() : [...new Set([...visible, ...st.hiddenNames])]
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
      // 解除限制 ≠ 可用：工具可能根本没挂到本会话的工具表（插件未启用 / 需要重启）。
      // 那种情况下必须如实报失败，不能报 applied:true 让人白等一轮。
      if (!host.toolNames(agent).includes(target)) {
        host.record('resolve', new Error(`${target} 已解除本插件限制，但仍不在本会话工具表（可能插件未挂载或需要重启 DSH）`))
        return {
          ...base,
          applied: false,
          reason: 'not-visible',
          hint: '本插件的限制已经解除，但宿主仍没把这个工具交给本会话 —— 大概率没被挂载（插件未启用，或刚更新完需要重启 DSH）。抽屉开不了它。',
        }
      }
      return { ...base, applied: true, hint: '已只放这一个进来，同组其余仍收起' }
    },
  })

  // 会话级策略：只影响当前 agent 的默认开关，不动全局设置。
  // 工具 / 斜杠命令 / 输入框上方那个控件 都走这一条路，避免三份重复逻辑。
  const agentsGet = (sessionId) => {
    try {
      const service = ctx && typeof ctx.get === 'function' ? ctx.get('agents') : null
      return service && typeof service.get === 'function' ? service.get(sessionId) : null
    } catch (error) {
      host.record('agents.get', error)
      return null
    }
  }
  const sessionView = (agent) => {
    const st = stateFor(agent)
    return {
      showDock: policy.showDock === true,
      showClear: policy.showClear === true,
      classifyNudge: policy.classifyNudge !== false,
      presets: policy.presets,
      // 给输入框上方那一行用的账：「已收纳 N 个工具 · 自动取出 M 次」。
      // 比「开着 2 组」更像人话 —— 用户不知道一组里有多少东西。
      hiddenTools: st.hiddenNames.length,
      selfHealed: stats.selfHealed,
      // 档位下拉里「跟随全局（N 天）」要显示的数字
      globalIdleDays: policy.idleDays,
      session: {
        level: st.level,
        idleDays: sessionIdleDays(st),
        source: st.level || Number.isFinite(st.idleDays) ? 'session' : 'global',
      },
      groups: groupsView(agent).map((g) => ({ id: g.id, title: g.title, on: g.on, hot: g.hot, visible: g.visible })),
    }
  }
  const applySessionPolicy = (agent, spec) => {
    if (!agent) return { error: 'no agent' }
    const st = stateFor(agent)
    const input = spec || {}
    if (input.reset === true) {
      st.level = null
      st.idleDays = null
    } else {
      if (input.level !== undefined && input.level !== null) {
        if (!LEVEL_DAYS[input.level]) return { error: `level 只能是 ${Object.keys(LEVEL_DAYS).join(' / ')}` }
        st.level = input.level
        st.idleDays = policy.presets[input.level]
      }
      if (input.idleDays !== undefined && input.idleDays !== null) {
        const days = Number(input.idleDays)
        if (!Number.isFinite(days) || days < 0) return { error: 'idleDays 必须是 >= 0 的数字' }
        st.level = null
        st.idleDays = Math.round(days)
      }
    }
    if (input.collapseAll === true) {
      // 立刻全收：本会话就先这样，下个会话再按策略重算。
      st.modes = new Map(groups.map((g) => [g.id, { mode: 'hide', names: new Set() }]))
    } else {
      applyDefaults(st)
    }
    rebuild(agent)
    return sessionView(agent)
  }

host.registerTool({
    name: 'lazy_tools_mode',
    description:
      '只改**当前会话**的收敛策略：给 level 或 idleDays，立刻按新策略重算默认开哪些组；reset:true 恢复跟随全局设置。会覆盖本会话手动开关过的组。',
    parameters: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['low', 'medium', 'high'], description: '会话级档位' },
        idleDays: { type: 'number', description: '会话级闲置天数（覆盖档位）' },
        reset: { type: 'boolean', description: 'true = 清掉会话级覆盖，回到全局策略' },
        collapse: { type: 'boolean', description: 'true = 立刻把这个会话的所有组收起' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
    execute: async (args, exec) => {
      const agent = exec && exec.agent
      if (!agent) return { error: 'no agent scope' }
      const spec = { ...(args || {}) }
      if (spec.collapse === true) spec.collapseAll = true
      return applySessionPolicy(agent, spec)
    },
  })

  // 分类：把「没人管的怪工具」交给当前会话的 agent 自己判断（插件不内嵌模型）。
  host.registerTool({
    name: 'lazy_tools_classify',
    description:
      '列出所有没归组、也不在常驻白名单的工具（带描述与参数名），供 agent 自己按用途分组。分好后用 lazy_tools_save_groups 落盘，长期生效。',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '最多列几个（默认 80）' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
    execute: async (args, exec) => {
      const agent = exec && exec.agent
      const names = unclassifiedNames(agent)
      const limit = Number.isFinite(args && args.limit) ? Math.max(1, Math.round(args.limit)) : 80
      const byName = new Map(host.schemas(agent).map((item) => [item.name, item]))
      const tools = names.slice(0, limit).map((name) => {
        const schema = byName.get(name)
        const description = schema && typeof schema.description === 'string' ? schema.description : ''
        const params =
          schema && schema.parameters && schema.parameters.properties && typeof schema.parameters.properties === 'object'
            ? Object.keys(schema.parameters.properties).slice(0, 10)
            : []
        return { name, description: description.slice(0, 200), params }
      })
      return {
        total: names.length,
        shown: tools.length,
        tools,
        existingGroups: groups.map((g) => ({ id: g.id, title: g.title || g.id, match: g.match, keep: g.keep || [] })),
        instructions:
          '按用途分成 2–4 组（例：观察/只读、操作/会改状态、需要额外配置的能力）。每组至少 2 个工具，' +
          'id 用小写字母+连字符。不要包含常驻工具（如 pwsh/read/write/skill/lazy_tools_*）。' +
          '分好后调用 lazy_tools_save_groups：{ groups: [{ id, title, hint, match: ["工具名", …] }] }。',
      }
    },
  })

  host.registerTool({
    name: 'lazy_tools_save_groups',
    description:
      '把 agent 分好的组写进 ~/.dsh/lazy-tools.groups.json 并立刻生效（长期有效，用户随时可手改）。会做安全校验：含常驻工具、少于 2 个、与现有组重叠过多都会被拒。',
    parameters: {
      type: 'object',
      properties: {
        groups: {
          type: 'array',
          description: '组定义数组：{ id, title, hint?, match: [工具名…] }',
          items: { type: 'object' },
        },
        applyNow: {
          type: 'boolean',
          description: 'true 才立刻生效（会打断本会话前缀缓存）；默认只写文件、下次会话生效',
        },
      },
      required: ['groups'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
    execute: async (args, exec) => {
      const agent = exec && exec.agent
      const incoming = Array.isArray(args && args.groups) ? args.groups : []
      if (!incoming.length) return { saved: 0, issues: ['要 groups 数组'] }
      const known = new Set(host.allToolNames())
      const core = [...CORE_TOOLS]
      const issues = []
      const cleaned = []
      for (const raw of incoming) {
        const id = String((raw && raw.id) || '').trim()
        const match = Array.isArray(raw && raw.match) ? raw.match.map((name) => String(name)) : []
        if (!id) {
          issues.push('有条目缺 id')
          continue
        }
        if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
          issues.push(`${id}: id 只能小写字母/数字/连字符`)
          continue
        }
        if (match.length < 2) {
          issues.push(`${id}: 少于 2 个工具`)
          continue
        }
        const inCore = match.filter((name) => core.includes(name))
        if (inCore.length) {
          issues.push(`${id}: 含常驻工具 ${inCore.join(', ')} —— 这些不能被收起`)
          continue
        }
        const unknown = match.filter((name) => !known.has(name))
        if (unknown.length) {
          issues.push(`${id}: 未注册的名字 ${unknown.slice(0, 4).join(', ')}`)
          continue
        }
        const overlap = match.filter((name) => groups.some((g) => g.res.some((re) => re.test(name))))
        if (overlap.length / match.length > 0.8) {
          issues.push(`${id}: 与现有组重叠 ${Math.round((overlap.length * 100) / match.length)}%，没有意义`)
          continue
        }
        if (groups.some((g) => g.id === id)) {
          issues.push(`${id}: 组 id 已存在`)
          continue
        }
        cleaned.push({
          id,
          title: String((raw && raw.title) || id),
          hint: raw && raw.hint ? String(raw.hint) : undefined,
          match,
          defaultOn: false,
        })
      }
      if (!cleaned.length) return { saved: 0, issues }
      try {
        const existing = readUserGroups(host.record)
        const next = [...existing.filter((g) => !cleaned.some((c) => c.id === g.id)), ...cleaned]
        const file = writeUserGroups(next)
        // 默认只落盘、下次会话生效 —— 会话中途换工具表会打断前缀缓存，
        // 而「只在会话开始时决定收哪些工具」是本插件最核心的承诺。
        // 确实要现在生效的人显式传 applyNow: true，返回里会写明代价。
        const applyNow = args && args.applyNow === true
        if (applyNow && agent) {
          for (const c of cleaned) {
            const res = c.match.map((pattern) => matcherFor(pattern)).filter(Boolean)
            if (res.length) groups.push({ ...c, expect: c.match.length, res })
          }
          const st = stateFor(agent)
          applyDefaults(st)
          rebuild(agent)
        }
        host.log('info', `groups saved: ${cleaned.map((c) => c.id).join(', ')} (file ${file}, applyNow=${applyNow})`)
        return {
          saved: cleaned.length,
          ids: cleaned.map((c) => c.id),
          file,
          appliedNow: applyNow && Boolean(agent),
          issues,
          note: applyNow
            ? '已立刻生效（会打断本会话的前缀缓存）。'
            : '已写入文件，下次会话开始时生效（不打断当前会话缓存）。要现在生效就带上 applyNow: true。',
        }
      } catch (error) {
        host.record('save groups', error)
        return { saved: 0, issues: [...issues, `写文件失败：${error && error.message ? error.message : String(error)}`] }
      }
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
        // 自动分组建议（policy.autoGroups=off 时为空）：调用时现算，避免冷启动顺序带来的空结果
        autoGroups: (() => {
          const fresh = autoGroups(false)
          return { mode: fresh.mode, applied: fresh.applied, suggestions: fresh.suggestions, skipped: fresh.skipped }
        })(),
      }
    },
  })

  // 基准：把「工具 schema 税」量成可复现的数字（字符数，不猜 token）。
  // 任何人都能在自己机器上跑同一条命令对比，README 里的估算因此可被检验。
  host.registerTool({
    name: 'lazy_tools_bench',
    description:
      '量「工具定义占多少字符」：全部工具、当前收起、以及每组各占多少。用来验证「收起到底省了多少」，也是 README 数字的来源。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
    execute: async (_args, exec) => {
      const agent = exec && exec.agent
      // 必须读全局注册表：被收起的工具不在 agent 的可见 schema 里，
      // 用 agent 视角会把它们漏掉，hiddenChars 永远是 0。
      const schemas = host.schemas()
      const visible = new Set(host.toolNames(agent))
      const chars = (schema) => {
        try {
          return JSON.stringify({
            name: schema.name,
            description: schema.description || '',
            parameters: schema.parameters || {},
          }).length
        } catch {
          return 0
        }
      }
      const stBench = agent ? stateFor(agent) : { hiddenNames: [] }
      const hiddenSet = new Set(stBench.hiddenNames)
      // 「全局注册」≠「本会话能用」：宿主可能压根没把某个插件挂到本会话（实测 cua_driver_native__*）。
      // 那些工具从没进过上下文，把它们算成「收起省下的」就是虚报。
      // 三态记账：visible（在表里）/ hidden（我们收的）/ absent（宿主没挂 —— 省不了，也不该算）。
      const absent = (name) => !visible.has(name) && !hiddenSet.has(name)
      const rows = []
      let totalChars = 0
      let hiddenChars = 0
      let hiddenCount = 0
      let absentTools = 0
      let absentChars = 0
      let visibleInRegistry = 0
      for (const group of groups) {
        let groupChars = 0
        let groupCount = 0
        let groupHidden = 0
        let groupHiddenChars = 0
        let groupAbsent = 0
        let groupAbsentChars = 0
        for (const schema of schemas) {
          if (!group.res.some((re) => re.test(schema.name))) continue
          const size = chars(schema)
          if (absent(schema.name)) {
            groupAbsent += 1
            groupAbsentChars += size
            continue
          }
          groupChars += size
          groupCount += 1
          if (!visible.has(schema.name)) {
            groupHidden += 1
            groupHiddenChars += size
          }
        }
        if (groupCount || groupAbsent) rows.push({ group: group.id, tools: groupCount, hidden: groupHidden, chars: groupChars, hiddenChars: groupHiddenChars, absent: groupAbsent, absentChars: groupAbsentChars })
      }
      for (const schema of schemas) {
        const size = chars(schema)
        if (absent(schema.name)) {
          absentTools += 1
          absentChars += size
          continue
        }
        totalChars += size
        if (visible.has(schema.name)) visibleInRegistry += 1
        if (!visible.has(schema.name)) {
          hiddenChars += size
          hiddenCount += 1
        }
      }
      // 这张会话工具表里有、但没有登记在本注册表里的名字（排序后给）。存在的意义：
      // 「bench 说 135 可见、却只有 101 在册」这种对不上账的问题，光看数字只能猜，
      // 给出名字才能去查是谁注册的（2026-10-28 加：当时 34 个无处可查）。
      const registryNames = new Set(schemas.map((s) => s.name))
      const outsideNames = [...visible].filter((n) => !registryNames.has(n)).sort()
      return {
        tools: schemas.length,
        visible: visible.size,
        visibleInRegistry,
        visibleOutsideRegistry: visible.size - visibleInRegistry,
        outsideRegistryNames: outsideNames,
        hidden: hiddenCount,
        absent: absentTools,
        // 三态只在本注册表内互斥：visibleInRegistry + hidden + absent === tools。
        // visible 是这个会话的**整张**工具表，其中有 34 个不归本注册表管（实测 135 = 101 + 34，
        // 2026-10-28），所以 visible + hidden + absent 会大于 tools —— 要对账请用 visibleInRegistry。
        // totalChars 只算「本会话相关的」（visibleInRegistry + hidden）；absent 从没进过上下文，
        // 算进来就成了「省下了一个从来没花的钱」，所以单列在 absentChars。
        totalChars,
        visibleChars: totalChars - hiddenChars,
        hiddenChars,
        absentChars,
        // 只给字符数，不硬编 token 换算系数：不同语言/描述密度差别很大。
        // 想换算的人自己按 provider 的实际 tokenizer 除。
        groups: rows.sort((a, b) => b.hiddenChars - a.hiddenChars),
        note: '字符数是实测（name + description + parameters 的 JSON 长度）；token 请按你自己 provider 的 tokenizer 换算。absent = 注册了但宿主没挂到本会话的工具，从没进过上下文，所以不计入「省下」；它变成 0 就说明所有工具都真的到了会话里。',
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
      const known = host.allToolNames().length ? host.allToolNames() : [...new Set([...visible, ...st.hiddenNames])].sort()
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
    description: '自检：DSH 四个契约还在不在（register / schemas / restrict / agent 事件）、版本号、上次 hidden 数。升级排查先跑它。可选 tool 参数：查一个工具名到底卡在哪一层（全局注册 / agent 可见 / 是否只剩 run_code）。',
    parameters: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: '可选：要追查的工具名，例如 cua_driver_native__get_desktop_state' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
    execute: async (_args, exec) => {
      const agent = exec && exec.agent
      const probe = host.probe(agent)
      const names = host.toolNames(agent)
      const counters = host.counters()
      const errors = host.errors()
      const st = agent ? stateFor(agent) : { hiddenNames: [], seen: new Set() }
      if (!st.seen) st.seen = new Set()
      // 每次自检都采样一次当前工具表：宿主中途把插件挂上来（或又撤走）时，
      // 只靠 rebuild 那一刻的采样会漏掉，分类就会撒谎。
      for (const name of names) st.seen.add(name)
      const known = [...new Set([...names, ...st.hiddenNames])]
      const stray = strayNames(known, names)
      const view = groupsView(agent)
      const warnings = []
      const notes = []
      const hiddenSet = new Set(st.hiddenNames)
      const seenSet = st.seen || new Set()
      const registeredAll = host.allToolNames()
      const namesOf = (id) => {
        const def = groups.find((g) => g.id === id)
        if (!def) return []
        const pool = registeredAll.length ? registeredAll : known
        return pool.filter((name) => def.res.some((re) => re.test(name)))
      }
      for (const g of view) {
        if (typeof g.expect === 'number' && !g.expectOk) {
          warnings.push(`${g.id}: matched ${g.matched} ≠ expect ${g.expect}${g.matched < g.expect ? '（少的那几个可能已改名/未加载）' : '（多出来的是新工具，正则可能要补）'}`)
        }
        if (!g.on || g.matched === 0 || g.visible > 0) continue
        // 组开着却一个都不可见，有三种根因，处理方式各不相同 —— 一律报警会训练人忽略警报：
        //   ① 我们收起了却没还回来（restrict 撤销失败）→ 真故障，必须响；
        //   ② 这些工具在本会话里挂载过、现在不见了，也不是我们收的 → 真异常，必须响；
        //   ③ 从来没挂载过 → 宿主没把它们给这个会话（实测 cua_driver_native__* 自 DSH 2.0.20 起如此）。
        //      这种抽屉治不了，改成「静音待命」：只进 notes，不拉低 healthy。宿主哪天真挂上来，
        //      g.visible 就大于 0，这段不再进，监控自动恢复 —— 不需要用户做任何事。
        const inGroup = namesOf(g.id)
        const ours = inGroup.filter((name) => hiddenSet.has(name))
        const vanished = inGroup.filter((name) => seenSet.has(name) && !hiddenSet.has(name))
        if (ours.length) {
          warnings.push(`${g.id}: 组是开的，但有 ${ours.length} 个被我们收起的工具没还回来 —— restrict 撤销没生效。先 lazy_tools_disable 再 enable；不行就重启`)
        } else if (vanished.length) {
          warnings.push(`${g.id}: 这 ${vanished.length} 个工具本会话里出现过、现在不见了，也不是抽屉收的 —— 查宿主为什么撤了工具表（改名 / 插件被禁 / restrict 被别的插件覆盖）`)
        } else {
          // 别猜。拿组里第一个名字做 DSH 作者给的两层 lookup（#11207），把「没挂载」拆成两种实测：
          //   global 查不到        → 真的没注册
          //   global 有、agent 有、工具表没有 → 被 schemas(agent) 这一层滤了（不是抽屉、不是 restrict）
          // 2026-10-30 实测 cua_driver_native__* 属于第二种；run_code 在这个版本里根本不存在。
          const probeName0 = inGroup[0] || ''
          const p = probeName0 ? host.probeName(probeName0, agent) : null
          // 三态，全部来自实测（不是猜）：
          //   not-registered      全局 get 都查不到 → 真没注册
          //   agent-filtered      全局有、agent 作用域没有 → 被作用域过滤器挡（限制取交集）
          //   filtered-by-schemas 两层都查得到、却不在工具表 → 被 schemas(agent) 这一层滤掉
          //   unverified          宿主没提供 get()，量不了 —— 明说量不了，不编原因
          const state2 = !p
            ? 'unverified'
            : p.global === false
              ? 'not-registered'
              : p.global === true && p.agent === false
                ? 'agent-filtered'
                : p.global === true && p.agent === true
                  ? 'filtered-by-schemas'
                  : 'unverified'
          g.blocked = state2
          g.blockedTools = g.matched
          if (p) g.blockedProbe = p
          const measured = p ? `（实测 ${probeName0}: global=${p.global} / agent=${p.agent}）` : ''
          notes.push(
            state2 === 'filtered-by-schemas'
              ? `${g.id}: 这 ${g.matched} 个工具注册了、agent 作用域也解析得到，但没进本会话工具表 ${measured} —— 被 schemas(agent) 过滤，不是抽屉收的，抽屉也解不开`
              : state2 === 'agent-filtered'
                ? `${g.id}: 这 ${g.matched} 个工具在全局有、在 agent 作用域查不到 ${measured} —— 被某个作用域过滤器挡了（限制在作用域链上取交集）`
                : state2 === 'not-registered'
                  ? `${g.id}: 这 ${g.matched} 个名字在全局注册表里查不到 ${measured} —— 插件没注册成功`
                  : `${g.id}: 这 ${g.matched} 个工具不在本会话工具表；宿主没提供 get()，量不出卡在哪一层 ${measured}`,
          )
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
      // 客户端心跳：宿主正常 ≠ 浏览器那边挂上了。没上报过就明说没上报，不要假装绿。
      const ping = clientPing()
      const client = ping
        ? {
            seen: true,
            at: ping.at,
            agoSeconds: Math.max(0, Math.round((Date.now() - Date.parse(ping.at)) / 1000)),
            panels: ping.panels,
          }
        : { seen: false, hint: '客户端还没上报过（面板可能没挂上：重启后仍为 false 就查 browser 控制台）' }

      // 可选诊断：查一个名字到底卡在哪一层。
      // 2026-10-30 按 DSH 作者的第二封邮件更正：`get(name)` 省略第二参数 = **全局视图**，
      // 要量「这个 agent 的作用域」必须 `get(name, agent)`（与 schemas(agent) 同一个视图）。
      // 另附 agent preset 的两个事实：defaultId（新会话默认）与 composedPreset(agent.ctx)（本 agent 实际挂的）。
      let nameProbe = null
      const wanted = _args && typeof _args.tool === 'string' ? _args.tool : ''
      if (wanted) {
        nameProbe = host.probeName(wanted, agent)
        nameProbe.inAgentTable = names.includes(wanted)
        nameProbe.runCodeInTable = names.includes('run_code')
        const presets = (() => {
          try {
            return agent && agent.ctx && typeof agent.ctx.get === 'function' ? agent.ctx.get('agentPresets') : null
          } catch (error) {
            return null
          }
        })()
        nameProbe.defaultPreset = presets && presets.defaultId !== undefined ? presets.defaultId : null
        nameProbe.composedPreset =
          presets && typeof presets.composedPreset === 'function' ? presets.composedPreset(agent.ctx) ?? null : null
        nameProbe.hint =
          nameProbe.global === false
            ? '全局注册表里就没有这个名字 —— 不是作用域过滤的问题'
            : nameProbe.scoped === false
              ? '全局有、**作用域视图**没有（get(name, agent)=false）⇒ 作用域链上有个过滤器挡它（可能是别人加的，空 deny 抵消不了另一个过滤）'
              : nameProbe.scoped === true && nameProbe.inAgentTable === false
                ? '作用域视图有、schemas(agent) 里没有 ⇒ 作者说这说明要对着已装构建进一步查（两者本该一致）'
                : '全局有、作用域有、也在 schemas(agent) 里 —— 注册层面没问题，往「出站工具表 / 呈现模式」方向查'
      }

      return {
        ok: contracts.every((c) => c.ok),
        // 销毁竞态（'agent 已销毁'）是宿主的生命周期，不是我们的病：它以证据留在 errors 里，
        // 但不许把 healthy 拖成 false，否则每轮都在替宿主挨刀（2026-10-30 实测）。
        healthy:
          contracts.every((c) => c.ok) &&
          errors.filter((e) => !String((e && e.where) || '').includes('agent 已销毁')).length === 0 &&
          warnings.length === 0,
        checkedAt: nowIso(),
        contracts,
        client,
        groups: view,
        policy,
        nameProbe,
        warnings,
        notes,
        stray,
        usage: usageView(),
        stats: {
          agentCreated: counters.agentCreated,
          toolsChanged: counters.toolsChanged,
          restrictCalls: counters.restrictCalls,
        restrictSkipped: counters.restrictSkipped,
          restrictFailures: counters.restrictFailures,
          hideEvents: stats.hideEvents,
          autoOpened: stats.autoOpened,
          selfHealed: stats.selfHealed,
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
        const promptText = () => {
          // 能力目录（2026-10-29）：只列「组 id + 中文标题」，不列工具全名。
          // 为什么要这点成本：模型知道某个能力存在才会去调；组被收起后它连名字都看不到，
          // 自愈也就没机会触发。代价约 +50 token/轮，换「知道抽屉里有什么」。
          const base =
            `工具抽屉（lazy-tools）：${groups.map((g) => (g.title ? `${g.id}(${g.title})` : g.id)).join(' / ')} 默认收起。` +
            '工具报 unknown 时先调 lazy_tools_status（含每组用途与工具数）；需要时 lazy_tools_enable {group, only:[…]}；排查用 lazy_tools_health。'
          // 有「没人管的怪工具」时提一句：让当前会话的 agent 自己分类（一次，落盘后长期生效）。
          let loose = []
          try {
            loose = unclassifiedNames(null)
          } catch {
            loose = []
          }
          if (policy.classifyNudge === false || loose.length < 3) return base
          const head = loose.slice(0, 6).join(', ')
          return (
            base +
            ` 另有 ${loose.length} 个工具没归组、也没有共同前缀：${head}${loose.length > 6 ? ' …' : ''}。` +
            '请调 lazy_tools_classify 读描述、按用途分组，再用 lazy_tools_save_groups 落盘（一次即可，长期生效）。'
          )
        }
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
