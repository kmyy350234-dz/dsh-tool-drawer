// tools/groups.js — 抽屉的六个开关工具：status / enable / disable / mode / save_groups / list。
//
// 为什么拆出来（2026-11-03，第 2 批重构；第 1 批是 prompt.js 那种搬法）：
//   这六段原本直接写在 index.js 的 apply() 里，靠闭包摸 host / groups / states / …，
//   于是「apply() 有多长」和「工具怎么定义」缠在一起：改一个 description 要滚两千行，
//   冷读也读不动。搬出来**只为了让定义和装配分开**，不改行为：
//     · name / description / parameters / output / execute 逐字节保留（原文由
//       _work/tools-extract.mjs 用词法器从旧 index.js 切出来，只有行首缩进按新层级调整）；
//     · 搬移前后用 _work/tool-defs-snapshot.mjs 序列化 8 个工具的定义做 diff，必须为空。
//
// 为什么六个在同一个文件：它们共用同一套「组 / 会话状态 / 选择器」依赖，而且
//   enable 与 disable 必须用**完全一样**的解析规则（按名字找组、回读工具表、受管会话拒绝）。
//   按工具拆成六个文件会把这份一致性拆散，收益只有行数。
//
// 为什么是普通函数不是类：这里没有状态。状态（groups / states / usage）都在 index.js 的
//   apply() 里，本文件只拿引用、只调用，不持有 —— 所以可以脱离 apply() 单独加载。

/**
 * @param {object} deps
 * @param {object}   deps.host           宿主契约（toolNames / allToolNames / schemas / record / log）
 * @param {Array}    deps.groups         已编译的组（工具体里读 id / res / title）
 * @param {Function} deps.groupsView     (agent) => 组视图（on / mode / matched / visible / blocked …）
 * @param {Function} deps.idsFrom        (args) => group/groups 归一化后的 id 数组
 * @param {Function} deps.membersOf      (组, 名字池) => 组真正能收的成员名
 * @param {Function} deps.rebuild        (agent) => 按当前模式重建该会话的作用域限制
 * @param {Function} deps.selectorSchema (extra) => group/groups 选择器的 JSON schema
 * @param {Function} deps.stateFor       (agent) => 会话状态（modes / hiddenNames / managed …）
 * @param {Function} deps.touch          (组 id, 'enable'|'disable') => 记一次用量
 * @param {Function} deps.text           (对象) => 给模型看的 JSON 文本
 * @param {Function} deps.applySessionPolicy (agent, spec) => 会话级策略（mode 工具的唯一实现）
 * @param {Function} deps.applyDefaults  (st) => 按策略重算默认开哪些组
 * @param {Set}      deps.CORE_TOOLS     常驻/自救工具名（永不可收）
 * @param {Function} deps.matcherFor     (pattern) => RegExp | null
 * @param {Function} deps.readUserGroups 读 ~/.dsh/lazy-tools.groups.json
 * @param {Function} deps.writeUserGroups 写 ~/.dsh/lazy-tools.groups.json
 * @param {Function} deps.unclassifiedNames (agent) => 没归组的裸名工具
 * @param {Function} deps.autoGroups     (apply) => 自动分组报告（list 里透出建议）
 */
