// 策略/用户组文件存储：读写、归一化、原子写。
// 与 HTTP bridge 分开：改文件语义不碰路由，改路由不碰文件格式。
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, renameSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'

export const LEVELS = ['low', 'medium', 'high']

export function policyFile() {
  if (process.env.LAZY_TOOLS_POLICY_FILE) return process.env.LAZY_TOOLS_POLICY_FILE
  const home = process.env.USERPROFILE || process.env.HOME || '.'
  return join(home, '.dsh', 'lazy-tools.policy.json')
}

/** 只接受认识的键；其余丢掉，避免手改文件时写进垃圾。 */
export function normalizePolicy(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  if (LEVELS.includes(raw.level)) out.level = raw.level
  if (Number.isFinite(raw.idleDays) && raw.idleDays >= 0) out.idleDays = Math.round(raw.idleDays)
  if (Number.isFinite(raw.minTools) && raw.minTools >= 0) out.minTools = Math.round(raw.minTools)
  if (Number.isFinite(raw.warmRatio)) out.warmRatio = Math.min(1, Math.max(0.05, raw.warmRatio))
  if (raw.presets && typeof raw.presets === 'object') {
    const presets = {}
    for (const key of ['low', 'medium', 'high']) {
      const days = Number(raw.presets[key])
      if (Number.isFinite(days) && days >= 0) presets[key] = Math.round(days)
    }
    if (Object.keys(presets).length === 3) out.presets = presets
  }
  if (typeof raw.classifyNudge === 'boolean') out.classifyNudge = raw.classifyNudge
  if (typeof raw.showDock === 'boolean') out.showDock = raw.showDock
  if (typeof raw.showClear === 'boolean') out.showClear = raw.showClear
  // 自动分组：off / suggest / on（2026-10-25 加）
  if (raw.autoGroups === 'off' || raw.autoGroups === 'suggest' || raw.autoGroups === 'on') out.autoGroups = raw.autoGroups
  // 2026-11-03 修：**managedRoles 必须透传**。
  // 找到它的是一条测试：README 写着「角色写进 policy.json」，但归一化在这里把它吃掉，
  // 于是从 policy.json 配的角色**从来没生效过**（只有插件 config 里的能生效）——静默两个月。
  // 更糟的是保存路径：`mergePolicyForStorage` 先把存盘策略读回来（被这里剥掉 managedRoles），
  // 再合并写回 ⇒ **随便存一次设置就把角色配置删了**（与档案 #78 同一类：写成功但内容不对）。
  // 这里只做形状检查，具体校验交给 roles.js 的 normalizeManagedRoles。
  if (raw.managedRoles && typeof raw.managedRoles === 'object' && !Array.isArray(raw.managedRoles)) {
    out.managedRoles = raw.managedRoles
  }
  return out
}

/**
 * 设置页保存：把一份补丁合到现有策略上，并处理「档位 → 天数」的跟随。
 *
 * 为什么单独抽出来：`policy.idleDays` 在插件启动时算一次（index.js 的 policy 初始化），
 * 之后设置页走的是 Object.assign —— 用户把档位从 high 改成 low，`policy.level` 变了、
 * `policy.idleDays` 还是 3 天，直到重启进程。2026-10-28 对面复现了这个不一致。
 *
 * 规则：只给了 level、没给 idleDays（undefined / null = 用户没碰那一格）时，
 * 天数跟着档位走；显式给了数字就用数字（用户可以「跟随档位但天数是自定义」）。
 *
 * @param {object} policy 现有策略（会被就地修改并返回）
 * @param {object} next 设置页提交的补丁
 */
export function applyPolicyPatch(policy, next) {
  const patch = Object.assign({}, next)
  const hasDays = patch.idleDays !== undefined && patch.idleDays !== null
  if (!hasDays && patch.level && policy && policy.presets) {
    const preset = policy.presets[patch.level]
    if (Number.isFinite(preset)) patch.idleDays = preset
  }
  return Object.assign(policy, patch)
}

