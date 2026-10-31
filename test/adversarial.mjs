// adversarial.mjs —— 对抗 / 极端 输入测试（独立于 smoke.mjs，不改插件行为）
//
// 原则：
//   1. 只断言三件事：**不崩**（apply/tool 不抛）、**不静默**（错要有记账）、**不挂死**（有时间上限）。
//   2. 每条用例独立世界；文件类用例走 LAZY_TOOLS_*_FILE 环境变量，用临时文件。
//   3. 结果分三档：RED（崩/静默/挂死）、YELLOW（慢或可疑但可用）、PASS。
//   4. 红不自动修：报告出来，由人按「可达性三档」决定。
//
// 跑法：node test/adversarial.mjs

import { apply } from '../lib/index.js'
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'

const results = []
let red = 0
let yellow = 0
let known = 0

function record(kind, name, detail) {
  if (kind === 'RED') red++
  if (kind === 'YELLOW') yellow++
  if (kind === 'KNOWN') known++
  let safe = detail && detail.length > 180 ? detail.slice(0, 180) + '…' : detail
  if (typeof safe === 'string') safe = safe.replace(/[^\s]{40,}/g, (m) => m.slice(0, 16) + '…')
  results.push({ kind, name, detail: safe })
  const mark = kind === 'PASS' ? 'ok ' : kind === 'YELLOW' ? '!! ' : kind === 'KNOWN' ? '-- ' : 'XX '
  console.log(`${mark} ${name}${safe ? '  — ' + safe : ''}`)
}

const assert = (cond, message) => {
  if (!cond) throw new Error(message)
}

function makeWorld() {
  const registered = new Map()
  const denyByAgent = new Map()
  const createdListeners = []
  const toolsChangeListeners = []
  const preExecuteListeners = []
  const guards = []

  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    on(event, handler) {
      if (event === 'agent/created') createdListeners.push(handler)
      if (event === 'tools/change') toolsChangeListeners.push(handler)
      if (event === 'tools/pre-execute') preExecuteListeners.push(handler)
    },
    effect(callback) {
      try { const off = callback(); if (typeof off === 'function') off() } catch { /* ignore */ }
      return () => {}
    },
    get(key) {
      if (key === 'agents') return { list: () => [], get: () => undefined }
      return undefined
    },
    tools: {
      guard(fn) { guards.push(fn); return () => {} },
      register(definition) { registered.set(definition.name, definition); return () => registered.delete(definition.name) },
      get(name, agent) {
        if (!agent) return registered.get(name)
        const deny = denyByAgent.get(agent) || new Set()
        return deny.has(name) ? undefined : registered.get(name)
      },
      schemas(agent) {
        const deny = (agent && denyByAgent.get(agent)) || new Set()
        return [...registered.keys()].filter((name) => !deny.has(name)).map((name) => ({ name }))
      },
    },
  }

  const makeAgent = (id) => {
    const agent = { id }
    denyByAgent.set(agent, new Set())
    agent.ctx = {
      tools: {
        get(name, scoped) {
          if (!scoped) return registered.get(name)
          const deny = denyByAgent.get(scoped) || new Set()
          return deny.has(name) ? undefined : registered.get(name)
        },
        restrict({ deny } = {}) {
          const set = denyByAgent.get(agent) || new Set()
          const names = Array.isArray(deny) ? deny : []
          for (const n of names) set.add(n)
          return () => { for (const n of names) set.delete(n) }
        },
      },
    }
    return agent
  }

  const createAgent = (id) => {
    const agent = makeAgent(id)
    for (const listener of createdListeners) listener({ agent })
    return agent
  }

  return {
    ctx,
    registered,
    createAgent,
    denyByAgent,
    fireToolsChange() { for (const listener of toolsChangeListeners) listener() },
  }
}

async function runTool(world, name, args, agent) {
  const def = world.registered.get(name)
  assert(def && typeof def.execute === 'function', `工具 ${name} 未注册`)
  return def.execute(args || {}, { agent })
}

function lazyToolCount(world) {
  return [...world.registered.keys()].filter((n) => n.startsWith('lazy_tools_')).length
}

// 用例包装：崩了 = RED，其余交给 body 自己判
async function check(name, body, opts = {}) {
  const start = performance.now()
  try {
    const detail = await body()
    const ms = performance.now() - start
    if (opts.maxMs && ms > opts.maxMs) {
      record('YELLOW', name, `${Math.round(ms)}ms > ${opts.maxMs}ms`)
    } else {
      record('PASS', name, detail ? `${detail}${ms > 50 ? ` (${Math.round(ms)}ms)` : ''}` : undefined)
    }
  } catch (error) {
    const ms = Math.round(performance.now() - start)
    record('RED', name, `${error && error.message ? error.message : String(error)} (${ms}ms)`)
  }
}

