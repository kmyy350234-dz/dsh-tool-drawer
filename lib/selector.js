// 组选择器 schema 与参数归一化（纯函数）。
export function selectorSchema(extra) {
  return {
    type: 'object',
    properties: {
      group: { type: 'string', description: '组 id（单个）' },
      groups: { type: 'array', items: { type: 'string' }, description: '多个组 id（批量，与 group 二选一）' },
      ...extra,
    },
    additionalProperties: false,
  }
}

export function idsFrom(args) {
  const single = args && typeof args.group === 'string' && args.group ? [args.group] : []
  const many = args && Array.isArray(args.groups) ? args.groups.filter((id) => typeof id === 'string' && id) : []
  return [...new Set([...single, ...many])]
}
