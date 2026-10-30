// host.js — 唯一知道 DeepSeek Harness 插件契约的一个文件。
//
// 为什么单独拆出来：DSH 升级时可能改的是 tools.register / tools.schemas /
// agent.ctx.tools.restrict 的签名，或者 `agent/created` 的 payload。分开之后，
// 升级只改这里（约 100 行），index.js 一行不动。改动前的旧写法见
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

// 把一条 UserMessage 的正文抽成纯文本：content 可能是字符串，也可能是块数组。
function textOfMessage(message) {
  if (!message) return ''
  const content = message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => (block && typeof block.text === 'string' ? block.text : ''))
      .filter(Boolean)
      .join(' ')
  }
  return ''
}

export function createHost(ctx) {
  const errors = []
  const counters = { agentCreated: 0, restrictCalls: 0, restrictFailures: 0, restrictSkipped: 0, toolsChanged: 0, userMessages: 0, toolCalls: 0 }
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
    const entry = { where, message: messageOf(error) }
    errors.push(entry)
    while (errors.length > MAX_ERRORS) errors.shift()
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

    /** 契约 2：ctx.tools.schemas(agent) → 该 agent 可见的工具 schema 列表 */
    toolNames(agent) {
      const tools = registry()
      if (!tools || typeof tools.schemas !== 'function') return []
      try {
        const list = tools.schemas(agent)
        if (!Array.isArray(list)) return []
        return list.map((item) => (item ? item.name : null)).filter((name) => typeof name === 'string')
      } catch (error) {
        record('tools.schemas', error)
        return []
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
      if (!tools || typeof tools.guard !== 'function') return false
      try {
        const dispose = tools.guard((exec) => {
          try {
            return handler(exec) || undefined
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
      if (!Array.isArray(names) || names.length === 0) return null
      let scoped = null
      try {
        scoped = agent && agent.ctx && agent.ctx.tools ? agent.ctx.tools : null
      } catch (error) {
        record('agent.ctx', error)
        return null
      }
      if (!scoped || typeof scoped.restrict !== 'function') {
        record('tools.restrict', new Error('agent.ctx.tools.restrict is not available'))
        return null
      }
      counters.restrictCalls += 1
      try {
        return own(scoped.restrict({ deny: names }))
      } catch (error) {
        // 「作用域已销毁」不是我们的错：子代理（比如 Mnemon 的后台检查）可能在
        // tools/change 回调跑到一半时就被销毁了。2026-10-23 实测撞到过一次：
        // 它被算进 restrictFailures，还照样打了个 hidden=102 的日志。
        // 这类竞争单独记，不计入失败。
        if (messageOf(error).includes('inactive context')) {
          // 竞争记一条证据、单独计数，**但不许参与 healthy 判定**。
          // 2026-10-30 实测：一个 subagent 销毁后留下两条这种记录，health 直接报 unhealthy ——
          // 那是替宿主的生命周期挨刀。修法不是删记录（冒烟 [13] 要求它留痕），而是 health 里豁免这一类。
          counters.restrictSkipped += 1
          record('tools.restrict (agent 已销毁)', error)
          return null
        }
        counters.restrictFailures += 1
        record('tools.restrict', error)
        return null
      }
    },

    /** 记一次真实工具调用（health 的首次成功率要用）。只计数，不参与任何决定。 */
    countToolCall() {
      counters.toolCalls += 1
    },

  /** 从账本恢复累计计数（2026-10-30）：只升不降，避免并发实例往回写小数字 */
  seedCounters(seed) {
    if (!seed || typeof seed !== 'object') return
    for (const key of ['toolCalls', 'selfHealed', 'autoOpened']) {
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
     * `agent/inbox/inserted`：一条用户消息进入 inbox（还没进模型）。
     * 用它做「关键词预开」——用户说「截图」，对应组的工具先出现，观感上像工具自己冒出来。
     * 只做被动通知，不拦消息；handler 抛错吞掉。
     */
    onUserMessage(handler) {
      if (!ctx || typeof ctx.on !== 'function') {
        record('agent/inbox/inserted', new Error('ctx.on is not available'))
        return false
      }
      try {
        ctx.on('agent/inbox/inserted', (payload) => {
          counters.userMessages += 1
          try {
            const agent = payload && payload.agent
            const text = textOfMessage(payload && payload.message)
            if (agent && text) handler(agent, text)
          } catch (error) {
            record('inbox handler', error)
          }
        })
        return true
      } catch (error) {
        record('agent/inbox/inserted', error)
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
  }
}
