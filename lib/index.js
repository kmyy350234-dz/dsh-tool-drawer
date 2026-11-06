// lazy-tools — 把「很重但平时不用」的工具组从上下文里收起来，需要时再开。
//
// 机制：每个 agent 创建时，按配置把该组里的工具从**它自己的作用域**里 restrict 掉
// （DSH 的 restrict 只能藏全局工具，藏不了自己 scope 注册的）；enable/disable 就是
// 解除 / 重建这条限制。宿主契约全在 host.js，这里只管组逻辑和七个工具。
//
// 七个工具：status / enable / disable / list / health / mode / save_groups（0.16.0 由 11 个合并）
//             classify / save_groups（L7 的旧注释写着「六个」——对面 2026-10-28 指出来，已更正）
// 契约与实测记录：perf-\lazy-tools-接线说明-20261022.md

import { createHost } from './host.js'
import { Config } from './config.js'
import { mountBridge, readStoredPolicy, readStoredPolicyStrict, readPolicyRaw, clientPing, readUserGroups, writeUserGroups, applyPolicyPatch, policyFileMtime, writeStoredPolicy } from './api.js'
import { loadUsage, saveUsage, recordUsage, isToolHot, hotRatio as usageHotRatio, LEVEL_DAYS } from './usage.js'
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
  const storedRead = (() => {
    try {
      return readStoredPolicyStrict()
    } catch (error) {
      return { ok: false, error }
    }
  })()
  const stored = storedRead.ok && storedRead.policy ? storedRead.policy : {}
  if (!storedRead.ok) {
    host.record(
      'policy file',
      new Error(`policy.json 读不出来（${String((storedRead.error && storedRead.error.message) || storedRead.error)}）—— 本次按插件配置/默认值启动，磁盘上的设置没有被应用`),
    )
  }
  const pickNumber = (a, b, fallback) => (Number.isFinite(a) ? a : Number.isFinite(b) ? b : fallback)
  // 比例类参数（0~1）：夹到 [0.05, 1]，防手改文件写成 0 或 12 导致「永不整组开 / 一热就全开」。
  const pickRatio = (a, b, fallback) => {
    const raw = Number.isFinite(a) ? a : Number.isFinite(b) ? b : fallback
    return Math.min(1, Math.max(0.05, raw))
  }
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
    // minTools 下限 3：自动分组要求「同一前缀 ≥3 个」才建组，填 2 不会生效（2026-10-30）。
    // 在加载时就夹住 —— health 里看到的是**生效值**，不是用户填的值。
    minTools: Math.max(3, pickNumber(stored.minTools, cfg.minTools, 3)),
    // 组热判据：组内「热工具」占比 ≥ warmRatio 才整组开（2026-10-30 从硬编码改成可配）
    warmRatio: pickRatio(stored.warmRatio, cfg.warmRatio, 0.3),
    presets,
    showDock: typeof stored.showDock === 'boolean' ? stored.showDock : cfg.showDock === true,
    // 裸名工具分类提示：默认开（false 才关）
    classifyNudge: typeof stored.classifyNudge === 'boolean' ? stored.classifyNudge : cfg.classifyNudge !== false,
    showClear: typeof stored.showClear === 'boolean' ? stored.showClear : cfg.showClear === true,
    // 自动分组：off 不动 / suggest 只建议 / on 直接建组并收起（2026-10-25 加）
    autoGroups: normalizeAutoMode(stored.autoGroups, cfg.autoGroups),
  // 受管角色（默认关闭）：preset id / 'subagent' → { allowGroups, unknown }
  managedRoles: (() => {
    // 2026-11-03（冷读第三轮）：文件里**写了**这个键就必须验形状。以前看的是归一化后的 stored ——
    // 字符串/数组在 normalizePolicy 那一步已经被丢掉，于是"写坏了"和"没写"长得一模一样
    // （静默清空角色）。合法空对象 {} = 没有角色，不许误报。
    const rawStored = storedRead.ok && storedRead.raw ? storedRead.raw : null
    const hasStoredRoles = Boolean(rawStored && Object.prototype.hasOwnProperty.call(rawStored, 'managedRoles'))
    // 2026-11-03（复读遗留 A）：删键 = **显式清空**，不回退到插件配置。
    // 只有「文件根本不存在」才回退 cfg —— 那才是"从没配过"。
    const fileExists = Boolean(storedRead.ok && storedRead.raw)
    if (fileExists && !hasStoredRoles && cfg.managedRoles) {
      host.log('info', 'policy.json 里已删除 managedRoles（按显式清空处理，插件配置里的角色不再生效）')
    }
    const raw = hasStoredRoles ? rawStored.managedRoles : fileExists ? null : cfg.managedRoles
    if (hasStoredRoles) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        host.record(
          'managedRoles',
          new Error('policy.json 里 managedRoles 形状不合法（应为 { 角色: { allowGroups: [...] } }），已忽略文件里的这一项'),
        )
        return null
      }
      if (Object.keys(raw).length === 0) return null
    }
    const normalized = normalizeManagedRoles(raw)
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length && !normalized) {
      host.record('managedRoles', new Error('managedRoles 里没有任何可用条目（每条要有 allowGroups 数组；空数组合法＝只留常驻），已忽略'))
    }
    return normalized
  })(),
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
  // 用户手写组：来源两处 —— 配置里的 extraGroups（loader 层）与独立文件
  // ~/.dsh/lazy-tools.groups.json（设置页保存不会冲掉它）。
  const fileGroups = readUserGroups(host.record)
  const extraGroups = [...(Array.isArray(cfg.extraGroups) ? cfg.extraGroups : []), ...fileGroups]
  // 把一批组定义编译成 { ...g, res }：无效条目跳过并记账；expect 夹成有限正整数。
  // 2026-10-30 对抗测试：手写 groups 全无效时不能静默什么都不注册（见下方 fallback）。
  const compileGroups = (list, manual = false) =>
    list
      .filter((g) => g && typeof g.id === 'string' && Array.isArray(g.match) && g.match.length)
      .map((g) => {
        let res = []
        for (const pattern of g.match) {
          const re = matcherFor(pattern)
          if (re) res.push(re)
          else host.record('group pattern', new Error(`无效的匹配式 ${JSON.stringify(String(pattern))}（组 ${g.id}），已忽略`))
        }
        // 只接受真正的 number，不做类型强转（expect: '19' / true 这类笔误不猜语义，按未设置处理）
        const expect = typeof g.expect === 'number' && Number.isFinite(g.expect) && g.expect > 0 ? Math.round(g.expect) : undefined
        // 注意：必须先把原值摘掉，否则 `...g` 会把 NaN 又带回来（2026-10-30 对抗测试 缺陷3）。
        const { expect: _rawExpect, ...rest } = g
        // 0.17.0 删掉了 autoHints：旧配置里还写着它时不能静默；但这是**兼容提示、不是故障**，
        // 按组只记一次、进 health.notes —— 记成 error 会让老用户 health 永久 false（训练人忽略红灯）。
        if (Object.prototype.hasOwnProperty.call(rest, 'autoHints') && !compatNotes.has(g.id)) {
          compatNotes.add(g.id)
          host.log('warn', `group ${g.id}: autoHints was removed in 0.17.0; ignored`)
        }
        // universal：这个组的匹配式能匹配**任意名字**（`*` / `re:.*`）—— 与工具数量无关地判定，
        // 所以 cua_* 这类前缀组不会被误伤（2026-10-31，回答「宿主改名追不动」）。
        const sentinel = '\u0000lazy-tools-probe\u0000'
        // 2026-11-06（冷读红 2）：单探针可被 re:^[a-z0-9_]+$ 绕过；用多个异形探针，
        // 全中才算“万能匹配”。前缀组不会全中，字面枚举也不会。
        const probes = ['zz_probe_alpha', 'probe_beta_9', '000_probe', 'x_y_z9', 'zzprobealpha']
        // 2026-11-05（外部审阅抓到的 P0）：V8 在**首次 test() 时才编译**正则 ——
        // 超长模式会在 test 抛 SyntaxError，把整个 apply 带崩（加载即失败）。
        // 所以这里真的执行一次 test；抛错的匹配式按无效处理并记账，不许逃出 apply。
        const tested = []
        for (const re of res) {
          try {
            re.test(sentinel)
            tested.push(re)
          } catch (error) {
            host.record(
              'group pattern',
              new Error(`匹配式执行失败（组 ${g.id}）：${String((error && error.message) || error)}，已忽略`),
            )
          }
        }
        res = tested
        const universal = res.some((re) => probes.every((probe) => re.test(probe)))
        return {
          ...rest,
          res,
          ...(manual ? { manual: true } : {}),
          ...(universal ? { universal: true } : {}),
          ...(expect === undefined ? {} : { expect }),
        }
      })
      .filter((g) => g.res.length)

  // 2026-10-31：手写组与出厂组分开编译 —— 只有手写组需要「全匹配」防线。
  const cfgGroups = Array.isArray(cfg.groups) && cfg.groups.length ? cfg.groups : null
  let groups = [
    ...compileGroups(cfgGroups || DEFAULT_GROUPS, Boolean(cfgGroups)),
    ...compileGroups(extraGroups, true),
  ]
  if (!groups.length) {
    // 用户给的组全无效（null / 缺 match / 正则全坏）→ 退回出厂四组，并且必须响。
    // 否则插件会「装上了但一个工具都不注册」，用户连 health 都调不到（2026-10-30 对抗测试）。
    host.log('warn', 'all configured groups were invalid; falling back to the default groups')
    host.record('groups', new Error('配置里的组全部无效，已退回默认四组'))
    groups = compileGroups(DEFAULT_GROUPS)
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
  let roleSource = policy.managedRoles || null
  // 工具（lib/tools/roles.js）要写回这两个 let：跨模块赋值只能走 setter ——
  // 那正是「搬出去之后不再有隐式闭包」的证据，显式两行比看不见的闭包好查。
  const setRoleSource = (v) => {
    roleSource = v
  }
  let rolesGroupSig = ''
  const auditHitsSeen = new Set()
  const refreshManagedRoles = (force = false, hadRolesOverride = null) => {
    if (!roleSource) {
      // 只有「从有角色变成没角色」才需要解锁现存会话；启动时本来就没角色，别遍历重建。
      const hadRoles = hadRolesOverride === null ? Boolean(policy.managedRoles) : Boolean(hadRolesOverride)
      policy.managedRoles = null
      rolesGroupSig = ''
      if (hadRoles) {
        try {
          for (const agent of host.agentList()) {
            const st = states.get(agent)
            if (!st) continue
            st.managed = null
            if (typeof rebuild === 'function') rebuild(agent)
          }
        } catch (error) {
          host.record('managedRoles rebuild', error)
        }
      }
      return
    }
    const groupIds = groups.map((g) => g.id)
    const sig = groupIds.join('|')
    if (!force && sig === rolesGroupSig) return
    rolesGroupSig = sig
    const next = { ...roleSource }
    const audit = auditManagedRoles(next, groupIds)
    for (const hit of audit.unknown) {
      const tag = `${hit.role}::${hit.ids.join(',')}`
      if (auditHitsSeen.has(tag)) continue
      auditHitsSeen.add(tag)
      // auto-* 组是插件按工具前缀自己建的，冷启动时可能还没建出来 —— 这条不拉红
      // （否则健康机器上会长期挂一条假错误，训练人忽略红灯），只记日志。
      if (hit.ids.every((id) => id.startsWith('auto-'))) {
        host.log('warn', `managedRoles: 角色 ${hit.role} 的自动组还没建出来（${hit.ids.join(', ')}）—— 等对应工具注册后自动生效`)
        continue
      }
      host.record(
        'managedRoles',
        new Error(`角色 ${hit.role} 的 allowGroups 里这些组不存在：${hit.ids.join(', ')}（当前可用：${groupIds.join(', ')}）`),
      )
    }
    for (const key of audit.dropped) {
      delete next[key]
      host.log('warn', `managedRoles: 角色 ${key} 的组全都不存在，已停用（组补上后会自动恢复）`)
    }
    policy.managedRoles = Object.keys(next).length ? next : null
    // 2026-11-03（对比评审指出）：角色/组变了之后，**现存会话**也要重建 ——
    // 否则"配了但老会话没变"，用户看到的就是"改了没生效"。
    // 只动已经开过会话的 agent（states 里有记录的）；新会话创建时自己会算。
    try {
      for (const agent of host.agentList()) {
        const st = states.get(agent)
        if (!st) continue
        st.managed = resolveManagedRole(agent, policy.managedRoles)
        if (typeof rebuild === 'function') rebuild(agent)
      }
    } catch (error) {
      host.record('managedRoles rebuild', error)
    }
  }

  // policy.json 改完**不用重启**（2026-11-03）：agent/created 时比对 mtime，变过就重读 managedRoles。
  // 用户原话「配置这个会很麻烦」—— 真正的麻烦是"改完要重启"，不是"要改"。
  // 读不到 mtime（文件不存在/权限）⇒ 永不重载，退回旧行为。
  let policyMtime = policyFileMtime()
  const setPolicyMtime = (v) => {
    policyMtime = v
  }
  const reloadManagedRolesIfChanged = () => {
    try {
      const mtime = policyFileMtime()
      if (!mtime || mtime === policyMtime) return false
      // 冷读红 2：读失败**不许**当成"角色被删光"。
      //   ① 不许先推进 mtime（否则坏文件会让失败粘住，改回来也不重读）；
      //   ② 不许把 managedRoles 清空（保持旧值，按旧配置继续跑）；
      //   ③ 必须响（record），否则用户以为改生效了。
      const strict = readStoredPolicyStrict()
      if (!strict.ok) {
        host.record(
          'managedRoles reload',
          new Error(`policy.json 读不出来（${String((strict.error && strict.error.message) || strict.error)}）—— 已保持旧的角色配置，未重载`),
        )
        return false
      }
      // 2026-11-03（冷读第三轮）：要分清「文件里没有这个键」和「有这个键但写坏了」。
      // 前者是用户把角色删光了（合法，清空）；后者是手滑（必须保持旧值、必须响）——
      // 否则一个拼错的类型就能把整张角色表静默清空。
      const hasRolesKey = Boolean(strict.raw && Object.prototype.hasOwnProperty.call(strict.raw, 'managedRoles'))
      let next
      if (!hasRolesKey) {
        // 同上：文件在、但没这个键 = 用户删光了（清空）；文件不在才回退 cfg。
        next = strict.raw ? null : normalizeManagedRoles(cfg.managedRoles)
      } else {
        const rawRoles = strict.raw.managedRoles
        if (!rawRoles || typeof rawRoles !== 'object' || Array.isArray(rawRoles)) {
          host.record(
            'managedRoles reload',
            new Error('policy.json 里 managedRoles 形状不合法（应为 { 角色: { allowGroups: [...] } }）—— 已保持旧的角色配置，未重载'),
          )
          return false
        }
        next = normalizeManagedRoles(rawRoles)
        if (!next && Object.keys(rawRoles).length) {
          // 形状对、但条目全没用（没 allowGroups / 类型错）：会清空角色。
          // 这不是「用户删光了」，也必须记账 —— 否则又一次静默清空（冷读第三轮红 2 的最后一种）。
          host.record('managedRoles reload', new Error('managedRoles 里没有任何可用条目（每条要有 allowGroups 数组；空数组合法）—— 已清空角色'))
        }
      }
      policyMtime = mtime
      // 重载也可能早于任何会话创建（autoGroups 还没跑）；先补一次动态组再审计，
      // 免得把合法的 auto-* 角色当成"组不存在"删掉（冷读红 4a 的同一条规则）。
      try {
        autoGroups(true)
      } catch {
        /* 补不上就按现有组表审 */
      }
      roleSource = next
      refreshManagedRoles(true)
      host.log('info', `managedRoles 热重载：${next ? Object.keys(next).join(',') : '（空）'}`)
      return true
    } catch (error) {
      host.record('managedRoles reload', error)
      return false
    }
  }

  // 「这个组真正能收的工具」= 匹配到、且不是常驻/自救工具。
  // 2026-10-30 对抗测试：手写组用 match: ['*'] 会把 lazy_tools_* 也吞了，自愈链路直接断。
  const membersOf = (g, pool = host.allToolNames()) =>
    pool.filter((name) => !CORE_TOOLS.has(name) && g.res.some((re) => re.test(name)))

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

  const states = new WeakMap()
  const stats = { hideEvents: 0, selfHealed: 0, lastHidden: null, rebuilds: 0 }
  // 2026-10-30：计数器跨重载恢复 —— 否则每次重载 firstTryRate 归零，永远拿不到数据。
  const savedStats = usageLedger.stats || {}
  host.seedCounters(savedStats)
  stats.selfHealed = Math.max(stats.selfHealed, Number(savedStats.selfHealed) || 0)
  // 把「进程内 + 历史」的累计数写回账本，供下一次重载恢复。
  const persistCounts = () => {
    usageLedger.stats = {
      toolCalls: host.counters().toolCalls,
      selfHealed: stats.selfHealed,
    }
  }

  const groupOf = (toolName) => {
    for (const g of groups) if (g.res.some((re) => re.test(toolName))) return g.id
    return null
  }

  // 会话开始那一刻定默认值（中途绝不改，保前缀缓存）：
  //   最近 idleDays 内被调用过（热） / 被点名永不自动收 / 显式 defaultOn:true → 开着；
  //   其余 → 收起。天数不写就跟档位走（low 14 / medium 7 / high 3）。
  // st.idleDays 是「本会话的覆盖值」（lazy_tools_mode 改它），不改全局策略。
  const sessionIdleDays = (st) => (st && Number.isFinite(st.idleDays) ? st.idleDays : policy.idleDays)
  // 组的「热」不再等于「任一工具热」—— 那会让单工具热度永远不可达（2026-10-30 挑刺）。
  // 现在的定义只含 defaultOn；真正的「整组该开」在 applyDefaults 里按**热工具占比**判。
  const warmGroups = () =>
    new Set(groups.filter((g) => g.defaultOn === true).map((g) => g.id))
  const applyDefaults = (st) => {
    // 受管会话：模式完全由角色策略决定，不看热度（纪律不能用习惯替代）。
    if (st.managed) {
      const allow = new Set(st.managed.role.allowGroups)
      // 2026-11-05（元宝挑刺 1）：'*' 是 isAllowedByPolicy 认可的「不设限」，但这里按组 id 比对
      // ⇒ '*' 不匹配任何组，所有组被记成 hide；实际 deny 又是 0。同一个判据两个入口。
      const allowAll = allow.has('*')
      const managedModes = new Map()
      for (const g of groups) {
        managedModes.set(g.id, allowAll || allow.has(g.id) ? { mode: 'all', names: new Set() } : { mode: 'hide', names: new Set() })
      }
      st.modes = managedModes
      return
    }
    const warm = warmGroups()
    const idleDays = sessionIdleDays(st)
    const hideable = host.allToolNames().filter((name) => !CORE_TOOLS.has(name))
    const next = new Map()
    for (const g of groups) {
      const members = membersOf(g)
      // 手写组用了万能匹配式（`*` / `re:.*`）⇒ 忽略（见 warnManualGuard）。出厂组不受影响。
      if (g.manual && g.universal) {
        warnManualGuard(g, hideable.length)
        continue
      }
      const hotTools = members.filter((name) => isToolHot(usageLedger, name, idleDays))
      // 「整组开」的两个来源：组被显式设成默认开，或**热工具占比够高**（≥ policy.warmRatio，默认 30%）。
      // 为什么要比例：组时间戳是「任一工具被调用」就更新，于是「37 个里只用 1 个」在原来必然整组开、
      // only 分支永远走不到 —— 功能是真的，只是不可达。
      const ratio = policy.warmRatio
      const ratioWarm = hotTools.length > 0 && hotTools.length / Math.max(1, members.length) >= ratio
      if (warm.has(g.id) || ratioWarm) continue
      // 单工具热度（2026-10-29；2026-10-30 定型）：**热的全放，其余收起**。
      // 曾经有过 slice(0,3) 与 max(3,ceil(成员数×ratio)) 两道上限，都是**恒不生效的死代码**：
      // 走 only 分支的条件是 hot < 成员数×ratio ≤ ceil(...) = cap ⇒ 永远截不到。
      // 删掉它，语义更干净：「热到阈值 → 整组开；没到 → 热的全放，其余收起」。
      const shown = hotTools
      next.set(g.id, shown.length ? { mode: 'only', names: new Set(shown) } : { mode: 'hide', names: new Set() })
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
      // 冷读红 4a：审计必须在 autoGroups(true) **之后**跑 —— 否则 `auto-mnemon` 这类动态组
      // 在审计时还不存在，合法角色会被整条删掉（fail-open，而且报的是假错误）。
      refreshManagedRoles()
      const resolvedRole = resolveManagedRole(agent, policy.managedRoles)
      st = {
        // 受管角色：null 表示普通会话（走热度逻辑）
        managed: resolvedRole,
        // 2026-11-03（盲测指出）：子会话带了 label，但那个角色**没配** ⇒ 它会悄悄退回默认工具面，
        // 越权且零报错。这里把它记下来，health 里看得见（不拉红：认不出就不动仍是对的，但要能查）。
        roleHint: (() => {
          try {
            const header = agent && agent.session && agent.session.header
            if (!header || !header.parentSession || !policy.managedRoles) return null
            // 2026-11-04（复读红 1）：与生产路径**同一套**确定性候选与「配过」判据，别在这里另写规则。
            // 旧写法用全段扫描，摘要里的 hermes 会变成 hint（诊断信息误导人，也让「摘要词不参与」不成立）。
            const candidates = labelRoleCandidates(labelOfSession(agent, header))
            const hinted = candidates[0] || null
            if (!hinted) return null
            // 2026-11-04（复读三轮红）：**直接用生产的解析结果**判空 ——
            // 之前只镜像了「候选配过」，漏了 `managedRoles.subagent` 兜底，于是 managed=subagent 时
            // 还会提示「没配、用的是默认工具面」，同一份 health 自相矛盾。
            if (resolvedRole) return null
            return {
              label: String(labelOfSession(agent, header)),
              role: hinted,
              hint: `子会话自称 ${hinted}，但 managedRoles 里没配 —— 它现在用的是默认工具面。要给它单独的工具面：lazy_tools_roles({ role: "${hinted}", allowGroups: [...], basis: "…" })`,
            }
          } catch {
            return null
          }
        })(),
        modes: new Map(),
        lifts: [],
        hiddenNames: [],
        seen: new Set(),
        level: null,
        idleDays: null,
        // 2026-10-30 加：rebuild 必须串行。rc.3 里「撤销限制」会**同步**发 tools/change，
        // 事件处理器会在外层 rebuild 跑到一半时重入进来 —— 内层把自己的 lift 句柄写进 st.lifts，
        // 外层随后用它的 leftovers 覆盖掉，那条限制就再没人能解除（孤儿）。
        rebuilding: false,
        pendingRebuild: false,
      }
      applyDefaults(st)
      states.set(agent, st)
    }
    return st
  }

  // 这个工具名现在该不该藏：没被任何组匹配 → 不藏；组没记录 → 全开；
  // 'hide' → 藏；'only' → 不在白名单里的才藏。
  const hiddenBy = (st, name) => {
    // 2026-10-30 对抗测试：手写组 match:['*'] 也不能收走常驻/自救工具（否则自愈链路断掉）。
    if (CORE_TOOLS.has(name)) return false
    const gid = groupOf(name)
    if (!gid) return false
    const m = st.modes.get(gid)
    if (!m) return false
    if (m.mode === 'hide') return true
    return !m.names.has(name)
  }

  // 串行化入口：同一个 agent 同时只允许一个 rebuild 在跑；跑的过程中再被叫，
  // 只记一个「待办」标记，等当前这轮结束后立刻补跑一轮（这样晚注册的工具也不会被吞）。
  // 为什么必须这样：见 stateFor 里 rebuilding / pendingRebuild 的注释（重入会把 lift 句柄覆盖掉）。
  const rebuild = (agent) => {
    const st = stateFor(agent)
    if (st.rebuilding) {
      st.pendingRebuild = true
      return
    }
    st.rebuilding = true
    stats.rebuilds += 1
    try {
      let rounds = 0
      do {
        st.pendingRebuild = false
        rebuildOnce(agent, st)
        rounds += 1
      } while (st.pendingRebuild && rounds < 5)
      if (st.pendingRebuild) {
        st.pendingRebuild = false
        host.log('warn', 'rebuild still pending after 5 rounds; dropped (possible change loop)')
      }
    } finally {
      st.rebuilding = false
    }
  }

  const rebuildOnce = (agent, st) => {
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
    // 2026-11-01（0.18 隔离约束①）：只在「本会话当前可见」的名字里选要藏的。
    // 别人已经藏掉的名字不再由我们 deny —— 否则撤销我们这层也放不出来，账还会算在别人头上。
    const visibleAfterLift = host.toolNames(agent)
    const source = visibleAfterLift
    const wanted = st.managed
      ? source.filter((name) => (!CORE_TOOLS.has(name) || ROLE_HIDEABLE_CORE.has(name)) && !isAllowedByPolicy(st.managed, name, groupOf))
      : source.filter((name) => hiddenBy(st, name))
    // 2026-11-04（与别名/scoped 工具共存）：宿主只允许 mask **全局工具**，
    // 别的插件注册在 agent 作用域的工具（如别名转发壳）天然不可 restrict。
    // 不去 deny 它们 —— 否则每次 rebuild 都换一条「这些名字不可限制」，
    // health 被永久拖红，而它们本来也不归我们管。读不到可 restrict 名单时保持旧行为（照藏）。
    const restrictable = host.restrictableNames(agent)
    const hidden = restrictable ? wanted.filter((name) => restrictable.has(name)) : wanted
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
    // 2026-11-01（0.18 隔离约束②）：撤销后回读。上一轮我们藏过、现在仍不可见、
    // 且不是本轮要藏的名字 ⇒ 被外部层挡住（不是我们）。只记证据，不抢别人的锁。
    // 2026-11-06（冷读红 1/红 2）：用**实际可见**算「藏不掉」的名单。
    // 真宿主里 scope 同名注册的工具永远 visible；reserved PTC（run_code）的 restrict 必抛；
    // 而 restrictableNames 读不到时旧过滤会整体失效 —— 只看名单都不能代表"藏得住"。
    // 于是把「想藏但本轮之后还看得见」记下来，泄漏检测不再把它们当漏网，避免 3 秒重建链。
    const stillVisible = host.toolNames(agent)
    // 2026-11-06（冷读 2 红）：逐名字判断，而不是整批布尔。
    //   - denied：这一批 restrict 确实点过名（成功或逐名字成功）；
    //   - permanent：badname（unknown / reserved PTC），永久藏不掉；
    //   - transient：这轮失败（systemic/inactive），下一轮必须重试，不能锁。
    // 2026-11-06（复读红 1 + 新洞 1）：只排除 transient。
    //   - shadow（deny 了仍可见）、permanent（badname）、以及**从未进 hidden 的 scope 别名**
    //     都属于「这轮藏不掉」，要锁，否则每次 tools/change 都算漏网（别名壳 3 秒链）；
    //   - transient（这轮 restrict 系统失败）不锁，下一轮重试。
    // 锁本身会在 restrictableNames 签名变化时整体清空，给晚注册的工具一次机会。
    const hideReport = host.hideReport(agent) || { transient: [] }
    // hidden 为空 = 本轮根本没调用 hideTools，报告是**上一轮**的；此时所有 leftover 都该锁，
    // 否则「上轮 transient、本轮退成 scope 别名壳」的名字会永远算漏网（复读黄项）。
    const transient = hidden.length > 0 ? new Set(hideReport.transient || []) : new Set()
    st.unhideable = wanted.filter((name) => stillVisible.includes(name) && !transient.has(name))
    // 外部变化的判据：可限制名单变了（如 alias 退场 / 全局工具晚注册），才值得清闩锁重试；
    // 单纯 tools/change（比如我们自己的 restrict）不该造成 churn。
    st.restrictableSig = restrictable ? [...restrictable].sort().join('\n') : null
    const nextHidden = new Set(hidden)
    const stuck = (st.hiddenNames || []).filter(
      (name) => !visibleAfterLift.includes(name) && !nextHidden.has(name) && !CORE_TOOLS.has(name),
    )
    st.foreign = stuck.length ? { count: stuck.length, sample: stuck.slice(0, 8) } : null
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
      const inGroup = membersOf(g, known)
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
  //
  // 2026-11-01：加第二个参数「名字池」。提示段每轮组装都要重算这个清单，而 allToolNames()
  // 走 schemas()（全量 schema 深拷贝，DSH 作者实测 258 个工具 34.2 ms）——调用方手里已有
  // 便宜读法（tools.view 的全局视图）时就把名字传进来，别在每轮请求里白拷一遍。
  const unclassifiedNames = (agent, sourceOverride) => {
    const all = Array.isArray(sourceOverride) ? sourceOverride : host.allToolNames()
    // 显式传进来的池就是权威（空数组 = 全局确实没有工具）；只有「没传」且全局为空时，
    // 才退到本 agent 的工具表。2026-11-01 冷读：原来把显式传的空数组当「没数据」，白跑一次 schemas()。
    const source = Array.isArray(sourceOverride) || all.length ? all : host.toolNames(agent)
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
      const inGroup = membersOf(g, known)
      const m = st.modes.get(g.id)
      const mode = m ? m.mode : 'all'
      // hot 与决策用**同一套语义**（2026-10-30 挑刺）：组级时间戳是「任一工具热」，
      // 拿它当 hot 会和「按占比收起」打架（用户看到 hot=true 却是 only/hide）。
      // 现在 hot = 占比 ≥ warmRatio；组级时间戳只留作 lastUsed 展示，不再进决策。
      // 2026-10-30 挑刺：这里原来用 policy.idleDays，而决策用 sessionIdleDays(st) ——
      // 会话档位改过后 status 会和决策打架（组收起了还报 hot=true）。同一个判据，走同一个函数。
      const idleDaysView = sessionIdleDays(agent ? stateFor(agent) : null)
      const hotCount = inGroup.filter((name) => isToolHot(usageLedger, name, idleDaysView)).length
      const hotRatio = usageHotRatio(hotCount, inGroup.length)
      const entry = {
        id: g.id,
        title: g.title || g.id,
        on: mode === 'all',
        mode,
        onlyCount: mode === 'only' ? m.names.size : 0,
        matched: inGroup.length,
        visible: inGroup.filter((name) => visible.includes(name)).length,
        hot: hotRatio >= policy.warmRatio,
        hotTools: hotCount,
        hotRatio,
        lastUsed: usageLedger.groups[g.id] || null,
      }
      // expect 是**下限**（2026-10-30）：吸纳型组（负向前瞻 / 前缀通配）本来就会吸纳新工具，
      // 多出来是设计意图；少了才是问题（改名/没加载/正则漏）。等式语义会让默认状态下 healthy 长期 false，
      // 这正是「训练人忽略报警」的场景。也不再排除 only 模式：matched 数的是组内注册工具，与只放了几个无关。
      if (typeof g.expect === 'number') {
        entry.expect = g.expect
        entry.expectOk = inGroup.length >= g.expect
      }
      if (g.manual && guardWarned.has(g.id)) entry.guarded = true
      return entry
    })
  }

  // 提示段 + 会话快照（2026-11-03 搬去 lib/prompt.js）。依赖全部显式注入，
  // 于是「该列哪些组」这个判据只在这里生成一次，提示段和 health 共用它。
  const promptApi = createPrompt({
    host,
    groups,
    membersOf,
    groupOf,
    states,
    policy,
    usageLedger,
    unclassifiedNames,
    isAllowedByPolicy,
  })

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
    // 2026-11-03：新建会话时先看 policy.json 有没有被改过（改完免重启）。
    reloadManagedRolesIfChanged()
    if (agent && agent.ctx && agent.ctx.tools) rebuild(agent)
  })

  // 时序兜底：插件可能比工具先加载（第一次算出的 hidden 会是 0），上游升级新增工具也会走这里。
  // 只在「发现漏网」（本该藏却可见）时才重建；重建后漏网消失，所以不会自激循环。
  // 3 秒冷却防的是「restrict 自己触发的 tools/change」打成死循环 —— 所以冷却必须盖在
  // **重建**上，不能盖在**检查**上。
  // 2026-10-28 对面复现的坑：原实现先盖时间戳再检查，冷启动时上游插件挤在 3 秒内注册的工具
  // 会被冷却吞掉；而之后不再有 tools/change 事件，那个工具整场可见、静默烧 token。
  const lastLeakCheck = new WeakMap()
  const leakTimers = new WeakMap()
  // 冷却时长可被测试压短（默认 3s）：`LAZY_TOOLS_COOLDOWN_MS=60`。用到时才读，避免 import 期定死。
  const leakCooldownMs = () => {
    const raw = Number(process.env.LAZY_TOOLS_COOLDOWN_MS)
    return Number.isFinite(raw) && raw >= 0 ? raw : 3000
  }
  // 2026-10-30 对面第二轮：冷却期内的**第二次**晚注册会被整段跳过，而之后没有事件就永远漏着。
  // 修法：冷却期内不立刻重建，但**排一次延迟核对**（到冷却结束 +25ms 再查一遍）。
  // 这样冷却只推迟动作、不再丢动作；延迟核对自身由 leakTimers 去重，重建引发的新事件会重新排一次，
  // 查到没有漏网就自然停下（不会自激）。
  const reconcileLeaks = (agent) => {
    const st = states.get(agent)
    if (!st) return
    const now = Date.now()
    const since = now - (lastLeakCheck.get(agent) || 0)
    if (since < leakCooldownMs()) {
      if (leakTimers.has(agent)) return
      const timer = setTimeout(() => {
        leakTimers.delete(agent)
        reconcileLeaks(agent)
      }, leakCooldownMs() - since + 25)
      if (timer && typeof timer.unref === 'function') timer.unref()
      leakTimers.set(agent, timer)
      return
    }
    // 2026-11-06（冷读红 1/红 2）：漏网 = 本该藏、实际仍可见、且**本轮确实藏不掉**。
    // 只看 restrictableNames 不够：它不代表"藏得住"（scope 同名遮蔽 / reserved PTC 仍可见），
    // 读不到时还会让过滤整体失效。用 rebuild 回读的实际结果 st.unhideable 兜底。
    const blocked = new Set(Array.isArray(st.unhideable) ? st.unhideable : [])
    const leaked = host.toolNames(agent)
      .filter((name) => hiddenBy(st, name))
      .filter((name) => !blocked.has(name))
    if (!leaked.length) return
    lastLeakCheck.set(agent, now)
    rebuild(agent)
  }
  const restrictableSigOf = (agent) => {
    try {
      const names = host.restrictableNames(agent)
      return names ? [...names].sort().join('\n') : null
    } catch {
      return null
    }
  }
  host.onToolsChange(() => {
    for (const agent of host.agentList()) {
      const st = states.get(agent)
      const sig = restrictableSigOf(agent)
      if (st && sig !== null && st.restrictableSig !== undefined && sig !== st.restrictableSig) {
        // 可限制名单变了（alias 退场 / 全局工具晚注册）：清**全部**闩锁，给"现在能藏了"一次机会。
        // 不保留 badname：名字可能从 unknown 变成可限制（红 1 的恢复性回归）。
        st.unhideable = []
      }
      reconcileLeaks(agent)
    }
  })
  // 卸载/热重载时清掉待办定时器 —— 孤儿定时器会和孤儿限制一样难查。
  try {
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => () => {
        for (const agent of host.agentList()) {
          const timer = leakTimers.get(agent)
          if (timer) clearTimeout(timer)
          leakTimers.delete(agent)
        }
      })
    }
  } catch (error) {
    host.record('effect', error)
  }

  // 关键词预开（autoHints）已于 2026-10-31 删除，见 CHANGELOG 0.17.0；旧配置写法会被记一条 health.notes 提示（不是 errors）。
  // 理由：判定词无穷且不可维护；自动入口改为「消息里的数据类型」（见后续版本），
  // 其余靠模型自己 enable + 自愈兜底。删掉时内置四组确实在用它，所以这是一次真实的功能删除。

  // 记「谁真的被调用过」：旁听 tools/pre-execute，只记账、不改决定。
  // 写盘节流 30 秒，避免每次调用都碰磁盘。
  let lastUsageSave = 0
  // 某个组**第一次**被记到时立刻落盘：组变热是稀疏事件，不该卡在 30 秒节流里。
  const savedGroups = new Set()
  host.onPreExecute((exec) => {
    const name = exec && exec.name
    if (!name) return
    const groupId = groupOf(name)
    // 2026-10-30 第二次修正（挑刺清单）：分母**只算属于某个组的调用**。
    // 为什么：自愈只可能发生在「被收起的组内工具」上，而 read / write / bash 这类核心工具
    // 永不入组、永远不可能自愈 —— 拿全量调用当分母会把指标稀释成没有分辨力的数字
    // （例：一晚 200 次调用里 190 次是核心工具，5 次自愈会被读成 97.5%，而在组内其实是 50%）。
    // 仍然测不到的：模型「压根没开口」的静默失能（用户要能力、模型判自己不会）——
    // 那类不产生任何调用，这个数看不见。详见 health 里 firstTryRate 的注释。
    if (groupId) host.countToolCall()
    const firstForGroup = Boolean(groupId) && !savedGroups.has(groupId)
    recordUsage(usageLedger, name, groupId)
    if (groupId) savedGroups.add(groupId)
    const now = Date.now()
    if (firstForGroup || now - lastUsageSave > 30000) {
      lastUsageSave = now
          persistCounts()
      if (!saveUsage(usageLedger)) host.log('warn', 'usage file write failed (kept in memory)')
    }
  })

  // 自愈：模型要调一个被我们藏起来的工具时，在 dispatch 前把它放出来，并在同一轮直接放行。
  // 用户全程无感。万一宿主对「未知工具」不跑守卫，这里也只是不生效，不会有副作用。
  // 旧工具名 → 新位置（2026-10-30 合并 4 个工具后保留的指路）。
  // 不注册 schema = 不占每轮上下文；只在模型真的喊旧名时回一句「已并入 X」。
  const LEGACY_TOOL_HINTS = {
    lazy_tools_scan: 'lazy_tools_list { ungrouped: true }',
    lazy_tools_classify: 'lazy_tools_save_groups（不传 groups）',
    lazy_tools_resolve: 'lazy_tools_enable { name }',
    lazy_tools_bench: 'lazy_tools_health { bench: true }',
  }

  host.onDispatchGuard((exec) => {
    const name = exec && exec.name
    const agent = exec && (exec.agent || exec.caller)
    if (!name || !agent) return undefined
    if (LEGACY_TOOL_HINTS[name]) {
      return `${name} 已在 0.16.0 并入 ${LEGACY_TOOL_HINTS[name]}；请改用新入口（功能相同）。`
    }
    const groupId = groupOf(name)
    if (!groupId) return undefined
    const st = stateFor(agent)
    // 受管会话：策略由管理员定，自愈不得绕过（否则等于绕开角色纪律）。
    // 显式 undefined：宿主把任何非 undefined 的返回值当拒绝（null 也算）。
    if (st.managed) return undefined
    const m = st.modes.get(groupId)
    if (!m) return undefined
    if (m.mode === 'only' && m.names.has(name)) return undefined
    const names = m.mode === 'only' ? new Set([...m.names, name]) : new Set([name])
    st.modes.set(groupId, { mode: 'only', names })
    // 会话级累计：同一对话里的自愈次数；跨会话/重载再累加到全局 stats。
    st.selfHealed = (Number.isFinite(st.selfHealed) ? st.selfHealed : 0) + 1
    stats.selfHealed += 1
    persistCounts()
    saveUsage(usageLedger)
    host.log('info', `self-heal: revealed ${name} (group ${groupId})`)
    rebuild(agent)
    // 2026-11-05：原来是「拒绝 + 让模型重试」，在 UI 上表现为一次假失败（工具其实已经拿到）。
    // 现在补开、重建后直接放行：这一次调用正常执行，下一轮工具面里也已经包含它。
    // 受管会话在上面已经 return（自愈不得绕过角色纪律），所以这里只影响普通会话。
    // 2026-11-05（冷读红 1）：宿主判据是 `reason !== undefined` —— **null 也会被当成拒绝**。
    // 之前写 null 能放行，全靠 host.js 的 `|| undefined` 兜底；这里显式 undefined。
    return undefined
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
        const beforeRoles = JSON.stringify(roleSource || null)
        const hadRolesBefore = Boolean(policy.managedRoles)
        const patch = Object.assign({}, next)
        // 冷读红 4b：设置页把 managedRoles **原样**塞进来会绕过归一化与审计 ——
        // allowGroups: [] 会静默把会话锁死，类型写错会让 isAllowedByPolicy 抛错（多给）。
        // 所以这里必须走和启动/热重载同一条归一化 + 审计。
        const touchesRoles = Object.prototype.hasOwnProperty.call(patch, 'managedRoles')
        let explicitClear = false
        if (touchesRoles) {
          // 2026-11-06（冷读红 1/B）：空对象是「清空角色」；无效输入保持原值。
          const rolePatch = applyManagedRolesPatch(roleSource, patch.managedRoles)
          explicitClear = rolePatch.explicitClear
          if (!rolePatch.ignored) patch.managedRoles = rolePatch.next
          else delete patch.managedRoles
        }
        applyPolicyPatch(policy, patch)
        if (touchesRoles) {
          // patch 里带了新角色表才换源；没带（=设置页没碰这一格）就保持原源 ——
          // 别拿「生效表」（可能已被审计删过条目）覆盖「配置源」。
          if (explicitClear) roleSource = null
          else if (patch.managedRoles) roleSource = patch.managedRoles
          // 2026-11-06（元宝 P0）：角色表没变就不 refresh/rebuild；否则一次勾选框会把
          // 所有存活会话的前缀缓存全废掉。
          if (JSON.stringify(roleSource || null) !== beforeRoles) refreshManagedRoles(true, hadRolesBefore)
        }
        host.log('info', `policy updated via settings: ${JSON.stringify(policy)}`)
      },
      record: (where, error) => host.record(where, error),
      setPolicyMtime: (v) => setPolicyMtime(v),
    })
    // 桥的返回值原来没人接（对面 2026-10-29 指出是死代码）：插件卸载后它还在回请求。
    // 挂到 ctx.effect 上，随插件生命周期一起关掉。
    if (typeof unmountBridge === 'function' && ctx && typeof ctx.effect === 'function') {
      ctx.effect(() => unmountBridge)
    }
  } catch (error) {
    host.record('bridge mount', error)
  }


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

  // 受管角色：preset 可能在 agent 创建之后才被选中（Web UI 会先给默认 preset，再切回角色 preset）。
  // 只听事件、不改别的：重算角色 → 重设默认模式 → 重建限制。
  if (policy.managedRoles) {
    const onPresetSelected = (sessionId, presetId) => {
      try {
        const agent = agentsGet(sessionId)
        if (!agent) return
        const st = states.get(agent)
        if (!st) return
        const managed = resolveManagedRole(agent, policy.managedRoles)
        const before = st.managed ? st.managed.key : null
        const after = managed ? managed.key : null
        if (before === after) return
        st.managed = managed
        applyDefaults(st)
        rebuild(agent)
      } catch (error) {
        host.record('agent-preset/selected', error)
      }
    }
    try {
      if (ctx && typeof ctx.on === "function") ctx.on('agent-preset/selected', onPresetSelected)
    } catch (error) {
      host.record('agent-preset/selected listener', error)
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
      // 本对话累计；全局累计仍看 health.stats.selfHealed。
      selfHealed: sessionSelfHealed(st),
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
    // 2026-11-06（元宝 P0）：受管会话的工具面由角色决定，st.modes 在 rebuild 里被忽略；
    // 继续返回成功就是假成功。这里明确拒绝。
    if (st.managed) return { error: '受管会话由角色决定工具面：mode / 收纳本对话不生效' }
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



  // ── 8 个工具的定义在 lib/tools/（2026-11-03，第 2 批重构）──────────────────────
  // 为什么注册点挪到这里：这些定义依赖 apply() 里逐段建起来的闭包（applySessionPolicy /
  //   会话视图 / 组视图 / 读写策略 …），必须等它们全部就绪；顺序由 tools/index.js 拼出来，
  //   是硬要求（status, roles, enable, disable, mode, save_groups, list, health）。
  const toolDefs = createTools({
    host, groups, groupsView, idsFrom, membersOf, rebuild, selectorSchema, stateFor, touch, text,
    applySessionPolicy, applyDefaults, CORE_TOOLS, matcherFor, readUserGroups, unclassifiedNames,
    writeUserGroups, autoGroups,
    policy, normalizeManagedRoles, policyFileMtime, readPolicyRaw, refreshManagedRoles,
    writeStoredPolicy, setPolicyMtime, setRoleSource,
    states, stats, compatNotes, promptApi, clientPing, strayNames, usageView, nowIso,
  })
  for (const def of toolDefs) host.registerTool(def)

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


  // ── 会话级目录（2026-11-03 起在 lib/prompt.js）────────────────────────────
  // 为什么搬走：这段和 health 的「会话快照」是**同一个判据**，必须只留一个入口。
  // 依赖全部显式注入（host / groups / states / policy / usageLedger / …），见 prompt.js。
  mountPromptSection(ctx, promptApi, host)

  host.log(
    'info',
    `loaded in root scope; groups=${groups.map((g) => g.id).join(',')} level=${policy.level} caughtUp=${caughtUp} reclaimed=${reclaimed}`,
  )
}
