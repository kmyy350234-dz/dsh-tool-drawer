// 用 sessionId 取 agent（宿主 agents 服务不可用时返回 null，不抛）。
export function createAgentsGet({ ctx, host }) {
  return (sessionId) => {
    try {
      const service = ctx && typeof ctx.get === 'function' ? ctx.get('agents') : null
      return service && typeof service.get === 'function' ? service.get(sessionId) : null
    } catch (error) {
      host.record('agents.get', error)
      return null
    }
  }
}
