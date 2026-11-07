// 设置页 ↔ 宿主 的 HTTP 桥。策略文件读写已抽到 policy-store.js。
// 这里只保留鉴权、路由、CORS、请求体读取。
import {
  LEVELS,
  policyFile,
  policyFileMtime,
  savePolicy,
} from './policy-store.js'


const MAX_BODY = 64 * 1024
let lastClientPing = null

/** 给健康检查读的客户端心跳快照（没有就是没上报过）。 */
export function clientPing() {
  return lastClientPing
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    // 2026-11-05（元宝挑刺附注）：原来用字符串 += 拼 chunk —— 分块正好切在多字节汉字中间时
    // 会被解成替换字符。先收 Buffer，最后一次性 UTF-8 解码。
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      const room = MAX_BODY - size
      if (room <= 0) return
      const piece = buf.length > room ? buf.subarray(0, room) : buf
      chunks.push(piece)
      size += piece.length
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(JSON.parse(text || '{}'))
      } catch {
        resolve({ __invalidJson: true })
      }
    })
    req.on('error', () => resolve({ __invalidJson: true }))
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

              // 2026-11-05（元宝挑刺 2）：只比 Origin.host === headers.host 挡不住 DNS rebinding
              // —— 攻击者域名解析到 127.0.0.1 时两者天然相等。桥只服务本机，Host 必须是回环。
              const hostHeader = String(headers.host || '').trim()
              const hostOnly = hostHeader.replace(/:\d+$/, '').toLowerCase()
              // IPv6 的 Host 按 RFC 必须带方括号；裸 '::1' 到不了这里（且会被上面的端口剥离搞坏）。
              const loopback = hostOnly === '127.0.0.1' || hostOnly === 'localhost' || hostOnly === '[::1]'
              if (!loopback) {
                return send(403, { error: 'Host must be loopback' })
              }

              // 2026-11-05（外部审阅 C2）：原来只校验「有 Origin 就必须同源」——没有 Origin 的请求
              // 直接放行，于是任何本机进程（或 DNS rebinding 后的页面）都能改策略/改会话工具面。
              // 现在写操作必须带自定义头；跨源页面带不上这个头（会先触发预检，而这里不答 OPTIONS）。
              if (req.method === 'POST' && String(headers['x-lazy-tools'] || '') !== '1') {
                return send(403, { error: 'missing x-lazy-tools header' })
              }
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
                if (body && body.__invalidJson) return send(400, { error: 'invalid json body' })
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
                try {
                  const saved = savePolicy(body, { record: host.record })
                  // 写盘成功后必须追平 mtime，否则下一次 agent/created 会误判外部改过。
                  if (typeof options.setPolicyMtime === 'function') options.setPolicyMtime(policyFileMtime())
                  options.applyPolicy(saved.merged)
                } catch (error) {
                  if (error && error.status) return send(error.status, { error: error.message })
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
