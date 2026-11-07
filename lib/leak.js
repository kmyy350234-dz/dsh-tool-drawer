// 漏网核对与冷却：只负责“发现本该藏却仍可见”的晚注册工具，并触发 rebuild。
// 事件注册留在 index.js；这里只持有冷却状态和两个纯查询。
export function createLeakGuard({ host, states, hiddenBy, rebuild }) {
  const lastLeakCheck = new WeakMap()
  const leakTimers = new WeakMap()
  const leakCooldownMs = () => {
    const raw = Number(process.env.LAZY_TOOLS_COOLDOWN_MS)
    return Number.isFinite(raw) && raw >= 0 ? raw : 3000
  }

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

  const dispose = () => {
    for (const agent of host.agentList()) {
      const timer = leakTimers.get(agent)
      if (timer) clearTimeout(timer)
      leakTimers.delete(agent)
    }
  }

  return { reconcileLeaks, restrictableSigOf, dispose }
}
