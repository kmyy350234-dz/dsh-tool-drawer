// 自动分组：只认「没被现有组覆盖 + 同前缀够数」的家族；on 并进 groups，suggest 只暴露建议。
export function createAutoGroups({ host, policy, groups, suggestGroups, matcherFor }) {
  let autoReport = { mode: policy.autoGroups, suggestions: [], skipped: [], applied: [] }
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
      // 只有工具表确实有内容时才认为「算过了」；冷启动时工具还没注册，要留着重算。
      if (toolNames.length > 0) autoSettled = true
    } catch (error) {
      host.record('auto groups', error)
    }
    return autoReport
  }
  return autoGroups
}