export function createGroupTools(deps) {
  const {
    host,
    groups,
    groupsView,
    idsFrom,
    membersOf,
    rebuild,
    selectorSchema,
    stateFor,
    touch,
    text,
    applySessionPolicy,
    applyDefaults,
    CORE_TOOLS,
    matcherFor,
    readUserGroups,
    unclassifiedNames,
    writeUserGroups,
    autoGroups,
  } = deps

  const statusTool = {
  name: 'lazy_tools_status',
  description: '查看按需工具组：每组有多少工具、当前是开还是关。',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
  execute: async (_args, exec) => ({ groups: groupsView(exec && exec.agent) }),
}

  // 注意：roles（角色读写）不在这里 —— 它有 setter 依赖，定义在 tools/roles.js，
  // 由 tools/index.js 插到 status 与 enable 之间（顺序是硬要求，见那个文件顶部）。

  const enableTool = {
  name: 'lazy_tools_enable',
  description: '开启按需工具组（group 单个 / groups 批量）；给 only 就只放这几个工具（其余仍收起，只能配单个组）。下一轮起可用。',
  parameters: selectorSchema({
    only: { type: 'array', items: { type: 'string' }, description: '只放这些工具名，必须都属于该组；省略=整组开' },
    name: {
      type: 'string',
      description: '按工具名一步开启（可只给片段）：自动找到它属于哪组、只放这一个（原 lazy_tools_resolve）',
    },
  }),
  output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
  execute: async (args, exec) => {
    // 2026-10-30 合并：原 lazy_tools_resolve —— 按工具名一步开启。
    // 受管会话：工具面由角色策略决定，不允许从工具里改（改配置，不改编排）。
    if (exec && exec.agent && stateFor(exec.agent).managed) {
      return { error: '受管会话：工具面由角色策略决定，不允许从工具里改；请编辑 managedRoles 配置。' }
    }
    const byName = args && typeof args.name === 'string' ? args.name.trim() : ''
    if (byName) {
      const agentN = exec && exec.agent
      if (!agentN) return { error: 'no agent scope' }
      const stN = stateFor(agentN)
      const visibleN = host.toolNames(agentN)
      const knownN = host.allToolNames().length ? host.allToolNames() : [...new Set([...visibleN, ...stN.hiddenNames])]
      const exactN = knownN.filter((n) => n === byName)
      const matchedN = exactN.length ? exactN : knownN.filter((n) => n.toLowerCase().includes(byName.toLowerCase())).slice(0, 8)
      if (!matchedN.length) {
        return { found: false, query: byName, hint: '这个名字没见过。先 lazy_tools_list 看现有前缀，或者确认拼写；也可能它属于一个尚未加载的插件。' }
      }
      const targetN = matchedN[0]
      const groupN = groups.find((g) => g.res.some((re) => re.test(targetN)))
      const baseN = { found: true, tool: targetN, group: groupN ? groupN.id : null }
      if (matchedN.length > 1) baseN.matches = matchedN.slice(0, 8)
      if (!groupN) return { ...baseN, applied: false, hint: '它不在任何组里，本来就一直可见' }
      if (visibleN.includes(targetN)) return { ...baseN, applied: false, hint: '它本来就可用了' }
      stN.modes.set(groupN.id, { mode: 'only', names: new Set([targetN]) })
      touch(groupN.id, 'enable')
      rebuild(agentN)
      if (!host.toolNames(agentN).includes(targetN)) {
        host.record('enable', new Error(`${targetN} 已解除限制，但仍不在本会话工具表（可能未挂载或需要重启）`))
        return { ...baseN, applied: false, reason: 'not-visible', hint: '本插件的限制已经解除，但宿主仍没把它交给本会话 —— 大概率没被挂载（插件未启用，或刚更新完需要重启 DSH）。抽屉开不了它。' }
      }
      return { ...baseN, applied: true, hint: '已只放这一个进来，同组其余仍收起' }
    }
    const ids = idsFrom(args)
    if (!ids.length) return { error: '要 group、groups 或 name 之一' }
    const unknown = ids.filter((id) => !groups.some((g) => g.id === id))
    if (unknown.length) return { error: `unknown group: ${unknown.join(', ')}` }
    const agent = exec && exec.agent
    if (!agent) return { error: 'no agent scope' }
    const st = stateFor(agent)
    const only = Array.isArray(args && args.only) ? args.only.filter((name) => typeof name === 'string') : null
    if (only && ids.length > 1) return { error: 'only 只能配单个组' }
    if (only) {
      if (!only.length) return { error: 'only 不能是空数组；要整组开就省掉 only，要关就用 disable' }
      const group = groups.find((g) => g.id === ids[0])
      const bad = only.filter((name) => !group.res.some((re) => re.test(name)))
      if (bad.length) return { error: `这些名字不属于组 ${ids[0]}：${bad.join(', ')}` }
      const known = new Set([...host.toolNames(agent), ...st.hiddenNames])
      const missing = only.filter((name) => !known.has(name))
      if (missing.length) return { error: `这些名字当前不认识（可能没加载或拼错）：${missing.join(', ')}` }
      st.modes.set(ids[0], { mode: 'only', names: new Set(only) })
      touch(ids[0], 'enable')
      rebuild(agent)
      // 2026-11-01：回读（与按名字开同一条规矩）。只改模式不等于工具真回来了。
      const backOnly = host.toolNames(agent)
      if (!only.some((name) => backOnly.includes(name))) {
        return {
          enabled: ids[0],
          only,
          applied: false,
          reason: 'externally-hidden',
          hint: '本插件的限制已经解除，但这些工具一个都没回到会话工具表 —— 被外部过滤器挡着（宿主权限门或别的插件），不是抽屉收的。查 lazy_tools_health 的 groups[].blocked。',
        }
      }
      return { enabled: ids[0], only }
    }
    for (const id of ids) st.modes.delete(id)
    for (const id of ids) touch(id, 'enable')
    rebuild(agent)
    // 2026-11-01 修（真宿主实测撞到）：组模式改掉就返回「enabled」是**假成功** ——
    // 本机 `enable cua-screen` 返回成功，可 19 个成员一个都没回来（被 computer-use 权限门挡着）。
    // 规矩与 health 一致：解除我们这层之后回读，仍不可见就明说是外部挡的，不许报成功。
    const after = new Set(host.toolNames(agent))
    const blocked = ids.filter((id) => {
      const g = groups.find((item) => item.id === id)
      const members = g ? membersOf(g) : []
      return members.length > 0 && !members.some((name) => after.has(name))
    })
    const out = { enabled: ids.length === 1 ? ids[0] : ids }
    if (blocked.length) {
      out.applied = false
      out.blocked = blocked
      out.reason = 'externally-hidden'
      out.hint =
        '这些组的开关已经拨到「开」，但成员一个都没回到本会话工具表 —— 被外部过滤器挡着（宿主权限门或别的插件），不是抽屉收的。查 lazy_tools_health 的 groups[].blocked / notes。'
    }
    return out
  },
}

  const disableTool = {
  name: 'lazy_tools_disable',
  description: '关闭按需工具组（group 单个 / groups 批量），把它从上下文里收回；也会清掉之前的 only 白名单。',
  parameters: selectorSchema(),
  output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
  execute: async (args, exec) => {
    // 2026-10-30 合并：原 lazy_tools_resolve —— 按工具名一步开启。
    // 受管会话：工具面由角色策略决定，不允许从工具里改（改配置，不改编排）。
    if (exec && exec.agent && stateFor(exec.agent).managed) {
      return { error: '受管会话：工具面由角色策略决定，不允许从工具里改；请编辑 managedRoles 配置。' }
    }
    const ids = idsFrom(args)
    if (!ids.length) return { error: '要 group 或 groups' }
    const unknown = ids.filter((id) => !groups.some((g) => g.id === id))
    if (unknown.length) return { error: `unknown group: ${unknown.join(', ')}` }
    const agent = exec && exec.agent
    if (!agent) return { error: 'no agent scope' }
    const st = stateFor(agent)
    for (const id of ids) st.modes.set(id, { mode: 'hide', names: new Set() })
    for (const id of ids) touch(id, 'disable')
    rebuild(agent)
    return { disabled: ids.length === 1 ? ids[0] : ids }
  },
}

  const modeTool = {
    name: 'lazy_tools_mode',
    description:
      '只改**当前会话**的收敛策略：给 level 或 idleDays，立刻按新策略重算默认开哪些组；reset:true 恢复跟随全局设置。会覆盖本会话手动开关过的组。',
    parameters: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['low', 'medium', 'high'], description: '会话级档位' },
        idleDays: { type: 'number', description: '会话级闲置天数（覆盖档位）' },
        reset: { type: 'boolean', description: 'true = 清掉会话级覆盖，回到全局策略' },
        collapse: { type: 'boolean', description: 'true = 立刻把这个会话的所有组收起' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
    execute: async (args, exec) => {
      const agent = exec && exec.agent
      if (!agent) return { error: 'no agent scope' }
      const spec = { ...(args || {}) }
      if (spec.collapse === true) spec.collapseAll = true
      return applySessionPolicy(agent, spec)
    },
  }

// 分类：把「没人管的怪工具」交给当前会话的 agent 自己判断（插件不内嵌模型）。

  const saveGroupsTool = {
  name: 'lazy_tools_save_groups',
  description:
    '把 agent 分好的组写进 ~/.dsh/lazy-tools.groups.json（长期有效，用户随时可手改）。默认只写文件、下次会话生效；applyNow=true 才立刻生效（会打断本会话前缀缓存）。会做安全校验：含常驻工具、少于 2 个、与现有组重叠过多都会被拒。',
  parameters: {
    type: 'object',
    properties: {
      groups: {
        type: 'array',
        description: '组定义数组：{ id, title, match: [工具名…] }',
        items: { type: 'object' },
      },
      applyNow: {
        type: 'boolean',
        description: 'true 才立刻生效（会打断本会话前缀缓存）；默认只写文件、下次会话生效',
      },
    },
    additionalProperties: false,
  },
  output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
  execute: async (args, exec) => {
    const agent = exec && exec.agent
    const incoming = Array.isArray(args && args.groups) ? args.groups : []
    // 2026-11-06（A/B 评审 F1）：受管会话只能由角色决定工具面；save_groups 以前漏了守卫，
    // review 虽然藏了 edit/write，却仍能改全局组配置。这里与 enable/disable 用同一判据。
    if (agent && incoming.length && stateFor(agent).managed) {
      return { error: '受管会话：工具面由角色策略决定，不允许写全局组配置；请编辑 groups 文件或 managedRoles。' }
    }
    // 2026-10-30 合并：不传 groups = 要分类材料（原 lazy_tools_classify）。
    if (!incoming.length) {
      const namesU = unclassifiedNames(agent)
      const byNameU = new Map(host.schemas(agent).map((item) => [item.name, item]))
      const toolsU = namesU.slice(0, 80).map((name) => {
        const schema = byNameU.get(name)
        const description = schema && typeof schema.description === 'string' ? schema.description : ''
        const params =
          schema && schema.parameters && schema.parameters.properties && typeof schema.parameters.properties === 'object'
            ? Object.keys(schema.parameters.properties).slice(0, 10)
            : []
        return { name, description: description.slice(0, 200), params }
      })
      return {
        saved: 0,
        classify: {
          total: namesU.length,
          shown: toolsU.length,
          tools: toolsU,
          existingGroups: groups.map((g) => ({ id: g.id, title: g.title || g.id, match: g.match, keep: g.keep || [] })),
          instructions:
            '按用途分成 2–4 组（例：观察/只读、操作/会改状态、需要额外配置的能力）。每组至少 2 个工具，' +
            'id 用小写字母+连字符。不要包含常驻工具（如 pwsh/read/write/skill/lazy_tools_*）。' +
            '分好后调用 lazy_tools_save_groups：{ groups: [{ id, title, match: ["工具名", …] }] }。',
        },
      }
    }
    const known = new Set(host.allToolNames())
    const core = [...CORE_TOOLS]
    const issues = []
    const cleaned = []
    for (const raw of incoming) {
      const id = String((raw && raw.id) || '').trim()
      const match = Array.isArray(raw && raw.match) ? raw.match.map((name) => String(name)) : []
      if (!id) {
        issues.push('有条目缺 id')
        continue
      }
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
        issues.push(`${id}: id 只能小写字母/数字/连字符`)
        continue
      }
      if (match.length < 2) {
        issues.push(`${id}: 少于 2 个工具`)
        continue
      }
      const inCore = match.filter((name) => core.includes(name))
      if (inCore.length) {
        issues.push(`${id}: 含常驻工具 ${inCore.join(', ')} —— 这些不能被收起`)
        continue
      }
      const unknown = match.filter((name) => !known.has(name))
      if (unknown.length) {
        issues.push(`${id}: 未注册的名字 ${unknown.slice(0, 4).join(', ')}`)
        continue
      }
      const overlap = match.filter((name) => groups.some((g) => g.res.some((re) => re.test(name))))
      if (overlap.length / match.length > 0.8) {
        issues.push(`${id}: 与现有组重叠 ${Math.round((overlap.length * 100) / match.length)}%，没有意义`)
        continue
      }
      if (groups.some((g) => g.id === id)) {
        issues.push(`${id}: 组 id 已存在`)
        continue
      }
      cleaned.push({
        id,
        title: String((raw && raw.title) || id),
        match,
        defaultOn: false,
      })
    }
    if (!cleaned.length) return { saved: 0, issues }
    try {
      const existing = readUserGroups(host.record)
      const next = [...existing.filter((g) => !cleaned.some((c) => c.id === g.id)), ...cleaned]
      const file = writeUserGroups(next)
      // 默认只落盘、下次会话生效 —— 会话中途换工具表会打断前缀缓存，
      // 而「只在会话开始时决定收哪些工具」是本插件最核心的承诺。
      // 确实要现在生效的人显式传 applyNow: true，返回里会写明代价。
      const applyNow = args && args.applyNow === true
      if (applyNow && agent) {
        for (const c of cleaned) {
          const res = c.match.map((pattern) => matcherFor(pattern)).filter(Boolean)
          if (res.length) groups.push({ ...c, expect: c.match.length, res })
        }
        const st = stateFor(agent)
        applyDefaults(st)
        rebuild(agent)
      }
      host.log('info', `groups saved: ${cleaned.map((c) => c.id).join(', ')} (file ${file}, applyNow=${applyNow})`)
      return {
        saved: cleaned.length,
        ids: cleaned.map((c) => c.id),
        file,
        appliedNow: applyNow && Boolean(agent),
        issues,
        note: applyNow
          ? '已立刻生效（会打断本会话的前缀缓存）。'
          : '已写入文件，下次会话开始时生效（不打断当前会话缓存）。要现在生效就带上 applyNow: true。',
      }
    } catch (error) {
      host.record('save groups', error)
      return { saved: 0, issues: [...issues, `写文件失败：${error && error.message ? error.message : String(error)}`] }
    }
  },
}

  const listTool = {
  name: 'lazy_tools_list',
  description: '列出某个组里的工具名（被收起过的也算，visible 字段区分当前可不可见）。配 match 正则、挑单工具开关时用。',
  parameters: {
    type: 'object',
    properties: {
      group: { type: 'string', description: '组 id；省略则列出所有已知工具' },
      ungrouped: {
        type: 'boolean',
        description: '只列没归组的工具（带描述与参数名）；同时给前缀分桶建议（原 lazy_tools_scan / classify）',
      },
    },
    additionalProperties: false,
  },
  output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
  execute: async (args, exec) => {
    const agent = exec && exec.agent
    const visible = host.toolNames(agent)
    const st = agent ? stateFor(agent) : { hiddenNames: [] }
    const known = host.allToolNames().length ? host.allToolNames() : [...new Set([...visible, ...st.hiddenNames])].sort()
    const id = args && typeof args.group === 'string' ? args.group : ''
    // 2026-10-30 合并：原 lazy_tools_scan（前缀分桶）+ lazy_tools_classify（未归组工具描述）并进这里。
    if (args && args.ungrouped) {
      const names = unclassifiedNames(agent)
      const byName = new Map(host.schemas(agent).map((item) => [item.name, item]))
      const tools = names.slice(0, 80).map((name) => {
        const schema = byName.get(name)
        const description = schema && typeof schema.description === 'string' ? schema.description : ''
        const params =
          schema && schema.parameters && schema.parameters.properties && typeof schema.parameters.properties === 'object'
            ? Object.keys(schema.parameters.properties).slice(0, 10)
            : []
        return { name, description: description.slice(0, 200), params }
      })
      const buckets = new Map()
      for (const n of visible) {
        const key = n.includes('__') ? n.split('__')[0] : n.includes('_') ? n.split('_')[0] : n
        if (!buckets.has(key)) buckets.set(key, [])
        buckets.get(key).push(n)
      }
      // 冷读发现：autoGroups='suggest' 在设置里可选，但合并 scan 时把建议字段丢了 →
      // 选它的人看不到任何输出。这里把它接回 list { ungrouped: true }。
      const suggestion = (() => {
        try {
          return autoGroups(false)
        } catch {
          return null
        }
      })()
      return {
        group: null,
        ungrouped: { total: names.length, shown: tools.length, tools },
        ...(suggestion
          ? {
              autoGroups: {
                mode: suggestion.mode,
                applied: suggestion.applied,
                suggestions: suggestion.suggestions,
                skipped: suggestion.skipped,
              },
            }
          : {}),
        prefixes: [...buckets.entries()]
          .map(([prefix, list]) => ({ prefix, count: list.length, sample: list.slice(0, 4) }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 40),
      }
    }
    if (!id) return { group: null, count: known.length, visible: visible.length, names: known }
    const group = groups.find((g) => g.id === id)
    if (!group) return { error: `unknown group: ${id}` }
    const matched = known.filter((name) => group.res.some((re) => re.test(name)))
    return { group: id, count: matched.length, visible: matched.filter((name) => visible.includes(name)).length, names: matched }
  },
}

  // 返回**数组**（不是对象）：tools/index.js 靠它拼最终的注册顺序。
  return [statusTool, enableTool, disableTool, modeTool, saveGroupsTool, listTool]
}
