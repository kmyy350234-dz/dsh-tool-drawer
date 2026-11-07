import { setModes } from './state-ops.js'
// 热度判据：会话默认开合（不碰 host/states，依赖全部显式注入）。
import { isToolHot } from './usage.js'
import { CORE_TOOLS } from './autogroups.js'

export function createHeat({ policy, groups, usageLedger, allToolNames, membersOf, warnManualGuard } = {}) {
  // 缺依赖时在加载期报，不等第一个会话 stateFor 才炸。
  const deps = { policy, groups, usageLedger, allToolNames, membersOf, warnManualGuard }
  const missing = Object.keys(deps).filter((key) => deps[key] === undefined || deps[key] === null)
  if (missing.length) throw new Error(`createHeat 缺少依赖: ${missing.join(', ')}`)
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
      setModes(st, managedModes)
      return
    }
    const warm = warmGroups()
    const idleDays = sessionIdleDays(st)
    const hideable = allToolNames().filter((name) => !CORE_TOOLS.has(name))
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
    setModes(st, next)
  }
  return { sessionIdleDays, warmGroups, applyDefaults }
}
