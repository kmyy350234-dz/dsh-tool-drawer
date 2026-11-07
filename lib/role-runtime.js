// 角色运行时：managedRoles 审计/热重载；rebuild/autoGroups 通过 late-binding 注入。
export function createRoleRuntime({
  host,
  cfg,
  policy,
  groups,
  states,
  roleStore,
  auditManagedRoles,
  resolveManagedRole,
  normalizeManagedRoles,
  readStoredPolicyStrict,
  policyFileMtime,
  getAutoGroups,
  getRebuild,
}) {
  let rolesGroupSig = ''
  const auditHitsSeen = new Set()
  let policyMtime = policyFileMtime()

  const refreshManagedRoles = (force = false, hadRolesOverride = null) => {
    if (!roleStore.source) {
      const hadRoles = hadRolesOverride === null ? Boolean(policy.managedRoles) : Boolean(hadRolesOverride)
      policy.managedRoles = null
      rolesGroupSig = ''
      if (hadRoles) {
        try {
          for (const agent of host.agentList()) {
            const st = states.get(agent)
            if (!st) continue
            st.managed = null
            const rebuild = getRebuild()
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
    const next = { ...roleStore.source }
    const audit = auditManagedRoles(next, groupIds)
    for (const hit of audit.unknown) {
      const tag = `${hit.role}::${hit.ids.join(',')}`
      if (auditHitsSeen.has(tag)) continue
      auditHitsSeen.add(tag)
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
    try {
      for (const agent of host.agentList()) {
        const st = states.get(agent)
        if (!st) continue
        st.managed = resolveManagedRole(agent, policy.managedRoles)
        const rebuild = getRebuild()
        if (typeof rebuild === 'function') rebuild(agent)
      }
    } catch (error) {
      host.record('managedRoles rebuild', error)
    }
  }

  const setPolicyMtime = (v) => {
    policyMtime = v
  }

  const reloadManagedRolesIfChanged = () => {
    try {
      const mtime = policyFileMtime()
      if (!mtime || mtime === policyMtime) return false
      const strict = readStoredPolicyStrict()
      if (!strict.ok) {
        host.record(
          'managedRoles reload',
          new Error(`policy.json 读不出来（${String((strict.error && strict.error.message) || strict.error)}）—— 已保持旧的角色配置，未重载`),
        )
        return false
      }
      const hasRolesKey = Boolean(strict.raw && Object.prototype.hasOwnProperty.call(strict.raw, 'managedRoles'))
      let next
      if (!hasRolesKey) {
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
          host.record('managedRoles reload', new Error('managedRoles 里没有任何可用条目（每条要有 allowGroups 数组；空数组合法）—— 已清空角色'))
        }
      }
      policyMtime = mtime
      try {
        const autoGroups = getAutoGroups()
        if (typeof autoGroups === 'function') autoGroups(true)
      } catch {
        /* 补不上就按现有组表审 */
      }
      roleStore.source = next
      refreshManagedRoles(true)
      host.log('info', `managedRoles 热重载：${next ? Object.keys(next).join(',') : '（空）'}`)
      return true
    } catch (error) {
      host.record('managedRoles reload', error)
      return false
    }
  }

  return { refreshManagedRoles, reloadManagedRolesIfChanged, setPolicyMtime }
}
