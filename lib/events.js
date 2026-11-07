// 宿主事件接线（按事件逐个拆，避免误切中间的 leak 初始化）。
export function installAgentCreated({ host, reloadManagedRolesIfChanged, rebuild }) {
  host.onAgentCreated((agent) => {
    // 新建会话时先看 policy.json 有没有被改过（改完免重启）。
    reloadManagedRolesIfChanged()
    if (agent && agent.ctx && agent.ctx.tools) rebuild(agent)
  })
}

export function installToolsChange({ host, states, restrictableSigOf, reconcileLeaks }) {
  host.onToolsChange(() => {
    for (const agent of host.agentList()) {
      const st = states.get(agent)
      const sig = restrictableSigOf(agent)
      if (st && sig !== null && st.restrictableSig !== undefined && sig !== st.restrictableSig) {
        st.unhideable = []
      }
      reconcileLeaks(agent)
    }
  })
}

export function installPreExecute({ host, groupOf, usageLedger, recordUsage, saveUsage, persistCounts }) {
  // 旁听 tools/pre-execute：只记账、不改决定；写盘节流 30 秒。
  let lastUsageSave = 0
  const savedGroups = new Set()
  host.onPreExecute((exec) => {
    const name = exec && exec.name
    if (!name) return
    const groupId = groupOf(name)
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
}

export function installPresetSelected({ ctx, host, policy, states, agentsGet, resolveManagedRole, applyDefaults, rebuild }) {
  // 受管角色：preset 可能在 agent 创建之后才被选中，重算角色 → 重设模式 → 重建限制。
  if (!policy.managedRoles) return
  const onPresetSelected = (sessionId) => {
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
    if (ctx && typeof ctx.on === 'function') ctx.on('agent-preset/selected', onPresetSelected)
  } catch (error) {
    host.record('agent-preset/selected listener', error)
  }
}

export function installDispatchGuard({ host, groupOf, stateFor, stats, persistCounts, saveUsage, usageLedger, rebuild }) {
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
    if (st.managed) return undefined
    const m = st.modes.get(groupId)
    if (!m) return undefined
    if (m.mode === 'only' && m.names.has(name)) return undefined
    const names = m.mode === 'only' ? new Set([...m.names, name]) : new Set([name])
    st.modes.set(groupId, { mode: 'only', names })
    st.selfHealed = (Number.isFinite(st.selfHealed) ? st.selfHealed : 0) + 1
    stats.selfHealed += 1
    persistCounts()
    saveUsage(usageLedger)
    host.log('info', `self-heal: revealed ${name} (group ${groupId})`)
    rebuild(agent)
    return undefined
  })
}
