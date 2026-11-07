// apply 收尾：收回上次实例的孤儿限制；给已经活着的 agent 补一次 rebuild。
export function reclaimPreviousLifts({ host, PROCESS_LIFTS }) {
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
  return reclaimed
}

export function catchUpAgents({ host, rebuild }) {
  let caughtUp = 0
  for (const existing of host.agentList()) {
    if (existing && existing.ctx && existing.ctx.tools) {
      rebuild(existing)
      caughtUp += 1
    }
  }
  return caughtUp
}
