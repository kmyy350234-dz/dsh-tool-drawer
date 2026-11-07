import { createState } from '../session-state.js'
import { markSeen } from '../state-ops.js'
// tools/health.js — 自检工具（lazy_tools_health，1 个）+ 它独占的基准账 benchReport。
//
// 为什么单独一个文件：health 是**唯一**一个把「宿主契约 / 组视图 / 会话快照 / 过滤器诊断」
//   全摊开给模型看的工具，它读的依赖最多（14 个）。塞回 groups.js 会把那六个日常开关工具的
//   依赖表撑大一倍，反而更难读。
//
// 为什么 benchReport 跟着它走：那个函数只被 health 的 { bench: true } 分支调用（旧 index.js
//   里除定义外只有一处引用），留在 index.js 就是「只有一个人用的 97 行」。搬过来后 index.js
//   不再需要知道它 —— 依赖没增加，只是换了住处。注意它缩进原本就不整齐（body 多两格），
//   这次**没有被顺手格式化**：搬家不是修风格的地方，改了就没法证明逐字节一致。
//
// 原文来源：_work/tools-extract.mjs 切出，逐字节保留（只有缩进变化）。

/**
 * @param {object} deps
 * @param {object}   deps.host        宿主契约（probe / probeName / toolNames / allToolNames / schemas / counters / errors / record）
 * @param {Array}    deps.groups      已编译的组
 * @param {Function} deps.groupsView  (agent) => 组视图（含 guarded / expect / blocked）
 * @param {Function} deps.stateFor    (agent) => 会话状态
 * @param {WeakMap}  deps.states      agent => 会话状态（读 foreign / managed，不建新状态）
 * @param {object}   deps.stats       计数（hideEvents / selfHealed / lastHidden）
 * @param {Set}      deps.compatNotes 已删除配置项（autoHints）的提示 id；health 里翻成 notes
 * @param {object}   deps.policy      策略（原样回给模型看）
 * @param {object}   deps.promptApi   提示段 API（describeSession = 会话快照）
 * @param {Function} deps.clientPing  客户端心跳记录
 * @param {Function} deps.strayNames  (已知, 可见) => 漏网名字
 * @param {Function} deps.usageView   () => 用量账本视图
 * @param {Function} deps.text        (对象) => JSON 文本
 * @param {Function} deps.nowIso      () => ISO 时间
 * @param {Set}      deps.CORE_TOOLS  常驻/自救工具名（bench 里不该算成「该收的」）
 */
