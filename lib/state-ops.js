// 会话状态的共享写操作：只有跨模块会改的字段走这里，单写字段（rebuild 内部）保持直接写。
export function setManaged(st, managed) {
  st.managed = managed
}

export function setModes(st, modes) {
  st.modes = modes
}

export function setMode(st, groupId, entry) {
  st.modes.set(groupId, entry)
}

export function deleteModes(st, ids) {
  for (const id of ids) st.modes.delete(id)
}

export function setUnhideable(st, names) {
  st.unhideable = names
}

export function bumpSelfHealed(st) {
  st.selfHealed = (Number.isFinite(st.selfHealed) ? st.selfHealed : 0) + 1
  return st.selfHealed
}

export function markSeen(st, names) {
  if (!st.seen) st.seen = new Set()
  for (const name of names || []) st.seen.add(name)
  return st.seen
}
