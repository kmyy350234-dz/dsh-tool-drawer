// 会话状态的唯一初始形状；后续模块只在这个形状上改值，不再各自补字段。
export const STATE_FIELDS = [
  'managed',
  'roleHint',
  'modes',
  'lifts',
  'hiddenNames',
  'seen',
  'level',
  'idleDays',
  'rebuilding',
  'pendingRebuild',
  'restrictableSig',
  'unhideable',
  'foreign',
  'selfHealed',
]

export function createState({ managed = null, roleHint = null } = {}) {
  return {
    managed,
    roleHint,
    modes: new Map(),
    lifts: [],
    hiddenNames: [],
    seen: new Set(),
    level: null,
    idleDays: null,
    rebuilding: false,
    pendingRebuild: false,
    restrictableSig: undefined,
    unhideable: [],
    foreign: null,
    selfHealed: 0,
  }
}

// 会话状态（WeakMap 属主仍由调用方持有；这里只负责初始化/查询）。
export function createSessionState({
  policy,
  autoGroups,
  refreshManagedRoles,
  resolveManagedRole,
  applyDefaults,
  labelRoleCandidates,
  labelOfSession,
  CORE_TOOLS,
  groupOf,
}) {
  // WeakMap 归 session-state 所有；外部只拿只读 peekState，不再传原始 WeakMap。
  const states = new WeakMap()
  const peekState = (agent) => states.get(agent) || null
  const stateFor = (agent) => {
    let st = states.get(agent)
    if (!st) {
      // 会话开始的这一刻再算一次：apply() 时别的插件的工具可能还没注册完。
      autoGroups(true)
      // 审计必须在 autoGroups(true) 之后跑：否则 auto-* 组还不存在，合法角色会被整条删掉。
      refreshManagedRoles()
      const resolvedRole = resolveManagedRole(agent, policy.managedRoles)
      const roleHint = (() => {
        try {
          const header = agent && agent.session && agent.session.header
          if (!header || !header.parentSession || !policy.managedRoles) return null
          const candidates = labelRoleCandidates(labelOfSession(agent, header))
          const hinted = candidates[0] || null
          if (!hinted) return null
          if (resolvedRole) return null
          return {
            label: String(labelOfSession(agent, header)),
            role: hinted,
            hint: `子会话自称 ${hinted}，但 managedRoles 里没配 —— 它现在用的是默认工具面。要给它单独的工具面：lazy_tools_roles({ role: "${hinted}", allowGroups: [...], basis: "…" })`,
          }
        } catch {
          return null
        }
      })()
      st = createState({ managed: resolvedRole, roleHint })
      applyDefaults(st)
      states.set(agent, st)
    }
    return st
  }

  // 这个工具名现在该不该藏：没被任何组匹配 → 不藏；组没记录 → 全开；hide → 藏；only → 不在白名单才藏。
  const hiddenBy = (st, name) => {
    if (CORE_TOOLS.has(name)) return false
    const gid = groupOf(name)
    if (!gid) return false
    const m = st.modes.get(gid)
    if (!m) return false
    if (m.mode === 'hide') return true
    return !m.names.has(name)
  }

  return { stateFor, hiddenBy, peekState }
}
