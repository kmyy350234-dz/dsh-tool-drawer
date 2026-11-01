// roles.js — 受管会话（router / worker / subagent）的角色策略。
//
// 设计约束（2026-11-01）：
//   1. 默认关闭：policy.managedRoles 为空 ⇒ 完全走原来的热度逻辑，行为不变。
//   2. 只认结构信号：preset id（来自 agentPresets.composedPreset）与 session.header.parentSession；
//      不认插件名、不认工单标题。
//   3. 封闭默认：角色没授权的组、以及没有归组的工具，一律隐藏。
//   4. 真源在配置里（管理员写），不在代码里；本模块只做解析，不做判断。
//
// 为什么不给每个 agent 单独写策略：真源保持“角色 → 组”这一层；每个 agent 的结果是
// 从角色模板派生出来的（确定性、可 diff），而不是各自手写一份。

/** 校验并归一化 managedRoles；无效条目直接丢掉（失败方向放开）。 */
export function normalizeManagedRoles(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key !== 'string' || !key) continue
    if (!value || typeof value !== 'object') continue
    const allow = Array.isArray(value.allowGroups)
      ? value.allowGroups.filter((item) => typeof item === 'string' && item.length > 0)
      : []
    if (!allow.length) continue
    out[key] = {
      allowGroups: [...new Set(allow)],
      // 未归组工具的默认：hide（角色纪律）| show（人用会话不适用；留作显式逃生口）
      unknown: value.unknown === 'show' ? 'show' : 'hide',
    }
  }
  return Object.keys(out).length ? out : null
}

/**
 * 解析一个 agent 的受管角色。返回 { key, role } 或 null。
 * - 有 parentSession ⇒ 用 `subagent` 键；
 * - 否则用 preset id（composedPreset）匹配 managedRoles 的键；
 * - 读不到任何信号 ⇒ null（退回原有逻辑）。
 */
export function resolveManagedRole(agent, managedRoles) {
  if (!managedRoles || !agent) return null
  const header = agent.session && agent.session.header ? agent.session.header : null

  // 1) 派生会话（子代理）：父会话是谁不重要，策略键固定为 subagent
  if (header && header.parentSession) {
    const role = managedRoles.subagent
    return role ? { key: 'subagent', role } : null
  }

  // 2) 角色 preset：优先问宿主服务，拿不到再退到 session header
  let presetId = null
  try {
    const presets = agent.ctx && typeof agent.ctx.get === 'function' ? agent.ctx.get('agentPresets') : null
    if (presets && typeof presets.composedPreset === 'function') {
      presetId = presets.composedPreset(agent.ctx) ?? null
    } else if (header && typeof header.agentPreset === 'string') {
      presetId = header.agentPreset
    }
  } catch {
    presetId = null
  }
  if (!presetId) return null

  const role = managedRoles[presetId]
  return role ? { key: presetId, role } : null
}

/** 这个工具在当前受管角色下是否允许。未归组按角色的 unknown 处理。 */
export function isAllowedByPolicy(managed, name, groupOf) {
  const role = managed && managed.role
  if (!role) return false
  const groupId = groupOf(name)
  if (groupId === null) return role.unknown === 'show'
  return role.allowGroups.includes(groupId)
}
