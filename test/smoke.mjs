// 冒烟测试：不依赖 DSH，把 apply() 在一个假宿主上真跑一遍。
//
// 为什么要它：`node --check` 只证明「语法没说错」，证明不了「跑起来对」。
// 这个测试替身实现的是 host.js 假设的那四个契约（register / schemas /
// restrict / agent/created），所以契约一改、这里先红。
//
// 跑法：node test/smoke.mjs   （退出码 0 = 全过）

import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { normalizePolicy } from '../lib/api.js'
import { isHot, recordUsage, LEVEL_DAYS, DAY } from '../lib/usage.js'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 测试隔离：不要让真实用户组文件影响断言。
// 用 tmpdir 拼一个必然不存在的名字 —— 不写死 Windows 用户名（公开仓 + 发布包里都不该出现）。
const NO_SUCH = join(tmpdir(), 'lazy-tools.DOES-NOT-EXIST')
process.env.LAZY_TOOLS_GROUPS_FILE = `${NO_SUCH}.groups.json`
process.env.LAZY_TOOLS_POLICY_FILE = `${NO_SUCH}.policy.json`
// 用量账本也必须隔离：2026-10-29 单工具热度上线后，[12] 因为读到真机账本
// （vision_describe 真的热）而少收了一个工具、断言失败 —— 测试不能看用户的历史。
process.env.LAZY_TOOLS_USAGE_FILE = `${NO_SUCH}.usage.json`

// --quiet：只打汇总和失败项。钩子每次提交都跑它，49 行逐条输出纯属浪费（2026-10-30 加的）。
const quiet = process.argv.includes('--quiet')
const log = quiet ? () => {} : (...args) => console.log(...args)

let checks = 0
function ok(label) {
  checks += 1
  log(`  ok  ${label}`)
}

function assertJsonSafe(value, path = 'value') {
  const stack = [[value, path]]
  const seen = new Set()
  while (stack.length) {
    const [node, where] = stack.pop()
    if (node === undefined) throw new Error(`${where} 是 undefined —— 不是 lossless JSON`)
    if (typeof node === 'function') throw new Error(`${where} 是函数 —— 序列化不了`)
    if (typeof node === 'number' && !Number.isFinite(node)) throw new Error(`${where} 不是有限数字`)
    if (node && typeof node === 'object') {
      if (seen.has(node)) continue
      seen.add(node)
      for (const [key, child] of Object.entries(node)) stack.push([child, `${where}.${key}`])
    }
  }
}

// 假宿主：语义尽量贴近真的 —— schemas(agent) 返回「该 agent 可见」的工具，
// restrict({deny}) 只影响调用它的那个 agent，并把解除函数交回来。
function makeWorld() {
  const registered = new Map()
  const createdListeners = []
  const denyByAgent = new Map()
  const activeByAgent = new Map() // agent -> [{ names }]：当前**真正挂着**的限制（孤儿会在这里露出来）
  // rc.3 的撤销是同步通知的。默认关（不影响其它用例），需要复现重入的用例自己打开。
  let fireOnRestrict = false
  const living = [] // «ctx.get('agents').list()» 返回的东西
  const effects = [] // «ctx.effect(cb)» 收下的回调，插件卸载时 Cordis 会调用它们
  const toolsChangeListeners = []
  const inboxListeners = []
  const preExecuteListeners = []
  const guards = []
  const commands = []
  const unmounted = new Map() // agent -> Set(name)：宿主没挂到该会话的工具（不是我们 restrict 的）

  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    on(event, handler) {
      if (event === 'agent/created') createdListeners.push(handler)
      if (event === 'tools/change') toolsChangeListeners.push(handler)
      if (event === 'agent/inbox/inserted') inboxListeners.push(handler)
      if (event === 'tools/pre-execute') preExecuteListeners.push(handler)
    },
    effect(callback) {
      effects.push(callback)
      return () => {}
    },
    get(key) {
      if (key === 'agents') return { list: () => living, get: (id) => living.find((a) => a && a.id === id) }
      if (key === 'commands') {
        return {
          register(definition) {
            commands.push(definition)
            return () => {}
          },
        }
      }
      return undefined
    },
    tools: {
      guard(fn) {
        guards.push(fn)
        return () => {}
      },

      register(definition) {
        registered.set(definition.name, definition)
        return () => registered.delete(definition.name)
      },
      // 真实宿主：get() 查的是「注册表里有没有」，不受作用域过滤影响
      // （#11207 官方给的 lookup：global 有、agent 有、但 schemas(agent) 里没有 = 被 schemas 层滤了）
      get(name) { return registered.get(name) },
      schemas(agent) {
        const deny = (agent && denyByAgent.get(agent)) || new Set()
        const miss = (agent && unmounted.get(agent)) || new Set()
        return [...registered.keys()].filter((name) => !deny.has(name) && !miss.has(name)).map((name) => ({ name }))
      },
    },
  }

  const makeAgent = (id) => {
    const agent = { id }
    denyByAgent.set(agent, new Set())
    activeByAgent.set(agent, [])
    agent.ctx = {
      tools: {
        get(name) { return registered.get(name) },
        restrict(filter) {
          const deny = denyByAgent.get(agent)
          const added = Array.isArray(filter && filter.deny) ? [...filter.deny] : []
          const entry = { names: added }
          activeByAgent.get(agent).push(entry)
          for (const name of added) deny.add(name)
          // 2026-10-30：rc.3 里「撤销限制」是**同步**通知 tools/change 的。
          // 这条 synchronous 行为正是重入 rebuild 的来源，所以 mock 必须能模拟它（否则测试会假绿）。
          if (fireOnRestrict) fireToolsChange()
          return () => {
            activeByAgent.get(agent).splice(activeByAgent.get(agent).indexOf(entry), 1)
            for (const name of added) deny.delete(name)
            if (fireOnRestrict) fireToolsChange()
          }
        },
      },
    }
    return agent
  }

  const createAgent = (id, setup) => {
    const agent = makeAgent(id)
    living.push(agent)
    // setup 在「第一次 rebuild 之前」跑：用来模拟创建那一刻宿主就没挂载某些工具
    if (typeof setup === 'function') setup(agent)
    for (const listener of createdListeners) listener({ agent })
    return agent
  }

  const fireToolsChange = () => {
    for (const listener of toolsChangeListeners) listener()
  }

  const fireUserMessage = (agent, text) => {
    for (const listener of inboxListeners) {
      listener({ agent, message: { role: 'user', content: [{ type: 'text', text }] } })
    }
  }

  const firePreExecute = async (agent, name) => {
    for (const listener of preExecuteListeners) {
      await listener({ name, agent }, async () => ({ kind: 'allow' }))
    }
  }

  const fireGuard = (agent, name) => {
    let decision
    for (const guard of guards) {
      const result = guard({ name, agent })
      if (result) decision = result
    }
    return decision
  }

  // 模拟「宿主没把这个工具挂到该会话」：和「我们 restrict 掉」不是一回事 ——
  // 前者从来没进过工具表（如 cua_driver_native__* 自 DSH 2.0.20 起），后者是我们收的。
  const unmount = (agent, names) => {
    if (!unmounted.has(agent)) unmounted.set(agent, new Set())
    const miss = unmounted.get(agent)
    for (const name of names) miss.add(name)
    return () => {
      for (const name of names) miss.delete(name)
    }
  }

  return {
    ctx,
    fireGuard,
    unmount,
    commands,
    firePreExecute,
    registered,
    denyByAgent,
    activeByAgent,
    // 打开它 = mock 的 restrict 在「加上」和「解除」时都同步 fireToolsChange（rc.3 的行为）
    setSyncRestrictEvents(value) {
      fireOnRestrict = !!value
    },
    /** 当前真正挂着的限制列表（孤儿 = 比预期多出来的那条） */
    activeRestrictions(agent) {
      return activeByAgent.get(agent) || []
    },
    /** 该 agent 现在可见的工具名（= schemas(agent) 的名字） */
    visibleNames(agent) {
      const deny = denyByAgent.get(agent) || new Set()
      const miss = unmounted.get(agent) || new Set()
      return [...registered.keys()].filter((name) => !deny.has(name) && !miss.has(name))
    },
    createAgent,
    makeAgent,
    living,
    createdListeners,
    effects,
    toolsChangeListeners,
    inboxListeners,
    fireToolsChange,
    fireUserMessage,
  }
}