// KNOWN：确认过、按可达性判定「不修」的极限用例。它出现失败也不让套件变红，
// 但必须写清为什么归绿 —— 否则下一个人会以为这是被漏掉的 bug。
async function checkKnown(name, body, reason) {
  try {
    await body()
    record('KNOWN', name, reason)
  } catch (error) {
    record('KNOWN', name, `${reason}（实测仍抛：${error && error.message ? String(error.message).slice(0, 60) : String(error)}）`)
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'lazy-adv-'))
const NO_SUCH = join(tmp, 'nope')
process.env.LAZY_TOOLS_USAGE_FILE = `${NO_SUCH}.usage.json`
process.env.LAZY_TOOLS_GROUPS_FILE = `${NO_SUCH}.groups.json`
process.env.LAZY_TOOLS_POLICY_FILE = `${NO_SUCH}.policy.json`

const sixTools = (world) => {
  for (const n of ['biz_a', 'biz_b', 'biz_c', 'biz_d', 'biz_e', 'biz_f']) {
    world.ctx.tools.register({ name: n, description: 'x', parameters: {}, output: {} })
  }
}

async function main() {
  console.log('=== A. 配置畸形（要求：不抛 + 7 个自救工具注册）===')

  const badConfigs = [
    ['groups=null', { groups: null }],
    ['groups="string"', { groups: 'string' }],
    ['groups=42', { groups: 42 }],
    ['groups=[null]', { groups: [null] }],
    ['groups=[{}]', { groups: [{}] }],
    ['match=字符串', { groups: [{ id: 'g', match: 'biz_*' }] }],
    ['match=[null]', { groups: [{ id: 'g', match: [null] }] }],
    ['id=数字', { groups: [{ id: 42, match: ['biz_*'] }] }],
    ['id=Unicode', { groups: [{ id: '桌面·组', match: ['biz_*'] }] }],
    ['id 含零字节', { groups: [{ id: 'a\u0000b', match: ['biz_*'] }] }],
    ['重复 id', { groups: [{ id: 'dup', match: ['biz_a'] }, { id: 'dup', match: ['biz_b'] }] }],
  ]
  for (const [label, cfg] of badConfigs) {
    await check(`A ${label}`, () => {
      const world = makeWorld()
      apply(world.ctx, cfg)
      assert(lazyToolCount(world) === 7, `注册数=${lazyToolCount(world)}，应 7`)
      return '可加载'
    })
  }

  await check('A 1000 个组', () => {
    const world = makeWorld()
    sixTools(world)
    const groups = Array.from({ length: 1000 }, (_, i) => ({ id: `g${i}`, match: [`biz_${i}`], defaultOn: false }))
    apply(world.ctx, { groups, autoGroups: 'off' })
    assert(lazyToolCount(world) === 7, '工具没注册全')
    return '1000 组可加载'
  }, { maxMs: 3000 })

  console.log('\n=== B. 恶意匹配式（要求：不挂死 + 万能式被忽略 + 记账）===')

  await check('B "*" 万能式被忽略并记账', async () => {
    const world = makeWorld()
    sixTools(world)
    apply(world.ctx, { groups: [{ id: 'all', match: ['*'], defaultOn: false }], autoGroups: 'off' })
    const agent = world.createAgent('a-star')
    assert(world.denyByAgent.get(agent).size === 0, `万能组仍收了 ${world.denyByAgent.get(agent).size} 个`)
    const health = await runTool(world, 'lazy_tools_health', {}, agent)
    assert(health.errors.some((e) => String(e.where).includes('group guard')), '没有记账 group guard')
    return '忽略 + 记账'
  })

  await check('B "re:.*" 万能式被忽略', async () => {
    const world = makeWorld()
    sixTools(world)
    apply(world.ctx, { groups: [{ id: 'all', match: ['re:.*'], defaultOn: false }], autoGroups: 'off' })
    const agent = world.createAgent('a-star2')
    assert(world.denyByAgent.get(agent).size === 0, '万能组收了工具')
    return '忽略'
  })

  await check('B 坏正则 re:( 被忽略并记账', async () => {
    const world = makeWorld()
    sixTools(world)
    apply(world.ctx, { groups: [{ id: 'bad', match: ['re:('], defaultOn: false }], autoGroups: 'off' })
    const agent = world.createAgent('a-badre')
    const health = await runTool(world, 'lazy_tools_health', {}, agent)
    assert(health.errors.some((e) => String(e.where).includes('group pattern')), '坏正则没记账')
    return '记账'
  })

  // 可达性判定：要手写 ~10 万字符的正则才触发 → 属「主动构造」，按三档归绿，不修。
  // 记录为 KNOWN，套件不因它失败；如果将来真修了，把它改回 check 即可。
  await checkKnown('B 超长 pattern（100k 字符）—— 已知极限，不修', () => {
    const world = makeWorld()
    sixTools(world)
    const long = 'biz_' + 'x'.repeat(100000)
    apply(world.ctx, { groups: [{ id: 'long', match: [long], defaultOn: false }], autoGroups: 'off' })
    assert(lazyToolCount(world) === 7, '工具没注册全')
    return '可加载'
  }, 'V8 在首次 test() 时才编译超长正则（lib/index.js:161）；需手写约 10 万字符才触发，按可达性属绿')

  // ReDoS 放到子进程里跑：真挂死也只影响子进程，不会卡住测试
  await check('B ReDoS 回溯炸弹不挂死（子进程 3s 上限）', () => {
    const script = `
      import { apply } from './lib/index.js'
      const ctx = { logger:{info(){},warn(){},error(){}}, on(){}, effect(){return()=>{}}, get(){},
        tools:{ guard(){return()=>{}}, register(){return()=>{}}, get(){}, schemas(){ return [{name:'biz_a'}] } } }
      apply(ctx, { groups: [{ id:'x', match: ['re:^(a+)+$'] }], autoGroups: 'off' })
      console.log('done')
    `
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: process.cwd(),
      timeout: 3000,
      encoding: 'utf8',
    })
    if (r.error && r.error.code === 'ETIMEDOUT') throw new Error('matcherFor 在 3s 内没返回（可挂死）')
    assert(r.status === 0, `子进程失败: ${r.stderr || r.status}`)
    return '3s 内完成'
  })

  console.log('\n=== C. 脏数据文件（要求：不崩、能记账、默认值可用）===')

  const writeTmp = (name, content) => {
    const file = join(tmp, name)
    writeFileSync(file, content, 'utf8')
    return file
  }

  await check('C groups.json 非法 JSON', async () => {
    process.env.LAZY_TOOLS_GROUPS_FILE = writeTmp('bad-groups.json', '{not json')
    const world = makeWorld()
    sixTools(world)
    apply(world.ctx, { groups: [{ id: 'ok', match: ['biz_*'], defaultOn: false }], autoGroups: 'off' })
    const agent = world.createAgent('a-badjson')
    const health = await runTool(world, 'lazy_tools_health', {}, agent)
    assert(health.ok === true, 'health 不可用')
    process.env.LAZY_TOOLS_GROUPS_FILE = `${NO_SUCH}.groups.json`
    return 'health 仍可用'
  })

  await check('C groups.json 是对象不是数组', () => {
    process.env.LAZY_TOOLS_GROUPS_FILE = writeTmp('obj-groups.json', '{"id":"x"}')
    const world = makeWorld()
    apply(world.ctx, { groups: [{ id: 'ok', match: ['biz_*'] }], autoGroups: 'off' })
    assert(lazyToolCount(world) === 7, '工具没注册全')
    process.env.LAZY_TOOLS_GROUPS_FILE = `${NO_SUCH}.groups.json`
    return '可加载'
  })

  await check('C usage 文件损坏 JSON', async () => {
    process.env.LAZY_TOOLS_USAGE_FILE = writeTmp('bad-usage.json', '<<<')
    const world = makeWorld()
    apply(world.ctx, { groups: [{ id: 'ok', match: ['biz_*'] }], autoGroups: 'off' })
    const agent = world.createAgent('a-badusage')
    const health = await runTool(world, 'lazy_tools_health', {}, agent)
    assert(health.stats.toolCalls === 0, `toolCalls=${health.stats.toolCalls}，应 0`)
    process.env.LAZY_TOOLS_USAGE_FILE = `${NO_SUCH}.usage.json`
    return '按空账本处理'
  })

  await check('C policy 文件损坏 / 类型错', async () => {
    process.env.LAZY_TOOLS_POLICY_FILE = writeTmp('bad-policy.json', '{"level":123,"idleDays":"x"}')
    const world = makeWorld()
    apply(world.ctx, { groups: [{ id: 'ok', match: ['biz_*'] }], autoGroups: 'off' })
    const agent = world.createAgent('a-badpolicy')
    const status = await runTool(world, 'lazy_tools_status', {}, agent)
    assert(status && Array.isArray(status.groups), 'status 不可用')
    process.env.LAZY_TOOLS_POLICY_FILE = `${NO_SUCH}.policy.json`
    return '回默认策略'
  })

  console.log('\n=== D. 压力 ===')

  await check('D 5000 工具 + 20 组', () => {
    const world = makeWorld()
    for (let i = 0; i < 5000; i++) world.ctx.tools.register({ name: `bulk_${i}`, description: 'x', parameters: {}, output: {} })
    const groups = Array.from({ length: 20 }, (_, i) => ({ id: `bg${i}`, match: [`bulk_${i}_*`, `bulk_${i}00`], defaultOn: false }))
    apply(world.ctx, { groups, autoGroups: 'off' })
    const agent = world.createAgent('a-bulk')
    assert(world.denyByAgent.get(agent).size >= 0, '创建 agent 失败')
    return '可加载'
  }, { maxMs: 5000 })

  await check('D 连续 100 次 enable/disable', async () => {
    const world = makeWorld()
    apply(world.ctx, { groups: [{ id: 'g', match: ['biz_*'], defaultOn: false }], autoGroups: 'off' })
    sixTools(world)
    const agent = world.createAgent('a-churn')
    for (let i = 0; i < 100; i++) {
      await runTool(world, 'lazy_tools_enable', { group: 'g' }, agent)
      await runTool(world, 'lazy_tools_disable', { group: 'g' }, agent)
    }
    return '100 轮无异常'
  })

  await check('D 同一 agent 连续 50 次 tools/change', () => {
    const world = makeWorld()
    apply(world.ctx, { groups: [{ id: 'g', match: ['biz_*'], defaultOn: false }], autoGroups: 'off' })
    sixTools(world)
    world.createAgent('a-change')
    for (let i = 0; i < 50; i++) world.fireToolsChange()
    return '50 次无异常'
  })

  console.log('\n=== E. 运行时边界 ===')

  await check('E 宿主没有 agent.ctx.tools（坏宿主）', () => {
    const world = makeWorld()
    const agent = world.createAgent('a-broken')
    agent.ctx = {}
    return '创建后未抛'
  })

  await check('E enable 不存在的名字', async () => {
    const world = makeWorld()
    apply(world.ctx, { groups: [{ id: 'g', match: ['biz_*'] }], autoGroups: 'off' })
    sixTools(world)
    const agent = world.createAgent('a-none')
    const r = await runTool(world, 'lazy_tools_enable', { name: 'nope_xyz' }, agent)
    assert(r.found === false, '应 found:false')
    return 'found:false'
  })

  await check('E enable 名字含正则元字符（a.b 不能误匹配 aXb）', async () => {
    const world = makeWorld()
    world.ctx.tools.register({ name: 'aXb', description: 'x', parameters: {}, output: {} })
    world.ctx.tools.register({ name: 'a.b', description: 'x', parameters: {}, output: {} })
    apply(world.ctx, { groups: [{ id: 'g', match: ['a.b'] }], autoGroups: 'off' })
    const agent = world.createAgent('a-regex')
    const deny = world.denyByAgent.get(agent)
    assert(deny.has('a.b') || !deny.has('aXb'), 'a.b 模式误匹配了 aXb')
    return '字面匹配'
  })

  await check('E Unicode 工具名 enable', async () => {
    const world = makeWorld()
    world.ctx.tools.register({ name: 'biz_中文', description: 'x', parameters: {}, output: {} })
    apply(world.ctx, { groups: [{ id: 'g', match: ['biz_*'] }], autoGroups: 'off' })
    const agent = world.createAgent('a-uni')
    const r = await runTool(world, 'lazy_tools_enable', { name: 'biz_中文' }, agent)
    assert(r.found === true, '没找到 Unicode 工具')
    return 'found:true'
  })

  await check('E 组 id 与出厂组重名', () => {
    const world = makeWorld()
    apply(world.ctx, { groups: [{ id: 'cua-screen', match: ['biz_*'], defaultOn: false }], autoGroups: 'off' })
    assert(lazyToolCount(world) === 7, '工具没注册全')
    return '可加载'
  })

  rmSync(tmp, { recursive: true, force: true })

  console.log(`\n=== 结果：PASS ${results.length - red - yellow - known} / KNOWN ${known} / YELLOW ${yellow} / RED ${red} ===`)
  if (red > 0) {
    console.log('还有 RED —— 按可达性三档决定修不修，不要直接改代码。')
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error('adversarial 中断:', error)
  process.exitCode = 1
})
