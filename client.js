window.__ModuleLoader__.load({
  id: 'dsh-tool-drawer',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const API = '/lazy-tools/api'

// 语言：跟宿主 locale 服务走（不是猜浏览器）；拿不到就退回中文。
    let localeService = null
    function activeIsChinese() {
      try {
        const snapshot = localeService && typeof localeService.getLocale === 'function' ? localeService.getLocale() : null
        const active = snapshot && snapshot.active ? String(snapshot.active) : ''
        if (active) return active.toLowerCase().startsWith('zh')
        return String((typeof navigator !== 'undefined' && navigator.language) || 'zh').toLowerCase().startsWith('zh')
      } catch {
        return true
      }
    }
    const tr = (zh, en) => (activeIsChinese() ? zh : en)

    /** 订阅语言变化：切换语言时让组件重渲染（返回值不用，只是触发）。 */
    function useLocaleVersion() {
      const [version, setVersion] = React.useState(0)
      React.useEffect(() => {
        const service = localeService
        if (!service || typeof service.subscribe !== 'function') return undefined
        return service.subscribe(() => setVersion((value) => value + 1))
      }, [])
      return version
    }
    const LEVEL_LABELS = {
      low: tr('低（保守）', 'Low (conservative)'),
      medium: tr('中（默认）', 'Medium (default)'),
      high: tr('高（激进）', 'High (aggressive)'),
    }
    // 角色工具面（用户口中的「面具」）：勾选 = 该角色在 label 下按 allowGroups 裁工具。
    // 默认值与 cordis.patch.yml 的 managedRoles 保持一致；UI 只控制「启用/停用」，细粒度组仍可在配置里改。
    const ROLE_MASKS = {
      review: { allowGroups: ['browser-heavy'], unknown: 'hide' },
      build: { allowGroups: ['*'], unknown: 'show' },
      research: { allowGroups: ['web', 'browser-heavy'], unknown: 'hide' },
    }
    const ROLE_LABELS = {
      review: tr('review（审阅）', 'review'),
      build: tr('build（实现）', 'build'),
      research: tr('research（调研）', 'research'),
    }

    async function request(path, body) {
      const options = { headers: { 'content-type': 'application/json', 'x-lazy-tools': '1' } }
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
      dockCustom: { display: 'flex', alignItems: 'center', gap: '4px', opacity: 0.85 },
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
      useLocaleVersion()
      const [state, setState] = React.useState(null)
      const [form, setForm] = React.useState(null)
      const [status, setStatus] = React.useState('')
      const [error, setError] = React.useState('')
      // 用户有没有手改过「闲置天数」：没改过就让档位决定天数（2026-10-29 修 bug 2 的客户端半边）
      const [daysTouched, setDaysTouched] = React.useState(false)
      const [newRoleName, setNewRoleName] = React.useState('')
      const [newRoleGroups, setNewRoleGroups] = React.useState([])
      const [groupCatalog, setGroupCatalog] = React.useState([])
      const [roleError, setRoleError] = React.useState('')

      React.useEffect(() => {
        let alive = true
        request('/state')
          .then((data) => {
            if (!alive) return
            setState(data)
            setGroupCatalog(Array.isArray(data.groups) ? data.groups : [])
            setForm({
              level: data.policy.level,
              idleDays: String(data.policy.idleDays),
              minTools: String(data.policy.minTools),
              presetLow: String((data.policy.presets && data.policy.presets.low) || 14),
              presetMedium: String((data.policy.presets && data.policy.presets.medium) || 7),
              presetHigh: String((data.policy.presets && data.policy.presets.high) || 3),
              showDock: data.policy.showDock === true,
              showClear: data.policy.showClear === true,
              classifyNudge: data.policy.classifyNudge !== false,
              autoGroups: data.policy.autoGroups || 'on',
              managedRoles: data.policy.managedRoles && typeof data.policy.managedRoles === 'object'
                ? data.policy.managedRoles
                : {},
            })
          })
          .catch((err) => alive && setError(err.message))
        return () => {
          alive = false
        }
      }, [])

      const update = (key) => (event) => {
        const value = event && event.target ? event.target.value : event
        setStatus('')
        if (key === 'idleDays') {
          setDaysTouched(true)
          setForm((prev) => ({ ...prev, idleDays: value }))
          return
        }
        setForm((prev) => {
          const next = { ...prev, [key]: value }
          // 换档位、且用户没手改过天数时：输入框跟着显示该档的天数（真正下发由宿主按档位算）
          if (key === 'level' && !daysTouched) {
            const presets = { low: prev.presetLow, medium: prev.presetMedium, high: prev.presetHigh }
            if (presets[value] !== undefined) next.idleDays = String(presets[value])
          }
          return next
        })
      }
      const setFlag = (key) => (event) => {
        const checked = Boolean(event && event.target && event.target.checked)
        setForm((prev) => ({ ...prev, [key]: checked }))
        setStatus('')
      }

      const setRole = (role) => (event) => {
        const checked = Boolean(event && event.target && event.target.checked)
        setForm((prev) => {
          const next = { ...(prev.managedRoles || {}) }
          if (checked) {
            if (!next[role]) next[role] = ROLE_MASKS[role] || { allowGroups: [], unknown: 'hide' }
          } else {
            delete next[role]
          }
          return { ...prev, managedRoles: next }
        })
        setStatus('')
      }

      const addRole = () => {
        const name = String(newRoleName || '').trim().toLowerCase()
        if (!/^[A-Za-z0-9_-]+$/.test(name)) {
          setRoleError(tr('角色名只能用字母、数字、_、-（它会匹配 label 的第一段）', 'Role names: letters, digits, _, - (matches the first label segment)'))
          return
        }
        const groups = Array.isArray(newRoleGroups) ? newRoleGroups : []
        setForm((prev) => ({
          ...prev,
          managedRoles: {
            ...(prev.managedRoles || {}),
            [name]: { allowGroups: groups, unknown: 'hide' },
          },
        }))
        setNewRoleName('')
        setNewRoleGroups([])
        setRoleError('')
        setStatus('')
      }

      const refreshGroups = async () => {
        try {
          const data = await request('/state')
          setState(data)
          setGroupCatalog(Array.isArray(data.groups) ? data.groups : [])
          setStatus(tr('分组列表已刷新', 'Group list refreshed'))
          setError('')
        } catch (err) {
          setError(err.message)
        }
      }

      const save = async () => {
        setError('')
        setStatus(tr('保存中…', 'Saving…'))
        const presets = { low: Number(form.presetLow), medium: Number(form.presetMedium), high: Number(form.presetHigh) }
        const daysText = String(form.idleDays == null ? '' : form.idleDays).trim()
        const payload = {
          level: form.level,
          minTools: Number(form.minTools),
          presets,
          showDock: form.showDock === true,
          showClear: form.showClear === true,
          classifyNudge: form.classifyNudge !== false,
          autoGroups: form.autoGroups || 'on',
          managedRoles: form.managedRoles || {},
        }
        // 空字符串不能变成 Number('') = 0 —— 0 在这里的意思是「不按时间收敛 = 全开」。
        // 规则：手改过、或填的数与当前档位天数不同 → 下发；否则不下发，让宿主按档位算。
        if (daysText !== '') {
          const value = Number(daysText)
          if (Number.isFinite(value) && value >= 0) {
            const presetForLevel = presets[form.level]
            if (daysTouched || !Number.isFinite(presetForLevel) || value !== presetForLevel) {
              payload.idleDays = Math.round(value)
            }
          }
        }
        try {
          const data = await request('/policy', payload)
          setState(data)
          setStatus(tr('已保存（下次会话开始时按新策略决定默认收起哪些组）', 'Saved. The new policy applies from the next session start.'))
        } catch (err) {
          setStatus('')
          setError(err.message)
        }
      }

      if (error && !form) return h('p', { style: styles.error }, `${tr('读取设置失败：', 'Failed to load settings: ')}${error}`)
      if (!form) return h('p', { style: styles.hint }, tr('读取中…', 'Loading…'))

      const summary = state && state.summary ? state.summary : null
      const stowedLine = summary
        ? tr(
            `已收纳 ${summary.hidden} 个工具 · 自动取出 ${summary.selfHealed} 次`,
            `${summary.hidden} tools stowed · ${summary.selfHealed} auto-restored`,
          )
        : ''

      // 基础页只留大多数人在意的几格；其余进「高级设置」（原生 <details>，不占注意力）。
      // 旧配置里可能有 re 之类历史角色，也列出来，别让它隐身。
      const roleKeys = [...new Set([...Object.keys(ROLE_MASKS), ...Object.keys(form.managedRoles || {})])]
      return h(
        'div',
        { style: styles.wrap },
        h('p', { style: styles.intro }, tr('重工具组默认收起，需要时由 AI 主动放回、或在调用被拦时自动放回。这里控制「自动收敛」的策略——它在每个会话开始时按历史使用决定默认开哪些组，不会在干活途中打断缓存。', 'Heavy tool groups stay collapsed and come back on demand. These settings control when groups collapse on their own: the decision is made once at session start, so it never breaks an active prompt cache.')),
        stowedLine ? h('p', { style: styles.hint }, stowedLine) : null,
        h(
          'div',
          { style: styles.row },
          h('label', { style: styles.label }, tr('收敛档位', 'Collapse level')),
          h(
            'select',
            { style: styles.input, value: form.level, onChange: update('level') },
            ['low', 'medium', 'high'].map((level) => h('option', { key: level, value: level }, LEVEL_LABELS[level])),
          ),
        ),
        h(
          'div',
          { style: styles.row },
          h('label', { style: styles.label }, tr('闲置天数（可自定义）', 'Idle days (custom)')),
          h('input', { style: styles.input, type: 'number', min: 0, value: form.idleDays, onChange: update('idleDays') }),
          h('span', { style: styles.hint }, tr('留空 = 跟随档位（不会存成 0）；0 = 不按时间收敛，所有组默认张开', 'Empty = follow the level (never stored as 0). 0 = never collapse by time.')),
        ),
        h(
          'div',
          { style: styles.row },
          h(
            'label',
            { style: { ...styles.label, display: 'flex', alignItems: 'center', gap: '8px' } },
            h('input', { type: 'checkbox', checked: form.showDock === true, onChange: setFlag('showDock') }),
            tr('在输入框上方显示「工具抽屉」控件', 'Show the drawer control above the composer'),
          ),
          h('span', { style: styles.hint }, tr('默认关闭。开启后可在每个对话里单独选档位；该控件按对话挂载，勾选后切换一次对话（或刷新页面）即出现。', 'Off by default. Once enabled, every conversation can pick its own level. Mounted per conversation, so switch conversations (or reload) before it appears.')),
        ),
        h(
          'div',
          { style: styles.row },
          h(
            'label',
            { style: { ...styles.label, display: 'flex', alignItems: 'center', gap: '8px' } },
            h('input', { type: 'checkbox', checked: form.showClear === true, onChange: setFlag('showClear') }),
            tr('在输入框上方显示「收纳本对话工具」按钮', 'Show the stow-now button above the composer'),
          ),
          h('span', { style: styles.hint }, tr('与档位控件互相独立：只想要档位就不勾它；想一键把本对话的工具全收纳再勾。', 'Independent of the level control. Leave it off unless you want a one-click stow for this conversation.')),
        ),
        h(
          'details',
          { style: { marginTop: '4px' } },
          h(
            'summary',
            { style: { cursor: 'pointer', fontSize: '13px', opacity: 0.75 } },
            tr('高级：角色工具面（默认关闭，编排器再用）', 'Advanced: role masks (off by default; for orchestrators)'),
          ),
          h(
            'div',
            { style: styles.row },
            h('label', { style: styles.label }, tr('角色工具面（默认关闭）', 'Role masks (off by default)')),
          h(
            'div',
            { style: { display: 'flex', gap: '14px', flexWrap: 'wrap' } },
            roleKeys.map((role) =>
              h(
                'label',
                { key: role, style: { ...styles.label, display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 400 } },
                h('input', {
                  type: 'checkbox',
                  checked: Boolean(form.managedRoles && form.managedRoles[role]),
                  onChange: setRole(role),
                }),
                ROLE_LABELS[role] || role,
                h('span', { style: { opacity: 0.65, fontSize: '12px' } }, (() => {
                  const groups = form.managedRoles && form.managedRoles[role] && form.managedRoles[role].allowGroups
                  return Array.isArray(groups) ? (groups.length ? groups.join(', ') : 'CORE only') : ''
                })()),
              ),
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '4px' } },
            h('input', {
              style: styles.input,
              placeholder: tr('自定义角色名', 'Custom role'),
              value: newRoleName,
              onChange: (event) => setNewRoleName(event.target.value),
            }),
            h('button', { style: styles.button, type: 'button', onClick: refreshGroups }, tr('刷新分组', 'Refresh groups')),
          ),
          h('span', { style: styles.hint }, tr('从当前所有工具组勾选；勾“全部”等于 allowGroups:["*"]；不勾任何组 = 只留常驻工具。', 'Pick from the current groups; All = allowGroups:["*"]; none = core tools only.')),
          h(
            'div',
            { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
            groupCatalog.map((g) =>
              h(
                'label',
                { key: g.id, style: { ...styles.label, display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 400, fontSize: '12px' } },
                h('input', {
                  type: 'checkbox',
                  checked: newRoleGroups.includes(g.id),
                  onChange: (event) => {
                    const checked = Boolean(event && event.target && event.target.checked)
                    setNewRoleGroups((prev) => checked ? [...prev.filter((x) => x !== g.id), g.id] : prev.filter((x) => x !== g.id))
                  },
                }),
                `${g.title || g.id} (${g.id})`,
              ),
            ),
            h(
              'label',
              { style: { ...styles.label, display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 400, fontSize: '12px' } },
              h('input', {
                type: 'checkbox',
                checked: newRoleGroups.includes('*'),
                onChange: (event) => setNewRoleGroups(event.target.checked ? ['*'] : []),
              }),
              tr('全部 (*)', 'All (*)'),
            ),
          ),
          h('button', { style: styles.button, type: 'button', onClick: addRole }, tr('添加角色', 'Add role')),
          roleError ? h('span', { style: styles.error }, roleError) : null,
          h(
            'span',
            { style: styles.hint },
            tr(
              '默认关闭：勾选后 label 为 review/build/research 时按角色裁工具面；review/research 隐藏 edit/write。取消勾选 = 该角色不再裁工具面，下次会话/标签生效。自定义角色也可在下面加。',
              'Off by default. Once checked, review/build/research labels apply a role-scoped tool surface; review/research hide edit/write. Uncheck to stop masking for that role (next session/label). Add custom roles below.',
            ),
          ),
        ),
        ),
        h(
          'div',
          { style: styles.actions },
          h('button', { style: styles.button, onClick: save, type: 'button' }, tr('保存', 'Save')),
          h('span', { style: status && status.includes('失败') ? styles.error : styles.status }, status),
          error ? h('span', { style: styles.error }, error) : null,
        ),
        h(
          'details',
          { style: { marginTop: '4px' } },
          h('summary', { style: { cursor: 'pointer', fontSize: '13px', opacity: 0.75 } }, tr('高级设置', 'Advanced')),
          h(
            'div',
            { style: { ...styles.wrap, marginTop: '12px' } },
            h(
              'div',
              { style: styles.row },
              h('label', { style: styles.label }, tr('自动分组', 'Auto groups')),
              h(
                'select',
                { style: styles.input, value: form.autoGroups || 'on', onChange: update('autoGroups') },
                [
                  h('option', { key: 'on', value: 'on' }, tr('自动建组并收起（默认）', 'Auto-create and collapse (default)')),
                  h('option', { key: 'suggest', value: 'suggest' }, tr('只建议（在 scan 里）', 'Suggest only (in scan)')),
                  h('option', { key: 'off', value: 'off' }, tr('关闭', 'Off')),
                ],
              ),
              h('span', { style: styles.hint }, tr('按工具名前缀识别家族，同族至少 3 个才建组，核心工具永不入组；被收起的工具第一次被调用时会自动放回来。', 'Groups tool families by name prefix; at least 3 tools per family; core tools are never included; a collapsed tool is restored automatically the first time it is called.')),
            ),
            h(
              'div',
              { style: styles.row },
              h('label', { style: styles.label }, tr('三档各自的天数（可修改）', 'Days per level (editable)')),
              h(
                'div',
                { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
                h('span', { style: styles.hint }, tr('低', 'Low')),
                h('input', { style: { ...styles.input, width: '84px' }, type: 'number', min: 0, value: form.presetLow, onChange: update('presetLow') }),
                h('span', { style: styles.hint }, tr('中', 'Mid')),
                h('input', { style: { ...styles.input, width: '84px' }, type: 'number', min: 0, value: form.presetMedium, onChange: update('presetMedium') }),
                h('span', { style: styles.hint }, tr('高', 'High')),
                h('input', { style: { ...styles.input, width: '84px' }, type: 'number', min: 0, value: form.presetHigh, onChange: update('presetHigh') }),
                h('span', { style: styles.hint }, tr('天', 'days')),
              ),
              h('span', { style: styles.hint }, tr('改了之后，档位控件和斜杠命令都按新的天数算', 'The drawer control and the slash command both use these numbers.')),
            ),
            h(
              'div',
              { style: styles.row },
              h('label', { style: styles.label }, tr('最小工具数', 'Min tools per group')),
              h('input', { style: styles.input, type: 'number', min: 0, value: form.minTools, onChange: update('minTools') }),
              h('span', { style: styles.hint }, tr('少于这么多个工具的组不值得动它', 'Groups smaller than this are not worth touching.')),
            ),
            h(
              'div',
              { style: styles.row },
              h(
                'label',
                { style: { ...styles.label, display: 'flex', alignItems: 'center', gap: '8px' } },
                h('input', { type: 'checkbox', checked: form.classifyNudge !== false, onChange: setFlag('classifyNudge') }),
                tr('没归组的裸名工具，让 AI 顺手分一次组', 'Let the agent group unnamed tools once'),
              ),
              h('span', { style: styles.hint }, tr('默认开启。当有新插件的工具既没有共同前缀、又不属于任何组时，会在系统提示里提醒 AI 花一点 token 分组，结果写进 ~/.dsh/lazy-tools.groups.json，之后长期生效、不再重复。反感多这一句的人可以关掉（关掉后仍可手动让 AI 调 lazy_tools_classify）。', 'On by default. When a new plugin registers tools with no shared prefix and no group, the agent is reminded once to group them (a small token cost); the result is stored in ~/.dsh/lazy-tools.groups.json and reused afterwards. Turn it off if you dislike the extra line — lazy_tools_classify still works manually.')),
            ),
            h('p', { style: styles.hint }, state && state.file ? `${tr('策略文件：', 'Policy file: ')}${state.file}` : ''),
          ),
        ),
      )
    }

    // 输入框上方那一行：只改「这个对话」的抽屉，不碰全局设置。
    function LazyToolsDock(props) {
      useLocaleVersion()
      const sessionId = props && props.sessionId ? String(props.sessionId) : ''
      const [state, setState] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [customDaysText, setCustomDaysText] = React.useState('')
      const [customOpen, setCustomOpen] = React.useState(false)

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
      // 两个开关各自独立：只要有一个打开，这一行就渲染；里面每个控件再由各自的开关控制。
      if (!state || (state.showDock !== true && state.showClear !== true)) return null
      const current = (state && state.session && state.session.level) || 'global'
      const presets = state.presets || { low: 14, medium: 7, high: 3 }
      const globalDays = Number.isFinite(state.globalIdleDays) ? state.globalIdleDays : presets.medium
      const isCustom = state.session && state.session.source === 'session' && !state.session.level
      const hiddenTools = Number.isFinite(state.hiddenTools) ? state.hiddenTools : 0
      const selfHealed = Number.isFinite(state.selfHealed) ? state.selfHealed : 0
      // 档位从「循环点击」改成一次选择（2026-10-29）：原来想从全局切到高档要点三次，
      // 而每次点击都会重算工具表 —— 三次 = 三次打断前缀缓存。
      const selectValue = customOpen || isCustom ? 'custom' : current
      const customLabel = isCustom
        ? tr(`自定义（${state.session.idleDays} 天）`, `Custom (${state.session.idleDays} d)`)
        : tr('自定义…', 'Custom…')
      const onPick = (event) => {
        const value = event && event.target ? event.target.value : 'global'
        if (value === 'custom') {
          setCustomOpen(true)
          return
        }
        setCustomOpen(false)
        apply(value === 'global' ? { reset: true } : { level: value })
      }

      const stowButton =
        state.showClear === true
          ? h(
              'button',
              {
                type: 'button',
                style: styles.dockButton,
                disabled: busy,
                title: tr('立刻把本对话的所有工具组收纳起来（随时可再开回来）', 'Stow every tool group in this conversation now. They can be reopened at any time.'),
                onClick: () => apply({ collapseAll: true }),
              },
              tr('收纳本对话工具', 'Stow now'),
            )
          : null

      const statusHint = h(
        'span',
        { style: styles.dockHint },
        error
          ? error
          : hiddenTools > 0
            // hiddenTools 和 selfHealed 都取本对话状态；全局累计只看 health.stats.selfHealed，不再混入口袋行。
            ? tr(`本对话已收纳 ${hiddenTools} 个工具 · 本对话累计自动取出 ${selfHealed} 次`, `This conversation: ${hiddenTools} stowed · this conversation auto-restored: ${selfHealed}`)
            : tr('没有收纳中的工具', 'nothing stowed'),
      )

      return h(
        'div',
        { style: styles.dock },
        state.showDock === true
          ? h('span', { style: styles.dockLabel }, tr('本对话工具收纳', 'Tool drawer'))
          : null,
        state.showDock === true
          ? h(
              'select',
              {
                style: styles.dockSelect,
                value: selectValue,
                disabled: busy,
                title: tr('只改这个对话的收敛档位', 'Change the collapse level for this conversation'),
                onChange: onPick,
              },
              [
                h('option', { key: 'global', value: 'global' }, tr(`跟随全局（${globalDays} 天）`, `Global (${globalDays} d)`)),
                h('option', { key: 'low', value: 'low' }, tr(`保守（${presets.low} 天）`, `Conservative (${presets.low} d)`)),
                h('option', { key: 'medium', value: 'medium' }, tr(`均衡（${presets.medium} 天）`, `Balanced (${presets.medium} d)`)),
                h('option', { key: 'high', value: 'high' }, tr(`积极（${presets.high} 天）`, `Aggressive (${presets.high} d)`)),
                h('option', { key: 'custom', value: 'custom' }, customLabel),
              ],
            )
          : null,
        state.showDock === true && customOpen
          ? h(
              'span',
              { style: styles.dockCustom, title: tr('只对当前对话生效；回车生效，Esc 取消', 'Applies to this conversation only. Enter to apply, Esc to cancel.') },
              h('input', {
                type: 'number',
                min: 0,
                step: 1,
                placeholder: tr('天数', 'days'),
                style: styles.dockInput,
                value: customDaysText,
                disabled: busy,
                autoFocus: true,
                'aria-label': tr('自定义天数（只对当前对话生效）', 'Custom days (this conversation only)'),
                onChange: (event) => setCustomDaysText(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Escape') {
                    setCustomOpen(false)
                    return
                  }
                  if (event.key !== 'Enter') return
                  const days = Number(customDaysText)
                  if (customDaysText === '' || !Number.isFinite(days) || days < 0) return
                  apply({ idleDays: Math.round(days) })
                  setCustomOpen(false)
                },
              }),
              tr('天', 'days'),
              h('button', { type: 'button', style: styles.dockButton, disabled: busy, onClick: () => setCustomOpen(false) }, tr('取消', 'Cancel')),
            )
          : null,
        stowButton,
        statusHint,
      )
    }

    // 把槽位注册抽成真正的局部函数：object 字面量里的方法名不是词法变量，
    // 不能在 apply 里裸调（2026-10-24 调试时踩过，报 registerInto is not defined）。
    function registerInto(ctx) {
      const slots = ctx.slots || (typeof ctx.get === 'function' ? ctx.get('slots') : null)
      if (!slots) {
        console.error('[lazy-tools] client: no slots service')
        return
      }
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
      // 告诉宿主「浏览器这边真的挂上了」。宿主正常 ≠ 面板挂上，
      // 这条心跳让 lazy_tools_health 能直接看出面板有没有挂（失败一律忽略，不影响功能）。
      try {
        const ping = fetch(`${API}/client`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-lazy-tools': '1' },
          body: JSON.stringify({ panels: ['settings.section', 'conversation.composer.dock'] }),
        })
        if (ping && typeof ping.catch === 'function') ping.catch(() => {})
      } catch {
        /* 心跳失败不影响任何功能 */
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        try {
          localeService = (typeof ctx.get === 'function' ? ctx.get('locale') : null) || ctx.locale || null
        } catch (error) {
          // 冷启动时 locale 服务可能还没就绪，属于预期内的先后顺序：不刷错误。
      console.log('[lazy-tools] locale not ready yet (cold start):', (error && error.message) || error)
          localeService = null
        }
        try {
          registerInto(ctx)
        } catch (error) {
          console.error('[lazy-tools] client apply failed:', (error && error.stack) || error)
          throw error
        }
      },
    }
  },
})
