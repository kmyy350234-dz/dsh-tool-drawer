// 只读视图：把组的当前状态整理成 status/health 用的 JSON。
import { isToolHot, hotRatio as usageHotRatio } from './usage.js'

export function createGroupsView({ host, groups, stateFor, membersOf, sessionIdleDays, usageLedger, policy, guardWarned }) {
  return (agent) => {
    const visible = host.toolNames(agent)
    const st = agent ? stateFor(agent) : { modes: new Map(), hiddenNames: [] }
    const all = host.allToolNames()
    const known = all.length ? all : [...new Set([...visible, ...st.hiddenNames])]
    return groups.map((g) => {
      const inGroup = membersOf(g, known)
      const m = st.modes.get(g.id)
      const mode = m ? m.mode : 'all'
      // hot 与决策用同一套语义：hot = 占比 ≥ warmRatio；组级时间戳只留作 lastUsed 展示。
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
      // expect 是下限：吸纳型组多出来是设计意图，少了才是问题。
      if (typeof g.expect === 'number') {
        entry.expect = g.expect
        entry.expectOk = inGroup.length >= g.expect
      }
      if (g.manual && guardWarned.has(g.id)) entry.guarded = true
      return entry
    })
  }
}
