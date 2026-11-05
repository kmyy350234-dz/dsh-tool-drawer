// host.js — 唯一知道 DeepSeek Harness 插件契约的一个文件。
//
// 为什么单独拆出来：DSH 升级时可能改的是 tools.register / tools.schemas /
// agent.ctx.tools.restrict 的签名，或者 `agent/created` 的 payload。分开之后，
// 升级只改这里，index.js 一行不动。改动前的旧写法见
// perf-\lazy-tools-接线说明-20261022.md。
//
// 编辑这个文件的规矩：
//   1. 任何函数都不许把异常抛给调用方 —— 全部包起来，失败记进 errors，由
//      lazy_tools_health 报出来。启动名册是 all-or-nothing，这里抛一次 DSH 就起不来。
//   2. 不 import 任何东西（连 fs 都不用）：模块本身要能在最裸的环境里加载。
//   3. 返回值必须 JSON-safe：没有 undefined、没有函数、没有 NaN。
//      （曾经因为输出里一个 undefined，宿主按「lossless JSON」把整个工具调用拒收。）
//   4. 版本号这类「拿不到就不知道」的东西，返回 null，不要猜一个填进去。

const LABEL = '[lazy-tools]'
const MAX_ERRORS = 8

function messageOf(error) {
  if (error && typeof error === 'object' && typeof error.message === 'string') return error.message
  return String(error)
}