/**
 * 落盘用：把补丁合到**已存盘的**策略上，返回完整策略。
 *
 * 2026-11-02 修（用户转述了同行的判断，回去一查是真的）：
 * 原来 POST /policy 把 `normalizePolicy(body)` 直接 `writeStoredPolicy()` —— 写下去的是**补丁**，
 * 不是合并后的完整策略。只要客户端发的是部分字段（档位按钮、脚本、未来的 UI 改版），
 * 文件就被覆盖成那几项，**其余设置从盘上消失**；运行时因为 `applyPolicy` 会把补丁并进内存，
 * 看起来一切正常 —— 直到重启进程，没落盘的那些就回到默认值。
 * 症状：改一处设置，重启后发现别的设置全变默认。
 *
 * 现在：读回存盘 → 合并补丁 → 写合并结果；内存侧也用同一份，盘和内存不再两套口径。
 *
 * @param {object} patch   这次提交的补丁
 * @param {object|null} stored 已存盘的策略（调用方从 readPolicyRaw() 归一化后传入）
 */
export function mergePolicyForStorage(patch, stored) {
  const base = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
  return applyPolicyPatch(base, patch)
}

/** 用户手写组的覆盖文件：和 policy 分开，设置页保存不会冲掉它。 */
export function groupsFile() {
  if (process.env.LAZY_TOOLS_GROUPS_FILE) return process.env.LAZY_TOOLS_GROUPS_FILE
  const home = process.env.USERPROFILE || process.env.HOME || '.'
  return join(home, '.dsh', 'lazy-tools.groups.json')
}

/** 读用户组；文件不存在或坏了都当作空数组（不能因为一行手写配置把插件带崩）。 */
export function readUserGroups(record) {
  const file = groupsFile()
  try {
    if (!existsSync(file)) return []
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((g) => g && typeof g.id === 'string' && Array.isArray(g.match) && g.match.length)
  } catch (error) {
    if (typeof record === 'function') record('user groups', error)
    return []
  }
}

/** 写用户组（覆盖整个文件）。只做最基本的形状校验，语义校验在调用方。 */
export function writeUserGroups(groups) {
  const file = groupsFile()
  // 2026-11-05：文件路径可被 LAZY_TOOLS_GROUPS_FILE 覆盖，目录必须跟着文件走，
  // 否则指向新目录时写盘直接 ENOENT。
  mkdirSync(dirname(file), { recursive: true })
  // 2026-11-05（元宝挑刺附注）：组文件原来是「直接写 + 不看回读」——写到一半失败/内容被改
  // 都会静默成功。改成原子写（tmp + rename）并回读校验，和 policy 一个待遇。
  const tmp = `${file}.${process.pid}.tmp`
  const payload = JSON.stringify(groups, null, 2) + '\n'
  try {
    writeFileSync(tmp, payload, 'utf8')
    renameSync(tmp, file)
    const back = readFileSync(file, 'utf8')
    if (back !== payload) throw new Error('组文件写入后回读不一致')
  } catch (error) {
    try { unlinkSync(tmp) } catch { /* 临时文件可能已经 rename 走了 */ }
    throw error
  }
  return file
}

/**
 * 严格版读策略（2026-11-03，冷读红 2）：把「文件不存在」和「读/解析失败」分开。
 * 旧的宽容读把所有异常都变成 null —— 对"用默认值启动"是好事，对"热重载"是灾难：
 * 坏 JSON / 半写文件会被当成"用户把角色全删了"，于是 managedRoles 被静默清零。
 * 调用方拿到 ok:false 时必须**保持旧值**并记账，不许当空。
 */
