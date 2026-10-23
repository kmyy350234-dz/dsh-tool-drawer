window.__ModuleLoader__.load({
  id: 'dsh-lazy-tools',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const API = '/lazy-tools/api'
    const LEVEL_LABELS = {
      low: '低（保守：14 天）',
      medium: '中（默认：7 天）',
      high: '高（激进：3 天）',
    }

    async function request(path, body) {
      const options = { headers: { 'content-type': 'application/json' } }
      if (body !== undefined) {
        options.method = 'POST'
        options.body = JSON.stringify(body)
      }
      const response = await fetch(API + path, options)
      const type = response.headers.get('content-type') || ''
      if (!type.includes('application/json')) {
        throw new Error(`插件后台接口未就绪（HTTP ${response.status}）——请重启 DSH 后再试`)
      }
      const data = await response.json()
      if (!response.ok) throw new Error((data && data.error) || `HTTP ${response.status}`)
      return data
    }

    const styles = {
      wrap: { display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '620px' },
      intro: { margin: 0, opacity: 0.75, fontSize: '13px', lineHeight: 1.6 },
      row: { display: 'flex', flexDirection: 'column', gap: '6px' },
      label: { fontSize: '13px', fontWeight: 600 },
      hint: { fontSize: '12px', opacity: 0.6 },
      input: {
        padding: '7px 10px',
        borderRadius: '8px',
        border: '1px solid color-mix(in srgb, currentColor 25%, transparent)',
        background: 'transparent',
        color: 'inherit',
        fontSize: '13px',
        fontFamily: 'inherit',
      },
      actions: { display: 'flex', alignItems: 'center', gap: '12px' },
      button: {
        padding: '7px 16px',
        borderRadius: '8px',
        border: '1px solid color-mix(in srgb, currentColor 30%, transparent)',
        background: 'color-mix(in srgb, currentColor 10%, transparent)',
        color: 'inherit',
        fontSize: '13px',
        cursor: 'pointer',
      },
      status: { fontSize: '12px', opacity: 0.7 },
      error: { fontSize: '12px', color: '#d9534f' },
      dock: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '12px',
        padding: '2px 4px',
        opacity: 0.9,
      },
      dockLabel: { fontWeight: 600 },
      dockSelect: {
        padding: '2px 6px',
        borderRadius: '999px',
        border: '1px solid color-mix(in srgb, currentColor 25%, transparent)',
        background: 'transparent',
        color: 'inherit',
        fontSize: '12px',
        fontFamily: 'inherit',
      },
      dockButton: {
        padding: '2px 10px',
        borderRadius: '999px',
        border: '1px solid color-mix(in srgb, currentColor 25%, transparent)',
        background: 'transparent',
        color: 'inherit',
        fontSize: '12px',
        cursor: 'pointer',
      },
      dockHint: { opacity: 0.6 },
      groupList: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
      chip: {
        padding: '2px 8px',
        borderRadius: '999px',
        fontSize: '12px',
        border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
      },
    }

    function LazyToolsSettings() {
      const [state, setState] = React.useState(null)
      const [form, setForm] = React.useState(null)
      const [status, setStatus] = React.useState('')
      const [error, setError] = React.useState('')

      React.useEffect(() => {
        let alive = true
        request('/state')
          .then((data) => {
            if (!alive) return
            setState(data)
            setForm({
              level: data.policy.level,
              idleDays: String(data.policy.idleDays),
              minTools: String(data.policy.minTools),
              neverAutoClose: (data.policy.neverAutoClose || []).join(', '),
              showDock: data.policy.showDock === true,
            })
          })
          .catch((err) => alive && setError(err.message))
        return () => {
          alive = false
        }
      }, [])

      const update = (key) => (event) => {
        const value = event && event.target ? event.target.value : event
        setForm((prev) => ({ ...prev, [key]: value }))
        setStatus('')
      }

      const save = async () => {
        setError('')
        setStatus('保存中…')
        try {
          const data = await request('/policy', {
            level: form.level,
            idleDays: Number(form.idleDays),
            minTools: Number(form.minTools),
            showDock: form.showDock === true,
            neverAutoClose: String(form.neverAutoClose || '')
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean),
          })
          setState(data)
          setStatus('已保存（下次会话开始时按新策略决定默认收起哪些组）')
        } catch (err) {
          setStatus('')
          setError(err.message)
        }
      }

      if (error && !form) return h('p', { style: styles.error }, `读取设置失败：${error}`)
      if (!form) return h('p', { style: styles.hint }, '读取中…')

      return h(
        'div',
        { style: styles.wrap },
        h(
          'p',
          { style: styles.intro },
          '重工具组默认收起，需要时由 AI 或关键词自动开回来。这里控制「自动收敛」的策略——它在每个会话开始时按历史使用决定默认开哪些组，不会在干活途中打断缓存。',
        ),
        h(
          'div',
          { style: styles.row },
          h('label', { style: styles.label }, '收敛档位'),
          h(
            'select',
            { style: styles.input, value: form.level, onChange: update('level') },
            ['low', 'medium', 'high'].map((level) =>
              h('option', { key: level, value: level }, LEVEL_LABELS[level]),
            ),
          ),
        ),
        h(
          'div',
          { style: styles.row },
          h('label', { style: styles.label }, '闲置天数'),
          h('input', {
            style: styles.input,
            type: 'number',
            min: 0,
            value: form.idleDays,
            onChange: update('idleDays'),
          }),
          h('span', { style: styles.hint }, '多少天没被调用就默认收起；0 表示不按时间收敛'),
        ),
        h(
          'div',
          { style: styles.row },
          h('label', { style: styles.label }, '最小工具数'),
          h('input', {
            style: styles.input,
            type: 'number',
            min: 0,
            value: form.minTools,
            onChange: update('minTools'),
          }),
          h('span', { style: styles.hint }, '少于这么多个工具的组不值得动它'),
        ),
        h(
          'div',
          { style: styles.row },
          h('label', { style: styles.label }, '永不自动收起'),
          h('input', {
            style: styles.input,
            type: 'text',
            value: form.neverAutoClose,
            onChange: update('neverAutoClose'),
            placeholder: '用逗号分隔组 id，例如 cua-input',
          }),
          state && Array.isArray(state.groups) && state.groups.length
            ? h(
                'div',
                { style: styles.groupList },
                state.groups.map((group) =>
                  h('span', { key: group.id, style: styles.chip }, group.title || group.id),
                ),
              )
            : null,
        ),
        h(
          'div',
          { style: styles.row },
          h(
            'label',
            { style: { ...styles.label, display: 'flex', alignItems: 'center', gap: '8px' } },
            h('input', {
              type: 'checkbox',
              checked: form.showDock === true,
              onChange: (event) => setForm((prev) => ({ ...prev, showDock: event.target.checked })),
            }),
            '在输入框上方显示「工具抽屉」控件',
          ),
          h('span', { style: styles.hint }, '默认关闭：不给不懂的人看；打开后每个对话可以单独调档位'),
        ),

h(
          'div',
          { style: styles.actions },
          h('button', { style: styles.button, onClick: save, type: 'button' }, '保存'),
          h('span', { style: status && status.includes('失败') ? styles.error : styles.status }, status),
          error ? h('span', { style: styles.error }, error) : null,
        ),
        h(
          'p',
          { style: styles.hint },
          state && state.file ? `策略文件：${state.file}` : '',
        ),
      )
    }

    // 输入框上方那一行：只改「这个对话」的抽屉，不碰全局设置。
    const DOCK_LEVELS = [
      { value: 'global', label: '跟随全局' },
      { value: 'low', label: '省着点（14 天）' },
      { value: 'medium', label: '中（7 天）' },
      { value: 'high', label: '激进（3 天）' },
    ]

    function LazyToolsDock(props) {
      const sessionId = props && props.sessionId ? String(props.sessionId) : ''
      const [state, setState] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')

      React.useEffect(() => {
        let alive = true
        if (!sessionId) return undefined
        request('/session?id=' + encodeURIComponent(sessionId))
          .then((data) => alive && (setState(data), setError('')))
          .catch((err) => alive && setError(err.message))
        return () => {
          alive = false
        }
      }, [sessionId])

      const apply = async (spec) => {
        if (!sessionId || busy) return
        setBusy(true)
        try {
          const data = await request('/session', { id: sessionId, ...spec })
          setState(data)
          setError('')
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy(false)
        }
      }

      if (!sessionId) return null
      // 控件默认关闭：想用的人去设置页打开（用户 2026-10-24 要求：别直接给小白）
      if (!state || state.showDock !== true) return null
      const current = (state && state.session && state.session.level) || 'global'
      const groups = (state && state.groups) || []
      const open = groups.filter((group) => group.on)

      return h(
        'div',
        { style: styles.dock },
        h('span', { style: styles.dockLabel }, '抽屉'),
        h(
          'select',
          {
            style: styles.dockSelect,
            value: current,
            disabled: busy,
            onChange: (event) => {
              const value = event.target.value
              apply(value === 'global' ? { reset: true } : { level: value })
            },
          },
          DOCK_LEVELS.map((item) => h('option', { key: item.value, value: item.value }, item.label)),
        ),
        h(
          'button',
          {
            type: 'button',
            style: styles.dockButton,
            disabled: busy,
            onClick: () => apply({ collapseAll: true }),
          },
          '立刻清空',
        ),
        h(
          'span',
          { style: styles.dockHint },
          error ? error : open.length ? `开着 ${open.length} 组` : '全部收起',
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = ctx.slots || ctx.get('slots')
        if (!slots) return
        slots.inject('settings.section', () =>
          slots.register(
            {
              name: 'settings.section',
              id: 'lazy-tools',
              order: 70,
              label: '工具抽屉',
            },
            LazyToolsSettings,
          ),
        )
        slots.inject('conversation.composer.dock', () =>
          slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'lazy-tools-dock',
              order: 7,
            },
            LazyToolsDock,
          ),
        )
      },
    }
  },
})