export function createHost(ctx) {
  // 每个 agent 已知不可限制的工具名（2026-11-04）：第二次起不再重复踩
  const nonRestrictableByAgent = new WeakMap()
  const errors = []
  // 2026-11-03（复读指出）：同一条错误在每次 rebuild 都会重记一次，8 个槽会被同一句占满，
  // health 的 healthy 就**永久 false**（等于把红灯变成背景噪声）。同 where+message 只留第一次。
  const seenErrors = new Set()
  const counters = { agentCreated: 0, restrictCalls: 0, restrictFailures: 0, restrictSkipped: 0, toolsChanged: 0, toolCalls: 0 }
  const state = { listenerAttached: false }

  const log = (level, message) => {
    try {
      const logger = ctx && ctx.logger
      const sink = logger && typeof logger[level] === 'function' ? logger[level] : null
      if (sink) sink.call(logger, `${LABEL} ${message}`)
      else if (level !== 'info') console.error(`${LABEL} ${message}`)
    } catch {
      // 记日志本身失败绝不能影响调用方
    }
  }

  const record = (where, error) => {
    // 2026-11-05（冷读附注）：V8 的 SyntaxError 会把**整段模式**塞进 message ——
    // 一个 10 万字符的坏 pattern 能让 health 输出约 100 KB。记账保留前 400 字符即可。
    const raw = messageOf(error)
    const entry = { where, message: raw.length > 400 ? raw.slice(0, 400) + '…（已截断）' : raw }
    // 2026-11-03（复读指出）：同一条错误每次 rebuild 都会重记一次，8 个槽被同一句占满，
    // health 的 healthy 就**永久 false**（红灯变成背景噪声）。同 where + 同 message 只留第一次。
    const key = `${where}\u0000${entry.message}`
    if (!seenErrors.has(key)) {
      seenErrors.add(key)
      errors.push(entry)
      // 2026-11-05（元宝挑刺 3）：shift() 掉的条目原来不删 seenErrors 的 key ——
      // 第 9 种错误挤掉第 1 种后，第 1 种复发再也不会进 errors，healthy 直接假绿。
      while (errors.length > MAX_ERRORS) {
        const dropped = errors.shift()
        if (dropped) seenErrors.delete(`${dropped.where}\u0000${dropped.message}`)
      }
    }
    // 日志照打：重复次数本身是证据（但不该把健康面拖红）
    log('warn', `${where}: ${entry.message}`)
  }

  // Contract: ctx.tools（注入 'tools' 之后必然存在；仍然按可选处理）
  const registry = () => {
    try {
      return ctx && ctx.tools ? ctx.tools : null
    } catch (error) {
      record('ctx.tools', error)
      return null
    }
  }

  // 把「解除函数」挂到插件生命周期上（ctx.effect）：插件被卸载/热重载时自动解除，
  // 否则旧实例留下的限制会变成孤儿 —— 新实例看不见也解不开，enable 会假成功。
  // 幂等包装：手动解除（enable/disable）之后 effect 再调一次是空操作。
  const own = (dispose) => {
    if (typeof dispose !== 'function') return dispose
    let done = false
    const once = () => {
      if (done) return
      done = true
      try {
        dispose()
      } catch (error) {
        record('lift', error)
      }
    }
    try {
      if (ctx && typeof ctx.effect === 'function') ctx.effect(() => once, 'lazy-tools: tool restriction')
    } catch (error) {
      record('effect', error)
    }
    return once
  }

  return {
    log,
    record,
    /** 把一段清理逻辑挂到插件生命周期上（api.js 的 HTTP 路由用它注销） */
    own,

    /** 契约 1：ctx.tools.register(definition) → 注销函数 */
    registerTool(definition) {
      const tools = registry()
      if (!tools || typeof tools.register !== 'function') {
        record('tools.register', new Error('ctx.tools.register is not available'))
        return null
      }
      try {
        return tools.register(definition)
      } catch (error) {
        record('tools.register', error)
        return null
      }
    },

    /**
     * 本 agent 能被 restrict 的名字（宿主只允许**全局工具**被 mask）。
     * 读不到返回 null —— 调用方别把「读不到」当成「空集」（否则一个都不藏）。
     */
    restrictableNames(agent) {
      try {
        const tools = registry()
        if (!tools || typeof tools.view !== 'function') return null
        const view = tools.view(agent)
        const names = view && view.restrictableNames
        if (names instanceof Set) return names
        if (Array.isArray(names)) return new Set(names)
      } catch (error) {
        record('tools.restrictable', error)
      }
      return null
    },
    /** 契约 2：ctx.tools.schemas(agent) → 该 agent 可见的工具 schema 列表 */
    toolNames(agent) {
      const tools = registry()
      if (!tools) return []
      // 2026-11-06：名字优先走 view(agent).visible；空视图 / 抛错时退回
      // schemas(agent) 复核 —— 与 visibleNames() 的失败方向同一不变量。
      // 注意：宿主里 schemas(agent) 本来就是 view(agent).visible 的投影，
      // 两者同源；这里不是"修风暴"（上一轮 6,242 次未复现，根因待查）。
      try {
        if (typeof tools.view === 'function') {
          const view = tools.view(agent)
          const visible = view && view.visible
          let names = null
          if (visible && typeof visible.keys === 'function') names = [...visible.keys()]
          else if (visible && typeof visible.entries === 'function') {
            names = [...visible.entries()].map((entry) => entry[0])
          }
          if (Array.isArray(names) && names.length > 0) {
            return names.filter((name) => typeof name === 'string')
          }
        }
      } catch (error) {
        record('tools.view', error)
      }
      if (typeof tools.schemas !== 'function') return []
      try {
        const list = tools.schemas(agent)
        if (!Array.isArray(list)) return []
        return list.map((item) => (item ? item.name : null)).filter((name) => typeof name === 'string')
      } catch (error) {
        record('tools.schemas', error)
        return []
      }
    },

    /**
     * 只要名字的可见工具表（2026-11-01 新加，给常驻提示段用）。
     *
     * 为什么不复用 toolNames()：它走 schemas(scope)，而宿主每调一次就把**全部可见 schema
     * 深拷贝一遍**（DSH 作者在 surface.js 里给的实测：258 个工具 34.2 ms）。提示段每轮组装
     * 都要读这个名字集合，只读名字却付整份 schema 的拷贝钱，是白花的。
     * `tools.view(scope).visible` 是宿主自带的同源视图（dsh-ops 的 surface.js 也读它），
     * 读得到就近乎免费；**空了或读不到才退回 schemas** —— 正确性优先于成本。
     *
     * 返回两态，调用方别把「读不到」当成「没有」：
     *   - 名字数组（空数组 = 这个作用域确实一个可见工具都没有，已用 schemas 复核过）
     *   - null      = 名字读不出来（视图空/抛错，且 schemas 也读不出来），调用方应退回旧行为
     *
     * 为什么要拿 schemas 复核「空视图」（2026-11-01 冷读抓到的红线）：空 Map 可能只是视图没建好，
     * 直接信它会把**所有开着的组从提示里删掉** —— 那正是「失败方向变短」，不能接受。
     * 复核只在空的时候发生，正常路径一次都不多花。
     *
     * @param scope agent；省略 = 全局层，与 schemas() 同义
     */
    visibleNames(scope) {
      const tools = registry()
      if (!tools) return null
      let fromView = null
      try {
        if (typeof tools.view === 'function') {
          const view = tools.view(scope)
          const visible = view && view.visible
          if (visible && typeof visible.keys === 'function') fromView = [...visible.keys()]
          else if (visible && typeof visible.entries === 'function') {
            fromView = [...visible.entries()].map((entry) => entry[0])
          }
        }
      } catch (error) {
        // 视图读不到不是错：退回 schemas 就是，但记一条（同一个构建反复失败时能看见）
        record('tools.view', error)
      }
      // 视图给了名字就直接用（便宜路径）
      if (Array.isArray(fromView) && fromView.length > 0) return fromView
      if (typeof tools.schemas !== 'function') return Array.isArray(fromView) ? fromView : null
      try {
        const list = tools.schemas(scope)
        if (!Array.isArray(list)) return null
        return list.map((item) => (item ? item.name : null)).filter((name) => typeof name === 'string')
      } catch (error) {
        record('tools.schemas', error)
        // 空视图 + schemas 也读不出来 ⇒ 这条信号不可信，交回调用方（它该退回旧行为）
        return null
      }
    },

    // 契约 2 的补充（2026-10-30，按 DSH 作者在 Discussion #11207 给的两行 lookup）：
  // 「注册了」和「这个 agent 能看到」是两件事，而且**限制会在作用域链上取交集** ——
  // 某个过滤器里的空 deny 抵消不了另一个过滤器。所以要知道一个名字到底卡在哪一层：
  //   global.tools.get(name) 有、agent.ctx.tools.get(name) 没有 ⇒ 被 agent 作用域的过滤器挡了
  //   两个都有、但出站请求只广告 run_code ⇒ 是「呈现模式（PTC）」的问题，不是注册问题
  probeName(name, agent) {
    const out = { name, global: null, agent: null, error: null }
    const call = (tools, key) => {
      if (!tools || typeof tools.get !== 'function') { out[key] = 'no-get'; return }
      try {
        out[key] = tools.get(name) !== undefined
      } catch (error) {
        out[key] = 'err'
        if (!out.error) out.error = String((error && error.message) || error)
      }
    }
    call(registry(), 'global')
    let agentTools = null
    try {
      agentTools = agent && agent.ctx ? agent.ctx.tools : null
    } catch (error) {
      agentTools = null
    }
    call(agentTools, 'agent')
    // 2026-10-30 更正（DSH 作者指出）：get(name) 省略第二个参数时用的是**全局视图**，
    // 即使通过 agent.ctx.tools 调用。所以要量「这个 agent 的作用域」，必须传 agent：
    //   scoped = get(name, agent) —— rc.3 里它和 schemas(agent) 读同一个作用域视图。
    const callScoped = (key, wanted) => {
      if (!agentTools || typeof agentTools.get !== 'function') { out[key] = 'no-get'; return }
      try {
        out[key] = agentTools.get(wanted, agent) !== undefined
      } catch (error) {
        out[key] = 'err'
        if (!out.error) out.error = String((error && error.message) || error)
      }
    }
    callScoped('scoped', name)
    callScoped('scopedRunCode', 'run_code')
    return out
  },

  /** 同上，但要整份 schema（名字 + 描述 + 参数），分类工具需要描述来理解用途 */
    schemas(agent) {
      const tools = registry()
      if (!tools || typeof tools.schemas !== 'function') return []
      try {
        const list = tools.schemas(agent)
        if (!Array.isArray(list)) return []
        return list.filter((item) => item && typeof item.name === 'string')
      } catch (error) {
        record('tools.schemas', error)
        return []
      }
    },

    /**
     * 自愈用的守卫：`tools.guard(fn)` 在 dispatch 前跑，能拦下一个调用。
     * handler 返回**字符串**表示拒绝（宿主契约：ToolGuard = (exec) => string | undefined），返回 undefined 放行。
     * 失败一律放行 —— 这条路上出错绝不能把正常调用拦死。
     */
    onDispatchGuard(handler) {
      const tools = registry()
      if (!tools || typeof tools.guard !== 'function') {
        // 2026-11-05（外部审阅）：宿主没有 guard 时，自愈守卫会**静默消失**而 health 全绿。
        // 失败必须响 —— 记一条，health 会把它变成红灯（同条只记一次）。
        record('tools.guard', new Error('宿主没有 tools.guard：按名自愈守卫不可用，被上游藏掉的工具不会被自动放回'))
        return false
      }
      try {
        const dispose = tools.guard((exec) => {
          try {
            // 2026-11-05（冷读）：不再用 `|| undefined` 把 null 悄悄转成放行 ——
            // 宿主判据是 reason !== undefined，null 会被当成拒绝。守卫区已显式返回 undefined。
            return handler(exec)
          } catch (error) {
            record('guard handler', error)
            return undefined
          }
        })
        own(dispose)
        return true
      } catch (error) {
        record('tools.guard', error)
        return false
      }
    },

    /**
     * 全局工具表（不传 scope）：不受任何 agent 的 restrict 影响。
     * 组归属、`expect` 计数、隐藏清单都必须用它算 —— 用「当前可见」算会把
     * 已经被藏起来的工具漏掉，`matched` 就会越用越小（2026-10-24 实测踩到）。
     */
    allToolNames() {
      const tools = registry()
      if (!tools || typeof tools.schemas !== 'function') return []
      try {
        const list = tools.schemas()
        if (!Array.isArray(list)) return []
        return list.map((item) => (item ? item.name : null)).filter((name) => typeof name === 'string')
      } catch (error) {
        record('tools.schemas(global)', error)
        return []
      }
    },

    /** 契约 3：agent.ctx.tools.restrict({ deny }) → 解除函数；只能藏全局工具 */
    hideTools(agent, names) {
      if (!agent || !Array.isArray(names) || names.length === 0) return null
      let scoped = null
      try {
        scoped = agent.ctx && agent.ctx.tools ? agent.ctx.tools : null
      } catch (error) {
        record('agent.ctx', error)
        return null
      }
      if (!scoped || typeof scoped.restrict !== 'function') {
        record('tools.restrict', new Error('agent.ctx.tools.restrict is not available'))
        return null
      }
      // 「作用域已销毁」/「名字不可限制」/「系统性错误」三类分开。
      // 2026-11-04（复读）：必须按宿主真实文案锚定 —— 已装宿主是 `tools.restrict() names unknown global tool "x"`；
      // 不锚定会把「系统性错误里恰好含 unknown tool」误判成名单问题（正是这次要防的误诊）。
      const classifyRestrictError = (error) => {
        const text = messageOf(error)
        if (text.includes('inactive context')) return 'inactive'
        // 2026-11-04（复读二轮）：**必须容忍复数** —— 真宿主在 2+ 未知名时发
        // `tools.restrict() names unknown global toolS "a", "b"`（复数 + 列表）。
        // 只锚单数会让「两个坏名字」整批判 systemic、不再逐个重试 ⇒ 整批 fail-open（这是回归）。
        if (/(?:^|[\s.])names unknown global tools?\b|\bnot restrictable\b|cannot name reserved PTC/i.test(text)) return 'badname'
        return 'systemic'
      }
      const isBadName = (error) => classifyRestrictError(error) === 'badname'

      // 已知不可限制的名字按 agent 缓存：第二次起不再重复踩，省 N 次失败调用。
      // 2026-11-05（外部审阅）：缓存原来只增不减 —— 冷启动早期被判「不可限制」的名字，
      // 等插件晚注册上来后仍被永久跳过（静默漏网）。现在：tools/change 一轮就失效，最长 60s。
      const cached = nonRestrictableByAgent.get(agent)
      const fresh = cached && cached.epoch === counters.toolsChanged && Date.now() - cached.at < 60000
      const skip = fresh ? cached.names : new Set()
      const wanted = names.filter((name) => !skip.has(name))
      if (!wanted.length) return null

      counters.restrictCalls += 1
      try {
        return own(scoped.restrict({ deny: wanted }))
      } catch (error) {
        if (classifyRestrictError(error) === 'inactive') {
          counters.restrictSkipped += 1
          return null
        }
        // 系统性错误：不逐个重试（否则 N 倍开销 + 把故障误诊成名单问题）
        if (!isBadName(error)) {
          counters.restrictFailures += 1
          record('tools.restrict', new Error('限制失败（非名单问题，已中止逐个重试）：' + messageOf(error)))
          return null
        }
        // 名字问题：逐个重试，坏名字跳过、其余照藏
        const liftsLocal = []
        const rejected = []
        let systemic = null
        for (const one of wanted) {
          counters.restrictCalls += 1
          try {
            liftsLocal.push(own(scoped.restrict({ deny: [one] })))
          } catch (single) {
            const kind = classifyRestrictError(single)
            if (kind === 'inactive') {
              counters.restrictSkipped += 1
              continue
            }
            if (kind === 'systemic') {
              systemic = single
              break
            }
            rejected.push(one)
          }
        }
        if (systemic) {
          counters.restrictFailures += 1
          record('tools.restrict', new Error('限制失败（非名单问题，已中止）：' + messageOf(systemic)))
        }
        if (rejected.length) {
          counters.restrictFailures += 1
          // 2026-11-05（冷读黄 1）：原来是 new Set() 覆盖 —— 每次出现新坏名都会把旧坏名忘掉，
          // 下次又重踩一次、失败计数虚高。同一 epoch 内取并集；epoch 变了（tools/change）自然清空重来。
          const previous = nonRestrictableByAgent.get(agent)
          const cache = new Set(previous && previous.epoch === counters.toolsChanged ? previous.names : [])
          for (const name of rejected) cache.add(name)
          nonRestrictableByAgent.set(agent, { names: cache, epoch: counters.toolsChanged, at: Date.now() })
          record('tools.restrict', new Error('这些名字不可限制（已逐个跳过，其余照常隐藏）：' + rejected.join(', ')))
        }
        if (!liftsLocal.length) return null
        // 复合解除句柄：逐条 lift。
        // 注意（2026-11-04 复读）：**这里不需要再记失败** —— 每条 lift 都经过 own()，它已经 record 了；
        // 上一版在这里加的「解除限制失败」是死路径（once 永不抛），已删。
        return () => {
          for (const liftOne of liftsLocal) {
            try {
              if (typeof liftOne === 'function') liftOne()
            } catch {
              /* own() 已记 */
            }
          }
        }
      }
    },

    /** 记一次真实工具调用（health 的首次成功率要用）。只计数，不参与任何决定。 */
    countToolCall() {
      counters.toolCalls += 1
    },

  /** 从账本恢复累计计数（2026-10-30）：只升不降，避免并发实例往回写小数字 */
  seedCounters(seed) {
    if (!seed || typeof seed !== 'object') return
    for (const key of ['toolCalls', 'selfHealed']) {
      const value = seed[key]
      if (Number.isFinite(value) && value > counters[key]) counters[key] = Math.round(value)
    }
  },

    /** 契约 4：`agent/created` 每个 agent 触发一次；handler 抛错不许影响创建 */
    onAgentCreated(handler) {
      if (!ctx || typeof ctx.on !== 'function') {
        record('agent/created', new Error("ctx.on is not available"))
        return false
      }
      try {
        ctx.on('agent/created', (payload) => {
          counters.agentCreated += 1
          try {
            handler(payload && payload.agent)
          } catch (error) {
            record('agent handler', error)
          }
        })
        state.listenerAttached = true
        return true
      } catch (error) {
        record('agent/created', error)
        return false
      }
    },

    /**
     * `tools/change`：工具注册表变化（新插件、注册/注销）。用来兜「插件比工具先加载」的时序，
     * 也兜「上游升级后新增了工具却没被组匹配」。handler 抛错吞掉，不许影响注册方。
     */
    onToolsChange(handler) {
      if (!ctx || typeof ctx.on !== 'function') {
        record('tools/change', new Error('ctx.on is not available'))
        return false
      }
      try {
        ctx.on('tools/change', () => {
          counters.toolsChanged += 1
          try {
            handler()
          } catch (error) {
            record('tools/change handler', error)
          }
        })
        return true
      } catch (error) {
        record('tools/change', error)
        return false
      }
    },


    /**
     * `tools/pre-execute`（waterfall）：每次工具调用**之前**的通知，用来记「谁真的被用过」。
     * 只旁听，不改决定：永远放行 `next()`。调用方抛错也吞掉，绝不影响正常调用。
     */
    onPreExecute(handler) {
      if (!ctx || typeof ctx.on !== 'function') return false
      try {
        ctx.on('tools/pre-execute', (exec, next) => {
          try {
            handler(exec)
          } catch (error) {
            record('pre-execute handler', error)
          }
          return next()
        })
        return true
      } catch (error) {
        record('tools/pre-execute', error)
        return false
      }
    },

    /** 自检用：只探测「有没有」，不真的去 restrict（有副作用） */
    probe(agent) {
      const tools = registry()
      let scoped = null
      try {
        scoped = agent && agent.ctx && agent.ctx.tools ? agent.ctx.tools : null
      } catch {
        scoped = null
      }
      return {
        register: !!(tools && typeof tools.register === 'function'),
        schemas: !!(tools && typeof tools.schemas === 'function'),
        restrict: !!(scoped && typeof scoped.restrict === 'function'),
        guard: !!(tools && typeof tools.guard === 'function'),
        agentEvent: state.listenerAttached,
      }
    },

    /** 现存活 agent 列表（插件热重载后补应用限制用）；拿不到就给空数组 */
    agentList() {
      try {
        if (!ctx || typeof ctx.get !== 'function') return []
        const agents = ctx.get('agents')
        if (!agents || typeof agents.list !== 'function') return []
        const list = agents.list()
        return Array.isArray(list) ? list : []
      } catch (error) {
        record('agents.list', error)
        return []
      }
    },

    // 这里原本有个 version()：试 ctx.get('appInfo'/'desktopInfo'/'app') 和
    // process.env.DSH_VERSION。2026-10-23 用 cordis_inspect 把 Host Service 目录
    // 翻了一遍 —— 没有任何版本服务，环境变量也没有，所以它永远返回 null。
    // 「永远 null 的字段比没有更糟，会让人以为探测失败」，直接删掉，health 不再报版本。

    counters() {
      return { ...counters }
    },

    errors() {
      return errors.map((entry) => ({ where: entry.where, message: entry.message }))
    },
    /**
     * 清空错误（2026-11-05）。为什么需要：errors 只进不出，一条瞬时错误（读配置失败、
     * 一个坏名字）会把 healthy 永久钉成 false，直到重启 —— 红灯变成背景噪声。
     * 只清 errors，不清自愈计数（计数是历史证据）。
     */
    clearErrors() {
      const n = errors.length
      errors.length = 0
      seenErrors.clear()
      return n
    },
  }
}

