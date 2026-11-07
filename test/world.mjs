export function makeWorld(options = {}) {
  const registered = new Map()
  // 2026-11-03：模拟「注册了但不可 restrict」的名字（真机上 agent 自己那层、run_code 等）
  const nonRestrictable = new Set(Array.isArray(options.nonRestrictable) ? options.nonRestrictable : [])
  const createdListeners = []
  const denyByAgent = new Map()
  const externalByAgent = new Map() // 模拟别的插件的 deny：我们的 lift 撤不动
  // 2026-11-04：agent 作用域注册的工具（别名转发壳）——可见但**不可 restrict**
  const scopedByAgent = new Map()
  const activeByAgent = new Map() // agent -> [{ names }]：当前**真正挂着**的限制（孤儿会在这里露出来）
  // rc.3 的撤销是同步通知的。默认关（不影响其它用例），需要复现重入的用例自己打开。
  let fireOnRestrict = false
  let failRestrictTimes = 0
  const failRestrictFor = new Set()
  const failRestrictSingle = new Set()
  const reservedPtc = new Set()
  const living = [] // «ctx.get('agents').list()» 返回的东西
  const effects = [] // «ctx.effect(cb)» 收下的回调，插件卸载时 Cordis 会调用它们
  const toolsChangeListeners = []
  const inboxListeners = []
  const preExecuteListeners = []
  const guards = []
  const commands = []
  const eventListeners = new Map()
  const unmounted = new Map() // agent -> Set(name)：宿主没挂到该会话的工具（不是我们 restrict 的）

  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    on(event, handler) {
      if (!eventListeners.has(event)) eventListeners.set(event, [])
      eventListeners.get(event).push(handler)
      if (event === 'agent/created') createdListeners.push(handler)
      if (event === 'tools/change') toolsChangeListeners.push(handler)
      if (event === 'agent/inbox/inserted') inboxListeners.push(handler)
      if (event === 'tools/pre-execute') preExecuteListeners.push(handler)
    },
    effect(callback) {
      effects.push(callback)
      return () => {}
    },
    get(key) {
      if (key === 'agents') return { list: () => living, get: (id) => living.find((a) => a && a.id === id) }
      if (key === 'commands') {
        return {
          register(definition) {
            commands.push(definition)
            return () => {}
          },
        }
      }
      return undefined
    },
    tools: {
      guard(fn) {
        guards.push(fn)
        return () => {}
      },

      register(definition) {
        registered.set(definition.name, definition)
        return () => registered.delete(definition.name)
      },
      // 真实宿主：get(name) 是全局视图；get(name, agent) 是 agent 作用域视图（rc.3 与 schemas(agent) 同源）。
      // 2026-10-30 冷读指出假宿主原来忽略第二个参数 ⇒ `scoped` 永远等于 `global`，三态测不出来。
      get(name, agent) {
        if (!agent) return registered.get(name)
        const deny = denyByAgent.get(agent) || new Set()
        const miss = unmounted.get(agent) || new Set()
        const ext = externalByAgent.get(agent) || new Set()
        if (deny.has(name) || miss.has(name) || ext.has(name)) return undefined
        return registered.get(name)
      },
      schemas(agent) {
        const deny = (agent && denyByAgent.get(agent)) || new Set()
        const miss = (agent && unmounted.get(agent)) || new Set()
        const ext = (agent && externalByAgent.get(agent)) || new Set()
        return [...registered.keys()].filter((name) => !deny.has(name) && !miss.has(name) && !ext.has(name)).map((name) => ({ name }))
      },
      // 宿主的同源视图（2026-11-01 新读路径）：与 schemas 同源、只给名字，代价是 Map 遍历而不是深拷贝。
      // 假宿主必须建这一条：不建的话，插件里「有 view 就不拷 schema」的主路径一行代码都测不到
      // （冷读把 `return [...visible.keys()]` 改成 `return []`，74 项照样全绿 —— 那就是假绿）。
      view(agent) {
        const deny = (agent && denyByAgent.get(agent)) || new Set()
        const miss = (agent && unmounted.get(agent)) || new Set()
        const ext = (agent && externalByAgent.get(agent)) || new Set()
        const scoped = (agent && scopedByAgent.get(agent)) || new Set()
        const visible = new Map()
        for (const [name, definition] of registered) {
          if (deny.has(name) || miss.has(name) || ext.has(name)) continue
          visible.set(name, definition)
        }
        // scoped 注册不受 mask 影响，且**不可被 restrict**
        for (const name of scoped) visible.set(name, { name, scoped: true })
        // 真宿主：inherited 名字先全部进 restrictableNames，再看 admits 决定 visible；
        // 被 deny 的名字仍在集合里。假宿主以前把 deny 的删掉，替身比真宿主更听话。
        const restrictableNames = new Set([...registered.keys()])
        return { visible, restrictableNames }
      },
    },
  }

  const makeAgent = (id) => {
    const agent = { id }
    denyByAgent.set(agent, new Set())
    externalByAgent.set(agent, new Set())
    activeByAgent.set(agent, [])
    agent.ctx = {
      // 受管角色测试：agentPresets 由 createAgent 的 setup 注入
      get(key) {
        if (key === 'agentPresets') return agent.presets
        return undefined
      },
      tools: {
        // 与注册表级 get 同语义：带 agent 时按该 agent 的作用域过滤（2026-10-30 冷读修）
        get(name, scopedAgent) {
          if (!scopedAgent) return registered.get(name)
          const denyS = denyByAgent.get(scopedAgent) || new Set()
          const missS = unmounted.get(scopedAgent) || new Set()
          const extS = externalByAgent.get(scopedAgent) || new Set()
          if (denyS.has(name) || missS.has(name) || extS.has(name)) return undefined
          return registered.get(name)
        },
        restrict(filter) {
          const deny = denyByAgent.get(agent)
          const asked = Array.isArray(filter && filter.deny) ? filter.deny : []
          if (asked.some((name) => reservedPtc.has(name))) {
            throw new Error('tools.restrict() cannot name reserved PTC mode presentation transport "' + asked.find((name) => reservedPtc.has(name)) + '"')
          }
          if (asked.some((name) => failRestrictFor.has(name))) {
            throw new Error('restrict backend unavailable')
          }
          if (asked.length === 1 && failRestrictSingle.has(asked[0])) {
            throw new Error('restrict backend unavailable')
          }
          if (failRestrictTimes > 0) {
            failRestrictTimes -= 1
            throw new Error('restrict backend unavailable')
          }
          const added = Array.isArray(filter && filter.deny) ? [...filter.deny] : []
          // 真宿主的行为：deny 里混进不可限制的名字 ⇒ **整批抛错**（一个都不藏）
          const unknown = added.filter((name) => nonRestrictable.has(name))
          if (unknown.length) throw new Error('tools.restrict() names unknown global tool "' + unknown[0] + '"')
          const entry = { names: added }
          activeByAgent.get(agent).push(entry)
          for (const name of added) deny.add(name)
          // 2026-10-30：rc.3 里「撤销限制」是**同步**通知 tools/change 的。
          // 这条 synchronous 行为正是重入 rebuild 的来源，所以 mock 必须能模拟它（否则测试会假绿）。
          if (fireOnRestrict) fireToolsChange()
          return () => {
            activeByAgent.get(agent).splice(activeByAgent.get(agent).indexOf(entry), 1)
            for (const name of added) deny.delete(name)
            if (fireOnRestrict) fireToolsChange()
          }
        },
      },
    }
    return agent
  }

  const createAgent = (id, setup) => {
    const agent = makeAgent(id)
    living.push(agent)
    // setup 在「第一次 rebuild 之前」跑：用来模拟创建那一刻宿主就没挂载某些工具
    if (typeof setup === 'function') setup(agent)
    for (const listener of createdListeners) listener({ agent })
    return agent
  }

  const fireToolsChange = () => {
    for (const listener of toolsChangeListeners) listener()
  }

  const fireUserMessage = (agent, text) => {
    for (const listener of inboxListeners) {
      listener({ agent, message: { role: 'user', content: [{ type: 'text', text }] } })
    }
  }

  const firePreExecute = async (agent, name) => {
    for (const listener of preExecuteListeners) {
      await listener({ name, agent }, async () => ({ kind: 'allow' }))
    }
  }

  const fireEvent = (event, ...args) => {
    for (const listener of eventListeners.get(event) || []) listener(...args)
  }

  const fireGuard = (agent, name) => {
    let decision
    for (const guard of guards) {
      const result = guard({ name, agent })
      // 2026-11-05（冷读红 1）：真实宿主判据是 `reason !== undefined`；假宿主原来按真值判，
      // 于是返回 null 的「拒绝」在测试里会变成「放行」。必须与宿主同判据。
      if (result !== undefined) decision = result
    }
    return decision
  }

  // 模拟「宿主没把这个工具挂到该会话」：和「我们 restrict 掉」不是一回事 ——
  // 前者从来没进过工具表（如 cua_driver_native__* 自 DSH 2.0.20 起），后者是我们收的。
  const unmount = (agent, names) => {
    if (!unmounted.has(agent)) unmounted.set(agent, new Set())
    const miss = unmounted.get(agent)
    for (const name of names) miss.add(name)
    return () => {
      for (const name of names) miss.delete(name)
    }
  }

  return {
    ctx,
    fireGuard,
    unmount,
    commands,
    firePreExecute,
    registered,
    denyByAgent,
    activeByAgent,
    // 打开它 = mock 的 restrict 在「加上」和「解除」时都同步 fireToolsChange（rc.3 的行为）
    failRestrictFor(name) {
      failRestrictFor.add(name)
      return () => failRestrictFor.delete(name)
    },
    failRestrictSingle(name) {
      failRestrictSingle.add(name)
      return () => failRestrictSingle.delete(name)
    },
    reservePtc(name) {
      reservedPtc.add(name)
    },
    failNextRestrict(times = 1) {
      failRestrictTimes = Math.max(0, Number(times) || 0)
    },
    setSyncRestrictEvents(value) {
      fireOnRestrict = !!value
    },
    /** 当前真正挂着的限制列表（孤儿 = 比预期多出来的那条） */
    activeRestrictions(agent) {
      return activeByAgent.get(agent) || []
    },
    /** 该 agent 现在可见的工具名（= schemas(agent) 的名字） */
    visibleNames(agent) {
      const deny = denyByAgent.get(agent) || new Set()
      const miss = unmounted.get(agent) || new Set()
      const scoped = scopedByAgent.get(agent) || new Set()
      return [...registered.keys()].filter((name) => !deny.has(name) && !miss.has(name)).concat([...scoped])
    },
    createAgent,
    fireEvent,
    externalByAgent,
    scopedByAgent,
    /** 在 agent 作用域注册一个「别家插件的工具」（可见、不可 restrict） */
    addScoped(agent, name) {
      let set = scopedByAgent.get(agent)
      if (!set) {
        set = new Set()
        scopedByAgent.set(agent, set)
      }
      set.add(name)
    },
    makeAgent,
    living,
    createdListeners,
    effects,
    toolsChangeListeners,
    inboxListeners,
    fireToolsChange,
    fireUserMessage,
  }
}
