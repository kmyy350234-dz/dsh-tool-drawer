// 会话级视图与操作（只做组装/校验，状态仍由 index.js 的 stateFor 持有）。
export function createSessionApi({
  stateFor,
  policy,
  groups,
  groupsView,
  sessionIdleDays,
  sessionSelfHealed,
  LEVEL_DAYS,
  applyDefaults,
  rebuild,
}) {
  const sessionView = (agent) => {
    const st = stateFor(agent)
    return {
      showDock: policy.showDock === true,
      showClear: policy.showClear === true,
      classifyNudge: policy.classifyNudge !== false,
      presets: policy.presets,
      hiddenTools: st.hiddenNames.length,
      selfHealed: sessionSelfHealed(st),
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
    // 受管会话的工具面由角色决定，继续返回成功就是假成功。
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
      st.modes = new Map(groups.map((g) => [g.id, { mode: 'hide', names: new Set() }]))
    } else {
      applyDefaults(st)
    }
    rebuild(agent)
    return sessionView(agent)
  }

  return { sessionView, applySessionPolicy }
}
