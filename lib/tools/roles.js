// tools/roles.js — 「角色 → 允许哪些组」的读写工具（lazy_tools_roles，1 个）。
//
// 为什么单独一个文件（虽然只有一个工具）：它和别的工具不一样，**有副作用** ——
//   唯一一个会写 policy.json 的工具。要动的可变状态也是独一份：
//     · roleSource   配置源（index.js 的 roleStore.source）
//     · policyMtime  上次读到的 policy.json mtime（role-runtime.js 内部）
//   跨模块给它们赋值只能走注入的 setter（deps.setRoleSource / deps.setPolicyMtime）：
//   搬移前是闭包直接赋值，搬之后模块里根本没有那两个变量。这是**故意的** ——
//   写角色的人（全插件唯一一处）显式声明「我要改这两格」，比隐式闭包好读也好查。
//
// 原文来源：_work/tools-extract.mjs 从旧 index.js 切出，逐字节保留（只有缩进变化）。
// 唯一的文本改动是那两行赋值 → setter 调用，其余原样；两处都做了行数与行首断言。

// ── 角色配置（2026-11-03）：AI 自己配，人只审结果 ─────────────────────────
// 用户原话：「反正给喜欢折腾的开个口子就行，大部分人懒得写」。
// 所以：读 = 看现状；写 = AI 自己配。**工具层强制三条不变量**，比人手写 JSON 可靠：
//   ① allowGroups 里的组必须真实存在（写错一个 id 就是"会话被锁到只剩核心工具"，#71）；
//   ② 不许写 `*`（那是"放开限制"的逃生口，只允许人手改文件）；
//   ③ 必须带 basis（为什么这么配），并自动盖 `createdBy: 'ai'` + `at`。
// 人手改 policy.json 的路径**照旧有效**（热重载会读进来）——那就是留给"喜欢折腾的人"的口子。

/**
 * @param {object} deps
 * @param {object}   deps.host               宿主契约（record / log）
 * @param {Array}    deps.groups             已编译的组（校验 allowGroups 的 id 是否真实存在）
 * @param {object}   deps.policy             策略对象（读 managedRoles）
 * @param {Function} deps.stateFor           (agent) => 会话状态（读 managed：受管会话不许自改）
 * @param {Function} deps.text               (对象) => JSON 文本
 * @param {Function} deps.normalizeManagedRoles (原始 JSON) => 归一化角色表 | null
 * @param {Function} deps.policyFileMtime    () => policy.json 的 mtime
 * @param {Function} deps.readPolicyRaw      () => { ok, value } 文件原始 JSON（不做归一化）
 * @param {Function} deps.writeStoredPolicy  (对象) => 写 policy.json
 * @param {Function} deps.refreshManagedRoles (force) => 按当前组表审计并生效
 * @param {Function} deps.setRoleSource      (v) => roleStore.source = v
 * @param {Function} deps.setPolicyMtime     (v) => role-runtime.js 的 policyMtime = v
 * @param {Set}      deps.CORE_TOOLS         常驻工具集合（算「未归组」时要排除）
 */
