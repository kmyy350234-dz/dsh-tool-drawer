// 设置页 ↔ 宿主 的桥。
//
// 设置页是客户端那一半画的（lib/client.js），它没法直接读宿主的对象，
// 所以这里开一条 loopback HTTP 路由（和 dsh-perlica-ding 同一套做法）：
//   GET  /lazy-tools/api/state   读当前策略 + 组清单
//   POST /lazy-tools/api/policy  写策略（落盘到 ~/.dsh/lazy-tools.policy.json）
//
// 为什么用文件而不是直接改 profile 的 cordis.patch.yml：
//   改 YAML 要重写用户的配置文件（还可能触发重载），风险高；
//   一个独立的小 JSON 只影响本插件的策略，删掉即回默认。
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'

const LEVELS = ['low', 'medium', 'high']
const MAX_BODY = 64 * 1024

// 客户端半边最后一次上报的时间。
//
// 为什么需要它：宿主这边一切正常（四个契约都在、hidden 也 applied），完全不等于
// 浏览器那边把设置页和输入框控件挂上了——2026-10-24 就出现过「宿主 healthy，
// 客户端条目 failed，Web 直接进恢复模式」。这份心跳让「面板到底挂没挂」变成
// lazy_tools_health 里一条能查的数据，而不是只能靠重启去发现。
let lastClientPing = null

/** 给健康检查读的客户端心跳快照（没有就是没上报过）。 */
export function clientPing() {
  return lastClientPing
}

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
 * @param {object|null} stored 已存盘的策略（调用方传 readStoredPolicy()）
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
  mkdirSync(join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh'), { recursive: true })
  writeFileSync(file, JSON.stringify(groups, null, 2) + '\n', 'utf8')
  return file
}

