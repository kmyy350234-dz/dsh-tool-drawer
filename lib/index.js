// lazy-tools — 把「很重但平时不用」的工具组从上下文里收起来，需要时再开。
//
// 机制：每个 agent 创建时，按配置把该组里的工具从**它自己的作用域**里 restrict 掉
// （DSH 的 restrict 只能藏全局工具，藏不了自己 scope 注册的）；enable/disable 就是
// 解除 / 重建这条限制。宿主契约全在 host.js，这里只管组装；工具定义在 lib/tools/。
//
// 八个工具：status / roles / enable / disable / mode / save_groups / list / health
// 契约与实测记录：perf-\lazy-tools-接线说明-20261022.md

import { createHost } from './host.js'
import { createHeat } from './heat.js'
import { matcherFor, compileGroups, commonPrefix, membersOf, groupOf } from './groups-core.js'
import { createStrayNames, createUnclassifiedNames } from './diagnostics.js'
import { createGroupsView } from './views.js'
import { createSessionApi } from './session-api.js'
import { createSessionState } from './session-state.js'
import { createRebuild } from './rebuild.js'
import { createLeakGuard } from './leak.js'
import { createAutoGroups } from './auto-groups.js'
import { createCounters } from './counters.js'
import { createRoleRuntime } from './role-runtime.js'
import { installAgentCreated, installToolsChange, installPreExecute, installDispatchGuard, installPresetSelected } from './events.js'
import { installSlash } from './slash.js'
import { installBridge } from './bridge.js'
import { reclaimPreviousLifts, catchUpAgents } from './catchup.js'
import { createUsageLog } from './usage-log.js'
import { createAgentsGet } from './agents.js'
import { selectorSchema, idsFrom } from './selector.js'
import { text, nowIso, loadPolicy } from './startup.js'
import { Config } from './config.js'
import { readStoredPolicyStrict, readPolicyRaw, clientPing, readUserGroups, writeUserGroups, applyPolicyPatch, policyFileMtime, writeStoredPolicy } from './api.js'
import { loadUsage, saveUsage, recordUsage, LEVEL_DAYS } from './usage.js'
import { suggestGroups, normalizeAutoMode, CORE_TOOLS } from './autogroups.js'
import { applyManagedRolesPatch, normalizeManagedRoles, resolveManagedRole, isAllowedByPolicy, auditManagedRoles, labelRoleCandidates, labelOfSession } from './roles.js'
import { createPrompt, mountPromptSection } from './prompt.js'
import { createTools } from './tools/index.js'

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

// 受管角色允许隐藏的 CORE 写工具：review/research 要能真正只读（read/pwsh/glob/grep 仍保留）。
// 这正是 2026-11-06 实测的边界：以前所有 CORE 都不能藏，review 只能靠提示词。
const ROLE_HIDEABLE_CORE = new Set(['edit', 'write'])

const DEFAULT_GROUPS = [
  {
    id: 'web',
    match: ['web_search', 'web_fetch', 'platform_search', 'domain_search', 'research', 'read_page', 'x_search', 'multi_search', 'advanced_search', 'video_search', 'weather', 'cache_search'],
    title: '搜索·联网',
    defaultOn: false,
  },
  {
    id: 'schedule',
    match: ['schedule_create', 'schedule_list', 'schedule_view', 'schedule_edit'],
    title: '定时任务',
    defaultOn: true,
  },
  {
    id: 'cua-screen',
    match: [CUA_SCREEN],
    title: '桌面·看',
    defaultOn: false,
  },
  {
    id: 'cua-input',
    match: [CUA_INPUT],
    title: '桌面·点',
    defaultOn: false,
  },
]

export function sessionSelfHealed(st) {
  return st && Number.isFinite(st.selfHealed) ? st.selfHealed : 0
}

