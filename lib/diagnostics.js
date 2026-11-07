// 工具面诊断：漏网（stray）与未归组（unclassified）纯计算，依赖显式注入。
import { CORE_TOOLS } from './autogroups.js'

export function createStrayNames({ groups, membersOf, commonPrefix }) {
  // 常驻工具（写在组 keep 里）不算漏网；2026-10-23 真机首测的假阳性就来自这里。
  const keepers = new Set()
  for (const g of groups) for (const name of Array.isArray(g.keep) ? g.keep : []) keepers.add(name)

  return (known, visible) => {
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
}

export function createUnclassifiedNames({ groups, allToolNames, toolNames }) {
  return (agent, sourceOverride) => {
    const all = Array.isArray(sourceOverride) ? sourceOverride : allToolNames()
    // 显式传进来的池就是权威（空数组 = 全局确实没有工具）；只有「没传」且全局为空时，才退到本 agent 的工具表。
    const source = Array.isArray(sourceOverride) || all.length ? all : toolNames(agent)
    const kept = new Set()
    for (const g of groups) for (const name of Array.isArray(g.keep) ? g.keep : []) kept.add(name)
    return source
      .filter((name) => !CORE_TOOLS.has(name))
      .filter((name) => !kept.has(name))
      .filter((name) => !name.includes('_'))
      .filter((name) => !groups.some((g) => g.res.some((re) => re.test(name))))
      .sort()
  }
}