async function runTool(world, name, args, agent) {
  const definition = world.registered.get(name)
  assert.ok(definition, `工具 ${name} 没注册上`)
  assert.equal(typeof definition.execute, 'function', `${name}.execute 不是函数`)
  return definition.execute(args || {}, { agent })
}

async function main() {
  log('[1] 载入与注册')
  const world = makeWorld()
  // 宿主全局工具：两个属于 cua 组，一个不属于
  world.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  world.ctx.tools.register({ name: 'cua_driver_native__b', description: 'x', parameters: {}, output: {} })
  world.ctx.tools.register({ name: 'other_tool', description: 'x', parameters: {}, output: {} })

  apply(world.ctx, {
    groups: [
      { id: 'cua', match: ['cua_driver_native__*'], title: '桌面自动化', defaultOn: false },
      { id: 'idle', match: ['other_tool'], title: '默认开', defaultOn: true },
    ],
  })
  for (const name of ['lazy_tools_status', 'lazy_tools_enable', 'lazy_tools_disable', 'lazy_tools_scan', 'lazy_tools_list', 'lazy_tools_resolve', 'lazy_tools_mode', 'lazy_tools_health', 'lazy_tools_classify', 'lazy_tools_save_groups', 'lazy_tools_bench']) {
    assert.ok(world.registered.has(name), `缺工具 ${name}`)
  }
  ok('十一个工具都注册上了')

  log('[2] agent 创建时按 defaultOn 收起')
  const agent = world.createAgent('agent-1')
  const deny = world.denyByAgent.get(agent)
  assert.deepEqual([...deny].sort(), ['cua_driver_native__a', 'cua_driver_native__b'])
  ok('cua 组两个工具被 restrict 掉，defaultOn:true 的组没动')

  const statusAfterCreate = await runTool(world, 'lazy_tools_status', {}, agent)
  assertJsonSafe(statusAfterCreate, 'status')
  const cua = statusAfterCreate.groups.find((g) => g.id === 'cua')
  assert.equal(cua.on, false)
  assert.equal(cua.mode, 'hide')
  assert.equal(cua.matched, 2) // 组里共几个（含被收起的）
  assert.equal(cua.visible, 0)
  ok('status 报 cua: on=false mode=hide, matched=2, visible=0')

  log('[3] enable / disable 往返')
  const enabled = await runTool(world, 'lazy_tools_enable', { group: 'cua' }, agent)
  assert.deepEqual(enabled, { enabled: 'cua' })
  assert.equal(world.denyByAgent.get(agent).size, 0)
  const afterEnable = await runTool(world, 'lazy_tools_status', {}, agent)
  assert.equal(afterEnable.groups.find((g) => g.id === 'cua').mode, 'all')
  assert.equal(afterEnable.groups.find((g) => g.id === 'cua').matched, 2)
  assert.equal(afterEnable.groups.find((g) => g.id === 'cua').visible, 2)
  ok('enable 之后限制解除、两个工具回来')

  log('[3a] only：只放指定的几个工具')
  const onlyResult = await runTool(world, 'lazy_tools_enable', { group: 'cua', only: ['cua_driver_native__a'] }, agent)
  assert.deepEqual(onlyResult, { enabled: 'cua', only: ['cua_driver_native__a'] })
  assert.deepEqual([...world.denyByAgent.get(agent)].sort(), ['cua_driver_native__b'])
  const onlyStatus = await runTool(world, 'lazy_tools_status', {}, agent)
  const onlyGroup = onlyStatus.groups.find((g) => g.id === 'cua')
  assert.equal(onlyGroup.mode, 'only')
  assert.equal(onlyGroup.onlyCount, 1)
  assert.equal(onlyGroup.visible, 1)
  const badOnly = await runTool(world, 'lazy_tools_enable', { group: 'cua', only: ['other_tool'] }, agent)
  assert.match(badOnly.error, /不属于组/)
  const emptyOnly = await runTool(world, 'lazy_tools_enable', { group: 'cua', only: [] }, agent)
  assert.match(emptyOnly.error, /不能是空数组/)
  ok('only 白名单生效、越界/空数组都被拒（没抛异常）')

  const disabled = await runTool(world, 'lazy_tools_disable', { group: 'cua' }, agent)
  assert.deepEqual(disabled, { disabled: 'cua' })
  assert.equal(world.denyByAgent.get(agent).size, 2)
  const afterOff = await runTool(world, 'lazy_tools_status', {}, agent)
  assert.equal(afterOff.groups.find((g) => g.id === 'cua').mode, 'hide')
  ok('disable 之后限制重新挂上，mode 回到 hide（only 被清掉）')

  const badGroup = await runTool(world, 'lazy_tools_enable', { group: 'nope' }, agent)
  assert.match(badGroup.error, /unknown group/)
  ok('未知组返回 error 而不是抛异常')

  log('[3b] list：组关着也认得名字、开着标可见')
  const listWhileOff = await runTool(world, 'lazy_tools_list', { group: 'cua' }, agent)
  assert.equal(listWhileOff.count, 2)
  assert.equal(listWhileOff.visible, 0)
  await runTool(world, 'lazy_tools_enable', { group: 'cua' }, agent)
  const listWhileOn = await runTool(world, 'lazy_tools_list', { group: 'cua' }, agent)
  assert.deepEqual(listWhileOn.names, ['cua_driver_native__a', 'cua_driver_native__b'])
  assert.equal(listWhileOn.visible, 2)
  const listAll = await runTool(world, 'lazy_tools_list', {}, agent)
  assert.equal(listAll.group, null)
  assert.ok(listAll.names.includes('lazy_tools_health'))
  await runTool(world, 'lazy_tools_disable', { group: 'cua' }, agent)
  ok('list 行为正确（关=知道但不可见、开=可见、省略组=全部已知）')

  log('[3c] re: 前缀的正则匹配式')
  const worldRe = makeWorld()
  worldRe.ctx.tools.register({ name: 'cua_driver_native__get_x', description: 'x', parameters: {}, output: {} })
  worldRe.ctx.tools.register({ name: 'cua_driver_native__click', description: 'x', parameters: {}, output: {} })
  apply(worldRe.ctx, {
    groups: [
      { id: 'screen', match: ['re:^cua_driver_native__(get_|list_)'], defaultOn: false },
      { id: 'input', match: ['re:^cua_driver_native__click$'], defaultOn: false },
    ],
  })
  const agentRe = worldRe.createAgent('agent-re')
  assert.deepEqual([...worldRe.denyByAgent.get(agentRe)].sort(), ['cua_driver_native__click', 'cua_driver_native__get_x'])
  const reStatus = await runTool(worldRe, 'lazy_tools_status', {}, agentRe)
  assert.equal(reStatus.groups.find((g) => g.id === 'screen').matched, 1)
  assert.equal(reStatus.groups.find((g) => g.id === 'input').matched, 1)
  ok('re: 正则分组可用（screen 1 / input 1）')

  log('[4] scan / health 的输出')
  const scan = await runTool(world, 'lazy_tools_scan', {}, agent)
  assertJsonSafe(scan, 'scan')
  // 可见 = 插件自己的 11 个工具 + other_tool；两个 cua 工具此刻仍被收着
  assert.equal(scan.total, 12, `可见数不对：${JSON.stringify(scan.buckets.map((b) => b.prefix))}`)
  assert.equal(scan.buckets.some((b) => b.prefix === 'cua_driver_native'), false)
  ok('scan 输出 JSON-safe，total 对得上当前可见数，且没有 cua 前缀')

  const health = await runTool(world, 'lazy_tools_health', {}, agent)
  assertJsonSafe(health, 'health')
  assert.equal(health.ok, true, `health 说契约不全：${JSON.stringify(health.contracts)}`)
  assert.equal(health.contracts.length, 4)
  assert.equal(health.stats.agentCreated, 1)
  assert.equal(health.stats.restrictFailures, 0)
  assert.equal(health.stats.lastHidden.hidden, 2)
  ok('health: 四个契约全绿，agentCreated=1，lastHidden=2')

  log('[5] 契约缺失时不崩')
  const brokenWorld = makeWorld()
  brokenWorld.ctx.tools = {} // 没有 register / schemas
  apply(brokenWorld.ctx, {})
  brokenWorld.createAgent('agent-broken')
  assert.equal(brokenWorld.registered.size, 0)
  ok('宿主缺 register/schemas 时 apply 不抛（插件不炸启动）')

  log('[6] restrict 拒绝时记账，不阻断')
  const world2 = makeWorld()
  apply(world2.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] })
  world2.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  const agent2 = world2.createAgent('agent-2')
  agent2.ctx.tools = {
    restrict() {
      throw new Error('host scoped restriction cannot hide own-scope tools')
    },
  }
  await runTool(world2, 'lazy_tools_disable', { group: 'cua' }, agent2)
  const health2 = await runTool(world2, 'lazy_tools_health', {}, agent2)
  assertJsonSafe(health2, 'health2')
  assert.equal(health2.stats.restrictFailures, 1)
  assert.ok(health2.errors.some((e) => e.where === 'tools.restrict'))
  ok('restrict 抛错被记账（restrictFailures=1），工具仍可用')

  log('[7] 重载补应用：apply 时已经活着的 agent 也要被收')
  const world3 = makeWorld()
  world3.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  const alive = world3.makeAgent('agent-alive')
  world3.living.push(alive) // 插件加载之前就存在的 agent
  apply(world3.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] })
  assert.equal(world3.denyByAgent.get(alive).size, 1)
  ok('apply 时把限制补到已存在的 agent（不用等 agent/created 再触发一次）')

  log('[8] 插件卸载/重载：限制必须随 ctx.effect 一起解除（不留孤儿）')
  const world4 = makeWorld()
  world4.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  apply(world4.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] })
  const agent4 = world4.createAgent('agent-dispose')
  assert.equal(world4.denyByAgent.get(agent4).size, 1)
  const disposers = world4.effects.map((callback) => callback())
  for (const dispose of disposers) if (typeof dispose === 'function') dispose()
  assert.equal(world4.denyByAgent.get(agent4).size, 0)
  for (const dispose of disposers) if (typeof dispose === 'function') dispose() // 二次解除必须空操作
  ok('卸载时限制被解除干净，重复解除不抛')

  log('[9] 常驻提示段：systemPrompt 在就挂一段，不在就跳过')
  const world5 = makeWorld()
  const sections = []
  world5.ctx.inject = (deps, callback) => {
    assert.deepEqual(deps, ['systemPrompt'])
    callback({
      effect: (make) => make(),
      systemPrompt: {
        section(section) {
          sections.push(section)
          return () => {}
        },
      },
    })
  }
  apply(world5.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] })
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'lazy-tools:groups')
  const promptText = sections[0].text()
  assert.match(promptText, /lazy_tools_status/)
  assert.match(promptText, /cua/)
  ok('systemPrompt 段已挂上，正文包含组 id 与排查入口')

  log('[10] 漏网与 expect 计数')
  const world6 = makeWorld()
  world6.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  world6.ctx.tools.register({ name: 'cua_driver_native__b', description: 'x', parameters: {}, output: {} })
  // 这条名字长得像同族、但正则没覆盖到 —— 模拟「上游升级新增工具」
  world6.ctx.tools.register({ name: 'cua_driver_native__newone', description: 'x', parameters: {}, output: {} })
  apply(world6.ctx, { groups: [{ id: 'cua', match: ['re:^cua_driver_native__(a|b)$'], defaultOn: false, expect: 2 }] })
  const agent6 = world6.createAgent('agent-stray')
  const health6 = await runTool(world6, 'lazy_tools_health', {}, agent6)
  assertJsonSafe(health6, 'health6')
  assert.ok(health6.stray.includes('cua_driver_native__newone'), `stray 没抓到：${JSON.stringify(health6.stray)}`)
  assert.ok(health6.warnings.some((w) => w.includes('漏网')))
  assert.equal(health6.healthy, false)
  ok('漏网工具被 stray 抓到、healthy 变 false')

  const world7 = makeWorld()
  world7.ctx.tools.register({ name: 'x_a', description: 'x', parameters: {}, output: {} })
  apply(world7.ctx, { groups: [{ id: 'x', match: ['re:^x_'], defaultOn: false, expect: 5 }] })
  const agent7 = world7.createAgent('agent-expect')
  const health7 = await runTool(world7, 'lazy_tools_health', {}, agent7)
  assert.equal(health7.groups[0].expect, 5)
  assert.equal(health7.groups[0].expectOk, false)
  assert.equal(health7.warnings.some((w) => w.includes('expect 5')), true)
  ok('expect 对不上会报警（matched 1 ≠ expect 5）')

  // 常驻工具（keep）不算漏网 —— 2026-10-23 真机首测就栽在这上面
  const world7b = makeWorld()
  world7b.ctx.tools.register({ name: 'browser_hidden', description: 'x', parameters: {}, output: {} })
  world7b.ctx.tools.register({ name: 'browser_keeper', description: 'x', parameters: {}, output: {} })
  apply(world7b.ctx, {
    groups: [{ id: 'b', match: ['re:^browser_(?!keeper$)'], keep: ['browser_keeper'], defaultOn: false, expect: 1 }],
  })
  const agent7b = world7b.createAgent('agent-keep')
  const health7b = await runTool(world7b, 'lazy_tools_health', {}, agent7b)
  assert.deepEqual(health7b.stray, [])
  assert.equal(health7b.healthy, true)
  ok('写在 keep 里的常驻工具不会被误报成漏网')

  log('[11] tools/change：后注册的工具会触发补收起')
  const world8 = makeWorld()
  apply(world8.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] })
  const agent8 = world8.createAgent('agent-change')
  world8.ctx.tools.register({ name: 'cua_driver_native__late', description: 'x', parameters: {}, output: {} })
  assert.equal(world8.denyByAgent.get(agent8).has('cua_driver_native__late'), false)
  world8.fireToolsChange()
  assert.equal(world8.denyByAgent.get(agent8).has('cua_driver_native__late'), true)
  ok('插件后于工具加载时，tools/change 会把新工具补收进来')

  log('[12] 批量开关与用量统计')
  const world9 = makeWorld()
  world9.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  world9.ctx.tools.register({ name: 'vision_describe', description: 'x', parameters: {}, output: {} })
  apply(world9.ctx, {
    groups: [
      { id: 'cua', match: ['cua_driver_native__*'], defaultOn: false },
      { id: 'vision', match: ['re:^vision_'], defaultOn: false },
    ],
  })
  const agent9 = world9.createAgent('agent-batch')
  assert.equal(world9.denyByAgent.get(agent9).size, 2)
  const batch = await runTool(world9, 'lazy_tools_enable', { groups: ['cua', 'vision'] }, agent9)
  assert.deepEqual(batch.enabled, ['cua', 'vision'])
  assert.equal(world9.denyByAgent.get(agent9).size, 0)
  const badBatchOnly = await runTool(world9, 'lazy_tools_enable', { groups: ['cua', 'vision'], only: ['x'] }, agent9)
  assert.match(badBatchOnly.error, /只能配单个组/)
  const noSelector = await runTool(world9, 'lazy_tools_enable', {}, agent9)
  assert.match(noSelector.error, /group 或 groups/)
  const health9 = await runTool(world9, 'lazy_tools_health', {}, agent9)
  assertJsonSafe(health9, 'health9')
  assert.ok(health9.usage.some((u) => u.id === 'cua' && u.enables === 1), JSON.stringify(health9.usage))
  ok('批量 enable 生效、only+多组被拒、usage 记账')

  log('[13] 作用域已销毁：不算失败，但必须标 applied=no')
  const worldA = makeWorld()
  worldA.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  apply(worldA.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] })
  const agentA = worldA.createAgent('agent-dead')
  agentA.ctx.tools = {
    restrict() {
      throw new Error('cannot create effect on inactive context')
    },
  }
  await runTool(worldA, 'lazy_tools_disable', { group: 'cua' }, agentA)
  const healthA = await runTool(worldA, 'lazy_tools_health', {}, agentA)
  assertJsonSafe(healthA, 'healthA')
  assert.equal(healthA.stats.restrictFailures, 0)
  assert.equal(healthA.stats.lastHidden.applied, false)
  assert.ok(healthA.errors.some((e) => e.where.includes('agent 已销毁')), JSON.stringify(healthA.errors))
  // 2026-10-30 实测抓到的回归：这条记录曾把 healthy 拖成 false（subagent 销毁后每轮报 unhealthy）。
  // 修法是「记录保留、但不参与 healthy 判定」——所以这条断言必须在这里，[13] 才算真的守住。
  assert.equal(healthA.healthy, true, '销毁竞态不许把 healthy 拖成 false')
  ok('已销毁作用域的竞争不计失败，lastHidden.applied=false')

  log('[14] 同一进程内重新 apply：先收回旧限制再重建（不留孤儿）')
  const worldB = makeWorld()
  worldB.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  const reapplyCfg = { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] }
  apply(worldB.ctx, reapplyCfg)
  const agentB = worldB.createAgent('agent-reapply')
  assert.equal(worldB.denyByAgent.get(agentB).size, 1)
  // 模拟「改配置 → 重新 apply」：模块没重载，但 apply 又跑了一次
  apply(worldB.ctx, reapplyCfg)
  assert.equal(worldB.denyByAgent.get(agentB).size, 1)
  const statusB = await runTool(worldB, 'lazy_tools_status', {}, agentB)
  assert.equal(statusB.groups.find((g) => g.id === 'cua').matched, 1)
  ok('重新 apply 时旧限制被收回再重建，state 能重新看见工具（matched=1）')

  log('[15] resolve：按名字一步开启')
  const worldC = makeWorld()
  worldC.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  worldC.ctx.tools.register({ name: 'cua_driver_native__b', description: 'x', parameters: {}, output: {} })
  apply(worldC.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] })
  const agentC = worldC.createAgent('agent-resolve')
  assert.equal(worldC.denyByAgent.get(agentC).size, 2)
  const r1 = await runTool(worldC, 'lazy_tools_resolve', { name: 'cua_driver_native__a' }, agentC)
  assert.equal(r1.found, true)
  assert.equal(r1.applied, true)
  assert.equal(r1.group, 'cua')
  assert.equal(worldC.denyByAgent.get(agentC).has('cua_driver_native__a'), false)
  assert.equal(worldC.denyByAgent.get(agentC).has('cua_driver_native__b'), true)
  const r2 = await runTool(worldC, 'lazy_tools_resolve', { name: 'native__b' }, agentC)
  assert.equal(r2.found, true)
  assert.equal(r2.tool, 'cua_driver_native__b')
  const r3 = await runTool(worldC, 'lazy_tools_resolve', { name: 'nope_xyz' }, agentC)
  assert.equal(r3.found, false)
  ok('resolve：一步开一个（only 语义）、片段能匹配、找不到给提示')

  log('[16] 关键词预开：用户说了 autoHints 里的词，工具自己出现')
  const worldE = makeWorld()
  worldE.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  apply(worldE.ctx, {
    groups: [{ id: 'desktop', match: ['cua_driver_native__*'], autoHints: ['截图', '看窗口'], defaultOn: false }],
  })
  const agentE = worldE.createAgent('agent-auto')
  assert.equal(worldE.denyByAgent.get(agentE).size, 1)
  worldE.fireUserMessage(agentE, '帮我截图看看这个窗口')
  assert.equal(worldE.denyByAgent.get(agentE).size, 0)
  const autoHealth = await runTool(worldE, 'lazy_tools_health', {}, agentE)
  assert.equal(autoHealth.stats.autoOpened, 1)
  assert.equal(autoHealth.stats.userMessages, 1)
  ok('命中 autoHints → 自动开组，health 记 autoOpened=1 / userMessages=1')

  log('[17] 设置页策略文件：只收认识的键')
  assert.deepEqual(normalizePolicy({ level: 'high', idleDays: 7, minTools: 2, showDock: true, showClear: true }), {
    level: 'high',
    idleDays: 7,
    minTools: 2,
    showDock: true,
    showClear: true,
  })
  assert.deepEqual(normalizePolicy({ level: 'turbo', idleDays: -1, minTools: 'x' }), {})
  assert.deepEqual(normalizePolicy({ presets: { low: 10, medium: 5, high: 2 } }), { presets: { low: 10, medium: 5, high: 2 } })
  assert.deepEqual(normalizePolicy({ presets: { low: 10, medium: 5 } }), {})
  assert.deepEqual(normalizePolicy(null), {})
  ok('非法的 level/天数/工具数被丢弃，字符串数组过滤干净')

  log('[18] 用量账本：热/冷判定')
  assert.deepEqual(LEVEL_DAYS, { low: 14, medium: 7, high: 3 })
  const usage = { groups: {}, tools: {} }
  const stamp = Date.now()
  recordUsage(usage, 'vision_ocr', 'vision-heavy', new Date(stamp - 2 * DAY))
  assert.equal(isHot(usage, 'vision-heavy', 7, stamp), true)
  assert.equal(isHot(usage, 'vision-heavy', 1, stamp), false)
  assert.equal(isHot(usage, 'browser-heavy', 7, stamp), false)
  assert.equal(isHot(usage, 'browser-heavy', 0, stamp), true)
  recordUsage(usage, 'dsh_browser_open', null, new Date(stamp))
  assert.equal(typeof usage.tools.dsh_browser_open, 'string')
  assert.equal(usage.groups.dsh_browser_open, undefined)
  ok('7 天内用过=热、1 天阈值=冷、无记录=冷、阈值 0=恒热、无组工具只记工具名')

  log('[19] 用量落盘：调用一次 → 账本有记录、组变热')
  const usagePath = join(tmpdir(), `lazy-tools-usage-${process.pid}.json`)
  process.env.LAZY_TOOLS_USAGE_FILE = usagePath
  const worldF = makeWorld()
  worldF.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  apply(worldF.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] })
  const agentF = worldF.createAgent('agent-usage')
  await worldF.firePreExecute(agentF, 'cua_driver_native__a')
  const rawUsage = JSON.parse(readFileSync(usagePath, 'utf8'))
  assert.equal(typeof rawUsage.groups.cua, 'string')
  assert.equal(typeof rawUsage.tools.cua_driver_native__a, 'string')
  const statusF = await runTool(worldF, 'lazy_tools_status', {}, agentF)
  assert.equal(statusF.groups.find((g) => g.id === 'cua').hot, true)
  rmSync(usagePath, { force: true })
  process.env.LAZY_TOOLS_USAGE_FILE = `${NO_SUCH}.usage.json`
  ok('pre-execute 记账 → usage 文件写出组时间戳、status.hot=true')
  log('[20] 会话级覆盖：lazy_tools_mode 立刻重算默认开哪些组')
  const worldG = makeWorld()
  worldG.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  apply(worldG.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] })
  const agentG = worldG.createAgent('agent-mode')
  assert.equal(worldG.denyByAgent.get(agentG).size, 1)
  const modeAll = await runTool(worldG, 'lazy_tools_mode', { idleDays: 0 }, agentG)
  assert.equal(modeAll.session.source, 'session')
  assert.equal(worldG.denyByAgent.get(agentG).size, 0)
  const modeReset = await runTool(worldG, 'lazy_tools_mode', { reset: true }, agentG)
  assert.equal(modeReset.session.source, 'global')
  assert.equal(worldG.denyByAgent.get(agentG).size, 1)
  ok('idleDays:0 → 全开；reset → 回全局（无历史 ⇒ 又收起）')

  log('[21] 自愈守卫：被藏工具的调用被拦下、自动补开')
  const worldH = makeWorld()
  worldH.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  apply(worldH.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] })
  const agentH = worldH.createAgent('agent-heal')
  const decision = worldH.fireGuard(agentH, 'cua_driver_native__a')
  assert.equal(typeof decision, 'string')
  assert.match(decision, /已自动为你打开/)
  assert.equal(worldH.denyByAgent.get(agentH).has('cua_driver_native__a'), false)
  const healthH = await runTool(worldH, 'lazy_tools_health', {}, agentH)
  assert.equal(healthH.stats.selfHealed, 1)
  ok('守卫拦下 + 补开该工具 + health.selfHealed=1')
  log('[22] 斜杠命令 /lazy-tools：改当前会话、乱输入报错')
  const worldI = makeWorld()
  worldI.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  apply(worldI.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] })
  const agentI = worldI.createAgent('agent-cmd')
  const command = worldI.commands.find((item) => item.name === 'lazy-tools')
  assert.ok(command, '斜杠命令没注册')
  const okResult = command.handler({ agent: agentI, rawInput: 'high' })
  assert.equal(okResult.kind, 'success')
  assert.match(okResult.text, /档位 high/)
  const stateResult = command.handler({ agent: agentI, rawInput: '' })
  assert.match(stateResult.text, /工具抽屉/)
  const badResult = command.handler({ agent: agentI, rawInput: 'bogus' })
  assert.equal(badResult.kind, 'error')
  ok('/lazy-tools high 生效；无参数读状态；乱输入报错')
  log('[23] 清空之后还能自己捞回来（设计红线）')
  const worldJ = makeWorld()
  worldJ.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  worldJ.ctx.tools.register({ name: 'cua_driver_native__b', description: 'x', parameters: {}, output: {} })
  apply(worldJ.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] })
  const agentJ = worldJ.createAgent('agent-restore')
  await runTool(worldJ, 'lazy_tools_enable', { group: 'cua' }, agentJ)
  assert.equal(worldJ.denyByAgent.get(agentJ).size, 0)
  await runTool(worldJ, 'lazy_tools_mode', { collapse: true }, agentJ)
  assert.equal(worldJ.denyByAgent.get(agentJ).size, 2)
  const resolvedBack = await runTool(worldJ, 'lazy_tools_resolve', { name: 'cua_driver_native__a' }, agentJ)
  assert.equal(resolvedBack.applied, true)
  assert.equal(worldJ.denyByAgent.get(agentJ).has('cua_driver_native__a'), false)
  await runTool(worldJ, 'lazy_tools_enable', { group: 'cua' }, agentJ)
  assert.equal(worldJ.denyByAgent.get(agentJ).size, 0)
  ok('立刻清空 → resolve 单个 / enable 整组 都能捞回')
  log('[24] 三处名字必须一致（2026-10-24 五次恢复模式的根因）')
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const clientSrc = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
    const patchSrc = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    const clientId = (clientSrc.match(/__ModuleLoader__[\s\S]{0,60}?id:\s*'([^']+)'/) || [])[1]
    const rowName = (patchSrc.match(/^\s*name:\s*(\S+)\s*$/m) || [])[1]
    assert.ok(clientId, 'client.js 里找不到 __ModuleLoader__.load 的 id')
    assert.ok(rowName, 'cordis.patch.yml 里找不到行名 name')
    assert.equal(clientId, pkg.name, `客户端 id(${clientId}) ≠ 包名(${pkg.name})：改名必须三处同改`)
    assert.equal(rowName, pkg.name, `patch 行名(${rowName}) ≠ 包名(${pkg.name})：改名必须三处同改`)
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/, '版本号不是 x.y.z')
    assert.ok(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch, 'package.json 缺 dsh.bundle.patch，装不上')
    ok('包名 / 客户端 id / patch 行名三处一致；版本号合法；bundle 声明在')
    log('[25] 自动分组：切分、白名单、80% 规则、上限')
    const { tokenize, suggestGroups, matchPattern, normalizeAutoMode } = await import('../lib/autogroups.js')
    assert.deepEqual(tokenize('cua_driver_native__list_apps'), ['cua_driver_native'])
    assert.deepEqual(tokenize('mnemon_view_route'), ['mnemon', 'view', 'route'])
    assert.deepEqual(tokenize('read'), ['read'])
    assert.equal(matchPattern(['mnemon']), 're:^mnemon(_|__|$)')
    assert.equal(normalizeAutoMode('bogus', 'on'), 'on')
    // 2026-10-29 改：兜底从 'suggest' 变 'on'（'suggest' 等于功能不存在）
    assert.equal(normalizeAutoMode(undefined, undefined), 'on')
    assert.equal(normalizeAutoMode('suggest'), 'suggest', '显式 suggest 仍然尊重')

    const many = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}_t${i}`)
    const names = [
      ...many('mnemon', 17),
      ...many('schedule', 4),
      ...many('job', 3),
      ...many('lazy_tools', 8),      // 核心（自救工具）→ 白名单
      'read', 'read_page', 'read_image', // read 是核心 → 只剩 2 个，不足数
      ...many('dsh_browser', 5),     // 已被现有组覆盖
      ...many('mix', 4),             // 一半会被"现有组"吃掉 → 80% 规则淘汰
    ]
    const covered = (name) => name.startsWith('dsh_browser_') || name === 'mix_t0' || name === 'mix_t1'
    const report = suggestGroups(names, covered, { minTools: 3 })
    const ids = report.suggestions.map((item) => item.id)
    assert.ok(ids.includes('auto-mnemon'), 'mnemon 应被识别')
    assert.ok(ids.includes('auto-schedule'), 'schedule 应被识别')
    assert.ok(ids.includes('auto-job'), 'job 应被识别')
    assert.ok(!ids.includes('auto-lazy-tools'), '核心工具族不该入组')
    assert.ok(!ids.includes('auto-read'), '核心 read 占掉名额后不足数，不该入组')
    assert.ok(!ids.includes('auto-dsh-browser'), '已被覆盖的族不该重复建组')
    assert.ok(!ids.includes('auto-mix'), '覆盖比例过高的族应被 80% 规则淘汰')
    const mnemon = report.suggestions.find((item) => item.id === 'auto-mnemon')
    assert.equal(mnemon.expect, 17)
    assert.deepEqual(mnemon.tools.slice(0, 2), ['mnemon_t0', 'mnemon_t1'])
    const capped = suggestGroups(names, covered, { minTools: 3, maxGroups: 1 })
    assert.equal(capped.suggestions.length, 1, 'maxGroups 应生效')
    ok('切分 / 白名单 / 覆盖淘汰 / 数量上限 都对')
    log('[26] 自动分组：子族覆盖不足时不许拆大族（mnemon 17 不该碎成两个 3）')
    const realish = [
      'mnemon_memory_body_create', 'mnemon_memory_body_merge', 'mnemon_memory_body_update',
      'mnemon_document_create', 'mnemon_document_manage', 'mnemon_document_search',
      'mnemon_view_route', 'mnemon_view_action', 'mnemon_recall', 'mnemon_remember',
      'mnemon_related', 'mnemon_forget', 'mnemon_status', 'mnemon_memory_bodies',
      'mnemon_subagent_result', 'mnemon_link', 'mnemon_view_action_extra',
    ]
    const collapsed = suggestGroups(realish, () => false, { minTools: 3 })
    const mn = collapsed.suggestions.find((item) => item.id === 'auto-mnemon')
    assert.ok(mn, 'mnemon 应作为一整族出现')
    assert.equal(mn.expect, 17, '整族数量应为 17')
    assert.ok(!collapsed.suggestions.some((item) => item.id.startsWith('auto-mnemon-')), '不该碎成子族')
    ok('子族覆盖不足 80% 时保留整族')
    log('[27] autoGroups=on：真的建组并按规则收起')
    const worldAuto = makeWorld()
    for (const name of ['smokefam_alpha', 'smokefam_beta', 'smokefam_gamma', 'smokefam_delta']) {
      worldAuto.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
    }
    apply(worldAuto.ctx, { groups: [], autoGroups: 'on' })
    const agentAuto = worldAuto.createAgent('agent-auto')
    const statusAuto = await runTool(worldAuto, 'lazy_tools_status', {}, agentAuto)
    const autoGroup = statusAuto.groups.find((group) => group.id === 'auto-smokefam')
    assert.ok(autoGroup, '应自动创建 auto-smokefam')
    assert.equal(autoGroup.matched, 4)
    assert.equal(worldAuto.denyByAgent.get(agentAuto).has('smokefam_alpha'), true, '应默认收起')
    ok('自动组已创建且默认收起')
    log('[28] 冷启动顺序：apply 时没工具，会话开始才注册 → 仍要建出自动组')
    const worldRace = makeWorld()
    apply(worldRace.ctx, { groups: [], autoGroups: 'on' })   // 此刻一个工具都没有
    for (const name of ['latefam_a', 'latefam_b', 'latefam_c']) {
      worldRace.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
    }
    const agentRace = worldRace.createAgent('agent-late')      // 会话开始，工具已就位
    const statusLate = await runTool(worldRace, 'lazy_tools_status', {}, agentRace)
    const lateGroup = statusLate.groups.find((group) => group.id === 'auto-latefam')
    assert.ok(lateGroup, '延迟注册的工具族也要能建组')
    assert.equal(lateGroup.matched, 3)
    ok('会话开始时补算生效')
    log('[29] extraGroups：追加而不替换默认四组')
    const worldExtra = makeWorld()
    for (const name of ['list_windows', 'get_window_state', 'click', 'type_text', 'launch_app']) {
      worldExtra.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
    }
    apply(worldExtra.ctx, {
      extraGroups: [
        { id: 'cu-observe', match: ['list_windows', 'get_window_state'], title: '电脑·看', defaultOn: false },
        { id: 'cu-act', match: ['click', 'type_text', 'launch_app'], title: '电脑·动', defaultOn: false },
      ],
    })
    const agentExtra = worldExtra.createAgent('agent-extra')
    const statusExtra = await runTool(worldExtra, 'lazy_tools_status', {}, agentExtra)
    const extraIds = statusExtra.groups.map((g) => g.id)
    assert.ok(extraIds.includes('cu-observe') && extraIds.includes('cu-act'), '追加组应在列表里')
    assert.ok(extraIds.includes('cua-screen') && extraIds.includes('cua-input'), '内置默认组不该被冲掉')
    const observe = statusExtra.groups.find((g) => g.id === 'cu-observe')
    assert.equal(observe.matched, 2)
    ok('extraGroups 追加成功、默认组保留')
    log('[30] 分类交接：save_groups 必须拒绝常驻工具')
    const worldCls = makeWorld()
    apply(worldCls.ctx, { groups: [], autoGroups: 'off' })
    const agentCls = worldCls.createAgent('agent-cls')
    const material = await runTool(worldCls, 'lazy_tools_classify', {}, agentCls)
    assert.ok(Array.isArray(material.tools), 'classify 要返回 tools 数组')
    assert.ok(typeof material.instructions === 'string' && material.instructions.length > 20, '要给分组说明')
    const badSave = await runTool(worldCls, 'lazy_tools_save_groups', { groups: [{ id: 'nope', match: ['pwsh', 'read'] }] }, agentCls)
    assert.equal(badSave.saved, 0)
    assert.ok(badSave.issues.some((s) => s.includes('常驻')), '必须拒绝含常驻工具的组')
    const smallSave = await runTool(worldCls, 'lazy_tools_save_groups', { groups: [{ id: 'tiny', match: ['only_one'] }] }, agentCls)
    assert.equal(smallSave.saved, 0)
    assert.ok(smallSave.issues.some((s) => s.includes('少于 2')), '必须拒绝单工具组')
    ok('classify 给材料、save_groups 拒绝常驻与单工具组')
    log('[31] 分类提示开关：默认开，关掉后提示段里不出现')
    const mkWorldWithPrompt = () => {
      const world = makeWorld()
      const sections = []
      world.ctx.inject = (deps, callback) => {
        callback({
          effect: (make) => make(),
          systemPrompt: {
            section(section) {
              sections.push(section)
              return () => {}
            },
          },
        })
      }
      return { world, sections }
    }
    const bare = ['bareclick', 'baretype', 'barescroll']
    const on = mkWorldWithPrompt()
    for (const name of bare) on.world.ctx.tools.register({ name, description: 'bare ' + name, parameters: { type: 'object', properties: {} }, output: {} })
    apply(on.world.ctx, { groups: [], classifyNudge: true })
    const onText = typeof on.sections[0].text === 'function' ? on.sections[0].text() : String(on.sections[0].text)
    assert.ok(onText.includes('没归组'), '开启时提示段应提到未归组工具')
    const off = mkWorldWithPrompt()
    for (const name of bare) off.world.ctx.tools.register({ name, description: 'bare ' + name, parameters: { type: 'object', properties: {} }, output: {} })
    apply(off.world.ctx, { groups: [], classifyNudge: false })
    const offText = typeof off.sections[0].text === 'function' ? off.sections[0].text() : String(off.sections[0].text)
    assert.ok(!offText.includes('没归组'), '关闭时提示段不该出现分类提醒')
    assert.ok(offText.includes('lazy_tools_status'), '关闭后基础提示还在')
    ok('分类提示默认开、可关，关掉不影响基础提示')

    log('[32] 宿主没挂载的组：静音待命，不拉低 healthy')
    const worldNM = makeWorld()
    worldNM.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
    worldNM.ctx.tools.register({ name: 'cua_driver_native__b', description: 'x', parameters: {}, output: {} })
    apply(worldNM.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], title: '桌面自动化', defaultOn: true }], autoGroups: 'off' })
    // 创建这一刻就没挂载：相当于 DSH 2.0.20 上 cua_driver_native__* 的真实处境
    let remountCua = () => {}
    const agentNM = worldNM.createAgent('agent-nm', (a) => {
      remountCua = worldNM.unmount(a, ['cua_driver_native__a', 'cua_driver_native__b'])
    })
    const hNM = await runTool(worldNM, 'lazy_tools_health', {}, agentNM)
    assertJsonSafe(hNM, 'health-nm')
    const gNM = hNM.groups.find((g) => g.id === 'cua')
    assert.equal(gNM.on, true)
    assert.equal(gNM.matched, 2)
    assert.equal(gNM.visible, 0)
    assert.equal(gNM.blocked, 'filtered-by-schemas')
    assert.deepEqual(hNM.warnings, [], `宿主没挂载不该算 warning：${JSON.stringify(hNM.warnings)}`)
    assert.equal(hNM.healthy, true, '静音待命不能让 healthy 变 false —— 否则每轮都在替宿主挨刀')
    assert.ok(hNM.notes.some((n) => n.includes('schemas(agent) 过滤')), `notes 要写实测原因：${JSON.stringify(hNM.notes)}`)
    assert.ok(hNM.groups.find((g) => g.id === 'cua').blockedProbe, '要带上探针结果（global/agent 两个布尔）')
    ok('[32] 注册了但不在工具表 → blocked:filtered-by-schemas、不报警、healthy 仍 true、notes 带实测原因')

    log('[33] 宿主修好了：监控自动恢复，不用做任何事')
    remountCua()
    const hNM2 = await runTool(worldNM, 'lazy_tools_health', {}, agentNM)
    const gNM2 = hNM2.groups.find((g) => g.id === 'cua')
    assert.equal(gNM2.visible, 2)
    assert.equal(gNM2.blocked, undefined)
    assert.equal(hNM2.healthy, true)
    ok('挂回来后 blocked 消失、visible=2 —— 监控自己恢复')

    log('[34] 挂过又消失：这个必须响')
    const unmountAgain = worldNM.unmount(agentNM, ['cua_driver_native__a', 'cua_driver_native__b'])
    const hNM3 = await runTool(worldNM, 'lazy_tools_health', {}, agentNM)
    const gNM3 = hNM3.groups.find((g) => g.id === 'cua')
    assert.equal(gNM3.visible, 0)
    assert.equal(gNM3.blocked, undefined, '挂载过的工具不见了不是「宿主没挂载」，不许静音')
    assert.ok(hNM3.warnings.some((w) => w.includes('出现过') && w.includes('不见了')), `要报「挂过又消失」：${JSON.stringify(hNM3.warnings)}`)
    assert.equal(hNM3.healthy, false)
    unmountAgain()
    ok('出现过又消失 → 报警、healthy=false（静音没有把真异常一起吞掉）')

    log('[35] bench 口径：可见 + 收起 + 宿主没挂 === 注册总数')
    const worldBench = makeWorld()
    // 两组：gg 关着（它的 2 个工具是我们收的）／hh 开着（其中 h_two 宿主没挂）
    for (const n of ['g_one', 'g_two', 'h_one', 'h_two', 'keep_one']) worldBench.ctx.tools.register({ name: n, description: 'x'.repeat(20), parameters: {}, output: {} })
    apply(worldBench.ctx, {
      groups: [
        { id: 'gg', match: ['g_*'], title: 'g', defaultOn: false },
        { id: 'hh', match: ['h_*'], title: 'h', defaultOn: true },
      ],
      autoGroups: 'off',
    })
    const agentBench = worldBench.createAgent('agent-b', (a) => worldBench.unmount(a, ['h_two']))
    const benchB = await runTool(worldBench, 'lazy_tools_bench', {}, agentBench)
    assertJsonSafe(benchB, 'bench-b')
    assert.equal(benchB.hidden, 2, 'g_one / g_two 是抽屉收起的')
    assert.equal(benchB.absent, 1, 'h_two 是宿主没挂的，不算在收起里（组开着不该被算成我们收的）')
    // tools 里还包含插件自己的 11 个 lazy_tools_*，所以只对「差值」下断言
    assert.equal(benchB.visibleInRegistry, benchB.tools - 3)
    assert.equal(benchB.visibleInRegistry + benchB.hidden + benchB.absent, benchB.tools, '三态必须能对上账')
    ok('bench：收起 2 + absent 1 + 注册内可见 (tools-3) = 注册总数，账能对上')

    log('[36] tools/change 冷却：先检查再盖章，3 秒内新注册的工具不能漏')
    const worldLeak = makeWorld()
    worldLeak.ctx.tools.register({ name: 'late_one', description: 'x', parameters: {}, output: {} })
    apply(worldLeak.ctx, { groups: [{ id: 'late', match: ['late_*'], title: 'late', defaultOn: false }], autoGroups: 'off' })
    const agentLeak = worldLeak.createAgent('agent-leak')
    // 第一发：此刻没有漏网（late_one 已经被收起）——旧实现在这里就盖了时间戳
    worldLeak.fireToolsChange()
    // 3 秒内上游又注册了一个本该收起的新工具，再来一发
    worldLeak.ctx.tools.register({ name: 'late_two', description: 'x', parameters: {}, output: {} })
    worldLeak.fireToolsChange()
    const denyLeak = worldLeak.denyByAgent.get(agentLeak)
    assert.ok(denyLeak.has('late_two'), `3 秒内新增的 late_two 也必须被收起；实际 deny=${[...denyLeak].join(',')}`)
    ok('冷启动 3 秒内新增的工具仍被收起（冷却只限重建频率，不吞检查）')

    log('[37] 设置页只改档位时，生效天数跟着档位走')
    const { applyPolicyPatch } = await import('../lib/api.js')
    const pol = { level: 'high', idleDays: 3, presets: { low: 14, medium: 7, high: 3 } }
    applyPolicyPatch(pol, { level: 'low' })
    assert.equal(pol.idleDays, 14, '改成 low 后 idleDays 应为 14')
    applyPolicyPatch(pol, { idleDays: 5 })
    assert.equal(pol.idleDays, 5, '显式给天数要用它，不能被档位覆盖')
    applyPolicyPatch(pol, { level: 'medium', idleDays: null })
    assert.equal(pol.idleDays, 7, 'idleDays 为 null 视为没碰，跟着档位重新算')
    ok('档位→天数跟随；显式天数优先')

    log('[38] 单工具热度：组里只放常用的那几个，其余继续收')
    const usagePath2 = join(tmpdir(), `lazy-tools-usage2-${process.pid}.json`)
    writeFileSync(usagePath2, JSON.stringify({ groups: {}, tools: { cua_driver_native__a: new Date().toISOString() } }))
    process.env.LAZY_TOOLS_USAGE_FILE = usagePath2
    const worldSingle = makeWorld()
    worldSingle.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
    worldSingle.ctx.tools.register({ name: 'cua_driver_native__b', description: 'x', parameters: {}, output: {} })
    apply(worldSingle.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }], autoGroups: 'off' })
    const agentSingle = worldSingle.createAgent('agent-single')
    const denySingle = worldSingle.denyByAgent.get(agentSingle)
    assert.equal(denySingle.has('cua_driver_native__b'), true, '没用过的 b 要继续收着')
    assert.equal(denySingle.has('cua_driver_native__a'), false, '用过的 a 应该保持可见（only 白名单）')
    rmSync(usagePath2, { force: true })
    process.env.LAZY_TOOLS_USAGE_FILE = `${NO_SUCH}.usage.json`
    ok('单工具热度：only 只放热的那一个，同组其余仍收起')

    log('[39] 常驻提示带组用途（能力目录）')
    const promptWorld = mkWorldWithPrompt()
    promptWorld.world.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
    apply(promptWorld.world.ctx, {
      groups: [{ id: 'cua', match: ['cua_driver_native__*'], title: '桌面·看', defaultOn: false }],
      autoGroups: 'off',
    })
    const promptText2 = typeof promptWorld.sections[0].text === 'function'
      ? promptWorld.sections[0].text()
      : String(promptWorld.sections[0].text)
    assert.ok(promptText2.includes('cua(桌面·看)'), `提示里要有组用途：${promptText2.slice(0, 140)}`)
    ok('提示段列「组 id(用途)」，模型才知道抽屉里有什么')

    log('[40] glob 里的 ? 必须按字面量转义')
    const worldQ = makeWorld()
    worldQ.ctx.tools.register({ name: 'ab', description: 'x', parameters: {}, output: {} })
    worldQ.ctx.tools.register({ name: 'a?b', description: 'x', parameters: {}, output: {} })
    apply(worldQ.ctx, { groups: [{ id: 'q', match: ['a?b'], defaultOn: false }], autoGroups: 'off' })
    const agentQ = worldQ.createAgent('agent-q')
    const statusQ = await runTool(worldQ, 'lazy_tools_status', {}, agentQ)
    const groupQ = statusQ.groups.find((g) => g.id === 'q')
    assert.equal(groupQ.matched, 1, '`a?b` 只能匹配字面量 a?b，不能把 ab 也吃进来')
    assert.equal(groupQ.visible, 0)
    ok('`?` 转义后只匹配字面量（`*` 仍是通配符）')

    // 2026-10-30 对面（DSH 作者）用我们的 db42e09 在 mock 里复现出来的真 bug：
    // rebuild 先 lift 旧限制、之后才替换 st.lifts；而 rc.3 的 lift 是**同步**发 tools/change 的，
    // 于是 change 处理器重入 rebuild，内层把自己的 lift 句柄写进 st.lifts，
    // 外层回来又用 leftovers 覆盖掉 → 内层那条限制永远没人解除（孤儿）。
    // 复现条件必须包括「同步事件」—— 所以这里打开 setSyncRestrictEvents。
    console.log('[41] 重入 rebuild：连续打开两个关着的组，不许留下孤儿限制')
    const worldR = makeWorld()
    worldR.setSyncRestrictEvents(true)
    worldR.ctx.tools.register({ name: 'g1_tool', description: 'x', parameters: {}, output: {} })
    worldR.ctx.tools.register({ name: 'g2_tool', description: 'x', parameters: {}, output: {} })
    apply(worldR.ctx, {
      groups: [
        { id: 'g1', match: ['g1_*'], defaultOn: false },
        { id: 'g2', match: ['g2_*'], defaultOn: false },
      ],
      autoGroups: 'off',
    })
    const agentR = worldR.createAgent('agent-reentrant')
    // 只看这两个测试工具：插件自己的 lazy_tools_* 永远可见，和本用例无关
    const onlyG = () => worldR.visibleNames(agentR).filter((n) => n.startsWith('g'))
    assert.equal(worldR.activeRestrictions(agentR).length, 1, '初始：一条限制覆盖两个组')
    assert.deepEqual(onlyG(), [], '初始两个都该藏起来')

    await runTool(worldR, 'lazy_tools_enable', { group: 'g1' }, agentR)
    assert.deepEqual(onlyG(), ['g1_tool'], '开 g1 之后只该看见 g1_tool')
    assert.equal(
      worldR.activeRestrictions(agentR).length,
      1,
      `开 g1 之后应该只剩一条限制（覆盖 g2），实际 ${worldR.activeRestrictions(agentR).length} 条 → 有孤儿`,
    )

    await runTool(worldR, 'lazy_tools_enable', { group: 'g2' }, agentR)
    assert.deepEqual(onlyG().sort(), ['g1_tool', 'g2_tool'], '两个都开之后两个都要可见')
    assert.equal(
      worldR.activeRestrictions(agentR).length,
      0,
      `两个都开之后不许留任何限制，实际 ${worldR.activeRestrictions(agentR).length} 条`,
    )
    worldR.setSyncRestrictEvents(false)
    ok('连续开两个组：没有孤儿限制，两个工具都真的回来了')

    // 2026-10-30 对面第二轮：冷却期内**第二次**晚注册会被整段跳过，且之后没有事件就永远漏着。
    // 复现：先注册 late_one（触发一次检查并盖时间戳）→ 冷却内注册 late_two（被 continue 跳过）
    //      → 之后没有事件 → late_two 一直可见。
    console.log('[42] 冷却期内的晚注册：不许漏（要延迟核对一次）')
    process.env.LAZY_TOOLS_COOLDOWN_MS = '60'
    const worldT = makeWorld()
    worldT.ctx.tools.register({ name: 'g_one', description: 'x', parameters: {}, output: {} })
    apply(worldT.ctx, { groups: [{ id: 'gh', match: ['g_*'], defaultOn: false }], autoGroups: 'off' })
    const agentT = worldT.createAgent('agent-late')
    const onlyG2 = () => worldT.visibleNames(agentT).filter((n) => n.startsWith('g_'))
    assert.deepEqual(onlyG2(), [], '初始 g_one 应该被藏起来')
    worldT.ctx.tools.register({ name: 'g_late_one', description: 'x', parameters: {}, output: {} })
    worldT.fireToolsChange()
    assert.deepEqual(onlyG2(), [], '第一次晚注册：立刻被藏起来（并开始冷却）')
    worldT.ctx.tools.register({ name: 'g_late_two', description: 'x', parameters: {}, output: {} })
    worldT.fireToolsChange()
    // 这一刻就是 bug 现场：冷却把它整段跳过，于是它**可见**
    assert.deepEqual(onlyG2(), ['g_late_two'], `冷却内第二次晚注册此刻应还是露着的（实际：${JSON.stringify(onlyG2())}）`)
    await new Promise((resolve) => setTimeout(resolve, 250))
    assert.deepEqual(onlyG2(), [], `冷却过后必须补收（实际可见：${JSON.stringify(onlyG2())}）`)
    delete process.env.LAZY_TOOLS_COOLDOWN_MS
    ok('冷却期内的第二次晚注册不会永远漏着（延迟核对生效）')

    console.log(`\nsmoke: ${checks} 项全过`)
}

main().catch((error) => {
  console.error('\nsmoke: 失败')
  console.error(error && error.stack ? error.stack : String(error))
  process.exitCode = 1
})