export function apply(ctx, config) {
  const host = createHost(ctx)
  // 0.17.0 删除 autoHints 后，旧配置的兼容提示（按组只记一次，不进 errors、不拖 healthy）。
  // 必须声明在 compileGroups 之前：组编译在 apply 早期就执行。
  const compatNotes = new Set()
  const cfg = config && typeof config === 'object' ? config : {}
  // 设置页里那几个全局字段：先读配置，再让「设置页写下的策略文件」覆盖它。
  // 于是 UI 改完立即生效，YAML 里仍然可以写死默认值。
  // 2026-11-03（冷读红 2 启动路径）：读失败**不许**静默退回默认 —— 那会连 level 一起悄悄改掉，
  // 而且 healthy 还是 true。启动路径和热重载必须同一条语义：读不出来就记账，按配置/默认跑，但必须响。
  const policy = loadPolicy({ cfg, host, readStoredPolicyStrict, LEVEL_DAYS, normalizeAutoMode, normalizeManagedRoles }).policy
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
  // 用户手写组：来源两处 —— 配置里的 extraGroups（loader 层）与独立文件
  // ~/.dsh/lazy-tools.groups.json（设置页保存不会冲掉它）。
  const fileGroups = readUserGroups(host.record)
  const extraGroups = [...(Array.isArray(cfg.extraGroups) ? cfg.extraGroups : []), ...fileGroups]
  // 把一批组定义编译成 { ...g, res }：无效条目跳过并记账；expect 夹成有限正整数。
  // 2026-10-30 对抗测试：手写 groups 全无效时不能静默什么都不注册（见下方 fallback）。
  // 2026-10-31：手写组与出厂组分开编译 —— 只有手写组需要「全匹配」防线。
  const cfgGroups = Array.isArray(cfg.groups) && cfg.groups.length ? cfg.groups : null
  let groups = [
    ...compileGroups(cfgGroups || DEFAULT_GROUPS, Boolean(cfgGroups), { host, compatNotes }),
    ...compileGroups(extraGroups, true, { host, compatNotes }),
  ]
  if (!groups.length) {
    // 用户给的组全无效（null / 缺 match / 正则全坏）→ 退回出厂四组，并且必须响。
    // 否则插件会「装上了但一个工具都不注册」，用户连 health 都调不到（2026-10-30 对抗测试）。
    host.log('warn', 'all configured groups were invalid; falling back to the default groups')
    host.record('groups', new Error('配置里的组全部无效，已退回默认四组'))
    groups = compileGroups(DEFAULT_GROUPS, false, { host, compatNotes })
  }

  // managedRoles 的 allowGroups 必须对着**当前真实存在的组**校验（2026-11-02，外部评审指出）。
  // 不校验的后果：照抄文档里那串不存在的组 id ⇒ 受管会话把所有组都藏起来，而受管会话里
  // enable/disable 被拒、自愈也不绕过 ⇒ 会话内没有任何自救路径，且**全程静默**。
  // 规则见 roles.js 的 auditManagedRoles：全错就停用该角色（退回普通行为），部分错只报不删。
  // 2026-11-03：抽成函数 —— 热重载也要走**同一套**校验（同一判据只留一个入口）。
  // 2026-11-03（冷读第三轮）：审计**不再就地删除**。`groups` 是会长的（autoGroups 在会话起手时
  // 补晚到的家族），就地删掉的角色在组补上后也回不来 ——「第一次会话早于 mnemon 注册」就会把合法的
  // auto-* 角色永久删掉（fail-open，而且报的是假错误）。现在保留一份**配置源**，组表变了就派生
  // 生效表；删掉的角色在组补上后自动回来。
  const states = new WeakMap()
  const roleStore = { source: policy.managedRoles || null }
  // 工具（lib/tools/roles.js）要写回这两个 let：跨模块赋值只能走 setter ——
  // 那正是「搬出去之后不再有隐式闭包」的证据，显式两行比看不见的闭包好查。
  const setRoleSource = (v) => {
    roleStore.source = v
  }
  const { refreshManagedRoles, reloadManagedRolesIfChanged, setPolicyMtime } = createRoleRuntime({
    host,
    cfg,
    policy,
    groups,
    states,
    roleStore,
    auditManagedRoles,
    resolveManagedRole,
    normalizeManagedRoles,
    readStoredPolicyStrict,
    policyFileMtime,
    getAutoGroups: () => autoGroups,
    getRebuild: () => rebuild,
  })

  // 2026-10-31 结构性防线（回答「宿主工具名会变，名单追不动」）：
  // 手写组若匹配到**整张可隐藏工具表**，判定为误配，整组忽略并记账。
  // 这条规则不依赖任何名字清单 —— 宿主把 pwsh 换成 ops_* 也照样兜住。
  const guardWarned = new Set()
  const warnManualGuard = (g, count) => {
    if (guardWarned.has(g.id)) return
    guardWarned.add(g.id)
    host.log('warn', `manual group ${g.id} matches every hideable tool; ignored`)
    host.record('group guard', new Error(`手写组 ${g.id} 匹配了全部 ${count} 个可隐藏工具，疑似误配，已忽略 —— 不会收任何工具`))
  }

  const autoGroups = createAutoGroups({ host, policy, groups, suggestGroups, matcherFor })
  autoGroups(true)

  const { stats, persistCounts } = createCounters({ host, usageLedger })

  const { sessionIdleDays, warmGroups, applyDefaults } = createHeat({
    policy,
    groups,
    usageLedger,
    allToolNames: () => host.allToolNames(),
    membersOf: (g, pool) => membersOf(g, pool || host.allToolNames()),
    warnManualGuard,
  })
  const groupOfName = (name) => groupOf(name, groups)
  const { stateFor, hiddenBy } = createSessionState({
    states,
    policy,
    autoGroups,
    refreshManagedRoles,
    resolveManagedRole,
    applyDefaults,
    labelRoleCandidates,
    labelOfSession,
    CORE_TOOLS,
    groupOf: groupOfName,
  })

  // 串行化入口：同一个 agent 同时只允许一个 rebuild 在跑；跑的过程中再被叫，
  // 只记一个「待办」标记，等当前这轮结束后立刻补跑一轮（这样晚注册的工具也不会被吞）。
  // 为什么必须这样：见 stateFor 里 rebuilding / pendingRebuild 的注释（重入会把 lift 句柄覆盖掉）。
  const { rebuild } = createRebuild({
    host,
    stateFor,
    stats,
    PROCESS_LIFTS,
    CORE_TOOLS,
    ROLE_HIDEABLE_CORE,
    isAllowedByPolicy,
    groupOf: groupOfName,
    hiddenBy,
    nowIso,
  })

  // 最长公共前缀：用来猜「这一组工具的名字家族」。
  // 例如 cua 组已知名的公共前缀是 `cua_driver_native__`，那么之后新出现的
  // `cua_driver_native__xxx` 只要没被组匹配，就该被当成漏网报出来。
  const strayNames = createStrayNames({ groups, membersOf, commonPrefix })
  const unclassifiedNames = createUnclassifiedNames({ groups, allToolNames: () => host.allToolNames(), toolNames: (agent) => host.toolNames(agent) })

  const groupsView = createGroupsView({
    host,
    groups,
    stateFor,
    membersOf,
    sessionIdleDays,
    usageLedger,
    policy,
    guardWarned,
  })

  // 提示段 + 会话快照（2026-11-03 搬去 lib/prompt.js）。依赖全部显式注入，
  // 于是「该列哪些组」这个判据只在这里生成一次，提示段和 health 共用它。
  const promptApi = createPrompt({
    host,
    groups,
    membersOf: (g, pool) => membersOf(g, pool || host.allToolNames()),
    groupOf: groupOfName,
    states,
    policy,
    usageLedger,
    unclassifiedNames,
    isAllowedByPolicy,
  })

  const { touch, usageView } = createUsageLog({ nowIso })

  installAgentCreated({ host, reloadManagedRolesIfChanged, rebuild })

  // 时序兜底：插件可能比工具先加载（第一次算出的 hidden 会是 0），上游升级新增工具也会走这里。
  // 只在「发现漏网」（本该藏却可见）时才重建；重建后漏网消失，所以不会自激循环。
  // 3 秒冷却防的是「restrict 自己触发的 tools/change」打成死循环 —— 所以冷却必须盖在
  // **重建**上，不能盖在**检查**上。
  // 2026-10-28 对面复现的坑：原实现先盖时间戳再检查，冷启动时上游插件挤在 3 秒内注册的工具
  // 会被冷却吞掉；而之后不再有 tools/change 事件，那个工具整场可见、静默烧 token。
  const { reconcileLeaks, restrictableSigOf, dispose: disposeLeakTimers } = createLeakGuard({
    host,
    states,
    hiddenBy,
    rebuild,
  })

  installToolsChange({ host, states, restrictableSigOf, reconcileLeaks })
  // 卸载/热重载时清掉待办定时器 —— 孤儿定时器会和孤儿限制一样难查。
  try {
    if (typeof ctx.effect === 'function') ctx.effect(() => disposeLeakTimers)
  } catch (error) {
    host.record('effect', error)
  }

  // 关键词预开（autoHints）已于 2026-10-31 删除，见 CHANGELOG 0.17.0；旧配置写法会被记一条 health.notes 提示（不是 errors）。
  // 理由：判定词无穷且不可维护；自动入口改为「消息里的数据类型」（见后续版本），
  // 其余靠模型自己 enable + 自愈兜底。删掉时内置四组确实在用它，所以这是一次真实的功能删除。

  installPreExecute({
    host,
    groupOf: groupOfName,
    usageLedger,
    recordUsage,
    saveUsage,
    persistCounts,
  })

  installDispatchGuard({
    host,
    groupOf: groupOfName,
    stateFor,
    stats,
    persistCounts,
    saveUsage,
    usageLedger,
    rebuild,
  })

  installSlash({
    ctx,
    host,
    policy,
    getSessionView: () => sessionView,
    getApplySessionPolicy: () => applySessionPolicy,
  })

  installBridge({
    ctx,
    host,
    policy,
    groups,
    states,
    stats,
    roleStore,
    getAgent: (sessionId) => agentsGet(sessionId),
    getSessionView: () => sessionView,
    getApplySessionPolicy: () => applySessionPolicy,
    applyManagedRolesPatch,
    applyPolicyPatch,
    refreshManagedRoles,
    setPolicyMtime,
  })

  // 会话级策略：只影响当前 agent 的默认开关，不动全局设置。
  // 工具 / 斜杠命令 / 输入框上方那个控件 都走这一条路，避免三份重复逻辑。
  const agentsGet = createAgentsGet({ ctx, host })

  installPresetSelected({
    ctx,
    host,
    policy,
    states,
    agentsGet,
    resolveManagedRole,
    applyDefaults,
    rebuild,
  })

  const { sessionView, applySessionPolicy } = createSessionApi({
    stateFor,
    policy,
    groups,
    groupsView,
    sessionIdleDays,
    sessionSelfHealed,
    LEVEL_DAYS,
    applyDefaults,
    rebuild,
  })

  // ── 8 个工具的定义在 lib/tools/（2026-11-03，第 2 批重构）──────────────────────
  // 为什么注册点挪到这里：这些定义依赖 apply() 里逐段建起来的闭包（applySessionPolicy /
  //   会话视图 / 组视图 / 读写策略 …），必须等它们全部就绪；顺序由 tools/index.js 拼出来，
  //   是硬要求（status, roles, enable, disable, mode, save_groups, list, health）。
  const toolDefs = createTools({
    host, groups, groupsView, idsFrom, membersOf: (g, pool) => membersOf(g, pool || host.allToolNames()), rebuild, selectorSchema, stateFor, touch, text,
    applySessionPolicy, applyDefaults, CORE_TOOLS, matcherFor, readUserGroups, unclassifiedNames,
    writeUserGroups, autoGroups,
    policy, normalizeManagedRoles, policyFileMtime, readPolicyRaw, refreshManagedRoles,
    writeStoredPolicy, setPolicyMtime, setRoleSource,
    states, stats, compatNotes, promptApi, clientPing, strayNames, usageView, nowIso,
  })
  for (const def of toolDefs) host.registerTool(def)

  const reclaimed = reclaimPreviousLifts({ host, PROCESS_LIFTS })

  const caughtUp = catchUpAgents({ host, rebuild })

  // ── 会话级目录（2026-11-03 起在 lib/prompt.js）────────────────────────────
  // 为什么搬走：这段和 health 的「会话快照」是**同一个判据**，必须只留一个入口。
  // 依赖全部显式注入（host / groups / states / policy / usageLedger / …），见 prompt.js。
  mountPromptSection(ctx, promptApi, host)

  host.log(
    'info',
    `loaded in root scope; groups=${groups.map((g) => g.id).join(',')} level=${policy.level} caughtUp=${caughtUp} reclaimed=${reclaimed}`,
  )
}