export function createHealthTool(deps) {
  const {
    host,
    groups,
    groupsView,
    stateFor,
    states,
    stats,
    compatNotes,
    policy,
    promptApi,
    clientPing,
    strayNames,
    usageView,
    text,
    nowIso,
    CORE_TOOLS,
  } = deps

  // 基准：把「工具 schema 税」量成可复现的数字（字符数，不猜 token）。
  // 任何人都能在自己机器上跑同一条命令对比，README 里的估算因此可被检验。
  // 基准账（原 lazy_tools_bench，2026-10-30 并入 health）：量「工具 schema 税」，字符数实测。

  const benchReport = (agent) => {
      // 必须读全局注册表：被收起的工具不在 agent 的可见 schema 里，
      // 用 agent 视角会把它们漏掉，hiddenChars 永远是 0。
      const schemas = host.schemas()
      const visible = new Set(host.toolNames(agent))
      const chars = (schema) => {
        try {
          return JSON.stringify({
            name: schema.name,
            description: schema.description || '',
            parameters: schema.parameters || {},
          }).length
        } catch {
          return 0
        }
      }
      const stBench = agent ? stateFor(agent) : { hiddenNames: [] }
      const hiddenSet = new Set(stBench.hiddenNames)
      // 「全局注册」≠「本会话能用」：宿主可能压根没把某个插件挂到本会话（实测 cua_driver_native__*）。
      // 那些工具从没进过上下文，把它们算成「收起省下的」就是虚报。
      // 三态记账：visible（在表里）/ hidden（我们收的）/ absent（宿主没挂 —— 省不了，也不该算）。
      const absent = (name) => !visible.has(name) && !hiddenSet.has(name)
      const rows = []
      let totalChars = 0
      let hiddenChars = 0
      let hiddenCount = 0
      let absentTools = 0
      let absentChars = 0
      let visibleInRegistry = 0
      for (const group of groups) {
        let groupChars = 0
        let groupCount = 0
        let groupHidden = 0
        let groupHiddenChars = 0
        let groupAbsent = 0
        let groupAbsentChars = 0
        for (const schema of schemas) {
          if (!group.res.some((re) => re.test(schema.name))) continue
          // 常驻/自救工具永不入组（2026-10-30 对抗测试），bench 也不该把它们算成「该收的」。
          if (CORE_TOOLS.has(schema.name)) continue
          const size = chars(schema)
          if (absent(schema.name)) {
            groupAbsent += 1
            groupAbsentChars += size
            continue
          }
          groupChars += size
          groupCount += 1
          if (!visible.has(schema.name)) {
            groupHidden += 1
            groupHiddenChars += size
          }
        }
        if (groupCount || groupAbsent) rows.push({ group: group.id, tools: groupCount, hidden: groupHidden, chars: groupChars, hiddenChars: groupHiddenChars, absent: groupAbsent, absentChars: groupAbsentChars })
      }
      for (const schema of schemas) {
        const size = chars(schema)
        if (absent(schema.name)) {
          absentTools += 1
          absentChars += size
          continue
        }
        totalChars += size
        if (visible.has(schema.name)) visibleInRegistry += 1
        if (!visible.has(schema.name)) {
          hiddenChars += size
          hiddenCount += 1
        }
      }
      // 这张会话工具表里有、但没有登记在本注册表里的名字（排序后给）。存在的意义：
      // 「bench 说 135 可见、却只有 101 在册」这种对不上账的问题，光看数字只能猜，
      // 给出名字才能去查是谁注册的（2026-10-28 加：当时 34 个无处可查）。
      const registryNames = new Set(schemas.map((s) => s.name))
      const outsideNames = [...visible].filter((n) => !registryNames.has(n)).sort()
      return {
        tools: schemas.length,
        visible: visible.size,
        visibleInRegistry,
        visibleOutsideRegistry: visible.size - visibleInRegistry,
        outsideRegistryNames: outsideNames,
        hidden: hiddenCount,
        absent: absentTools,
        // 三态只在本注册表内互斥：visibleInRegistry + hidden + absent === tools。
        // visible 是这个会话的**整张**工具表，其中有 34 个不归本注册表管（实测 135 = 101 + 34，
        // 2026-10-28），所以 visible + hidden + absent 会大于 tools —— 要对账请用 visibleInRegistry。
        // totalChars 只算「本会话相关的」（visibleInRegistry + hidden）；absent 从没进过上下文，
        // 算进来就成了「省下了一个从来没花的钱」，所以单列在 absentChars。
        totalChars,
        visibleChars: totalChars - hiddenChars,
        hiddenChars,
        absentChars,
        // 只给字符数，不硬编 token 换算系数：不同语言/描述密度差别很大。
        // 想换算的人自己按 provider 的实际 tokenizer 除。
        groups: rows.sort((a, b) => b.hiddenChars - a.hiddenChars),
        note: '字符数是实测（name + description + parameters 的 JSON 长度）；token 请按你自己 provider 的 tokenizer 换算。absent = 注册了但宿主没挂到本会话的工具，从没进过上下文，所以不计入「省下」；它变成 0 就说明所有工具都真的到了会话里。',
      }
  }

  const healthTool = {
  name: 'lazy_tools_health',
  description: '自检：DSH 五个契约还在不在（register / schemas / restrict / guard / agent 事件）、上次 hidden 数。升级排查先跑它。可选：tool 查单个工具卡在哪一层；clear 清空错误列表（瞬时错误不再让 healthy 永久为 false）。',
  parameters: {
    type: 'object',
    properties: {
      tool: { type: 'string', description: '可选：要追查的工具名，例如 cua_driver_native__get_desktop_state' },
      bench: { type: 'boolean', description: '附带基准账（字符数实测；原 lazy_tools_bench）' },
      full: { type: 'boolean', description: '返回全量（契约详情 / 账本 usage / 漏网 stray / filters），默认精简' },
      clear: { type: 'boolean', description: '清空错误列表（errors[] 只进不出，瞬时错误会让 healthy 永久 false）' },
      layersFor: {
        type: 'string',
        description:
          '可选（只读诊断）：枚举这个 agent 作用域链上的过滤器，报每层的 allow/deny 计数与「是否把该名字排除」，不打印过滤器内容',
      },
    },
    additionalProperties: false,
  },
  output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
  execute: async (_args, exec) => {
    const agent = exec && exec.agent
    const probe = host.probe(agent)
    // 2026-11-05（冷读红 1）：结构契约不健康时**拒绝清空** —— 否则「清一下」就能把宿主缺接口洗成 healthy=true。
    // 结构契约（register / schemas / restrict / guard / agent 事件）只有重启能修，不该被当瞬时错误清掉。
    const structuralOk = probe.register === true && probe.schemas === true && probe.restrict === true && probe.guard === true && probe.agentEvent === true
    const wantClear = _args && _args.clear === true && typeof host.clearErrors === 'function'
    const cleared = wantClear && structuralOk ? host.clearErrors() : 0
    const clearRefused = wantClear && !structuralOk
    const names = host.toolNames(agent)
    const counters = host.counters()
    const errors = host.errors()
    const st = agent ? stateFor(agent) : createState()
    if (!st.seen) st.seen = new Set()
    // 每次自检都采样一次当前工具表：宿主中途把插件挂上来（或又撤走）时，
    // 只靠 rebuild 那一刻的采样会漏掉，分类就会撒谎。
    for (const name of names) st.seen.add(name)
    const known = [...new Set([...names, ...st.hiddenNames])]
    const stray = strayNames(known, names)
    const view = groupsView(agent)
    const warnings = []
    const notes = []
    for (const id of compatNotes) notes.push(`${id}: 配置里的 autoHints 已删除（0.17.0），该项被忽略`)
    const hiddenSet = new Set(st.hiddenNames)
    const seenSet = st.seen || new Set()
    const registeredAll = host.allToolNames()
    const namesOf = (id) => {
      const def = groups.find((g) => g.id === id)
      if (!def) return []
      const pool = registeredAll.length ? registeredAll : known
      return pool.filter((name) => def.res.some((re) => re.test(name)))
    }
    for (const g of view) {
      if (g.guarded) notes.push(`${g.id}: 手写组匹配了全部可隐藏工具，已忽略（不会收任何工具；请把 match 改窄或删掉这个组）`)
      if (typeof g.expect === 'number' && !g.expectOk) {
        // 只会是「少于」—— 多于 expect 是吸纳型组的正常状态，不告警（2026-10-30）。
        warnings.push(`${g.id}: matched ${g.matched} < expect ${g.expect}（少的那几个可能已改名/未加载）`)
      }
      if (!g.on || g.matched === 0 || g.visible > 0) continue
      // 组开着却一个都不可见，有三种根因，处理方式各不相同 —— 一律报警会训练人忽略警报：
      //   ① 我们收起了却没还回来（restrict 撤销失败）→ 真故障，必须响；
      //   ② 这些工具在本会话里挂载过、现在不见了，也不是我们收的 → 真异常，必须响；
      //   ③ 从来没挂载过 → 宿主没把它们给这个会话（实测 cua_driver_native__* 自 DSH 2.0.20 起如此）。
      //      这种抽屉治不了，改成「静音待命」：只进 notes，不拉低 healthy。宿主哪天真挂上来，
      //      g.visible 就大于 0，这段不再进，监控自动恢复 —— 不需要用户做任何事。
      const inGroup = namesOf(g.id)
      const ours = inGroup.filter((name) => hiddenSet.has(name))
      const vanished = inGroup.filter((name) => seenSet.has(name) && !hiddenSet.has(name))
      if (ours.length) {
        warnings.push(`${g.id}: 组是开的，但有 ${ours.length} 个被我们收起的工具没还回来 —— restrict 撤销没生效。先 lazy_tools_disable 再 enable；不行就重启`)
      } else if (vanished.length) {
        warnings.push(`${g.id}: 这 ${vanished.length} 个工具本会话里出现过、现在不见了，也不是抽屉收的 —— 查宿主为什么撤了工具表（改名 / 插件被禁 / restrict 被别的插件覆盖）`)
      } else {
        // 别猜。拿组里第一个名字做 DSH 作者给的两层 lookup（#11207），把「没挂载」拆成两种实测：
        //   global 查不到        → 真的没注册
        //   global 有、agent 有、工具表没有 → 被 schemas(agent) 这一层滤了（不是抽屉、不是 restrict）
        // 2026-10-30 实测 cua_driver_native__* 属于第二种；run_code 在这个版本里根本不存在。
        const probeName0 = inGroup[0] || ''
        const p = probeName0 ? host.probeName(probeName0, agent) : null
        // 三态，全部来自实测（不是猜）：
        //   not-registered      全局 get 都查不到 → 真没注册
        //   agent-filtered      全局有、agent 作用域没有 → 被作用域过滤器挡（限制取交集）
        //   filtered-by-schemas 两层都查得到、却不在工具表 → 被 schemas(agent) 这一层滤掉
        //   unverified          宿主没提供 get()，量不了 —— 明说量不了，不编原因
          // 2026-10-30 二修（冷读指出）：p.agent 用的是 get(name)（全局视图）⇒ 恒等于 p.global，
          // `agent-filtered` 分支永远走不到。真正的 agent 作用域视图是 p.scoped = get(name, agent)。
        const state2 = !p
          ? 'unverified'
          : p.global === false
            ? 'not-registered'
              : p.scoped === false
              ? 'agent-filtered'
                : p.scoped === true
                ? 'filtered-by-schemas'
                : 'unverified'
        g.blocked = state2
        g.blockedTools = g.matched
        if (p) g.blockedProbe = p
        const measured = p ? `（实测 ${probeName0}: global=${p.global} / scoped=${p.scoped}）` : ''
        notes.push(
          state2 === 'filtered-by-schemas'
            ? `${g.id}: 这 ${g.matched} 个工具注册了、agent 作用域也解析得到，但没进本会话工具表 ${measured} —— 被 schemas(agent) 过滤，不是抽屉收的，抽屉也解不开`
            : state2 === 'agent-filtered'
              ? `${g.id}: 这 ${g.matched} 个工具在全局有、在 agent 作用域查不到 ${measured} —— 被某个作用域过滤器挡了（限制在作用域链上取交集）`
              : state2 === 'not-registered'
                ? `${g.id}: 这 ${g.matched} 个名字在全局注册表里查不到 ${measured} —— 插件没注册成功`
                : `${g.id}: 这 ${g.matched} 个工具不在本会话工具表；宿主没提供 get()，量不出卡在哪一层 ${measured}`,
        )
      }
    }
    if (stray.length) warnings.push(`漏网 ${stray.length} 个：${stray.slice(0, 8).join(', ')}${stray.length > 8 ? ' …' : ''}`)
    const contracts = [
      { id: 'tools.register', ok: probe.register, detail: '注册工具用的入口' },
      { id: 'tools.schemas', ok: probe.schemas, detail: `可见工具 ${names.length} 个` },
      {
        id: 'agent.ctx.tools.restrict',
        ok: probe.restrict,
        detail: agent ? `已调用 ${counters.restrictCalls} 次 / 失败 ${counters.restrictFailures} 次` : '无 agent 作用域，无法判断',
      },
      {
        // 2026-11-05（冷读红 1）：guard 缺了原来只有一个 errors 信号，而 clear 能把它抹掉 ⇒ 假绿。
        // 现在它是结构契约之一，clear 也抹不掉。
        id: 'tools.guard',
        ok: probe.guard === true,
        detail: '按名自愈守卫（restrict 失败时的兜底）',
      },
      {
        id: 'agent/created',
        ok: probe.agentEvent,
        detail: `监听已挂上；本进程已触发 ${counters.agentCreated} 次`,
      },
    ]
    // 客户端心跳：宿主正常 ≠ 浏览器那边挂上了。没上报过就明说没上报，不要假装绿。
    const ping = clientPing()
    const client = ping
      ? {
          seen: true,
          at: ping.at,
          agoSeconds: Math.max(0, Math.round((Date.now() - Date.parse(ping.at)) / 1000)),
          panels: ping.panels,
        }
      : { seen: false, hint: '客户端还没上报过（面板可能没挂上：重启后仍为 false 就查 browser 控制台）' }

    // 可选诊断：查一个名字到底卡在哪一层。
    // 2026-10-30 按 DSH 作者的第二封邮件更正：`get(name)` 省略第二参数 = **全局视图**，
    // 要量「这个 agent 的作用域」必须 `get(name, agent)`（与 schemas(agent) 同一个视图）。
    // 另附 agent preset 的两个事实：defaultId（新会话默认）与 composedPreset(agent.ctx)（本 agent 实际挂的）。
    let nameProbe = null
    const wanted = _args && typeof _args.tool === 'string' ? _args.tool : ''
    if (wanted) {
      nameProbe = host.probeName(wanted, agent)
      nameProbe.inAgentTable = names.includes(wanted)
      nameProbe.runCodeInTable = names.includes('run_code')
      const presets = (() => {
        try {
          return agent && agent.ctx && typeof agent.ctx.get === 'function' ? agent.ctx.get('agentPresets') : null
        } catch (error) {
          return null
        }
      })()
      nameProbe.defaultPreset = presets && presets.defaultId !== undefined ? presets.defaultId : null
      nameProbe.composedPreset =
        presets && typeof presets.composedPreset === 'function' ? presets.composedPreset(agent.ctx) ?? null : null
      nameProbe.hint =
        nameProbe.global === false
          ? '全局注册表里就没有这个名字 —— 不是作用域过滤的问题'
          : nameProbe.scoped === false
            ? '全局有、**作用域视图**没有（get(name, agent)=false）⇒ 作用域链上有个过滤器挡它（可能是别人加的，空 deny 抵消不了另一个过滤）'
            : nameProbe.scoped === true && nameProbe.inAgentTable === false
              ? '作用域视图有、schemas(agent) 里没有 ⇒ 作者说这说明要对着已装构建进一步查（两者本该一致）'
              : '全局有、作用域有、也在 schemas(agent) 里 —— 注册层面没问题，往「出站工具表 / 呈现模式」方向查'
    }

    // 可选（只读）：按 DSH 作者给的 rc.3 内部诊断，枚举这个 agent 作用域链上的过滤器。
    // 只报「每层 allow/deny 计数 + 是否排除这个名字」，不打印过滤器内容
    // （他说 compiled filters 是匿名项、不留 owner 名，所以能给的只有计数）。
    // 构建没暴露 .tools.layers 就明说没有 —— 不能当成「没有过滤器」。
    let filterReport = null
    const layersFor = _args && typeof _args.layersFor === 'string' ? _args.layersFor : ''
    if (layersFor) {
      try {
        const store = agent && agent.ctx && agent.ctx.tools ? agent.ctx.tools.layers : null
        if (!store || typeof store.chainLayers !== 'function') {
          filterReport = { supported: false, note: '这个构建没有暴露 rc.3 的 registry 结构（.tools.layers / chainLayers）' }
        } else {
          const layers = store.chainLayers(agent)
          // layersFor 支持逗号分隔的多个名字：一次问清「这条过滤到底排除了多少个样本」，
          // 比一次只验一个名字强得多（2026-10-30：为了把「采样 4 个」升级成「全部 56 个都验」）。
          const wantedNames = layersFor.split(',').map((s) => s.trim()).filter(Boolean)
          const filters = []
          layers.forEach((layer, layerIndex) => {
            const map = layer && layer.restrictions
            if (!map || typeof map.values !== 'function') return
            Array.from(map.values()).forEach((filter, filterIndex) => {
              const excludes = wantedNames.filter(
                (n) =>
                  !!filter &&
                  ((filter.allow !== undefined && !filter.allow.has(n)) ||
                    (filter.deny !== undefined && filter.deny.has(n))),
              )
              // 只读诊断（2026-11-01）：把 deny 集合的“样本 + 是否全是 cua 前缀”一起报出来。
              // 用途：区分“这一层是不是桌面电脑使用门”（它按全部 cua 名建 deny）。
              const denyNames = filter && filter.deny ? Array.from(filter.deny) : null
              filters.push({
                layerIndex,
                filterIndex,
                allowCount: filter && filter.allow ? filter.allow.size : null,
                denyCount: filter && filter.deny ? filter.deny.size : null,
                ...(denyNames ? { denySample: denyNames.slice(0, 4), denyAllCua: denyNames.every((n) => String(n).startsWith('cua_driver_native__')) } : {}),
                excludesName: excludes.includes(wantedNames[0]),
                checked: wantedNames.length,
                excludedCount: excludes.length,
                excludedAll: wantedNames.length > 0 && excludes.length === wantedNames.length,
              })
            })
          })
          filterReport = { supported: true, layerCount: layers.length, filters }
        }
      } catch (error) {
        filterReport = { supported: false, error: String((error && error.message) || error) }
      }
    }

    const report = {
      ok: contracts.every((c) => c.ok),
      // 2026-11-04（复读）：原来这里豁免 'agent 已销毁'，但 0.18 起销毁竞态只计 restrictSkipped、
      // **不再 record**，那个 where 已无生产者 ⇒ 豁免是死代码，删掉（少一个会误导人的分支）。
      healthy: contracts.every((c) => c.ok) && errors.length === 0 && warnings.length === 0,
      checkedAt: nowIso(),
      contracts,
      client,
      groups: view,
      policy,
      nameProbe,
      filterReport,
      warnings,
      notes,
      stray,
      usage: usageView(),
      // 外部 deny 交叉探测（0.18 隔离约束②）：放行后仍不可见的名字（最多 8 个样本）。
      foreignDenied: (() => {
        const st = agent ? states.get(agent) : null
        return st && st.foreign ? st.foreign : null
      })(),
      // 受管角色（默认关闭时是 null）：health 里要能一眼看出“这个会话按什么策略走”。
      managed: (() => {
        const st = agent ? states.get(agent) : null
        return st && st.managed
          ? {
              role: st.managed.key,
              allowGroups: st.managed.role.allowGroups,
              unknown: st.managed.role.unknown,
              // 2026-11-03：这个角色是从哪认来的 —— label / subagent / preset。
              // 编排器生态里同一件事有多种写法（`[role:xxx]` 已在 0.18.2 删除），出问题时先看这一格就知道该怪谁。
              source: st.managed.source ?? null,
              // 2026-11-03：AI 自动配的角色要能自证（谁配的、什么时候、依据）。
              createdBy: st.managed.role.createdBy ?? null,
              basis: st.managed.role.basis ?? null,
              // 2026-11-03（冷读甲/乙必修）：受管角色会把**未归组**工具也藏起来，
              // 而编排器的协议工具（need_help / report_submit…）正是未归组的 ——
              // 不在这里点名，就会「接了之后星型拓扑断掉，但哪儿都看不出来」。
              hiddenUngrouped: (() => {
                try {
                  // 2026-11-03 复读纠正：**不能用 `allToolNames()`（= schemas() 无参 = 只有全局层）**。
                  // preset 层自产的工具（MyGO 的 need_help/report_submit…）根本不在那张表里，
                  // 于是这里恒空 —— 假绿灯。正确的底集就是**本会话实际被藏的名字**（st.hiddenNames），
                  // 再逐名判「有没有被任何组匹配」，完全不依赖全局表。
                  const hidden = Array.isArray(st.hiddenNames) ? st.hiddenNames : []
                  if (!hidden.length) return []
                  const isGrouped = (name) => groups.some((g) => (g.res || []).some((re) => re.test(name)))
                  return hidden.filter((name) => !isGrouped(name)).sort().slice(0, 10)
                } catch {
                  return []
                }
              })(),
            }
          : null
      })(),
      // 会话快照（2026-11-03）：角色 + 本会话列了哪些组 + 可见/隐藏数 + 被外部挡掉的组。
      // 编排器（或人）靠这一行判断“这个会话的工具面对不对”，不用翻日志。
      session: (() => {
        try {
          const snap = promptApi.describeSession(agent)
          // 角色没配的提示挂在会话快照上（盲测：越权但零报错是最该修的失败模式）
          const hint = (() => {
            try {
              return stateFor(agent).roleHint || null
            } catch {
              return null
            }
          })()
          return hint ? { ...snap, roleHint: hint } : snap
        } catch (error) {
          host.record('session snapshot', error)
          return null
        }
      })(),
      // 2026-11-06：组内「想藏但藏不掉」的工具（scope 同名遮蔽 / reserved PTC）。
      unhideable: (() => {
        try {
          const state = stateFor(agent)
          return Array.isArray(state && state.unhideable) ? state.unhideable.slice(0, 8) : []
        } catch {
          return []
        }
      })(),
      ...(_args && _args.bench ? { bench: benchReport(agent) } : {}),
      stats: {
        agentCreated: counters.agentCreated,
        toolsChanged: counters.toolsChanged,
        restrictCalls: counters.restrictCalls,
      restrictSkipped: counters.restrictSkipped,
      toolCalls: counters.toolCalls,
      // 首次成功率 = 1 - 自愈次数 / **组内调用数**（自愈 = 模型第一次叫错了名字，同一轮补开并放行）。
      // 分母只数属于某个组的调用：核心工具永不入组、也不可能自愈，混进来会把数稀释成假象。
      // **它测不到**：模型压根没开口的那类静默失能（用户要能力、模型判断自己不会 → 零调用、
      // 零自愈，这个数仍是 1.0）。所以它是必要不充分条件，别拿它当「无感化成立」的证据。
      // 2026-10-30 修正：原式 (autoOpened + selfHealed)/toolCalls **语义反了** ——
      //   selfHealed 是坏事、autoOpened 是好事，相加等于「预开做得越好，成功率越难看」；
      //   而且 20 次自愈 / 100 次调用会被读成「20% 成功」，实际是 80%。
      // 2026-10-31（0.17.0）：autoOpened 随关键词预开一起删除，这里只剩 selfHealed 一项。
      firstTryRate:
        counters.toolCalls < 20
          ? null
          : Math.max(0, Math.round((1 - stats.selfHealed / counters.toolCalls) * 1000) / 1000),
        restrictFailures: counters.restrictFailures,
        hideEvents: stats.hideEvents,
        rebuilds: stats.rebuilds,
        selfHealed: stats.selfHealed,
        lastHidden: stats.lastHidden,
      },
      errors,
    }

    // 2026-10-30 精简默认视图：全量 4072 字节对「看一眼」太重（用户要求的减法 C 项）。
    // 三个常见排障问题仍能答：为什么没藏（mode/matched）、为什么藏了没放（visible/warnings）、
    // 被谁挡（给 layersFor 才带 filterReport）。要全量就加 { full: true }。
    if (!(_args && _args.full === true)) {
      const probeWanted = _args && typeof _args.tool === 'string'
      const layersWanted = _args && typeof _args.layersFor === 'string'
      // 默认视图 = report 减显式 omit，不再手抄字段；新增 report 字段自动可见。
      const DEFAULT_OMIT = new Set(['usage', 'nameProbe', 'filterReport', 'bench'])
      const defaultView = Object.fromEntries(Object.entries(report).filter(([key]) => !DEFAULT_OMIT.has(key)))
      defaultView.contracts = report.contracts.map((c) => ({ id: c.id, ok: c.ok }))
      defaultView.groups = report.groups.map((g) => ({
        id: g.id,
        title: g.title,
        on: g.on,
        mode: g.mode,
        matched: g.matched,
        visible: g.visible,
        onlyCount: g.onlyCount,
        ...(g.blocked ? { blocked: g.blocked } : {}),
        ...(typeof g.blockedTools === 'number' ? { blockedTools: g.blockedTools } : {}),
        ...(g.blockedProbe ? { blockedProbe: g.blockedProbe } : {}),
        ...(typeof g.expect === 'number' ? { expect: g.expect, expectOk: g.expectOk } : {}),
      }))
      if (cleared) defaultView.clearedErrors = cleared
      if (clearRefused) {
        defaultView.clearedErrors = 0
        defaultView.clearRefused = '结构契约不健康（register/schemas/restrict/guard/agent 事件），拒绝清空错误'
      }
      if (probeWanted && report.nameProbe) defaultView.nameProbe = report.nameProbe
      if (layersWanted && report.filterReport) defaultView.filterReport = report.filterReport
      if (_args && _args.bench) defaultView.bench = report.bench
      defaultView.note = '精简视图。要契约详情 / 账本 usage / 探针 nameProbe / 过滤器 filterReport 全量：加 { full: true }'
      return defaultView
    }
    return report
  },
}

  return healthTool
}
