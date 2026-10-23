window.__ModuleLoader__.load({
  id: 'dsh-lazy-tools',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const API = '/lazy-tools/api'
    const LEVEL_LABELS = {
      low: '低（保守）',
      medium: '中（默认）',
      high: '高（激进）',
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
      dockDivider: { opacity: 0.35 },
      dockButton: {
        padding: '2px 10px',
        borderRadius: '999px',
        border: '1px solid color-mix(in srgb, currentColor 25%, transparent)',
        background: 'transparent',
        color: 'inherit',
        fontSize: '12px',
        cursor: 'pointer',
        marginLeft: 'auto',
      },
      dockInput: {
        width: '58px',
        padding: '2px 6px',
        borderRadius: '999px',
        border: '1px solid color-mix(in srgb, currentColor 25%, transparent)',
        background: 'transparent',
        color: 'inherit',
        fontSize: '12px',
        fontFamily: 'inherit',
        textAlign: 'center',
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
              presetLow: String((data.policy.presets && data.policy.presets.low) || 14),
              presetMedium: String((data.policy.presets && data.policy.presets.medium) || 7),
              presetHigh: String((data.policy.presets && data.policy.presets.high) || 3),
              showDock: data.policy.showDock === true,
              showClear: data.policy.showClear === true,
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
            presets: { low: Number(form.presetLow), medium: Number(form.presetMedium), high: Number(form.presetHigh) },
            showDock: form.showDock === true,
            showClear: form.showClear === true,
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
          h('label', { style: styles.label }, '闲置天数（可自定义）'),
          h('input', {
            style: styles.input,
            type: 'number',
            min: 0,
            value: form.idleDays,
            onChange: update('idleDays'),
          }),
          h('span', { style: styles.hint }, '这里填多少天就是多少天；不填就跟随档位；0 表示不按时间收敛'),
        ),
        h(
          'div',
          { style: styles.row },
          h('label', { style: styles.label }, '三档各自的天数（可修改）'),
          h(
            'div',
            { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
            h('span', { style: styles.hint }, '低'),
            h('input', {
              style: { ...styles.input, width: '84px' },
              type: 'number',
              min: 0,
              value: form.presetLow,
              onChange: update('presetLow'),
            }),
            h('span', { style: styles.hint }, '中'),
            h('input', {
              style: { ...styles.input, width: '84px' },
              type: 'number',
              min: 0,
              value: form.presetMedium,
              onChange: update('presetMedium'),
            }),
            h('span', { style: styles.hint }, '高'),
            h('input', {
              style: { ...styles.input, width: '84px' },
              type: 'number',
              min: 0,
              value: form.presetHigh,
              onChange: update('presetHigh'),
            }),
            h('span', { style: styles.hint }, '天'),
          ),
          h('span', { style: styles.hint }, '改了之后，档位按钮和斜杠命令都按新的天数算'),
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
        // 「永不自动收起」从界面上拿掉了（2026-10-24 用户觉得麻烦）：
        // 默认值已经在代码里钉死是 ['cua-input']（动手组永不自动收），
        // 还想细调的人去 ~/.dsh/lazy-tools.policy.json 或 bundle 配置里写。
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
          h(
            'span',
            { style: styles.hint },
            '默认关闭。开启后可在每个对话里单独调档位；该控件按对话挂载，勾选后需要切换一次对话（或刷新页面）才会显示。',
          ),
        ),
        h(
          'div',
          { style: styles.row },
          h(
            'label',
            { style: { ...styles.label, display: 'flex', alignItems: 'center', gap: '8px' } },
            h('input', {
              type: 'checkbox',
              checked: form.showClear === true,
              onChange: (event) => setForm((prev) => ({ ...prev, showClear: event.target.checked })),
            }),
            '在输入框上方显示「立刻清空」按钮',
          ),
          h(
            'span',
            { style: styles.hint },
            '与档位按钮互相独立：只想要档位就不勾它；想一键把本对话的工具全收起来再勾。',
          ),
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
    const DOCK_LEVELS = ['global', 'low', 'medium', 'high']

    function LazyToolsDock(props) {
      const sessionId = props && props.sessionId ? String(props.sessionId) : ''
      const [state, setState] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [customDaysText, setCustomDaysText] = React.useState('')

      React.useEffect(() => {
        if (!state) return
        const snapshot = state.session || {}
        setCustomDaysText(snapshot.source === 'session' && !snapshot.level ? String(snapshot.idleDays) : '')
      }, [state])

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
      // 两个开关各自独立：只要有一个打开，这一行就渲染；里面每个按钮再由自己的开关控制。
      if (!state || (state.showDock !== true && state.showClear !== true)) return null
      const current = (state && state.session && state.session.level) || 'global'
      const groups = (state && state.groups) || []
      const open = groups.filter((group) => group.on)
      const presets = state.presets || { low: 14, medium: 7, high: 3 }
      const isCustom = state.session && state.session.source === 'session' && !state.session.level
      const levelName = current === 'low' ? '低' : current === 'high' ? '高' : '中'
      const levelLabel = isCustom
        ? `抽屉：${state.session.idleDays} 天`
        : `抽屉：${current === 'global' ? '跟随全局' : `${levelName} ${presets[current]} 天`}`

      return h(
        'div',
        { style: styles.dock },
        // 按钮一：只负责「这个对话的档位」，点一下换下一档（跟随全局 → 低 → 中 → 高）
        state.showDock === true
          ? h(
              'button',
              {
                type: 'button',
                style: styles.dockButton,
                disabled: busy,
                title: '只改这个对话的收敛档位',
                onClick: () => {
                  const order = ['global', 'low', 'medium', 'high']
                  const next = order[(order.indexOf(current) + 1) % order.length]
                  apply(next === 'global' ? { reset: true } : { level: next })
                },
              },
              levelLabel,
            )
          : null,
        // 这个对话的自定义天数：填数字回车生效，只影响当前对话
        state.showDock === true
          ? h('input', {
              type: 'number',
              min: 0,
              step: 1,
              placeholder: '天',
              style: styles.dockInput,
              value: customDaysText,
              disabled: busy,
              title: '给这个对话单独设一个天数，回车生效',
              onChange: (event) => setCustomDaysText(event.target.value),
              onKeyDown: (event) => {
                if (event.key !== 'Enter') return
                const days = Number(customDaysText)
                if (customDaysText === '' || !Number.isFinite(days) || days < 0) return
                apply({ idleDays: Math.round(days) })
              },
            })
          : null,
        // 按钮二：只负责「立刻清空本对话的工具组」（独立开关，默认不显示）
        state.showClear === true ? h(
          'button',
          {
            type: 'button',
            style: styles.dockButton,
            disabled: busy,
            title: '立刻把本对话的所有工具组收起（可随时再开回来）',
            onClick: () => apply({ collapseAll: true }),
          },
          '立刻清空',
        ) : null,
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