export function createRolesTool(deps) {
  const {
    host,
    groups,
    policy,
    stateFor,
    text,
    normalizeManagedRoles,
    policyFileMtime,
    readPolicyRaw,
    writeStoredPolicy,
    refreshManagedRoles,
    setRoleSource,
    setPolicyMtime,
    CORE_TOOLS,
  } = deps

  const rolesTool = {
  name: 'lazy_tools_roles',
  description:
    '查看 / 配置「角色 → 允许哪些组」。不传参数=只读（列出已有角色、来源、依据、可用组 id）；' +
    '传 role + allowGroups + basis = 写入（写入后即时生效，不用重启）。AI 不许写 *。',
  parameters: {
    type: 'object',
    properties: {
      role: { type: 'string', description: '角色名（小写字母/数字/_/-，1-32 位），要和子会话 label 里的候选段一致' },
      allowGroups: { type: 'array', items: { type: 'string' }, description: '这个角色允许的组 id（必须真实存在；不许写 *）' },
      basis: { type: 'string', description: '为什么这么配（会写进配置文件，事后可追）' },
      unknown: { type: 'string', enum: ['hide', 'show'], description: '没归组的工具怎么处理，默认 hide' },
    },
    additionalProperties: false,
  },
  output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
  execute: async (args, exec) => {
    const groupIds = groups.map((g) => g.id)
    const listRoles = () =>
      Object.entries(policy.managedRoles || {}).map(([key, role]) => ({
        role: key,
        allowGroups: role.allowGroups,
        unknown: role.unknown,
        createdBy: role.createdBy ?? null,
        at: role.at ?? null,
        basis: role.basis ?? null,
      }))

    // 只读
    if (!args || !args.role) return { groupIds, roles: listRoles(), hint: '要配置就传 role + allowGroups + basis' }

    // 受管会话里不许给自己改配置（否则"角色"就管不住自己了）
    const agent = exec && exec.agent
    const st = agent ? stateFor(agent) : null
    if (st && st.managed) return { error: `本会话是受管角色 ${st.managed.key}，不能给自己改角色配置；请在普通会话里配` }

    const key = String(args.role).trim().toLowerCase()
    if (!/^[a-z0-9_-]{1,32}$/.test(key)) return { error: '角色名只允许小写字母/数字/_/-，1-32 位' }
    // 2026-11-05（冷读黄 4）：空数组合法（= 只留常驻）。以前一律拒绝，和 README/POLICY 冲突。
    if (!Array.isArray(args.allowGroups)) return { error: 'allowGroups 必须是数组（可以是空数组 = 只留常驻工具）' }
    const allow = [...new Set(args.allowGroups.map((s) => String(s).trim()).filter(Boolean))]
    if (allow.includes('*')) {
      return { error: "AI 不能写 '*'（那是放开限制的逃生口）；要放开请人手改 policy.json —— 那是留给折腾的人的口子" }
    }
    // 2026-11-03（对比评审指出）：把**当前所有组**都列进 allowGroups，效果等价于 `*`。
    // 字面写 `*` 被拒，"枚举一遍"却能绕过去 —— 这里堵上。
    const allSelected = groupIds.length > 0 && groupIds.every((id) => allow.includes(id))
    if (allSelected) {
      return {
        error: `allowGroups 覆盖了全部 ${groupIds.length} 个组，等价于 '*'（放开限制）—— 这种事只允许人手改 policy.json`,
      }
    }
    const bad = allow.filter((id) => !groupIds.includes(id))
    if (bad.length) return { error: `这些组不存在：${bad.join(', ')}（当前可用：${groupIds.join(', ')}）` }
    const basis = typeof args.basis === 'string' ? args.basis.trim() : ''
    if (!basis) return { error: '必须给 basis（为什么这么配），否则权限就成了"从模型嘴里长出来"的' }

    try {
      // 冷读红 3（#78 同类）：**必须**以文件里的原始 JSON 为基底合并。
      // 以前用 readStoredPolicy()（归一化后）当基底 = "没认识的键全丢"；读失败时更会 wash 成只剩 managedRoles。
      // 这里读不出来就**拒绝写**：宁可这次没配成，也不许洗掉别的设置。
      const rawPolicy = readPolicyRaw()
      if (!rawPolicy.ok) {
        return {
          error: `policy.json 读不出来（${String((rawPolicy.error && rawPolicy.error.message) || rawPolicy.error)}）—— 为免洗掉其它设置，这次不写。修好文件再试。`,
        }
      }
      const stored = rawPolicy.value
      // 2026-11-03（冷读第三轮）：文件里 managedRoles 不是对象时，展开会把字符串摊成 "0"/"1"…
      // 数字键写进文件。和「读不出来」同一种处理：拒绝写，别污染文件。
      if (stored.managedRoles != null && (typeof stored.managedRoles !== 'object' || Array.isArray(stored.managedRoles))) {
        return { error: 'policy.json 里的 managedRoles 形状不合法（应为对象）；先修好文件再写，免得把别的键摊坏' }
      }
      const nextRoles = {
        ...(stored.managedRoles || {}),
        [key]: {
          allowGroups: allow,
          unknown: args.unknown === 'show' ? 'show' : 'hide',
          createdBy: 'ai',
          at: new Date().toISOString(),
          basis: basis.slice(0, 300),
        },
      }
      writeStoredPolicy({ ...stored, managedRoles: nextRoles })
      // 内存里同步 + 走同一套校验，再把 mtime 追平（免得下次 agent/created 把它当"外部改动"再读一遍）
      setRoleSource(normalizeManagedRoles(nextRoles))
      refreshManagedRoles(true)
      setPolicyMtime(policyFileMtime())
      // 2026-11-03（MyGO 场景）：受管角色默认把「未归组工具」也藏起来，
      // 而 MyGO 的 need_help / report_submit 正好未归组 —— 不提醒就会「接了反而更坏」。
      // 这里把会被藏掉的未归组工具回给调用方（只告知，不落盘）。
      const willHideUngrouped = (() => {
        try {
          if (args.unknown === 'show') return []
          const all = host.allToolNames().filter((name) => !CORE_TOOLS.has(name))
          const grouped = new Set()
          for (const g of groups) {
            for (const re of g.res || []) for (const name of all) if (re.test(name)) grouped.add(name)
          }
          return all.filter((name) => !grouped.has(name)).sort().slice(0, 30)
        } catch {
          return []
        }
      })()

      host.log('info', `roles: ${key} → ${allow.join(',')}（AI 配置；basis=${basis.slice(0, 40)}）`)
      return {
        ok: true,
        role: key,
        allowGroups: allow,
        applied: true,
        hint: '已写进 policy.json 并生效；下一个新建会话按它收紧。当前会话的工具面不变。',
        willHideUngrouped,
      }
    } catch (error) {
      return { error: `写入失败：${String((error && error.message) || error)}` }
    }
  },
}

  return rolesTool
}
