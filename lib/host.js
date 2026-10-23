// host.js — 唯一知道 DeepSeek Harness 插件契约的一个文件。
//
// 为什么单独拆出来：DSH 升级时可能改的是 tools.register / tools.schemas /
// agent.ctx.tools.restrict 的签名，或者 `agent/created` 的 payload。分开之后，
// 升级只改这里（约 100 行），index.js 一行不动。设计取舍见 DESIGN.md。
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
  const errors = []
  const counters = { agentCreated: 0, restrictCalls: 0, restrictFailures: 0, toolsChanged: 0 }
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
          record('tools.restrict (agent 已销毁)', error)
          return null
        }
        counters.restrictFailures += 1
        record('tools.restrict', error)
        return null
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
