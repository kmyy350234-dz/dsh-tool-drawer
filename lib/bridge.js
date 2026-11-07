// 设置页桥：状态读取、会话操作、策略写入；生命周期挂在 ctx.effect。
import { mountBridge } from './api.js'

export function installBridge({
  ctx,
  host,
  policy,
  groups,
  states,
  stats,
  roleStore,
  getAgent,
  getSessionView,
  getApplySessionPolicy,
  applyManagedRolesPatch,
  applyPolicyPatch,
  refreshManagedRoles,
  setPolicyMtime,
}) {
  try {
    const unmountBridge = mountBridge(ctx, host, {
      getState: () => ({
        policy,
        groups: groups.map((g) => ({ id: g.id, title: g.title || g.id, expect: g.expect ?? null })),
        summary: {
          hidden: host.agentList().reduce((max, agent) => {
            const st = states.get(agent)
            const n = st && st.hiddenNames ? st.hiddenNames.length : 0
            return n > max ? n : max
          }, 0),
          selfHealed: stats.selfHealed,
        },
        app: 'dsh-lazy-tools',
      }),
      getSession: (sessionId) => {
        const agent = getAgent(sessionId)
        return agent ? getSessionView()(agent) : { error: 'session not found' }
      },
      applySession: (sessionId, spec) => {
        const agent = getAgent(sessionId)
        return agent ? getApplySessionPolicy()(agent, spec) : { error: 'session not found' }
      },
      applyPolicy: (next) => {
        const beforeRoles = JSON.stringify(roleStore.source || null)
        const hadRolesBefore = Boolean(policy.managedRoles)
        const patch = Object.assign({}, next)
        const touchesRoles = Object.prototype.hasOwnProperty.call(patch, 'managedRoles')
        let explicitClear = false
        if (touchesRoles) {
          const rolePatch = applyManagedRolesPatch(roleStore.source, patch.managedRoles)
          explicitClear = rolePatch.explicitClear
          if (!rolePatch.ignored) patch.managedRoles = rolePatch.next
          else delete patch.managedRoles
        }
        applyPolicyPatch(policy, patch)
        if (touchesRoles) {
          if (explicitClear) roleStore.source = null
          else if (patch.managedRoles) roleStore.source = patch.managedRoles
          if (JSON.stringify(roleStore.source || null) !== beforeRoles) refreshManagedRoles(true, hadRolesBefore)
        }
        host.log('info', `policy updated via settings: ${JSON.stringify(policy)}`)
      },
      record: (where, error) => host.record(where, error),
      setPolicyMtime: (v) => setPolicyMtime(v),
    })
    if (typeof unmountBridge === 'function' && ctx && typeof ctx.effect === 'function') {
      ctx.effect(() => unmountBridge)
    }
  } catch (error) {
    host.record('bridge mount', error)
  }
}
