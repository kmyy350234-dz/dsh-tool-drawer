// prompt.js — 常驻提示段（会话级目录）与「会话快照」。
//
// 为什么单独拆出来（2026-11-03，第 1 批重构）：
//   这两百多行原本是 index.js 里 apply() 的一部分，靠闭包直接摸 host/groups/states/policy/usageLedger。
//   拆出来的目的不是"文件短一点"，而是把**一个判据只留一个入口**：
//     · 「这个会话挂载了哪些工具、该列哪些组」—— 提示段和 health 的会话快照走同一个函数；
//     · 「角色是什么」—— 由调用方传进来的 states 决定，这里不重新解析。
//   依赖全部显式注入（见 createPrompt 的参数），所以本文件可以脱离 apply() 单测。
//
// 失败方向：任何一处读不到（agent 认不出、工具表读不到）都退回**旧行为（列全部组）**，
// 绝不静默变短 —— 变短等于静默丢能力。

/**
 * @param {object} deps
 * @param {object} deps.host            host 契约（agentList / visibleNames / allToolNames / record）
 * @param {Array}  deps.groups          已编译的组
 * @param {Function} deps.membersOf     (组, 名字池) => 成员名
 * @param {Function} deps.groupOf       工具名 => 组 id | null
 * @param {WeakMap} deps.states         agent => 会话状态（hiddenNames / managed）
 * @param {object} deps.policy          策略（用 classifyNudge）
 * @param {object} deps.usageLedger     用量账本（用 tools[name] 的最后调用时间）
 * @param {Function} deps.unclassifiedNames (agent, 名字池) => 未归组的裸名工具
 * @param {Function} deps.isAllowedByPolicy (managed, name, groupOf) => boolean
 */
