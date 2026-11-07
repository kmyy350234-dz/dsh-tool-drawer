// 进程内计数器 + 跨重载恢复（stats 的属主）。
export function createCounters({ host, usageLedger }) {
  const stats = { hideEvents: 0, selfHealed: 0, lastHidden: null, rebuilds: 0 }
  const savedStats = usageLedger.stats || {}
  host.seedCounters(savedStats)
  stats.selfHealed = Math.max(stats.selfHealed, Number(savedStats.selfHealed) || 0)
  const persistCounts = () => {
    usageLedger.stats = {
      toolCalls: host.counters().toolCalls,
      selfHealed: stats.selfHealed,
    }
  }
  return { stats, persistCounts }
}