export function readStoredPolicyStrict() {
  const file = policyFile()
  if (!existsSync(file)) return { ok: true, policy: null, raw: null }
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'))
    // 2026-11-03（冷读第三轮）：合法 JSON 但不是对象（null / [] / "str"）也算「读不出来」。
    // 以前 normalizePolicy 把它静默变成 {} ⇒ 整份设置退回默认、healthy 还是 true。
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: new Error('policy.json 顶层不是对象') }
    }
    return { ok: true, policy: normalizePolicy(value), raw: value }
  } catch (error) {
    return { ok: false, error }
  }
}

/**
 * 读 policy 的**原始 JSON**（不归一化）：给需要"合并写回、保留别人键"的写路径用。
 * 冷读红 3：#78 的同类 —— 用归一化后的对象当基底去覆盖整份文件，会把没认识的键洗掉。
 */
export function readPolicyRaw() {
  const file = policyFile()
  if (!existsSync(file)) return { ok: true, value: {} }
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: new Error('policy.json 顶层不是对象') }
    }
    return { ok: true, value }
  } catch (error) {
    return { ok: false, error }
  }
}

/**
 * policy 文件的修改时间（毫秒）；不存在 / 读不到给 0。
 * 用途只有一个：**改完文件不用重启**（2026-11-03，用户点名"配置很麻烦"）。
 * 判据用 mtime 而不是 watchdog：不引依赖、失败就退回旧行为（拿不到就是 0，永不重载）。
 */
export function policyFileMtime() {
  try {
    const file = policyFile()
    if (!existsSync(file)) return 0
    return statSync(file).mtimeMs || 0
  } catch {
    return 0
  }
}

export function writeStoredPolicy(policy) {
  const file = policyFile()
  mkdirSync(dirname(file), { recursive: true })
  // 2026-11-03（冷读第三轮）：先写临时文件再 rename —— 直接 truncate+write 一旦中途失败，
  // 盘上就是半份 JSON，热重载读到它会当成"用户改坏了"（红 2 的放大器）。
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(policy, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
  return file
}

/** 两条写路径共用：以原始 JSON 为底，合并补丁，原子写并回读校验。 */
export function writePolicyMerged(raw, patch, { record } = {}) {
  const fail = (status, message) => {
    const error = new Error(message)
    error.status = status
    return error
  }
  if (!raw || !raw.ok) {
    throw fail(400, `policy.json 读不出来（${String((raw && raw.error && raw.error.message) || (raw && raw.error) || 'unknown')}），为免洗掉设置已拒绝写入`)
  }
  const merged = mergePolicyForStorage(normalizePolicy(patch), normalizePolicy(raw.value))
  writeStoredPolicy({ ...raw.value, ...merged })
  const back = readPolicyRaw()
  const backValue = back.ok ? normalizePolicy(back.value) : {}
  const lost = Object.keys(merged).filter((key) => !(key in backValue))
  if (lost.length) {
    const detail = `落盘后回读缺键：${lost.join(', ')}`
    if (typeof record === 'function') record('policy write', new Error(detail))
    throw fail(500, detail)
  }
  return merged
}

/** 设置页保存：归一化 → 读原始 JSON → 合并 → 原子写 → 回读校验。 */
export function savePolicy(body, { record } = {}) {
  const fail = (status, message) => {
    const error = new Error(message)
    error.status = status
    return error
  }
  const next = normalizePolicy(body)
  // 空策略一律拒绝：readJsonBody 在截断/坏 JSON 时给 {}，写下去等于清空文件。
  if (!Object.keys(next).length) throw fail(400, '策略为空（body 不是合法 JSON？），已拒绝写入')
  if (body && body.level !== undefined && next.level === undefined) {
    throw fail(400, `level 必须是 ${LEVELS.join(' / ')} 之一`)
  }
  // 必须先读原始 JSON 当基底：归一化会丢掉不认识的键，也会把坏文件当成空。
  const merged = writePolicyMerged(readPolicyRaw(), next, { record })
  return { merged, file: policyFile() }
}