export function createPrompt(deps) {
  const { host, groups, membersOf, groupOf, states, policy, usageLedger, unclassifiedNames, isAllowedByPolicy } = deps

  /**
   * 组装 scope → 属于哪个 agent。
   * 实测（2026-11-01 冷读，读的是宿主源码）：宿主只有一个组装点 `assembleContextFor(agent)`，
   * 传进来的 scope **就是 agent 对象**。`agent.ctx` 那条分支是防御用的（宿主换实现时不至于认不出），
   * 认不出来返回 null：**不许**拿陌生对象去 stateFor（它会顺手建一份新状态）。
   */
  const agentForScope = (scope) => {
    if (!scope || typeof scope !== 'object') return null
    let list = []
    try {
      list = host.agentList()
    } catch {
      list = []
    }
    const direct = list.find((candidate) => candidate === scope)
    if (direct) return direct
    const viaCtx = list.find((candidate) => candidate && candidate.ctx === scope)
    if (viaCtx) return viaCtx
    return null
  }

  /**
   * 本会话「挂载了」的工具名集合 = 该作用域可见的 ∪ 我们自己藏起来的。
   *
   * 为什么必须并上自己藏的：抽屉的全部作用就是「藏起来」。只数可见的，一个被整组收起的组
   * 会显示成「零挂载」从而从句子里消失 —— 那等于把提示变成沉默，比长一点糟得多。
   * 为什么**不**并上外部 deny（宿主权限门、别的插件）：那些工具这个会话本来就用不了，
   * 广告它们就是在骗模型（本机 cua 两组就是这么被广告了整整一周的）。
   * 已知边界（2026-11-01 冷读指出）：一个名字如果**先被我们藏过、之后又被外部挡上**，
   * 它仍在 hiddenNames 里 → 仍会被并回挂载集。这不是我们这层能分辨的，只能接受，
   * 真正的隔离信息在 `health.foreignDenied`。
   *
   * @returns Set<string> 或 null（信号不可信 ⇒ 调用方退回旧行为）
   */
  const mountedNames = (agent) => {
    if (!agent) return null
    let visible = null
    try {
      // 传的一定是认出来的**真 agent**。visibleNames 自己在「视图为空」时会用 schemas 复核。
      visible = host.visibleNames(agent)
    } catch {
      visible = null
    }
    if (!Array.isArray(visible)) return null
    let hidden = []
    try {
      const st = states.get(agent)
      if (st && Array.isArray(st.hiddenNames)) {
        hidden = st.hiddenNames
        // 受管会话：没授权的组连 enable 都会被拒，列进提示只是骗模型去点一个点不开的开关。
        if (st.managed) hidden = hidden.filter((name) => isAllowedByPolicy(st.managed, name, groupOf))
      }
    } catch {
      hidden = []
    }
    return new Set([...visible, ...hidden])
  }

  /**
   * 会话视图：挂载集 + 每个组在本会话里的成员 + 该列的组。
   * **提示段和 health 的快照都只走这一个函数**（DESIGN 规矩：同一判据只允许一个入口）。
   */
  const view = (agent) => {
    const mounted = mountedNames(agent)
    // 名字池一次算好：以前每个组各调一次 allToolNames()，8 个组就是 8 次全量 schema 拷贝。
    const pool = mounted ? [...mounted] : host.allToolNames()
    const members = new Map(groups.map((g) => [g, membersOf(g, pool)]))
    // 只列本会话真的有工具的组。**这里先不判空段** —— 2026-11-01 冷读指出，早退会把
    // 「有 N 个工具没归组，请去分组」这句一起吞掉，而那正是「一个组都没挂」的会话里唯一有用的句子。
    const listed = mounted ? groups.filter((g) => (members.get(g) || []).length > 0) : groups
    return { mounted, pool, members, listed }
  }

  /**
   * 这个会话是不是「默认 preset 的人工会话」。
   * 只在这里催人去做分组（lazy_tools_save_groups 会把结果写进全局分组表）——
   * 无人值守的角色会话（每工单一个会话、preset 装配）不该被引导去改全局配置，那是人或管理员的事。
   * 读不到任何信号 ⇒ 当作默认会话（与 0.17.2 行为一致）。
   */
  const isDefaultPresetSession = (agent) => {
    if (!agent) return true
    try {
      const presets = agent.ctx && typeof agent.ctx.get === 'function' ? agent.ctx.get('agentPresets') : null
      if (!presets || typeof presets.composedPreset !== 'function') return true
      const composed = presets.composedPreset(agent.ctx) ?? null
      if (composed === null) return true
      // 哪个字段才代表「默认」随构建不同：defaultId 是模块默认，selectedDefault 是用户当前选中的默认
      // （本机实测两者都是 cordis —— 2026-11-01 用 health.nameProbe 验的）。
      const known = [presets.defaultId, presets.selectedDefault, presets.defaultPreset].filter(
        (value) => typeof value === 'string' && value.length > 0,
      )
      if (!known.length) return true
      return known.includes(composed)
    } catch {
      return true
    }
  }

  /** 提示段正文。context 是宿主的 AssembleContext（`{ scope }`）。 */
  const sectionText = (context) => {
    // 2026-11-01：按**组装方会话**渲染。认不出 scope / 读不到工具表 ⇒ mounted=null ⇒ 全部退回旧行为。
    const scope = context && typeof context === 'object' ? (context.scope ?? context.agent ?? null) : null
    const sectionAgent = agentForScope(scope)
    const { members, listed } = view(sectionAgent)

    // 能力目录（2026-10-29 上线）：每组附 3 个代表工具名，把自愈从「猜名字」变成「照着念」。
    // 2026-11-01 起从「本会话挂载的名字池」取 —— 被我们收起的也在池里，被外部挡掉的不在。
    const sampleFor = (g) => {
      try {
        // 成员与本段列组用**同一份**判定（membersOf），不再各自跑一遍正则。
        const matched = members.get(g) || []
        if (!matched.length) return ''
        // 最近调用时间降序取前 3（账本里每把工具只有一个「最后调用时间」，没有窗口内次数）。
        const lastUsedAt = (n) => {
          const at = usageLedger && usageLedger.tools ? usageLedger.tools[n] : null
          const ms = at ? Date.parse(at) : 0
          return Number.isFinite(ms) ? ms : 0
        }
        const names = matched
          .slice()
          .sort((a, b) => lastUsedAt(b) - lastUsedAt(a))
          .slice(0, 3)
        // **不许截前缀**：裸名可能是别的插件的同名工具（本机就有裸名 click），照念会静默用错实现。
        const shown = names.map((n) => String(n))
        return shown.length ? `: ${shown.join('/')}` : ''
      } catch {
        return ''
      }
    }

    const base = listed.length
      ? `工具抽屉（lazy-tools）：${listed
          .map((g) => (g.title ? `${g.id}(${g.title}${sampleFor(g)})` : `${g.id}${sampleFor(g)}`))
          .join(' / ')} 默认收起。` +
        '工具报 unknown 时先调 lazy_tools_status（每组用途与工具数），或 lazy_tools_list {group} 拿到该组**全部**工具名（上面每组只列了 3 个样本）；需要时 lazy_tools_enable {group, only:[…]}；排查用 lazy_tools_health。'
      : ''

    // 有「没人管的怪工具」时提一句。classifyNudge 关掉时连全局名字都不读
    // —— 没 view 的宿主上那是每轮一次全量 schema 深拷贝。
    let loose = []
    const wantNudge = policy.classifyNudge !== false
    if (wantNudge) {
      try {
        // 全局名字池也走便宜读法（view(undefined) = 全局层）；拿不到就传 null，退回 schemas。
        let globalNames = null
        try {
          const names = host.visibleNames()
          globalNames = Array.isArray(names) ? names : null
        } catch {
          globalNames = null
        }
        loose = unclassifiedNames(null, globalNames)
      } catch {
        loose = []
      }
    }
    // 催人分组的话**只在默认 preset 的人工会话里说**（角色会话不该被引导去改全局分组表）。
    const nudgeText =
      wantNudge && loose.length >= 3 && isDefaultPresetSession(sectionAgent)
        ? `另有 ${loose.length} 个工具没归组、也没有共同前缀：${loose.slice(0, 6).join(', ')}${
            loose.length > 6 ? ' …' : ''
          }。请调 lazy_tools_save_groups（不传 groups）读描述、按用途分组，再带 groups 落盘（一次即可，长期生效）。`
        : ''
    // 空段判定（宿主会把空段整段丢掉）：
    //   · 没有目录、也没有提醒 ⇒ ''
    //   · 只有提醒（这个会话一个分组工具都没挂，但有散装工具要分类）⇒ 只输出提醒
    if (!base) return nudgeText ? `工具抽屉（lazy-tools）：${nudgeText}` : ''
    return nudgeText ? `${base} ${nudgeText}` : base
  }

  /**
   * 会话快照：给 health 和编排器看的一行状态（2026-11-03 加；2026-11-03 夜按挑刺结果收窄）。
   *
   * 只留三样，且**每样只有一个来源**：
   *   · `groupsListed` —— 与提示段同一个函数（view）算出来的，禁止另算一套；
   *   · `visible`      —— 走 visibleNames（便宜视图）；**读不到给 null，不许用 0 冒充**；
   *   · `hidden`       —— 我们自己藏了几个（hiddenNames 的长度）。
   *
   * 为什么砍掉两个字段（挑刺实测）：
   *   ① `role` 与既有 `managed` 重复且形状不同 ⇒ 违反「同一判据只允许一个入口」；
   *   ② `blockedGroups` 是第二个更弱的判据：我们把没撤掉的限制也会报成「外部挡」，
   *      而 health 的 `groups[].blocked` / `warnings` 已经分得清「没挂载过 / 挂过又没了 / 我们没还回来」
   *      三种根因。多一个同义字段，只会让同一份回答里出现两种结论。
   */
  const describeSession = (agent) => {
    if (!agent) return null
    // 读名字走便宜视图；读不到（视图抛错且 schemas 也抛错）返回 null —— 契约见 host.visibleNames。
    let visible = null
    try {
      visible = host.visibleNames(agent)
    } catch {
      visible = null
    }
    const visibleKnown = Array.isArray(visible)
    const v = view(agent)
    let st = null
    try {
      st = states.get(agent) || null
    } catch {
      st = null
    }
    return {
      groupsListed: v.listed.map((g) => g.id),
      visible: visibleKnown ? visible.length : null,
      hidden: st && Array.isArray(st.hiddenNames) ? st.hiddenNames.length : 0,
    }
  }

  return { agentForScope, mountedNames, view, sectionText, describeSession, isDefaultPresetSession }
}

/**
 * 把提示段挂到宿主上。
 * 拿不到 systemPrompt 服务就静默跳过 —— 这是可选项，不是必需能力。
 */
export function mountPromptSection(ctx, prompt, host) {
  try {
    if (!ctx || typeof ctx.inject !== 'function') return false
    ctx.inject(['systemPrompt'], (service) => {
      try {
        const section = {
          name: 'lazy-tools:groups',
          order: 3000,
          interpolate: false,
          text: (context) => prompt.sectionText(context),
        }
        if (service && service.systemPrompt && typeof service.systemPrompt.section === 'function') {
          if (typeof service.effect === 'function') {
            service.effect(() => service.systemPrompt.section(section), 'lazy-tools: prompt section')
          } else {
            service.systemPrompt.section(section)
          }
        } else {
          host.record('systemPrompt', new Error('systemPrompt.section is not available'))
        }
      } catch (error) {
        host.record('systemPrompt', error)
      }
    })
    return true
  } catch (error) {
    host.record('systemPrompt', error)
    return false
  }
}
