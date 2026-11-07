// 斜杠命令 /lazy-tools：直接改当前会话，不必经过模型。
export function installSlash({ ctx, host, policy, getSessionView, getApplySessionPolicy }) {
  try {
    const commands = ctx && typeof ctx.get === 'function' ? ctx.get('commands') : null
    if (commands && typeof commands.register === 'function') {
      const describe = (view) => {
        const on = (view.groups || []).filter((g) => g.on).map((g) => g.title || g.id)
        const which = view.session.level ? `档位 ${view.session.level}` : `跟随全局 ${view.session.idleDays} 天`
        return `工具抽屉：${which}${on.length ? `；开着 ${on.join('、')}` : '；全部收起'}`
      }
      host.own(
        commands.register({
          name: 'lazy-tools',
          description: '改当前会话的工具抽屉：high / medium / low / reset / off / <天数>',
          input: { hint: 'high | medium | low | reset | off | 7' },
          handler: (invocation) => {
            const agent = invocation && invocation.agent
            if (!agent) return { kind: 'error', text: '没有会话' }
            const raw = String((invocation && invocation.rawInput) || '').trim()
            const word = raw.toLowerCase()
            if (!raw) return { kind: 'success', text: describe(getSessionView()(agent)) }
            let spec = null
            if (word === 'reset' || word === '默认') spec = { reset: true }
            else if (word === 'off' || word === '全收' || word === '收起') spec = { collapseAll: true }
            else if (Object.prototype.hasOwnProperty.call(policy.presets, word)) spec = { level: word }
            else if (/^\d+$/.test(word)) spec = { idleDays: Number(word) }
            if (!spec) return { kind: 'error', text: `看不懂「${raw}」；可用：high / medium / low / reset / off / <天数>` }
            const result = getApplySessionPolicy()(agent, spec)
            if (result.error) return { kind: 'error', text: result.error }
            return { kind: 'success', text: describe(result) }
          },
        }),
      )
      host.log('info', 'slash command /lazy-tools registered')
    }
  } catch (error) {
    host.record('commands.register', error)
  }
}
