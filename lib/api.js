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
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
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
  if (raw.presets && typeof raw.presets === 'object') {
    const presets = {}
    for (const key of ['low', 'medium', 'high']) {
      const days = Number(raw.presets[key])
      if (Number.isFinite(days) && days >= 0) presets[key] = Math.round(days)
    }
    if (Object.keys(presets).length === 3) out.presets = presets
  }
  if (typeof raw.showDock === 'boolean') out.showDock = raw.showDock
  if (typeof raw.showClear === 'boolean') out.showClear = raw.showClear
  // 自动分组：off / suggest / on（2026-10-25 加）
  if (raw.autoGroups === 'off' || raw.autoGroups === 'suggest' || raw.autoGroups === 'on') out.autoGroups = raw.autoGroups
  return out
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

export function readStoredPolicy() {
  try {
    const file = policyFile()
    if (!existsSync(file)) return null
    return normalizePolicy(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

export function writeStoredPolicy(policy) {
  const file = policyFile()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(policy, null, 2)}\n`, 'utf8')
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
                if (body && body.level !== undefined && next.level === undefined) {
                  return send(400, { error: `level 必须是 ${LEVELS.join(' / ')} 之一` })
                }
                try {
                  writeStoredPolicy(next)
                } catch (error) {
                  return send(500, { error: `写策略文件失败：${String((error && error.message) || error)}` })
                }
                try {
                  options.applyPolicy(next)
                } catch (error) {
                  return send(500, { error: `应用策略失败：${String((error && error.message) || error)}` })
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