export function readStoredPolicy() {
  try {
    const file = policyFile()
    if (!existsSync(file)) return null
    return normalizePolicy(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

/**
 * 严格版读策略（2026-11-03，冷读红 2）：把「文件不存在」和「读/解析失败」分开。
 * readStoredPolicy 把所有异常都变成 null —— 对"用默认值启动"是好事，对"热重载"是灾难：
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

function readJsonBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > MAX_BODY) data = data.slice(0, MAX_BODY)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'))
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

/**
 * 挂上桥。webServer 可能还没就绪（开机早期），所以两条路各试一次：
 * 已经有的直接挂，没有的用 ctx.inject 等它出现。
 * options: { getState(): object, applyPolicy(policy): void, record(where, error) }
 */
export function mountBridge(ctx, host, options) {
  let mounted = false

  const mount = (server) => {
    if (mounted || !server || typeof server.register !== 'function') return
    try {
      // 注意：host.own() 收的是**已经建好的清理函数**，不是工厂函数。
      // 之前把 `() => server.register(...)` 传进去，结果是「只登记了清理器、从来没注册路由」，
      // 浏览器那边看到的就是 404（2026-10-24 实测）。所以先注册、再把返回的注销函数交给 own。
      const unregister = server.register({
          kind: 'prefix',
          path: '/lazy-tools/api',
          handler: async (req, res) => {
            const send = (code, payload) => {
              res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify(payload))
            }
            try {
              const path = String(req.url || '').split('?')[0]
              const headers = req.headers || {}
              const origin = headers.origin
              if (typeof origin === 'string' && origin.length > 0) {
                let sameOrigin = false
                try {
                  sameOrigin = new URL(origin).host === headers.host
                } catch {
                  sameOrigin = false
                }
                if (!sameOrigin) return send(403, { error: 'cross-origin request refused' })
              }
              if (req.method === 'GET' && path === '/lazy-tools/api/state') {
                return send(200, { ...options.getState(), file: policyFile(), levels: LEVELS })
              }
              // 会话级：只影响这一个对话（输入框上方那个控件用它）
              if (path === '/lazy-tools/api/session') {
                const url = new URL(String(req.url || ''), 'http://localhost')
                if (req.method === 'GET') {
                  const id = url.searchParams.get('id') || ''
                  if (!id) return send(400, { error: 'id required' })
                  if (typeof options.getSession !== 'function') return send(501, { error: 'session api unavailable' })
                  const state = options.getSession(id)
                  return state && state.error ? send(404, state) : send(200, state)
                }
                if (req.method === 'POST') {
                  const contentType = String(headers['content-type'] || '')
                  if (!contentType.includes('application/json')) {
                    return send(415, { error: 'content-type must be application/json' })
                  }
                  const body = await readJsonBody(req)
                  const id = String((body && body.id) || '')
                  if (!id) return send(400, { error: 'id required' })
                  if (typeof options.applySession !== 'function') return send(501, { error: 'session api unavailable' })
                  const state = options.applySession(id, body)
                  return state && state.error ? send(400, state) : send(200, state)
                }
                return send(405, { error: 'method not allowed' })
              }
              // 客户端心跳：设置页 / 输入框控件挂上之后由浏览器那半边 POST 一次。
              // 只记「什么时候、挂了哪几个面板」，不存任何用户数据。
              if (req.method === 'POST' && path === '/lazy-tools/api/client') {
                const contentType = String(headers['content-type'] || '')
                if (!contentType.includes('application/json')) {
                  return send(415, { error: 'content-type must be application/json' })
                }
                const body = await readJsonBody(req)
                const panels = Array.isArray(body && body.panels)
                  ? body.panels.slice(0, 8).map((item) => String(item))
                  : []
                lastClientPing = { at: new Date().toISOString(), panels }
                return send(200, { ok: true, at: lastClientPing.at, panels })
              }
              if (req.method === 'POST' && path === '/lazy-tools/api/policy') {
                const contentType = String(headers['content-type'] || '')
                if (!contentType.includes('application/json')) {
                  return send(415, { error: 'content-type must be application/json' })
                }
                const body = await readJsonBody(req)
                const next = normalizePolicy(body)
                // 空策略一律拒绝（2026-10-29 第三方复核指出的真实路径）：
                // readJsonBody 在「body 超 64KB 被截断 / JSON 坏 / req 出错」时 resolve({})，
                // 归一化后还是 {}，写下去就等于把 policy 文件清空，却返回 200。
                // 合法的设置页保存永远至少带一个已知键，所以「空」一定不是用户意图。
                if (!Object.keys(next).length) {
                  return send(400, { error: '策略为空（body 不是合法 JSON？），已拒绝写入' })
                }
                if (body && body.level !== undefined && next.level === undefined) {
                  return send(400, { error: `level 必须是 ${LEVELS.join(' / ')} 之一` })
                }
                try {
                  // 2026-11-02：写**合并后的完整策略**，不是补丁（见 mergePolicyForStorage 的注释）。
                  // 2026-11-03（冷读红 3）：必须先读**原始 JSON** 当基底 —— 归一化后的对象会丢掉它不认识的键，
                  // 坏文件还会被当成空对象，于是"保存一次设置"就把 autoGroups / managedRoles 洗没了。
                  // 读不出来就拒绝（400），一个字节都不写。
                  const raw = readPolicyRaw()
                  if (!raw.ok) {
                    return send(400, {
                      error: `policy.json 读不出来（${String((raw.error && raw.error.message) || raw.error)}），为免洗掉设置已拒绝写入`,
                    })
                  }
                  const merged = mergePolicyForStorage(next, normalizePolicy(raw.value))
                  // 用原始对象当底、把归一化后的已知键覆盖上去：未知键原样保留
                  const toWrite = { ...raw.value, ...merged }
                  writeStoredPolicy(toWrite)
                  // 写后回读（2026-11-02 同一次翻车补的第二道）：这次的问题不是「写失败」，而是
                  // 「写成功但内容不对」—— 只看 writeFileSync 没抛错就返回 200，两周没人发现。
                  // 落盘后把文件读回来对键集合，少一个就报错，不再静默。
                  const back = readPolicyRaw()
                  const backValue = back.ok ? normalizePolicy(back.value) : {}
                  const lost = Object.keys(merged).filter((key) => !(key in backValue))
                  if (lost.length) {
                    const detail = `落盘后回读缺键：${lost.join(', ')}`
                    host.record('policy write', new Error(detail))
                    return send(500, { error: detail })
                  }
                  options.applyPolicy(merged)
                } catch (error) {
                  return send(500, { error: `保存策略失败：${String((error && error.message) || error)}` })
                }
                return send(200, { ...options.getState(), file: policyFile(), levels: LEVELS })
              }
              return send(404, { error: 'not found' })
            } catch (error) {
              return send(500, { error: String((error && error.message) || error) })
            }
          },
      })
      host.own(unregister)
      mounted = true
      host.log('info', 'settings bridge registered at /lazy-tools/api')
    } catch (error) {
      host.record('bridge', error)
    }
  }

  let server = null
  try {
    server = ctx && typeof ctx.get === 'function' ? ctx.get('webServer') : null
  } catch {
    server = null
  }
  if (server) mount(server)
  else if (ctx && typeof ctx.inject === 'function') {
    try {
      ctx.inject(['webServer'], (scoped) => mount(scoped && scoped.webServer ? scoped.webServer : null))
    } catch (error) {
      host.record('bridge inject', error)
    }
  }

  return () => {
    mounted = false
  }
}
