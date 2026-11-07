// 冒烟测试：不依赖 DSH，把 apply() 在一个假宿主上真跑一遍。
//
// 为什么要它：`node --check` 只证明「语法没说错」，证明不了「跑起来对」。
// 这个测试替身实现的是 host.js 假设的那四个契约（register / schemas /
// restrict / agent/created），所以契约一改、这里先红。
//
// 跑法：node test/smoke.mjs   （退出码 0 = 全过）

import assert from 'node:assert/strict'
import { apply, sessionSelfHealed } from '../lib/index.js'
import { normalizePolicy, mergePolicyForStorage } from '../lib/api.js'
import { hotRatio, isToolHot, recordUsage, LEVEL_DAYS, DAY } from '../lib/usage.js'
import { createHost } from '../lib/host.js'
import { CORE_TOOLS } from '../lib/autogroups.js'
import { applyManagedRolesPatch, auditManagedRoles, roleFromLabel, roleCandidatesFromLabel, labelOfSession, normalizeManagedRoles, resolveManagedRole, isAllowedByPolicy, labelRoleCandidates } from '../lib/roles.js'
import { readFileSync, writeFileSync, rmSync, utimesSync, existsSync } from 'node:fs'
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
  // 2026-10-30：计数器已跨重载持久化 ⇒ 插件会真的往 NO_SUCH 路径写文件，先清掉，避免上一轮残留污染这一轮。
  rmSync(`${NO_SUCH}.usage.json`, { force: true })
  // 2026-11-03（冷读甲实测抓到）：[93]/[84] 会往 NO_SUCH.policy.json 写角色配置，
  // 残留到下一轮 → 第一个 apply 把它读进来审计 → 每个世界都多一条假错误 → healthy=false。
  // 临时文件的清理必须跟写入同步，否则「第二次跑必红」。
  rmSync(`${NO_SUCH}.policy.json`, { force: true })
  rmSync(`${NO_SUCH}.groups.json`, { force: true })

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

import { makeWorld } from './world.mjs'

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
  for (const name of ['lazy_tools_status', 'lazy_tools_enable', 'lazy_tools_disable', 'lazy_tools_mode', 'lazy_tools_save_groups', 'lazy_tools_list', 'lazy_tools_health']) {
    assert.ok(world.registered.has(name), `缺工具 ${name}`)
  }
  ok('七个工具都注册上了（0.16.0 由 11 个合并而来）')

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

  log('[4] list {ungrouped} / health 的输出')
  const scan = await runTool(world, 'lazy_tools_list', { ungrouped: true }, agent)
  assertJsonSafe(scan, 'list-ungrouped')
  // 前缀分桶只统计「当前可见」的工具；两个 cua 工具此刻仍被收着，所以不该出现
  assert.equal(scan.prefixes.some((b) => b.prefix === 'cua_driver_native'), false)
  assert.ok(scan.ungrouped && Array.isArray(scan.ungrouped.tools), '要给出未归组工具与描述')
  ok('list {ungrouped} 输出 JSON-safe：前缀分桶 + 未归组工具，且没有 cua 前缀')

  const health = await runTool(world, 'lazy_tools_health', {}, agent)
  assertJsonSafe(health, 'health')
  assert.equal(health.ok, true, `health 说契约不全：${JSON.stringify(health.contracts)}`)
  assert.equal(health.contracts.length, 5)
  assert.equal(health.stats.agentCreated, 1)
  assert.equal(health.stats.restrictFailures, 0)
  assert.equal(health.stats.lastHidden.hidden, 2)
  ok('health: 五个契约全绿，agentCreated=1，lastHidden=2')

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
  assert.equal(world3.denyByAgent.get(alive).size, 1, 'apply 时补应用必须收紧已存在 agent')
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
  assert.equal(health7.healthy, false, 'expect 对不上时 healthy 必须是 false（DESIGN.md:197）')
  assert.equal(typeof health7.stats.rebuilds, 'number', 'rebuilds 必须可观测')
  ok('expect 对不上会报警且 healthy=false（matched 1 ≠ expect 5）')

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
  assert.match(noSelector.error, /group、groups 或 name/)
  const health9 = await runTool(world9, 'lazy_tools_health', { full: true }, agent9)
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
  // 2026-11-01（0.18）：竞态只进计数、不进 errors（否则 8 个错误槽会被多会话占满）。
  assert.equal(healthA.errors.some((e) => e.where.includes('agent 已销毁')), false, JSON.stringify(healthA.errors))
  assert.ok(healthA.stats.restrictSkipped >= 1, '竞态必须仍然计数')
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
  const r1 = await runTool(worldC, 'lazy_tools_enable', { name: 'cua_driver_native__a' }, agentC)
  assert.equal(r1.found, true)
  assert.equal(r1.applied, true)
  assert.equal(r1.group, 'cua')
  assert.equal(worldC.denyByAgent.get(agentC).has('cua_driver_native__a'), false)
  assert.equal(worldC.denyByAgent.get(agentC).has('cua_driver_native__b'), true)
  const r2 = await runTool(worldC, 'lazy_tools_enable', { name: 'native__b' }, agentC)
  assert.equal(r2.found, true)
  assert.equal(r2.tool, 'cua_driver_native__b')
  const r3 = await runTool(worldC, 'lazy_tools_enable', { name: 'nope_xyz' }, agentC)
  assert.equal(r3.found, false)
  ok('enable {name}：一步开一个（only 语义）、片段能匹配、找不到给提示')

  log('[16] autoHints 已删除（0.17.0）：写它也不预开，更不计数')
  const worldE = makeWorld()
  const envE = `${NO_SUCH}.hint.usage.json`
  process.env.LAZY_TOOLS_USAGE_FILE = envE
  rmSync(envE, { force: true })
  worldE.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  apply(worldE.ctx, {
    groups: [{ id: 'desktop', match: ['cua_driver_native__*'], autoHints: ['截图', '看窗口'], defaultOn: false }],
  })
  const agentE = worldE.createAgent('agent-auto')
  assert.equal(worldE.denyByAgent.get(agentE).size, 1, '组默认收起')
  worldE.fireUserMessage(agentE, '帮我截图看看这个窗口')
  assert.equal(worldE.denyByAgent.get(agentE).size, 1, '关键词预开已删除：用户消息不该再自动放组')
  const autoHealth = await runTool(worldE, 'lazy_tools_health', {}, agentE)
  assert.equal('autoOpened' in autoHealth.stats, false, 'autoOpened 字段必须删干净')
  assert.equal('userMessages' in autoHealth.stats, false, 'userMessages 字段必须删干净')
  // 2026-11-03：这条原来断言「一条 inbox 监听都不许有」（0.17.0 删关键词预开时的红线）。
  // 0.18.2 起 `[role:xxx]` 通道（role-inbox）已整段删除，所以这条断言恢复为「0 条监听」。
  assert.equal(worldE.inboxListeners.length, 0, '0.18.2 恢复 0.17 红线：不再监听 inbox（[role:] 通道已删除）')
  assert.equal(autoHealth.notes.filter((n) => String(n).includes('autoHints')).length, 1, '旧配置的 autoHints 提示每组只该出现一次（重复 push 会红）')
  assert.equal(autoHealth.healthy, true, '兼容提示不许把 healthy 拖成 false（否则用户天天看红灯）')
  ok('autoHints 被忽略：不自动开组；stats 不再有 autoOpened / userMessages')

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
  assert.equal(isToolHot(usage, 'vision_ocr', 7, stamp), true)
  assert.equal(isToolHot(usage, 'vision_ocr', 1, stamp), false)
  assert.equal(isToolHot(usage, 'never_used', 7, stamp), false)
  assert.equal(isToolHot(usage, 'never_used', 0, stamp), true)
  assert.equal(hotRatio(8, 27), 8 / 27, 'hotRatio 不许取整')
  assert.ok(hotRatio(8, 27) < 0.3, '8/27 必须小于 0.3')
  const roleBase = { x: { allowGroups: ['a'] } }
  const cleared = applyManagedRolesPatch(roleBase, {})
  assert.equal(cleared.next, null, '空对象必须清空角色')
  assert.equal(cleared.changed, true, '清空要算变化')
  const roleNorm = normalizeManagedRoles(roleBase)
  const same = applyManagedRolesPatch(roleNorm, roleNorm)
  assert.equal(same.changed, false, '相同角色表不该刷新')
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
  // 2026-11-05：自愈改为「补开即放行」——不再返回字符串让模型重试（那在 UI 上是一次假失败）。
  assert.equal(decision, undefined)
  assert.equal(worldH.denyByAgent.get(agentH).has('cua_driver_native__a'), false)
  assert.ok((worldH.visibleNames(agentH) || []).includes('cua_driver_native__a'), '补开后必须可见')
  const healthH = await runTool(worldH, 'lazy_tools_health', {}, agentH)
  assert.equal(healthH.stats.selfHealed, 1)
  const statusH = await runTool(worldH, 'lazy_tools_status', {}, agentH)
  assert.equal(sessionSelfHealed({ selfHealed: 2 }), 2, '本对话自愈累计 helper')
  assert.equal(sessionSelfHealed({}), 0, '无 selfHealed 必须为 0')
  const sessionApiSrc = readFileSync(new URL('../lib/session-api.js', import.meta.url), 'utf8')
  assert.match(readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8') + sessionApiSrc, /selfHealed: sessionSelfHealed\(st\)/, 'sessionView 必须走会话 helper')
  assert.equal(statusH.selfHealed, 1, '本对话自愈累计必须为 1')
  ok('守卫补开即放行 + 工具可见 + health.selfHealed=1')
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
  const resolvedBack = await runTool(worldJ, 'lazy_tools_enable', { name: 'cua_driver_native__a' }, agentJ)
  assert.equal(resolvedBack.applied, true)
  assert.equal(worldJ.denyByAgent.get(agentJ).has('cua_driver_native__a'), false)
  await runTool(worldJ, 'lazy_tools_enable', { group: 'cua' }, agentJ)
  assert.equal(worldJ.denyByAgent.get(agentJ).size, 0)
  ok('立刻清空 → resolve 单个 / enable 整组 都能捞回')
  log('[24] 三处名字必须一致（2026-10-24 五次恢复模式的根因）')
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const bridgeClientSrc = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
    const patchSrc = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    const clientId = (bridgeClientSrc.match(/__ModuleLoader__[\s\S]{0,60}?id:\s*'([^']+)'/) || [])[1]
    const rowName = (patchSrc.match(/^\s*name:\s*(\S+)\s*$/m) || [])[1]
    assert.ok(clientId, 'client.js 里找不到 __ModuleLoader__.load 的 id')
    assert.ok(rowName, 'cordis.patch.yml 里找不到行名 name')
    assert.equal(clientId, pkg.name, `客户端 id(${clientId}) ≠ 包名(${pkg.name})：改名必须三处同改`)
    assert.equal(rowName, pkg.name, `patch 行名(${rowName}) ≠ 包名(${pkg.name})：改名必须三处同改`)
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/, '版本号不是 x.y.z')
    assert.ok(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch, 'package.json 缺 dsh.bundle.patch，装不上')
    ok('包名 / 客户端 id / patch 行名三处一致；版本号合法；bundle 声明在')
    // 2026-11-07：角色工具面（用户口中的「面具」）必须有 UI 开关，不能只藏在配置里。
    assert.match(bridgeClientSrc, /角色工具面（默认关闭）/, '设置页缺角色工具面开关')
    assert.match(bridgeClientSrc, /managedRoles: form\.managedRoles \|\| \{\}/, '设置页保存缺 managedRoles')
    ok('设置页有角色工具面开关，且会随策略保存')
    assert.match(bridgeClientSrc, /自定义角色名/, '设置页缺自定义角色输入')
    assert.doesNotMatch(patchSrc, /managedRoles:/, '角色工具面默认应为关闭（README 口径）')
    ok('角色工具面默认关闭，支持自定义角色')
    assert.match(bridgeClientSrc, /groupCatalog\.map/, '自定义角色必须从当前分组动态列出')
    ok('自定义角色从 state.groups 动态列组，不写死组名')
    assert.match(bridgeClientSrc, /本对话累计自动取出/, '收纳统计必须区分本对话与全局')
    ok('收纳统计区分本对话 hidden 与本对话 selfHealed')

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
    const material = await runTool(worldCls, 'lazy_tools_save_groups', {}, agentCls)
    assert.ok(material.classify && Array.isArray(material.classify.tools), '不传 groups 要返回分类材料')
    assert.ok(typeof material.classify.instructions === 'string' && material.classify.instructions.length > 20, '要给分组说明')
    const badSave = await runTool(worldCls, 'lazy_tools_save_groups', { groups: [{ id: 'nope', match: ['pwsh', 'read'] }] }, agentCls)
    assert.equal(badSave.saved, 0)
    assert.ok(badSave.issues.some((s) => s.includes('常驻')), '必须拒绝含常驻工具的组')
    const smallSave = await runTool(worldCls, 'lazy_tools_save_groups', { groups: [{ id: 'tiny', match: ['only_one'] }] }, agentCls)
    assert.equal(smallSave.saved, 0)
    assert.ok(smallSave.issues.some((s) => s.includes('少于 2')), '必须拒绝单工具组')
    ok('save_groups 不传 groups 给材料、带 groups 时拒绝常驻与单工具组')
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
    // 2026-10-30 二修：scoped 才是 agent 作用域视图；这个场景是「全局有、作用域查不到」⇒ agent-filtered
    assert.equal(gNM.blocked, 'agent-filtered')
    assert.deepEqual(hNM.warnings, [], `宿主没挂载不该算 warning：${JSON.stringify(hNM.warnings)}`)
    assert.equal(hNM.healthy, true, '静音待命不能让 healthy 变 false —— 否则每轮都在替宿主挨刀')
    assert.ok(hNM.notes.some((n) => n.includes('作用域') && n.includes('scoped=false')), 'notes 要写明决定性布尔 scoped=false（agent 是无第二参的全局值，不许当证据）')
    assert.ok(hNM.groups.find((g) => g.id === 'cua').blockedProbe, '要带上探针结果（global/scoped）')
    ok('[32] 注册了但不在工具表 → blocked:agent-filtered、不报警、healthy 仍 true、notes 带实测原因')

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
    const benchB = (await runTool(worldBench, 'lazy_tools_health', { bench: true }, agentBench)).bench
    assertJsonSafe(benchB, 'bench-b')
    assert.equal(benchB.hidden, 2, 'g_one / g_two 是抽屉收起的')
    assert.equal(benchB.absent, 1, 'h_two 是宿主没挂的，不算在收起里（组开着不该被算成我们收的）')
    // tools 里还包含插件自己的 7 个 lazy_tools_*，所以只对「差值」下断言
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

    // 2026-10-30 挑刺（第三轮）：原来的 fixture 手工写 {groups:{}, tools:{...}} —— 那是插件自己
    // **永远写不出来**的状态（recordUsage 必然同时写 groups），所以这个用例测的是假数据。
    // 现在用真实账本：10 个工具的组里只有 1 个用过 → 组时间戳虽热，但热工具占比只有 10%，
    // 按新定义（≥30% 才算整组开）应走 only，只放那 1 个。
    log('[38] 单工具热度：大组里只用 1 个 → 只放那一个')
    const usagePath2 = join(tmpdir(), `lazy-tools-usage2-${process.pid}.json`)
    const ledgerReal = { groups: {}, tools: {} }
    recordUsage(ledgerReal, 'cua_driver_native__a', 'cua', new Date())
    writeFileSync(usagePath2, JSON.stringify(ledgerReal))
    process.env.LAZY_TOOLS_USAGE_FILE = usagePath2
    const worldSingle = makeWorld()
    const ten = []
    for (const suffix of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
      ten.push(`cua_driver_native__${suffix}`)
      worldSingle.ctx.tools.register({ name: `cua_driver_native__${suffix}`, description: 'x', parameters: {}, output: {} })
    }
    apply(worldSingle.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }], autoGroups: 'off' })
    const agentSingle = worldSingle.createAgent('agent-single')
    const denySingle = worldSingle.denyByAgent.get(agentSingle)
    assert.equal(denySingle.has('cua_driver_native__a'), false, '用过的 a 应该被 only 放出来')
    for (const name of ten.filter((n) => n !== 'cua_driver_native__a')) {
      assert.equal(denySingle.has(name), true, `没用过的 ${name} 要继续收着`)
    }
    rmSync(usagePath2, { force: true })
    process.env.LAZY_TOOLS_USAGE_FILE = `${NO_SUCH}.usage.json`
    ok('大组只用 1 个：only 只放那一个（占比 10% < 30%）')

    // 对照组：小组里 1/2 用过 = 50% ≥ 30% → 整组开（否则「一个工具常用就整组开」会被一刀切掉）
    log('[44] 热工具占比够高 → 整组开（对照组）')
    const usagePath3 = join(tmpdir(), `lazy-tools-usage3-${process.pid}.json`)
    const ledgerSmall = { groups: {}, tools: {} }
    recordUsage(ledgerSmall, 'small__a', 'small', new Date())
    writeFileSync(usagePath3, JSON.stringify(ledgerSmall))
    process.env.LAZY_TOOLS_USAGE_FILE = usagePath3
    const worldSmall = makeWorld()
    for (const suffix of ['a', 'b']) worldSmall.ctx.tools.register({ name: `small__${suffix}`, description: 'x', parameters: {}, output: {} })
    apply(worldSmall.ctx, { groups: [{ id: 'small', match: ['small__*'], defaultOn: false }], autoGroups: 'off' })
    const agentSmall = worldSmall.createAgent('agent-small')
    assert.equal(worldSmall.denyByAgent.get(agentSmall).size, 0, '1/2 = 50% ≥ 30% ⇒ 整组开，一个都不该 deny')
    rmSync(usagePath3, { force: true })
    process.env.LAZY_TOOLS_USAGE_FILE = `${NO_SUCH}.usage.json`
    ok('小组里过半常用 → 整组开（占比阈值生效）')

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
    assert.ok(promptText2.includes('cua(桌面·看'), `提示里要有组用途：${promptText2.slice(0, 160)}`)
    // 2026-10-30 补：能力目录必须带**代表工具名**，否则自愈等于要模型猜一个被藏起来的名字；
    // 且必须列**完整名** —— 裸名 `click` 在注册表里可能是别的插件的同名工具（本机就撞了）。
    assert.ok(promptText2.includes('cua_driver_native__a'), `提示里要列完整工具名：${promptText2.slice(0, 200)}`)
    assert.ok(!promptText2.includes(': a)'), '不许截前缀：裸名可能是别的插件的同名工具（click 就撞了）')
    ok('提示段列「组 id(用途: 完整工具名)」—— 自愈不用再猜名字，也不会念错插件')

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

    // 2026-10-30 挑刺：firstTryRate 的分子原来是「补救次数」，语义反了 ——
    // 旧公式 (autoOpened + selfHealed)/toolCalls 在没有自愈时给 0（读成"成功率 0%"），实际应该是 100%。
    // 2026-10-30 挑刺（第二轮）：分母原来数**所有**工具的 pre-execute，而 read/write/bash 永不入组、
    // 不可能自愈 —— 200 次调用里 190 次核心工具，5 次自愈会被读成 97.5%，组内其实是 50%。
    // 现在分母只算「属于某个组」的调用；这个用例同时守住语义（无自愈=1）和分母口径（核心工具不计）。
    console.log('[43] firstTryRate：无自愈=1，且分母只数组内调用')
    const worldRate = makeWorld()
  const envRate = `${NO_SUCH}.rate.usage.json`
  process.env.LAZY_TOOLS_USAGE_FILE = envRate
  rmSync(envRate, { force: true })
    worldRate.ctx.tools.register({ name: 'g_rate', description: 'x', parameters: {}, output: {} })
    apply(worldRate.ctx, { groups: [{ id: 'gr', match: ['g_rate'], defaultOn: true }], autoGroups: 'off' })
    const agentRate = worldRate.createAgent('agent-rate')
    for (let i = 0; i < 20; i += 1) await worldRate.firePreExecute(agentRate, 'g_rate')
    for (let i = 0; i < 5; i += 1) await worldRate.firePreExecute(agentRate, 'lazy_tools_status') // 核心工具，不计
    const hRate = await runTool(worldRate, 'lazy_tools_health', {}, agentRate)
    assert.equal(hRate.stats.toolCalls, 20, `分母只该数组内调用（实际 ${hRate.stats.toolCalls}）`)
    assert.equal(hRate.stats.selfHealed, 0, '这个场景没有自愈')
    assert.equal(hRate.stats.firstTryRate, 1, `无自愈时首次成功率应为 1（实际 ${hRate.stats.firstTryRate}）`)
    ok('firstTryRate = 1 - 自愈/组内调用；核心工具调用不进分母')

    // 2026-10-30 挑刺（第四轮）：CAP=3 是「永久自愈税」—— 常用 4~11 个工具的用户每个会话都为
    // 被藏的那几个付一次自愈。上限应与判据对齐：max(3, ceil(成员数 × warmRatio))。
    console.log('[45] 热工具全放（20 成员 5 热 = 25% → 放 5 个，不再有 CAP）')
    const usagePath45 = join(tmpdir(), `lazy-tools-usage45-${process.pid}.json`)
    const ledger45 = { groups: {}, tools: {} }
    const world45 = makeWorld()
    for (let i = 0; i < 20; i += 1) {
      const name = `cap__t${i}`
      world45.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
      if (i < 5) recordUsage(ledger45, name, 'cap', new Date())
    }
    writeFileSync(usagePath45, JSON.stringify(ledger45))
    process.env.LAZY_TOOLS_USAGE_FILE = usagePath45
    apply(world45.ctx, { groups: [{ id: 'cap', match: ['cap__*'], defaultOn: false }], autoGroups: 'off' })
    const agent45 = world45.createAgent('agent-cap')
    const deny45 = world45.denyByAgent.get(agent45)
    for (let i = 0; i < 5; i += 1) assert.equal(deny45.has(`cap__t${i}`), false, `热的 cap__t${i} 必须放出来（不许再有 CAP 截断）`)
    for (let i = 5; i < 20; i += 1) assert.equal(deny45.has(`cap__t${i}`), true, `冷的 cap__t${i} 要继续收着`)
    const st45 = await runTool(world45, 'lazy_tools_status', {}, agent45)
    const grp45 = st45.groups.find((g) => g.id === 'cap')
    assert.equal(grp45.onlyCount, 5, `only 应放 5 个，实际 ${grp45.onlyCount}`)
    assert.equal(grp45.hotTools, 5, `hotTools 应报 5，实际 ${grp45.hotTools}`)
    assert.equal(grp45.hot, false, '5/20 = 25% < 30%，hot 应为 false（与决策同语义）')
    rmSync(usagePath45, { force: true })
    process.env.LAZY_TOOLS_USAGE_FILE = `${NO_SUCH}.usage.json`
    ok('only = 热的全放（旧 slice(0,3) 会漏掉 2 个）')

    // 对照组：warmRatio 可配 —— 调到 0.5 后 5/12（42%）不够热，仍走 only，且上限 6 允许 5 个全放
    console.log('[46] warmRatio 可配（0.5）：5/12 不够热 → only 5')
    const usagePath46 = join(tmpdir(), `lazy-tools-usage46-${process.pid}.json`)
    const ledger46 = { groups: {}, tools: {} }
    const world46 = makeWorld()
    for (let i = 0; i < 12; i += 1) {
      const name = `ratio__t${i}`
      world46.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
      if (i < 5) recordUsage(ledger46, name, 'ratio', new Date())
    }
    writeFileSync(usagePath46, JSON.stringify(ledger46))
    process.env.LAZY_TOOLS_USAGE_FILE = usagePath46
    apply(world46.ctx, {
      groups: [{ id: 'ratio', match: ['ratio__*'], defaultOn: false }],
      autoGroups: 'off',
      warmRatio: 0.5,
    })
    const agent46 = world46.createAgent('agent-ratio')
    const st46 = await runTool(world46, 'lazy_tools_status', {}, agent46)
    const grp46 = st46.groups.find((g) => g.id === 'ratio')
    assert.equal(grp46.mode, 'only', `5/12=42% < 50% ⇒ 应走 only，实际 ${grp46.mode}`)
    assert.equal(grp46.onlyCount, 5, `上限 6 应容许 5 个全放，实际 ${grp46.onlyCount}`)
    assert.equal(grp46.hot, false, '42% < 50% ⇒ hot=false（与决策同语义）')
    rmSync(usagePath46, { force: true })
    process.env.LAZY_TOOLS_USAGE_FILE = `${NO_SUCH}.usage.json`
    ok('warmRatio 可配，且 status.hot 与决策同一语义')

    // status.hot 曾经用「组时间戳」（任一工具热）；现在必须与占比判据一致
    console.log('[47] status.hot 不再用旧语义：1/12 热 → hot=false，但 only 放 1 个')
    const usagePath47 = join(tmpdir(), `lazy-tools-usage47-${process.pid}.json`)
    const ledger47 = { groups: {}, tools: {} }
    const world47 = makeWorld()
    for (let i = 0; i < 12; i += 1) {
      const name = `one__t${i}`
      world47.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
    }
    recordUsage(ledger47, 'one__t0', 'one', new Date()) // 组时间戳也写了，模拟真实账本
    writeFileSync(usagePath47, JSON.stringify(ledger47))
    process.env.LAZY_TOOLS_USAGE_FILE = usagePath47
    apply(world47.ctx, { groups: [{ id: 'one', match: ['one__*'], defaultOn: false }], autoGroups: 'off' })
    const agent47 = world47.createAgent('agent-one')
    const st47 = await runTool(world47, 'lazy_tools_status', {}, agent47)
    const grp47 = st47.groups.find((g) => g.id === 'one')
    assert.equal(grp47.mode, 'only', '1/12 应走 only')
    assert.equal(grp47.onlyCount, 1, 'only 只放 1 个')
    assert.equal(grp47.hot, false, '8% < 30% ⇒ hot 必须是 false（旧语义会错报 true）')
    assert.equal(grp47.lastUsed !== null, true, '但 lastUsed 仍要有（组级时间戳保留作展示）')
    rmSync(usagePath47, { force: true })
    process.env.LAZY_TOOLS_USAGE_FILE = `${NO_SUCH}.usage.json`
    ok('hot 与决策一致；组级时间戳只留作 lastUsed')

    // 2026-10-30 第二轮挑刺：吸纳型组（前缀通配/负向前瞻）配静态 expect，新工具被正确收起却触发告警 ——
    // healthy 在默认状态长期 false，正是「训练人忽略警报」。
    console.log('[48] 吸纳型组：多出来的成员不算漂移（expect 是下限）')
    const worldAbs = makeWorld()
    for (const s of ['a', 'b', 'c']) worldAbs.ctx.tools.register({ name: `abs__${s}`, description: 'x', parameters: {}, output: {} })
    apply(worldAbs.ctx, { groups: [{ id: 'abs', match: ['abs__*'], expect: 2, defaultOn: true }], autoGroups: 'off' })
    const agentAbs = worldAbs.createAgent('agent-abs')
    const hAbs = await runTool(worldAbs, 'lazy_tools_health', {}, agentAbs)
    assert.equal(hAbs.warnings.filter((w) => String(w).includes(' abs') || String(w).startsWith('abs')).length, 0, `不该有 abs 的告警：${JSON.stringify(hAbs.warnings)}`)
    const sAbs = await runTool(worldAbs, 'lazy_tools_status', {}, agentAbs)
    const gAbs = sAbs.groups.find((g) => g.id === 'abs')
    assert.equal(gAbs.matched, 3)
    assert.equal(gAbs.expectOk, true, '3 ≥ expect 2 ⇒ expectOk 应为 true（下限语义）')
    ok('吸纳型组：matched 3 > expect 2 不告警（healthy 不被误伤）')

    console.log('[49] 少了的成员才算漂移（下限语义的反面）')
    const worldMiss = makeWorld()
    worldMiss.ctx.tools.register({ name: 'miss__a', description: 'x', parameters: {}, output: {} })
    apply(worldMiss.ctx, { groups: [{ id: 'miss', match: ['miss__*'], expect: 2, defaultOn: true }], autoGroups: 'off' })
    const agentMiss = worldMiss.createAgent('agent-miss')
    const hMiss = await runTool(worldMiss, 'lazy_tools_health', {}, agentMiss)
    assert.ok(
      hMiss.warnings.some((w) => String(w).includes('miss') && String(w).includes('<')),
      `少成员时应有 '<' 告警：${JSON.stringify(hMiss.warnings)}`,
    )
    ok('matched < expect ⇒ 告警（改名/没加载/正则漏）')

    console.log('[50] minTools 填 2 时，生效值是 3（不许静默失效）')
    const worldMt = makeWorld()
    apply(worldMt.ctx, { groups: [], autoGroups: 'off', minTools: 2 })
    const agentMt = worldMt.createAgent('agent-mt')
    const hMt = await runTool(worldMt, 'lazy_tools_health', {}, agentMt)
    assert.equal(hMt.policy.minTools, 3, `minTools 应夹到 3，实际 ${hMt.policy.minTools}`)
    ok('minTools 下限 3 在加载时夹住，health 显示生效值')

    console.log('[51] 能力目录：最近用过的优先（不按累计次数）')
    const usagePath51 = join(tmpdir(), `lazy-tools-usage51-${process.pid}.json`)
    const oldIso = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
    writeFileSync(usagePath51, JSON.stringify({ groups: {}, tools: { ord__a: oldIso, ord__b: new Date().toISOString() }, counts: { ord__a: 100, ord__b: 1 } }))
    process.env.LAZY_TOOLS_USAGE_FILE = usagePath51
    const worldOrd = makeWorld()
    const sections51 = []
    worldOrd.ctx.inject = (deps, callback) => {
      callback({ effect: (make) => make(), systemPrompt: { section: (s) => { sections51.push(s); return () => {} } } })
    }
    worldOrd.ctx.tools.register({ name: 'ord__a', description: 'x', parameters: {}, output: {} })
    worldOrd.ctx.tools.register({ name: 'ord__b', description: 'x', parameters: {}, output: {} })
    apply(worldOrd.ctx, { groups: [{ id: 'ord', match: ['ord__*'], expect: 2, defaultOn: false }], autoGroups: 'off' })
    const text51 = sections51.length ? String(sections51[0].text()) : ''
    assert.ok(text51.includes('ord__b') && text51.includes('ord__a'), `目录要有两个工具名：${text51.slice(0, 160)}`)
    assert.ok(text51.indexOf('ord__b') < text51.indexOf('ord__a'), '今天用过的 ord__b 应排在 30 天前用过的 ord__a 前面')
    rmSync(usagePath51, { force: true })
    process.env.LAZY_TOOLS_USAGE_FILE = `${NO_SUCH}.usage.json`
    ok('目录排序：最近用过的优先；不按累计次数（账本没有窗口内计数）')

    // 2026-10-30 挑刺：会话档位（lazy_tools_mode idleDays）改过之后，决策用 sessionIdleDays，
    // 而 status/目录排序还在用 policy.idleDays —— 会出现「组已收起、hot 仍报 true」。
    console.log('[52] 会话档位生效时，status.hot 与决策同源')
    const usagePath52 = join(tmpdir(), `lazy-tools-usage52-${process.pid}.json`)
    const ledger52 = { groups: {}, tools: {} }
    const worldSd = makeWorld()
    for (const s of ['a', 'b', 'c', 'd']) worldSd.ctx.tools.register({ name: `sd__${s}`, description: 'x', parameters: {}, output: {} })
    const threeDaysAgo = new Date(Date.now() - 3 * DAY)
    recordUsage(ledger52, 'sd__a', 'sd', threeDaysAgo)
    recordUsage(ledger52, 'sd__b', 'sd', threeDaysAgo)
    writeFileSync(usagePath52, JSON.stringify(ledger52))
    process.env.LAZY_TOOLS_USAGE_FILE = usagePath52
    apply(worldSd.ctx, { groups: [{ id: 'sd', match: ['sd__*'], defaultOn: false }], autoGroups: 'off' })
    const agentSd = worldSd.createAgent('agent-sd')
    const s1 = await runTool(worldSd, 'lazy_tools_status', {}, agentSd)
    const g1 = s1.groups.find((g) => g.id === 'sd')
    assert.equal(g1.mode, 'all', '3 天前用过 2/4（50% ≥30%，7 天窗口内）⇒ 整组开')
    assert.equal(g1.hot, true)
    await runTool(worldSd, 'lazy_tools_mode', { idleDays: 1 }, agentSd)
    const s2 = await runTool(worldSd, 'lazy_tools_status', {}, agentSd)
    const g2 = s2.groups.find((g) => g.id === 'sd')
    assert.equal(g2.mode, 'hide', '1 天窗口下 3 天前的调用已冷 ⇒ 收起')
    assert.equal(g2.hotTools, 0, 'hotTools 也要按会话天数算')
    assert.equal(g2.hot, false, '组已收起，hot 必须同时为 false（同源；旧代码会报 true）')
    rmSync(usagePath52, { force: true })
    process.env.LAZY_TOOLS_USAGE_FILE = `${NO_SUCH}.usage.json`
    ok('会话档位下 status 与决策同源（不再各算各的天数）')

    // 0.16.0：11 个工具并成 7 个。旧名不再注册 schema（每轮省上下文），
  // 但模型若喊旧名，守卫要回一句「已并入 X」——公开契约先废弃，不静默消失。
  log('[53] 旧工具名给指路，不静默消失')
  const worldLegacy = makeWorld()
  apply(worldLegacy.ctx, { groups: [], autoGroups: 'off' })
  const agentLegacy = worldLegacy.createAgent('agent-legacy')
  const hintScan = worldLegacy.fireGuard(agentLegacy, 'lazy_tools_scan')
  assert.equal(typeof hintScan, 'string')
  assert.match(hintScan, /lazy_tools_list/)
  const hintBench = worldLegacy.fireGuard(agentLegacy, 'lazy_tools_bench')
  assert.match(hintBench, /lazy_tools_health/)
  ok('旧名 scan/bench/classify/resolve 都返回「已并入 X」')

  log('[54] health 默认精简：保留 client、去掉账本；full 给全量')
  const worldSlim = makeWorld()
  apply(worldSlim.ctx, { groups: [], autoGroups: 'off' })
  const agentSlim = worldSlim.createAgent('agent-slim')
  const slimH = await runTool(worldSlim, 'lazy_tools_health', {}, agentSlim)
  assert.equal('usage' in slimH, false, '默认视图不该带账本 usage')
  assert.equal('client' in slimH, true, '默认视图必须带 client（缺失≠正常，2026-10-30 盲评指出）')
  const fullH = await runTool(worldSlim, 'lazy_tools_health', { full: true }, agentSlim)
  assert.equal('usage' in fullH, true, 'full 视图要带账本')
  assert.ok(fullH.stats && slimH.stats, '两档都要有 stats')
  ok('默认精简保留 client + stats；full 才给 usage / 探针')

  log('[55] 计数器跨重载持久化：重载后 toolCalls 从账本恢复')
  const envP = `${NO_SUCH}.persist.usage.json`
  rmSync(envP, { force: true })
  process.env.LAZY_TOOLS_USAGE_FILE = envP
  const worldP1 = makeWorld()
  worldP1.ctx.tools.register({ name: 'g_persist', description: 'x', parameters: {}, output: {} })
  apply(worldP1.ctx, { groups: [{ id: 'gp', match: ['g_persist'], defaultOn: false }], autoGroups: 'off' })
  const agentP1 = worldP1.createAgent('agent-persist-1')
  for (let i = 0; i < 3; i += 1) await worldP1.firePreExecute(agentP1, 'g_persist')
  await runTool(worldP1, 'lazy_tools_save_groups', {}, agentP1) // 触发一次落盘（不快，但足以证明写入路径）
  const rawP = JSON.parse(readFileSync(envP, 'utf8'))
  assert.ok(rawP.stats && rawP.stats.toolCalls >= 1, `账本里要有累计计数：${JSON.stringify(rawP.stats)}`)
  // 模拟插件重载：新实例、同一账本
  const worldP2 = makeWorld()
  worldP2.ctx.tools.register({ name: 'g_persist', description: 'x', parameters: {}, output: {} })
  apply(worldP2.ctx, { groups: [{ id: 'gp', match: ['g_persist'], defaultOn: false }], autoGroups: 'off' })
  const agentP2 = worldP2.createAgent('agent-persist-2')
  const hP2 = await runTool(worldP2, 'lazy_tools_health', { full: true }, agentP2)
  assert.equal(hP2.stats.toolCalls, rawP.stats.toolCalls, `重载后应从账本恢复（文件 ${rawP.stats.toolCalls} / 内存 ${hP2.stats.toolCalls}）`)
  rmSync(envP, { force: true })
  process.env.LAZY_TOOLS_USAGE_FILE = `${NO_SUCH}.usage.json`
  ok('toolCalls 落盘并在重载后恢复（指标不再每次归零）')

  // 2026-10-30 对抗测试（元宝）三条：都只在手改配置时触发，但失效形态是「静默丢功能」。
  log('[56] 手写组 match:["*"] 不能吞掉常驻/自救工具')
  const worldStar = makeWorld()
  worldStar.ctx.tools.register({ name: 'other_tool', description: 'x', parameters: {}, output: {} })
  // 2026-10-31：万能匹配式（*）现在会被结构性防线忽略（见 [60]），所以这里用手写窄组
  // 测「常驻/自救工具不许入组」：组匹配到 lazy_tools_status 也不能收它。
  apply(worldStar.ctx, { groups: [{ id: 'all', match: ['lazy_tools_status', 'other_tool'], defaultOn: false }], autoGroups: 'off' })
  const agentStar = worldStar.createAgent('agent-star')
  const denyStar = worldStar.denyByAgent.get(agentStar)
  for (const name of ['lazy_tools_status', 'lazy_tools_enable', 'lazy_tools_disable', 'lazy_tools_mode', 'lazy_tools_save_groups', 'lazy_tools_list', 'lazy_tools_health']) {
    assert.equal(denyStar.has(name), false, `${name} 是自救工具，不许被手写组收起`)
  }
  assert.equal(denyStar.has('other_tool'), true, '普通工具仍应被这个组收起（组本身要生效）')
  // 组内的「成员」也不该包含常驻/自救工具（status 的 matched 会暴露这一点）
  const sStar = await runTool(worldStar, 'lazy_tools_status', {}, agentStar)
  const gStar = sStar.groups.find((g) => g.id === 'all')
  assert.equal(gStar.matched, 1, `组只该匹配到 1 个普通工具，实际 ${gStar.matched}`)
  assert.equal(gStar.visible, 0)
  ok('手写 match:* 只收普通工具，自救工具永远可见')

  log('[57] 配置里的组全无效：不许静默零注册')
  const worldBad = makeWorld()
  apply(worldBad.ctx, { groups: [null, {}, { id: 'g' }] })
  assert.equal(worldBad.registered.size, 8, `组全无效时也要注册 8 个工具，实际 ${worldBad.registered.size}`)
  const agentBad = worldBad.createAgent('agent-bad')
  const hBad = await runTool(worldBad, 'lazy_tools_health', {}, agentBad)
  assert.ok(hBad.errors.some((e) => String(e.where).includes('group')), '必须留下可见的错误记录')
  // 退回的确实是出厂组（不是空表），且混合「合法+无效」仍以合法组为准
  const sBad = await runTool(worldBad, 'lazy_tools_status', {}, agentBad)
  assert.ok(sBad.groups.some((g) => g.id === 'cua-screen'), '组全无效时应退回出厂组')
  const worldMix = makeWorld()
  worldMix.ctx.tools.register({ name: 'ok_a', description: 'x', parameters: {}, output: {} })
  apply(worldMix.ctx, { groups: [{ id: 'ok', match: ['ok_*'], defaultOn: false }, null, {}], autoGroups: 'off' })
  assert.equal(worldMix.registered.size, 9, '1 个业务工具 + 8 个自救工具')
  const agentMix = worldMix.createAgent('agent-mix')
  const sMix = await runTool(worldMix, 'lazy_tools_status', {}, agentMix)
  assert.equal(sMix.groups.length, 1, '混合输入只保留 1 个合法组')
  assert.equal(sMix.groups[0].id, 'ok')
  ok('组全无效 → 退回默认组并记账，工具照常注册（不再静默死掉）')

  log('[58] expect 非有限数不许进 status')
  const worldNaN = makeWorld()
  worldNaN.ctx.tools.register({ name: 'nan_a', description: 'x', parameters: {}, output: {} })
  apply(worldNaN.ctx, { groups: [{ id: 'nan', match: ['nan_*'], expect: Number.NaN }], autoGroups: 'off' })
  const agentNaN = worldNaN.createAgent('agent-nan')
  const sNaN = await runTool(worldNaN, 'lazy_tools_status', {}, agentNaN)
  const gNaN = sNaN.groups.find((g) => g.id === 'nan')
  assert.equal('expect' in gNaN, false, 'NaN expect 应视为未设置')
  assertJsonSafe(sNaN, 'status-nan')
  ok('expect 非法值被夹掉，status 仍 JSON-safe')

  // 2026-10-31：DSH 2.0.21 起 dsh-ops 用 ops_* 取代官方 pwsh。两代用户都可能有，
  // 所以保护清单用并集；这条测试钉住「两代都受保护」。
  log('[59] 兼容两代宿主工具名：pwsh 与 ops_* 都受保护')
  const worldHost = makeWorld()
  for (const name of ['pwsh', 'ops_bash', 'ops_grep', 'other_tool']) {
    worldHost.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
  }
  apply(worldHost.ctx, { groups: [{ id: 'all', match: ['pwsh', 'ops_bash', 'ops_grep', 'other_tool'], defaultOn: false }], autoGroups: 'off' })
  const agentHost = worldHost.createAgent('agent-host')
  const denyHost = worldHost.denyByAgent.get(agentHost)
  for (const name of ['pwsh', 'ops_bash', 'ops_grep']) {
    assert.equal(denyHost.has(name), false, `${name} 是宿主工具，不许被手写组收起`)
  }
  assert.equal(denyHost.has('other_tool'), true, '普通工具仍应被这个组收起')
  ok('两代宿主工具名（pwsh / ops_*）都在保护清单里')

  // 2026-10-31：不靠名字清单的结构性防线 —— 手写组匹配到「整张可隐藏工具表」= 误配，忽略。
  log('[60] 手写组匹配整张表 → 忽略并记账（不依赖宿主工具名）')
  const worldGuard = makeWorld()
  for (const name of ['biz_a', 'biz_b', 'biz_c', 'biz_d', 'biz_e', 'biz_f']) {
    worldGuard.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
  }
  apply(worldGuard.ctx, { groups: [{ id: 'all', match: ['*'], defaultOn: false }], autoGroups: 'off' })
  const agentGuard = worldGuard.createAgent('agent-guard')
  assert.equal(worldGuard.denyByAgent.get(agentGuard).size, 0, '匹配全部工具的手写组必须被忽略，一个都不许收')
  const hGuard = await runTool(worldGuard, 'lazy_tools_health', {}, agentGuard)
  assert.ok(hGuard.errors.some((e) => String(e.where).includes('group guard')), '必须留下可见记账')
  const sGuard = await runTool(worldGuard, 'lazy_tools_status', {}, agentGuard)
  assert.equal(sGuard.groups.find((g) => g.id === 'all').guarded, true, 'status 要如实标出这个组被忽略')
  ok('全匹配手写组被忽略并可见记账（宿主换名字也照样兜住）')

  log('[60b] 手写组用正则绕过哨兵：结构判定仍要挡住')
  const worldGuard2 = makeWorld()
  for (const name of ['biz2_a', 'biz2_b', 'biz2_c']) {
    worldGuard2.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
  }
  apply(worldGuard2.ctx, { groups: [{ id: 'all2', match: ['re:^[a-z0-9_]+$'], defaultOn: false }], autoGroups: 'off' })
  const agentGuard2 = worldGuard2.createAgent('agent-guard2')
  assert.equal(worldGuard2.denyByAgent.get(agentGuard2).size, 0, '正则覆盖全部工具也必须被忽略')
  const sGuard2 = await runTool(worldGuard2, 'lazy_tools_status', {}, agentGuard2)
  assert.equal(sGuard2.groups.find((g) => g.id === 'all2').guarded, true, 'status 要标 guarded')
  ok('正则绕过哨兵：结构判定兜住')

  log('[60c] 万能匹配 + 晚注册：apply 时没有工具，注册后仍要挡住')
  const worldGuard3 = makeWorld()
  apply(worldGuard3.ctx, { groups: [{ id: 'all3', match: ['re:^[a-z0-9_]+$'], defaultOn: false }], autoGroups: 'off' })
  for (const name of ['late_a', 'late_b', 'late_c']) {
    worldGuard3.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
  }
  const agentGuard3 = worldGuard3.createAgent('agent-guard3')
  worldGuard3.fireToolsChange()
  assert.equal(worldGuard3.denyByAgent.get(agentGuard3).size, 0, '晚注册也不能被万能组吞掉')
  const sGuard3 = await runTool(worldGuard3, 'lazy_tools_status', {}, agentGuard3)
  assert.equal(sGuard3.groups.find((g) => g.id === 'all3').guarded, true, 'status 要标 guarded')
  ok('晚注册：万能组仍被挡住')

  // 2026-11-01：受管角色（默认关闭）—— preset / parentSession 决定策略，封闭默认，自愈不绕过。
  log('[61] 受管角色：preset 决定策略、封闭默认、自愈不绕过')
  const worldRole = makeWorld()
  for (const name of ['role_fs_a', 'role_web_a', 'role_other_a']) {
    worldRole.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
  }
  apply(worldRole.ctx, {
    groups: [
      { id: 'role-fs', match: ['role_fs_*'] },
      { id: 'role-web', match: ['role_web_*'] },
    ],
    autoGroups: 'off',
    managedRoles: {
      'dsh-superagent-worker': { allowGroups: ['role-fs'] },
      subagent: { allowGroups: ['role-web'] },
    },
  })
  const humanRole = worldRole.createAgent('role-human')
  const workerRole = worldRole.createAgent('role-worker', (agent) => {
    agent.presets = { defaultId: 'cordis', composedPreset: () => 'dsh-superagent-worker' }
  })
  const subRole = worldRole.createAgent('role-sub', (agent) => {
    agent.session = { header: { parentSession: 'role-worker' } }
  })
  const dHuman = worldRole.denyByAgent.get(humanRole)
  const dWorker = worldRole.denyByAgent.get(workerRole)
  const dSub = worldRole.denyByAgent.get(subRole)
  assert.equal(dWorker.has('role_fs_a'), false, 'worker 授权组必须可见')
  assert.equal(dWorker.has('role_web_a'), true, 'worker 未授权组必须被藏')
  assert.equal(dWorker.has('role_other_a'), true, 'worker 未归组工具必须被藏（封闭默认）')
  assert.equal(dSub.has('role_web_a'), false, 'subagent 按 subagent 角色放行')
  assert.equal(dSub.has('role_fs_a'), true, 'subagent 未授权组必须被藏')
  assert.equal(dHuman.has('role_other_a'), false, '普通会话不受封闭默认影响（未归组不藏）')
  const managedHealBefore = (await runTool(worldRole, 'lazy_tools_health', {}, workerRole)).stats.selfHealed
  assert.equal(worldRole.fireGuard(workerRole, 'role_web_a'), undefined, '受管会话自愈不得绕过策略')
  const managedHealAfter = (await runTool(worldRole, 'lazy_tools_health', {}, workerRole)).stats.selfHealed
  assert.equal(managedHealAfter, managedHealBefore, '受管会话不许补开（selfHealed 不许增长）')
  assert.equal(dWorker.has('role_web_a'), true, '受管会话的未授权工具必须仍然被藏')
  assert.equal(worldRole.fireGuard(humanRole, 'role_web_a'), undefined, '普通会话自愈改为放行')
  const enableDef = worldRole.ctx.tools.get('lazy_tools_enable')
  const deniedEnable = await enableDef.execute({ group: 'role-web' }, { agent: workerRole })
  assert.ok(deniedEnable && deniedEnable.error && deniedEnable.error.includes('受管'), '受管会话里 enable 必须被拒')
  const modeDef = worldRole.ctx.tools.get('lazy_tools_mode')
  const deniedMode = await modeDef.execute({ collapseAll: true }, { agent: workerRole })
  assert.ok(deniedMode && deniedMode.error && deniedMode.error.includes('受管'), '受管会话里 mode 必须明确拒绝')
  const deniedSave = await runTool(worldRole, 'lazy_tools_save_groups', { groups: [{ id: 'role-new', match: ['role_fs_a', 'role_web_a'] }] }, workerRole)
  assert.ok(deniedSave && deniedSave.error && deniedSave.error.includes('受管'), '受管会话里 save_groups 必须拒绝写全局组')
  ok('受管角色只认 preset/parentSession，封闭默认生效，自愈不绕过')


  // 2026-11-01：受管角色的 preset 竞态 —— Web UI 可能先用默认 preset 创建，再切回角色 preset。
  log('[61b] label 角色：review/build/research 解析与工具面（CORE 不可藏）')
  assert.deepEqual(labelRoleCandidates('review:任务'), ['review'], 'review:任务 第一段 review')
  assert.deepEqual(labelRoleCandidates('build:改插件'), ['build'], 'build:改插件 第一段 build')
  assert.deepEqual(labelRoleCandidates('research:查资料'), ['research'], 'research:查资料 第一段 research')
  assert.deepEqual(labelRoleCandidates('dsh-my-go:hermes: 帮我改'), ['hermes', 'dsh-my-go'], 'MyGO 仍按第二段 hermes')
  const roleMap = {
    review: { allowGroups: ['browser-heavy'], unknown: 'hide' },
    build: { allowGroups: ['*'], unknown: 'show' },
    research: { allowGroups: ['search', 'browser-heavy'], unknown: 'hide' },
  }
  const groupOf = (name) => (name.startsWith('dsh_browser_') ? 'browser-heavy' : name.startsWith('web_') ? 'search' : null)
  const labelAgent = (label) => ({ session: { header: { parentSession: 'role-parent', label } } })
  assert.deepEqual(labelRoleCandidates('review: build the plugin'), ['review', 'build'], '显式 review 必须优先第一段')
  assert.equal(resolveManagedRole(labelAgent('review: build the plugin'), roleMap).key, 'review', 'review 摘要含 build 也不能升级成 build')
  assert.equal(resolveManagedRole(labelAgent('review:读'), roleMap).key, 'review', 'review label 必须解析成 review')
  assert.equal(resolveManagedRole(labelAgent('build:改'), roleMap).key, 'build', 'build label 必须解析成 build')
  assert.equal(resolveManagedRole(labelAgent('research:查'), roleMap).key, 'research', 'research label 必须解析成 research')
  assert.equal(resolveManagedRole(labelAgent('whatever:做'), roleMap), null, '未知 label 不带角色')
  assert.equal(isAllowedByPolicy({ role: roleMap.review }, 'dsh_browser_open', groupOf), true, 'review 允许 browser-heavy')
  assert.equal(isAllowedByPolicy({ role: roleMap.review }, 'web_search', groupOf), false, 'review 不允许 search')
  assert.equal(isAllowedByPolicy({ role: roleMap.research }, 'web_search', groupOf), true, 'research 允许 search')
  assert.equal(isAllowedByPolicy({ role: roleMap.research }, 'dsh_browser_open', groupOf), true, 'research 允许 browser')
  assert.equal(isAllowedByPolicy({ role: roleMap.build }, 'whatever', groupOf), true, 'build 不设限')
  // CORE 边界：read/pwsh 仍保护；edit/write 已由 ROLE_HIDEABLE_CORE 允许受管角色隐藏。
  for (const core of ['read', 'write', 'edit', 'pwsh', 'todo_write']) {
    assert.equal(CORE_TOOLS.has(core), true, core + ' 必须在 CORE')
  }
  ok('label 三角色解析正确；CORE 工具不可被角色隐藏（只读只能靠提示词/沙箱）')

  log('[61c] 受管角色能藏 edit/write（review 只读），build 不藏')
  const worldCore = makeWorld()
  for (const name of ['edit', 'write', 'core_a', 'core_b']) {
    worldCore.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
  }
  apply(worldCore.ctx, {
    groups: [{ id: 'core-g', match: ['core_*'] }],
    autoGroups: 'off',
    managedRoles: {
      'role-review': { allowGroups: ['core-g'], unknown: 'hide' },
      'role-build': { allowGroups: ['*'], unknown: 'show' },
    },
  })
  const coreReview = worldCore.createAgent('core-review', (agent) => {
    agent.presets = { defaultId: 'cordis', composedPreset: () => 'role-review' }
  })
  const coreBuild = worldCore.createAgent('core-build', (agent) => {
    agent.presets = { defaultId: 'cordis', composedPreset: () => 'role-build' }
  })
  const dCoreReview = worldCore.denyByAgent.get(coreReview)
  const dCoreBuild = worldCore.denyByAgent.get(coreBuild)
  assert.equal(dCoreReview.has('edit'), true, 'review 必须藏 edit')
  assert.equal(dCoreReview.has('write'), true, 'review 必须藏 write')
  assert.equal(dCoreReview.has('read'), false, 'review 不藏 read')
  assert.equal(dCoreBuild.has('edit'), false, 'build 不藏 edit')
  ok('受管角色能藏 edit/write；CORE 其余仍保护')

  log('[62] 受管角色：preset 在创建后才选中（竞态）')
  const worldRace2 = makeWorld()
  for (const name of ['race_fs_a', 'race_web_a']) {
    worldRace2.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
  }
  apply(worldRace2.ctx, {
    groups: [
      { id: 'race-fs', match: ['race_fs_*'] },
      { id: 'race-web', match: ['race_web_*'] },
    ],
    autoGroups: 'off',
    managedRoles: {
      'dsh-superagent-worker': { allowGroups: ['race-fs'] },
    },
  })
  const raceAgent = worldRace2.createAgent('race-agent')
  const dRace = worldRace2.denyByAgent.get(raceAgent)
  assert.equal(dRace.has('race_fs_a'), true, '切换前（普通会话、全冷）授权组也是收起的')
  raceAgent.presets = { defaultId: 'cordis', composedPreset: () => 'dsh-superagent-worker' }
  worldRace2.fireEvent('agent-preset/selected', 'race-agent', 'dsh-superagent-worker')
  assert.equal(dRace.has('race_fs_a'), false, '切换 preset 后授权组应被放行')
  assert.equal(dRace.has('race_web_a'), true, '切换后未授权组仍藏')
  ok('preset 晚选中也能重算角色并重建（竞态兜住）')


  // 2026-11-01（0.18 隔离约束②）：我们放行后仍不可见的名字，必须标成外部 deny。
  log('[63] 隔离：放行后仍不可见 ⇒ 标成外部 deny')
  const worldExt = makeWorld()
  worldExt.ctx.tools.register({ name: 'ext_a', description: 'x', parameters: {}, output: {} })
  apply(worldExt.ctx, {
    groups: [{ id: 'ext', match: ['ext_*'] }],
    autoGroups: 'off',
  })
  const agentExt = worldExt.createAgent('agent-ext')
  // 模拟另一个插件也 deny 它：直接写 fake host 的 deny 集合（不是我们的 lift 能撤的）
  worldExt.externalByAgent.get(agentExt).add('ext_a')
  await runTool(worldExt, 'lazy_tools_enable', { group: 'ext' }, agentExt)
  const healthExt = await runTool(worldExt, 'lazy_tools_health', {}, agentExt)
  assert.ok(healthExt.foreignDenied && healthExt.foreignDenied.sample.includes('ext_a'), JSON.stringify(healthExt.foreignDenied))
  ok('外部 deny 交叉探测：放行后仍不可见的名字被标出来')

  // 2026-11-01（0.18 第三条）：常驻提示段按**组装方会话**渲染，不再无脑列全部组。
  log('[64] 会话级目录：只列本会话挂载的组，空则整段消失')
  const makeSectionWorld = () => {
    const world = makeWorld()
    const sections = []
    world.ctx.inject = (deps, callback) => {
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
    world.ctx.tools.register({ name: 'grp_a__one', description: 'x', parameters: {}, output: {} })
    world.ctx.tools.register({ name: 'grp_b__one', description: 'x', parameters: {}, output: {} })
    apply(world.ctx, {
      groups: [
        { id: 'grp-a', match: ['grp_a__*'], title: 'A组' },
        { id: 'grp-b', match: ['grp_b__*'], title: 'B组' },
      ],
      autoGroups: 'off',
    })
    assert.equal(sections.length, 1)
    return { world, text: sections[0].text }
  }

  // ① 宿主权限门挡住 B 组（模拟本机 computer-use 门）：B 不该被广告，A 照旧。
  //    必须在 createAgent 之前挡住 —— 顺带验证「外部 deny 不并进挂载集」。
  const sec1 = makeSectionWorld()
  const secAgent = sec1.world.createAgent('agent-sec', (agent) => {
    sec1.world.externalByAgent.get(agent).add('grp_b__one')
  })
  const scopedText = sec1.text({ scope: secAgent })
  assert.match(scopedText, /grp-a/, `A 组没挂载却不见了：${scopedText.slice(0, 160)}`)
  assert.ok(!scopedText.includes('grp-b'), `被外部挡掉的 B 组不该被广告：${scopedText.slice(0, 200)}`)
  // ② 防御性：实测宿主只传 agent，但将来若换成 agent.ctx 也要认得（认不出会退回旧行为，不会乱删组）
  const viaCtxText = sec1.text({ scope: secAgent.ctx })
  assert.match(viaCtxText, /grp-a/, 'scope 传 agent.ctx 时也要认出来')
  assert.ok(!viaCtxText.includes('grp-b'), 'scope 传 agent.ctx 时同样不许广告 B')

  // ③ 一组都没挂载 ⇒ 空串（宿主会把空段整段丢掉）
  const sec2 = makeSectionWorld()
  const emptyAgent = sec2.world.createAgent('agent-empty', (agent) => {
    sec2.world.unmount(agent, ['grp_a__one', 'grp_b__one'])
  })
  assert.equal(sec2.text({ scope: emptyAgent }), '')
  assert.equal(sec2.text({ scope: emptyAgent.ctx }), '')

  // ④ 认不出 scope / 根本没传 context ⇒ 退回旧行为（列全部组），绝不因为读不到就变短
  const legacyText = sec1.text()
  assert.match(legacyText, /grp-a/)
  assert.match(legacyText, /grp-b/, '不传 context 时必须保持 0.17.2 行为')
  assert.match(sec1.text({ scope: {} }), /grp-b/, '认不出的 scope 也退回旧行为，不许静默变短')
  ok('会话级目录：没挂/被外部挡的组不广告、空则空段、认不出 scope 退回旧行为')

  // 2026-11-01：催人分组的提示只在默认 preset 的人工会话里出现。
  log('[65] 会话级目录：分类提示只在默认 preset 的会话里出现')
  const sec3 = makeSectionWorld()
  for (const name of ['loosealpha', 'loosebeta', 'loosegamma']) {
    sec3.world.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
  }
  const nudgeAgent = sec3.world.createAgent('agent-nudge')
  const defaultSectionText = sec3.text({ scope: nudgeAgent })
  assert.ok(
    defaultSectionText.includes('lazy_tools_save_groups'),
    `默认会话里应当催分组：${defaultSectionText.slice(0, 240)}`,
  )
  // 同一会话后来被切成角色 preset：能力目录照旧，但不许再催人去改全局分组表
  nudgeAgent.presets = { defaultId: 'cordis', composedPreset: () => 'some-worker-role' }
  const roleSectionText = sec3.text({ scope: nudgeAgent })
  assert.ok(
    !roleSectionText.includes('lazy_tools_save_groups'),
    `角色会话不该被引导去改全局分组：${roleSectionText.slice(0, 240)}`,
  )
  assert.match(roleSectionText, /lazy_tools_status/, '基础段（能力目录本身）必须还在')
  ok('分类提示只在默认 preset 会话出现；角色会话保留能力目录、不催分组')

  // 2026-11-01（冷读第二轮）：view 是主读路径，必须单独钉住 —— 空视图、没有视图、视图抛错
  // 三种情况都不许把「开着的组」静默弄没（那正是「失败方向变短」）。
  // 这条用例特意用 defaultOn:true 的组：抽屉不会藏它，所以 mounted 里没有 hiddenNames 兜底，
  // 空视图一旦被当成权威，组当场消失 —— 上一版用例没设这个前提，变异测试是绿的（假绿）。
  log('[66] 会话级目录：视图路径的三种退化')
  const worldView = makeWorld()
  const viewSections = []
  worldView.ctx.inject = (deps, callback) => {
    callback({
      effect: (make) => make(),
      systemPrompt: {
        section(section) {
          viewSections.push(section)
          return () => {}
        },
      },
    })
  }
  worldView.ctx.tools.register({ name: 'vw_a__one', description: 'x', parameters: {}, output: {} })
  apply(worldView.ctx, {
    groups: [{ id: 'vw-a', match: ['vw_a__*'], title: 'A组', defaultOn: true }],
    autoGroups: 'off',
  })
  const viewAgent = worldView.createAgent('agent-view')
  const viewText = viewSections[0].text
  assert.equal(worldView.denyByAgent.get(viewAgent).size, 0, 'defaultOn 组不该被抽屉收起（否则这条用例测不到空视图）')
  const originalView = worldView.ctx.tools.view
  assert.ok(typeof originalView === 'function', '假宿主必须有 view：否则主路径零覆盖')
  assert.match(viewText({ scope: viewAgent }), /vw-a/, '正常视图路径：组要在')

  // ① 视图返回空 Map（宿主视图没建好）⇒ 用 schemas 复核，组不许消失
  worldView.ctx.tools.view = () => ({ visible: new Map() })
  assert.match(viewText({ scope: viewAgent }), /vw-a/, '空视图必须回退 schemas 复核，不许静默丢组')
  // ② 视图抛错 ⇒ 同样退回 schemas
  worldView.ctx.tools.view = () => {
    throw new Error('view boom')
  }
  assert.match(viewText({ scope: viewAgent }), /vw-a/, '视图抛错必须退回 schemas')
  // ③ 宿主根本没有 view ⇒ 退回 schemas
  delete worldView.ctx.tools.view
  assert.match(viewText({ scope: viewAgent }), /vw-a/, '没有 view 的宿主必须退回 schemas')
  worldView.ctx.tools.view = originalView
  ok('视图路径：空视图/抛错/没有视图都退回 schemas，组不丢')

  // 2026-11-01：一个分组工具都没挂、但有散装工具时，段不能整个消失 ——
  // 「有 N 个工具没归组，请去分组」恰恰是这种会话里唯一有用的一句（冷读抓到的早退 bug）。
  log('[67] 会话级目录：只有提醒、没有目录时也不许空段')
  const sec5 = makeSectionWorld()
  const looseAgent = sec5.world.createAgent('agent-loose', (agent) => {
    sec5.world.unmount(agent, ['grp_a__one', 'grp_b__one'])
  })
  for (const name of ['loosealpha2', 'loosebeta2', 'loosegamma2']) {
    sec5.world.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
  }
  const looseText = sec5.text({ scope: looseAgent })
  assert.ok(looseText.includes('lazy_tools_save_groups'), `只有提醒时也要说话：${looseText.slice(0, 240)}`)
  assert.ok(!looseText.includes('grp-a'), `没有挂载的组不许出现在目录里：${looseText.slice(0, 240)}`)
  ok('一个分组工具都没挂 + 有散装工具 ⇒ 只输出提醒，不整段消失')

  // 2026-11-01：受管会话里没授权的组不该被广告（enable 会被拒，列出来就是骗模型）。
  log('[68] 会话级目录：受管角色不广告未授权的组')
  const worldManaged = makeWorld()
  const managedSections = []
  worldManaged.ctx.inject = (deps, callback) => {
    callback({
      effect: (make) => make(),
      systemPrompt: {
        section(section) {
          managedSections.push(section)
          return () => {}
        },
      },
    })
  }
  worldManaged.ctx.tools.register({ name: 'mgr_a__one', description: 'x', parameters: {}, output: {} })
  worldManaged.ctx.tools.register({ name: 'mgr_b__one', description: 'x', parameters: {}, output: {} })
  apply(worldManaged.ctx, {
    groups: [
      { id: 'mgr-a', match: ['mgr_a__*'], title: 'A组' },
      { id: 'mgr-b', match: ['mgr_b__*'], title: 'B组' },
    ],
    autoGroups: 'off',
    managedRoles: { 'role-x': { allowGroups: ['mgr-a'] } },
  })
  const managedAgent = worldManaged.createAgent('agent-managed', (agent) => {
    agent.presets = { defaultId: 'cordis', composedPreset: () => 'role-x' }
  })
  const managedText = managedSections[0].text({ scope: managedAgent })
  assert.match(managedText, /mgr-a/, '授权组要列出来')
  assert.ok(!managedText.includes('mgr-b'), `未授权组不许被广告：${managedText.slice(0, 200)}`)
  ok('受管角色：只列授权组，未授权组即使被我们藏了也不广告')

  // 2026-11-01（真宿主实测撞到）：组开关拨了不等于工具回来了 —— 外部 deny 挡着时不许报成功。
  log('[69] enable 回读：外部挡着时不许报「成功」')
  const worldBlocked = makeWorld()
  worldBlocked.ctx.tools.register({ name: 'blk_a__one', description: 'x', parameters: {}, output: {} })
  worldBlocked.ctx.tools.register({ name: 'blk_b__one', description: 'x', parameters: {}, output: {} })
  apply(worldBlocked.ctx, {
    groups: [
      { id: 'blk-a', match: ['blk_a__*'] },
      { id: 'blk-b', match: ['blk_b__*'] },
    ],
    autoGroups: 'off',
  })
  const blockedAgent = worldBlocked.createAgent('agent-blocked')
  // 模拟宿主权限门：这一层 deny 不在我们手里，我们 lift 之后它依然挡着
  worldBlocked.externalByAgent.get(blockedAgent).add('blk_a__one')
  const enableBlocked = await runTool(worldBlocked, 'lazy_tools_enable', { group: 'blk-a' }, blockedAgent)
  assert.equal(enableBlocked.applied, false, `外部挡着时必须报 applied:false，实际：${JSON.stringify(enableBlocked)}`)
  assert.ok(Array.isArray(enableBlocked.blocked) && enableBlocked.blocked.includes('blk-a'))
  assert.match(String(enableBlocked.hint), /不是抽屉收的/)
  // 正常组仍要报成功（不许为了这条修成一律 applied:false）
  const enableOk = await runTool(worldBlocked, 'lazy_tools_enable', { group: 'blk-b' }, blockedAgent)
  assert.notEqual(enableOk.applied, false, `正常的组不许被误报成失败：${JSON.stringify(enableOk)}`)
  ok('enable 回读：外部挡着报 applied:false，正常组照旧成功')

  // 2026-11-02（用户转述同行的判断，回去查实）：POST /policy 原来把**补丁**直接写盘，
  // 部分字段提交会把文件里其余设置冲掉；运行时看着正常，一重启就丢。
  log('[70] 策略落盘：部分补丁不许冲掉其他设置')
  const storedPolicy = {
    level: 'medium',
    idleDays: 7,
    minTools: 3,
    presets: { low: 14, medium: 7, high: 3 },
    classifyNudge: true,
    showDock: true,
    showClear: true,
    autoGroups: 'on',
  }
  const mergedLevel = mergePolicyForStorage({ level: 'high' }, storedPolicy)
  assert.equal(mergedLevel.level, 'high', '补丁里的档位要生效')
  assert.equal(mergedLevel.idleDays, 3, '只给档位时天数要跟着档位走')
  assert.equal(mergedLevel.showDock, true, '没提交的设置必须留在盘上（这条就是那个 bug）')
  assert.equal(mergedLevel.showClear, true, '同上：showClear 不许消失')
  assert.equal(mergedLevel.minTools, 3, '同上：minTools 不许消失')
  assert.deepEqual(mergedLevel.presets, { low: 14, medium: 7, high: 3 }, '同上：三档天数不许消失')
  assert.equal(mergedLevel.autoGroups, 'on', '同上：autoGroups 不许消失')
  // 显式给天数时不被档位覆盖
  const mergedExplicit = mergePolicyForStorage({ level: 'low', idleDays: 0 }, storedPolicy)
  assert.equal(mergedExplicit.idleDays, 0, '显式给 0（不按时间收敛）必须保留')
  // 2026-11-03 回归：managedRoles 必须活过"保存设置"这一趟。
  // 事故：normalizePolicy 曾经把它**整个剥掉** —— 于是 ① policy.json 里配的角色从来没生效；
  // ② 任何一次保存设置都会把角色配置静默删掉（与档案 #78 同一类：写成功但内容不对）。
  const storedWithRoles = { ...storedPolicy, managedRoles: { hermes: { allowGroups: ['write'] } } }
  const readBack = normalizePolicy(JSON.parse(JSON.stringify(storedWithRoles)))
  assert.deepEqual(readBack.managedRoles, { hermes: { allowGroups: ['write'] } }, 'normalizePolicy 不许吃掉 managedRoles')
  const mergedRoles = mergePolicyForStorage({ level: 'low' }, storedWithRoles)
  assert.ok(mergedRoles.managedRoles && mergedRoles.managedRoles.hermes, '保存设置不许把角色配置删掉')
  // 没有旧文件时等同首存
  const mergedFresh = mergePolicyForStorage({ level: 'medium' }, null)
  assert.equal(mergedFresh.level, 'medium')
  ok('策略落盘：补丁合并进旧策略，未提交的键不丢')

  // 2026-11-02（外部评审指出、复现属实）：allowGroups 写不存在 id ⇒ 受管会话把组全藏，
  // 而受管会话里 enable/disable 被拒、自愈也不绕过 ⇒ 会话内零自救路径，且全程静默。
  log('[71] 受管角色：allowGroups 写错不许把会话锁死')
  // ① 纯函数：全错 → 该角色被停用；半错 → 只报不删；'*' → 放行
  const auditAll = auditManagedRoles({ typo: { allowGroups: ['fs', 'shell'] } }, ['rf-a'])
  assert.deepEqual(auditAll.dropped, ['typo'], '全部 id 都不认识时必须停用该角色')
  assert.deepEqual(auditAll.unknown[0].ids, ['fs', 'shell'])
  const auditHalf = auditManagedRoles({ half: { allowGroups: ['rf-a', 'nope'] } }, ['rf-a'])
  assert.deepEqual(auditHalf.dropped, [], '有一半能用就不许删角色')
  assert.deepEqual(auditHalf.unknown[0].ids, ['nope'])
  assert.deepEqual(auditManagedRoles({ star: { allowGroups: ['*'] } }, []), { unknown: [], dropped: [] }, "'*' 不算写错")
  // 2026-11-03 冷读红 4a：auto-* **不再豁免**。
  // 以前它被跳过，于是 mnemon 停用后 `auto-mnemon` 消失时角色照常生效却一个组都没允许 →
  // 全部 hide、只剩核心工具、enable/disable 还被拒（#71 原地复活）。现在它和普通 id 一样参与判定。
  const auditAuto = auditManagedRoles({ auto: { allowGroups: ['auto-xxx'] } }, [])
  assert.deepEqual(auditAuto.dropped, ['auto'], 'auto-* 不存在时也要按"全错"停用角色')
  assert.deepEqual(auditAuto.unknown[0].ids, ['auto-xxx'], '并且要报出来')

  // ② 集成：全错的角色不生效（health.managed 为 null）+ health.errors 里有证据
  const worldAudit = makeWorld()
  worldAudit.ctx.tools.register({ name: 'rf_a__one', description: 'x', parameters: {}, output: {} })
  apply(worldAudit.ctx, {
    groups: [{ id: 'rf-a', match: ['rf_a__*'] }],
    autoGroups: 'off',
    managedRoles: {
      'role-typo': { allowGroups: ['fs', 'shell'] },
      'role-half': { allowGroups: ['rf-a', 'nope'] },
    },
  })
  const typoAgent = worldAudit.createAgent('agent-typo', (agent) => {
    agent.presets = { defaultId: 'cordis', composedPreset: () => 'role-typo' }
  })
  const healthTypo = await runTool(worldAudit, 'lazy_tools_health', {}, typoAgent)
  assert.equal(healthTypo.managed, null, '全写错的角色必须被停用（否则会话被锁到只剩核心工具）')
  assert.ok(
    healthTypo.errors.some((e) => String(e.message).includes('role-typo') && String(e.message).includes('不存在')),
    `health.errors 里必须响：${JSON.stringify(healthTypo.errors)}`,
  )
  // 半错的角色仍然生效（不是一刀切停用）
  const halfAgent = worldAudit.createAgent('agent-half', (agent) => {
    agent.presets = { defaultId: 'cordis', composedPreset: () => 'role-half' }
  })
  const healthHalf = await runTool(worldAudit, 'lazy_tools_health', {}, halfAgent)
  assert.ok(healthHalf.managed && healthHalf.managed.role === 'role-half', '半错角色仍要生效')
  ok('受管角色：allowGroups 写错会响；全错停用不锁死；部分错只报不删')

  // 2026-11-03（第 1 批重构）：提示段搬去 lib/prompt.js，顺带产出「会话快照」。
  // 这条钉住：health.session 与提示段**同一份判据**（该列哪些组），且能指出被外部挡掉的组。
  log('[72] 会话快照：health.session 与提示段同一份判定')
  const worldSnap = makeWorld()
  const snapSections = []
  worldSnap.ctx.inject = (deps, callback) => {
    callback({
      effect: (make) => make(),
      systemPrompt: {
        section(section) {
          snapSections.push(section)
          return () => {}
        },
      },
    })
  }
  worldSnap.ctx.tools.register({ name: 'snap_a__one', description: 'x', parameters: {}, output: {} })
  worldSnap.ctx.tools.register({ name: 'snap_b__one', description: 'x', parameters: {}, output: {} })
  worldSnap.ctx.tools.register({ name: 'snap_c__one', description: 'x', parameters: {}, output: {} })
  apply(worldSnap.ctx, {
    groups: [
      { id: 'snap-a', match: ['snap_a__*'], title: 'A' },
      { id: 'snap-b', match: ['snap_b__*'], title: 'B' },
      { id: 'snap-c', match: ['snap_c__*'], title: 'C' },
    ],
    autoGroups: 'off',
  })
  // C 组被外部挡掉（不是我们收的）：会话快照要能指出来。
  // 必须在 createAgent 之前挡：这样首次 rebuild 就看到它不可见，不会把它算进我们的藏匿集。
  const snapAgent = worldSnap.createAgent('agent-snap', (agent) => {
    worldSnap.externalByAgent.get(agent).add('snap_c__one')
  })
  const healthSnap = await runTool(worldSnap, 'lazy_tools_health', {}, snapAgent)
  assert.ok(healthSnap.session, 'health.session 必须存在')
  assert.ok(Array.isArray(healthSnap.session.groupsListed), 'groupsListed 必须是数组')
  // 2026-11-03 夜（挑刺）：role / blockedGroups 已砍——前者与 managed 重复，后者是第二个更弱的判据
  assert.ok(!('role' in healthSnap.session), 'session 不该重复 managed 里的 role')
  assert.ok(!('blockedGroups' in healthSnap.session), 'blockedGroups 已移除（health.groups[].blocked 是唯一入口）')
  const sectionTextSnap = snapSections[0].text({ scope: snapAgent })
  for (const id of healthSnap.session.groupsListed) {
    assert.ok(sectionTextSnap.includes(id), `快照说列了 ${id}，提示段里却没有：${sectionTextSnap}`)
  }
  // 反向：提示段里出现的组也必须在快照里（同一份判定，双向都对）
  for (const g of [
    { id: 'snap-a', re: /snap-a\(/ },
    { id: 'snap-b', re: /snap-b\(/ },
    { id: 'snap-c', re: /snap-c\(/ },
  ]) {
    if (g.re.test(sectionTextSnap)) assert.ok(healthSnap.session.groupsListed.includes(g.id), `提示段有 ${g.id}，快照却没有`)
  }
  assert.ok(healthSnap.session.visible >= 1 && healthSnap.session.hidden >= 1, '可见/隐藏计数要有')
  // visible 要等于「注册表 − 我们藏的 − 外部挡的」：注意假宿主的 visibleNames() 辅助函数**不过滤外部 deny**，
  // 所以这里自己按同一口径算，别拿两套定义互比。
  const snapDenied = worldSnap.denyByAgent.get(snapAgent) || new Set()
  const snapExternal = worldSnap.externalByAgent.get(snapAgent) || new Set()
  const expectedVisible = [...worldSnap.registered.keys()].filter(
    (name) => !snapDenied.has(name) && !snapExternal.has(name),
  ).length
  assert.equal(healthSnap.session.visible, expectedVisible, 'visible 必须等于本会话真正可见的工具数')

  // **读不到时不许编数字**（挑刺的红项）：视图与 schemas 同时抛错 ⇒ visible 必须是 null，不是 0
  const realView = worldSnap.ctx.tools.view
  const realSchemas = worldSnap.ctx.tools.schemas
  worldSnap.ctx.tools.view = () => {
    throw new Error('view boom')
  }
  worldSnap.ctx.tools.schemas = () => {
    throw new Error('schemas boom')
  }
  const healthBroken = await runTool(worldSnap, 'lazy_tools_health', {}, snapAgent)
  assert.equal(
    healthBroken.session.visible,
    null,
    `读不到工具表时必须给 null，不许用 0 冒充：${JSON.stringify(healthBroken.session)}`,
  )
  assert.ok(Array.isArray(healthBroken.session.groupsListed), '读不到时 groupsLeft 仍要给（退回旧行为：列全部组）')
  worldSnap.ctx.tools.view = realView
  worldSnap.ctx.tools.schemas = realSchemas
  ok('会话快照：列出的组与提示段同一份判定；读不到工具表时 visible=null，不编数字')

  // 2026-11-03：子代理的角色来源。宿主不给 subagent 工具传 preset/metadata，
  // 所以角色走「父会话给子会话的 label 带角色词」这条约定（[role:xxx] 通道已在 0.18.2 删除）。
  log('[74] 角色来源：label 尾段（厂商无关）')
  const labelCases = [
    ['dsh-my-go:hermes', 'hermes'],
    ['dsh-my-go/hermes', 'hermes'],
    ['team:reviewer', 'reviewer'],
    ['MyGO Explore', 'explore'],
    ['plainnoprefix', 'plainnoprefix'],
    ['尾段有中文:中文角色', null],
    ['', null],
    [undefined, null],
  ]
  for (const [input, expected] of labelCases) {
    assert.equal(roleFromLabel(input), expected, `roleFromLabel(${JSON.stringify(input)}) 应为 ${expected}`)
  }

  const worldLabel = makeWorld()
  worldLabel.ctx.tools.register({ name: 'lb_a__one', description: 'x', parameters: {}, output: {} })
  worldLabel.ctx.tools.register({ name: 'lb_b__one', description: 'x', parameters: {}, output: {} })
  apply(worldLabel.ctx, {
    groups: [
      { id: 'lb-a', match: ['lb_a__*'] },
      { id: 'lb-b', match: ['lb_b__*'] },
    ],
    autoGroups: 'off',
    managedRoles: {
      hermes: { allowGroups: ['lb-a'] },
      subagent: { allowGroups: ['lb-b'] },
    },
  })

  // ① 标签尾段命中 ⇒ 用它（精确），且 source=label
  const labelChild = worldLabel.createAgent('agent-label', (agent) => {
    agent.session = { header: { parentSession: 'p', label: 'dsh-my-go:hermes' } }
  })
  const healthLabel = await runTool(worldLabel, 'lazy_tools_health', {}, labelChild)
  assert.equal(healthLabel.managed && healthLabel.managed.role, 'hermes', `label 尾段必须认出来：${JSON.stringify(healthLabel.managed)}`)
  assert.equal(healthLabel.managed.source, 'label', 'source 要写明是 label 认出来的')
  const denyLabel = worldLabel.denyByAgent.get(labelChild)
  assert.ok(denyLabel.has('lb_b__one'), 'hermes 只允许 lb-a，lb-b 必须藏')
  assert.ok(!denyLabel.has('lb_a__one'), 'lb-a 必须放出来')

  // ② 标签尾段没配 ⇒ 退回 subagent 通用键，source=subagent
  const fallbackChild = worldLabel.createAgent('agent-label-fallback', (agent) => {
    agent.session = { header: { parentSession: 'p', label: 'unknown-vendor:nobody' } }
  })
  const healthFallback = await runTool(worldLabel, 'lazy_tools_health', {}, fallbackChild)
  assert.equal(healthFallback.managed && healthFallback.managed.role, 'subagent', '认不出的 label 要退回 subagent 键')
  assert.equal(healthFallback.managed.source, 'subagent')

  // ③ 非子会话带 label ⇒ 不许生效（label 只在子会话上认）
  const humanLabel = worldLabel.createAgent('agent-label-human', (agent) => {
    agent.session = { header: { label: 'dsh-my-go:hermes' } }
  })
  const healthHumanLabel = await runTool(worldLabel, 'lazy_tools_health', {}, humanLabel)
  assert.equal(healthHumanLabel.managed, null, '普通会话的 label 不该改变工具面')
  ok('角色来源：label 尾段优先于 subagent 键，非子会话不认 label')

  // 2026-11-03：**改完 policy.json 不用重启**（用户点名"配置很麻烦"）。
  // 判据是 mtime；读不到 mtime 就永不重载（退回旧行为）。AI 配的角色要能自证来源。
  log('[75] policy 热重载：改文件即生效，且能看出是谁配的')
  const tmpPolicy = join(tmpdir(), `lazy-tools.policy.reload.${Date.now()}.json`)
  const prevPolicyEnv = process.env.LAZY_TOOLS_POLICY_FILE
  process.env.LAZY_TOOLS_POLICY_FILE = tmpPolicy
  try {
    writeFileSync(tmpPolicy, JSON.stringify({ managedRoles: { alpha: { allowGroups: ['hl-a'] } } }), 'utf8')
    const worldReload = makeWorld()
    worldReload.ctx.tools.register({ name: 'hl_a__one', description: 'x', parameters: {}, output: {} })
    worldReload.ctx.tools.register({ name: 'hl_b__one', description: 'x', parameters: {}, output: {} })
    apply(worldReload.ctx, {
      groups: [
        { id: 'hl-a', match: ['hl_a__*'] },
        { id: 'hl-b', match: ['hl_b__*'] },
      ],
      autoGroups: 'off',
    })
    const mkChild = (id, label) =>
      worldReload.createAgent(id, (agent) => {
        agent.session = { header: { parentSession: 'p', label } }
      })

    const charlie1 = mkChild('agent-reload-1', 'v:alpha')
    const health1 = await runTool(worldReload, 'lazy_tools_health', {}, charlie1)
    assert.equal(health1.managed && health1.managed.role, 'alpha', '启动时读到的角色要生效')
    assert.equal(health1.managed.createdBy, null, '人手写的角色没有 createdBy')

    // 改文件（换成 beta，并带上 AI 的来源标记），把 mtime 推到未来确保能被判成"变过"
    writeFileSync(
      tmpPolicy,
      JSON.stringify({ managedRoles: { beta: { allowGroups: ['hl-b'], createdBy: 'ai', basis: 'smoke 测试' } } }),
      'utf8',
    )
    const future = new Date(Date.now() + 5000)
    utimesSync(tmpPolicy, future, future)

    const charlie2 = mkChild('agent-reload-2', 'v:beta')
    const health2 = await runTool(worldReload, 'lazy_tools_health', {}, charlie2)
    assert.equal(health2.managed && health2.managed.role, 'beta', '改完文件新建会话就该用新角色（不用重启）')
    assert.equal(health2.managed.createdBy, 'ai', 'AI 配的角色要能看出是谁配的')
    assert.equal(health2.managed.basis, 'smoke 测试', '依据要能透出来')

    // 旧角色已经不在配置里 ⇒ 新会话不再受管（subagent 键也没配）
    const charlie3 = mkChild('agent-reload-3', 'v:alpha')
    const health3 = await runTool(worldReload, 'lazy_tools_health', {}, charlie3)
    assert.equal(health3.managed, null, '被删掉的角色不该继续生效')
  } finally {
    if (prevPolicyEnv === undefined) delete process.env.LAZY_TOOLS_POLICY_FILE
    else process.env.LAZY_TOOLS_POLICY_FILE = prevPolicyEnv
    rmSync(tmpPolicy, { force: true })
  }
  ok('policy 热重载：mtime 变了就重读，AI 配的角色带 createdBy/basis')

  // 2026-11-03：**AI 自己配角色**（用户：大部分人懒得写，给喜欢折腾的留个口子）。
  // 工具层强制三条不变量：组必须存在、不许 `*`、必须带 basis。
  log('[76] lazy_tools_roles：AI 自己配角色，工具层守住三条不变量')
  const tmpRoles = join(tmpdir(), `lazy-tools.roles.${Date.now()}.json`)
  const prevRolesEnv = process.env.LAZY_TOOLS_POLICY_FILE
  process.env.LAZY_TOOLS_POLICY_FILE = tmpRoles
  try {
    const worldRoles = makeWorld()
    worldRoles.ctx.tools.register({ name: 'rl_a__one', description: 'x', parameters: {}, output: {} })
    worldRoles.ctx.tools.register({ name: 'rl_b__one', description: 'x', parameters: {}, output: {} })
    apply(worldRoles.ctx, {
      groups: [
        { id: 'rl-a', match: ['rl_a__*'] },
        { id: 'rl-b', match: ['rl_b__*'] },
      ],
      autoGroups: 'off',
    })
    const boss = worldRoles.createAgent('agent-roles-boss')

    // 只读
    const readOnly = await runTool(worldRoles, 'lazy_tools_roles', {}, boss)
    assert.deepEqual(readOnly.groupIds, ['rl-a', 'rl-b'], '只读模式要给出可用组')
    assert.deepEqual(readOnly.roles, [], '一开始没有角色')

    // 不变量 ①：组必须存在
    const badGroup = await runTool(worldRoles, 'lazy_tools_roles', { role: 'hermes', allowGroups: ['nope'], basis: 'x' }, boss)
    assert.ok(String(badGroup.error || '').includes('不存在'), '不存在的组必须拒绝')

    // 不变量 ②：AI 不许写 *
    const star = await runTool(worldRoles, 'lazy_tools_roles', { role: 'hermes', allowGroups: ['*'], basis: 'x' }, boss)
    assert.ok(
      String(star.error || '').includes('逃生口'),
      `AI 不许写 * —— 拒绝理由必须是"放开限制"这条，不能是碰巧"组不存在"：${JSON.stringify(star)}`,
    )

    // 不变量 ③：必须给 basis
    const noBasis = await runTool(worldRoles, 'lazy_tools_roles', { role: 'hermes', allowGroups: ['rl-a'] }, boss)
    assert.ok(String(noBasis.error || '').includes('basis'), '没依据必须拒绝')

    // 正常写入 → 文件真的落盘 + 新子会话按它收紧
    const written = await runTool(
      worldRoles,
      'lazy_tools_roles',
      { role: 'hermes', allowGroups: ['rl-a'], basis: '写模块，只用写类组' },
      boss,
    )
    assert.equal(written.ok, true, `写入应成功：${JSON.stringify(written)}`)
    const onDisk = JSON.parse(readFileSync(tmpRoles, 'utf8'))
    assert.equal(onDisk.managedRoles.hermes.createdBy, 'ai', '落盘要标明是 AI 配的')
    assert.equal(onDisk.managedRoles.hermes.basis, '写模块，只用写类组', '依据要落盘')

    const hermesChild = worldRoles.createAgent('agent-roles-child', (agent) => {
      agent.session = { header: { parentSession: 'p', label: 'v:hermes' } }
    })
    const healthHermes = await runTool(worldRoles, 'lazy_tools_health', {}, hermesChild)
    assert.equal(healthHermes.managed && healthHermes.managed.role, 'hermes', '新子会话要用刚配的角色')
    assert.equal(healthHermes.managed.createdBy, 'ai')
    const denyHermes = worldRoles.denyByAgent.get(hermesChild)
    assert.ok(denyHermes.has('rl_b__one'), '未授权的组要被藏')
  } finally {
    if (prevRolesEnv === undefined) delete process.env.LAZY_TOOLS_POLICY_FILE
    else process.env.LAZY_TOOLS_POLICY_FILE = prevRolesEnv
    rmSync(tmpRoles, { force: true })
  }
  ok('lazy_tools_roles：AI 配角色——不存在的组 / * / 缺 basis 全被拒，写入即生效')

  // 2026-11-03（盲测指出的失败模式）：子会话自称一个没配的角色时，它会悄悄落到默认工具面。
  // 认不出就不动仍然是对的，但**必须能查**：health.session.roleHint 要把它点名。
  log('[77] 角色没配时要说出来：health.session.roleHint')
  const worldHint = makeWorld()
  worldHint.ctx.tools.register({ name: 'rh_a__one', description: 'x', parameters: {}, output: {} })
  apply(worldHint.ctx, {
    groups: [{ id: 'rh-a', match: ['rh_a__*'] }],
    autoGroups: 'off',
    managedRoles: { hermes: { allowGroups: ['rh-a'] } },
  })
  const hintChild = worldHint.createAgent('agent-hint', (agent) => {
    agent.session = { header: { parentSession: 'p', label: 'vendor:nobody' } }
  })
  const healthHint = await runTool(worldHint, 'lazy_tools_health', {}, hintChild)
  assert.equal(healthHint.managed, null, '没配的角色不许生效')
  assert.ok(healthHint.session && healthHint.session.roleHint, '没配的角色必须在 session.roleHint 里点名')
  assert.equal(healthHint.session.roleHint.role, 'nobody')
  assert.ok(String(healthHint.session.roleHint.hint).includes('lazy_tools_roles'), '提示要给出下一步怎么做')

  const configuredChild = worldHint.createAgent('agent-hint-ok', (agent) => {
    agent.session = { header: { parentSession: 'p', label: 'vendor:hermes' } }
  })
  const healthNoHint = await runTool(worldHint, 'lazy_tools_health', {}, configuredChild)
  assert.equal(healthNoHint.session.roleHint, undefined, '配好了就不该再提示')
  ok('角色没配：session.roleHint 点名 + 给出下一步；配好了就不吵')

  // 2026-11-03 冷读红的回归（红 2 / 红 3）：坏 policy.json 不许把角色清零；写角色不许洗掉别的设置。
  log('[78] 冷读回归：坏 policy 不清角色；写角色不洗设置')
  const tmpRed = join(tmpdir(), `lazy-tools.reds.${Date.now()}.json`)
  const prevRedEnv = process.env.LAZY_TOOLS_POLICY_FILE
  process.env.LAZY_TOOLS_POLICY_FILE = tmpRed
  try {
    writeFileSync(tmpRed, JSON.stringify({ level: 'medium', managedRoles: { alpha: { allowGroups: ['rd-a'] } } }), 'utf8')
    const worldRed = makeWorld()
    worldRed.ctx.tools.register({ name: 'rd_a__one', description: 'x', parameters: {}, output: {} })
    worldRed.ctx.tools.register({ name: 'rd_b__one', description: 'x', parameters: {}, output: {} })
    apply(worldRed.ctx, {
      groups: [
        { id: 'rd-a', match: ['rd_a__*'] },
        { id: 'rd-b', match: ['rd_b__*'] },
      ],
      autoGroups: 'off',
    })
    const mk = (id) =>
      worldRed.createAgent(id, (agent) => {
        agent.session = { header: { parentSession: 'p', label: 'v:alpha' } }
      })
    const okChild = mk('agent-red-ok')
    assert.equal((await runTool(worldRed, 'lazy_tools_health', {}, okChild)).managed.role, 'alpha', '起始角色生效')

    // 红 2：文件坏掉 + mtime 变新 → 角色必须保持，且要响
    writeFileSync(tmpRed, '{ "level": "medium", }', 'utf8') // 尾逗号 = 坏 JSON
    const future = new Date(Date.now() + 8000)
    utimesSync(tmpRed, future, future)
    const afterBad = mk('agent-red-bad')
    const healthBad = await runTool(worldRed, 'lazy_tools_health', {}, afterBad)
    assert.equal(healthBad.managed && healthBad.managed.role, 'alpha', '坏 policy.json 不许把角色清零')
    assert.ok(
      healthBad.errors.some((e) => String(e.message).includes('读不出来')),
      '坏 policy.json 必须响（否则用户以为改生效了）',
    )

    // 红 3：坏文件时写角色必须拒绝（不许把文件洗成只剩 managedRoles）
    const bossRed = worldRed.createAgent('agent-red-boss')
    const writeBad = await runTool(worldRed, 'lazy_tools_roles', { role: 'beta', allowGroups: ['rd-b'], basis: 'x' }, bossRed)
    assert.ok(String(writeBad.error || '').includes('不写'), '坏 policy.json 时写角色必须拒绝')
    assert.equal(readFileSync(tmpRed, 'utf8').includes('{ "level": "medium", }'), true, '坏文件一个字节都不该被动')

    // 红 3：好文件时写角色必须保住 level 等键
    writeFileSync(
      tmpRed,
      JSON.stringify({ level: 'medium', presets: { low: 14, medium: 7, high: 3 }, managedRoles: { alpha: { allowGroups: ['rd-a'] } } }),
      'utf8',
    )
    const writeGood = await runTool(worldRed, 'lazy_tools_roles', { role: 'beta', allowGroups: ['rd-b'], basis: 'y' }, bossRed)
    assert.equal(writeGood.ok, true, `写入应成功：${JSON.stringify(writeGood)}`)
    const kept = JSON.parse(readFileSync(tmpRed, 'utf8'))
    assert.equal(kept.level, 'medium', '写角色不许把 level 洗掉（#78 同类）')
    assert.deepEqual(kept.presets, { low: 14, medium: 7, high: 3 }, '写角色不许把 presets 洗掉')
    assert.equal(kept.managedRoles.alpha.allowGroups[0], 'rd-a', '已有角色不许被覆盖')
  } finally {
    if (prevRedEnv === undefined) delete process.env.LAZY_TOOLS_POLICY_FILE
    else process.env.LAZY_TOOLS_POLICY_FILE = prevRedEnv
    rmSync(tmpRed, { force: true })
  }
  ok('冷读回归：坏文件不清角色且要响；写角色拒绝洗文件、保留 level/presets/已有角色')

  // 2026-11-03 冷读第二轮（红 1 / 红 2 启动 / 红 4a）：
  log('[79] 冷读第二轮回归：投影 label / 启动读失败要响 / auto-* 角色不许被误删')
  // ① label 走 sessionProjections（真机唯一通道）
  const fakeSession = { id: 's1' }
  const agentProj = {
    session: fakeSession,
    ctx: {
      get: (name) =>
        name === 'sessionProjections'
          ? { stateOf: (session, key) => (key === 'subagent' ? { identity: { label: 'dsh-my-go:hermes' } } : null) }
          : null,
    },
  }
  assert.equal(roleFromLabel(labelOfSession(agentProj, { parentSession: 'p' })), 'hermes', '投影里的 label 必须认出来')
  assert.equal(labelOfSession({ session: fakeSession, ctx: { get: () => null } }, { parentSession: 'p' }), null, '拿不到投影就返回 null，不猜')

  // ② 启动时 policy.json 坏了：必须响（healthy=false），不许静默退回默认
  const tmpBoot = join(tmpdir(), `lazy-tools.boot.${Date.now()}.json`)
  const prevBootEnv = process.env.LAZY_TOOLS_POLICY_FILE
  process.env.LAZY_TOOLS_POLICY_FILE = tmpBoot
  try {
    writeFileSync(tmpBoot, '{ "level": "high", }', 'utf8') // 尾逗号 = 坏 JSON
    const worldBoot = makeWorld()
    apply(worldBoot.ctx, { autoGroups: 'off' })
    const bootAgent = worldBoot.createAgent('agent-boot')
    const healthBoot = await runTool(worldBoot, 'lazy_tools_health', {}, bootAgent)
    assert.ok(
      healthBoot.errors.some((e) => String(e.message).includes('policy.json 读不出来')),
      '启动时读失败必须记账，不许静默退回默认',
    )
    assert.equal(healthBoot.healthy, false, '读失败必须让 healthy 变红（否则用户以为设置生效了）')
  } finally {
    if (prevBootEnv === undefined) delete process.env.LAZY_TOOLS_POLICY_FILE
    else process.env.LAZY_TOOLS_POLICY_FILE = prevBootEnv
    rmSync(tmpBoot, { force: true })
  }

  // ③ auto-* 角色：审计必须等 autoGroups 之后。否则合法角色被当成"组不存在"删掉（fail-open）
  const worldAutoRole = makeWorld()
  worldAutoRole.ctx.tools.register({ name: 'mnemon__search', description: 'x', parameters: {}, output: {} })
  worldAutoRole.ctx.tools.register({ name: 'mnemon__create', description: 'x', parameters: {}, output: {} })
  worldAutoRole.ctx.tools.register({ name: 'mnemon__recall', description: 'x', parameters: {}, output: {} })
  apply(worldAutoRole.ctx, {
    autoGroups: 'on',
    managedRoles: { reviewer: { allowGroups: ['auto-mnemon'] } },
  })
  const reviewerChild = worldAutoRole.createAgent('agent-auto-reviewer', (agent) => {
    agent.session = { header: { parentSession: 'p', label: 'v:reviewer' } }
  })
  const healthAuto = await runTool(worldAutoRole, 'lazy_tools_health', {}, reviewerChild)
  assert.equal(
    healthAuto.managed && healthAuto.managed.role,
    'reviewer',
    `auto-* 角色不许在启动时被误删（managed 应为 reviewer，实际 ${JSON.stringify(healthAuto.managed)}）`,
  )
  ok('冷读第二轮回归：投影 label 认得出；启动读失败会红；auto-* 角色不被误删')

  // 2026-11-03 冷读第三轮回归
  log('[80] 冷读第三轮回归：组晚到后 auto-* 角色自动恢复；合法非对象 policy 要响；热重载坏形状保持旧值')
  // ① 审计只在第一次会话跑 + 就地删 ⇒ 晚到的 auto 组永远不会被重审，合法角色被永久删掉（fail-open）
  {
    const worldLate = makeWorld()
    apply(worldLate.ctx, { autoGroups: 'on', managedRoles: { reviewer: { allowGroups: ['auto-mnemon'] } } })
    const early = worldLate.createAgent('agent-early')
    await runTool(worldLate, 'lazy_tools_health', {}, early)
    for (const name of ['mnemon__search', 'mnemon__create', 'mnemon__recall']) {
      worldLate.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
    }
    const lateChild = worldLate.createAgent('agent-late', (agent) => {
      // 真机的 label 不在 header 上，只在 sessionProjections 的 subagent 投影里（冷读红 1）
      agent.session = { header: { parentSession: 'p' } }
      const get = agent.ctx.get.bind(agent.ctx)
      agent.ctx.get = (key) =>
        key === 'sessionProjections' ? { stateOf: () => ({ identity: { label: 'v:reviewer' } }) } : get(key)
    })
    const lateHealth = await runTool(worldLate, 'lazy_tools_health', {}, lateChild)
    assert.equal(
      lateHealth.managed && lateHealth.managed.role,
      'reviewer',
      `组晚到后角色必须自动恢复（实际 ${JSON.stringify(lateHealth.managed)}）`,
    )
    assert.deepEqual(
      (lateHealth.errors || []).filter((e) => String(e.message).includes('auto-mnemon')),
      [],
      'auto-* 组还没建出来不许拉红（假错误会训练人忽略红灯）',
    )
  }

  // ② 合法 JSON 但「不是可用的策略」：必须当「读不出来」/「这一项写坏了」，健康灯要红；
  //    合法的空对象 {} 不许误报。
  {
    const prevPolicyEnv = process.env.LAZY_TOOLS_POLICY_FILE
    const tmpShape = join(tmpdir(), `lazy-tools.shape.${Date.now()}.json`)
    try {
      const cases = [
        ['null', 'null', '顶层不是对象', false],
        ['array', '[]', '顶层不是对象', false],
        ['string', '"hi"', '顶层不是对象', false],
        ['roles-string', JSON.stringify({ managedRoles: 'cua-screen' }), 'managedRoles 形状不合法', false],
        ['roles-array', JSON.stringify({ managedRoles: [] }), 'managedRoles 形状不合法', false],
        ['roles-empty', JSON.stringify({ managedRoles: {} }), null, true],
      ]
      for (const [label, content, expectError, healthyExpected] of cases) {
        writeFileSync(tmpShape, content, 'utf8')
        process.env.LAZY_TOOLS_POLICY_FILE = tmpShape
        const worldShape = makeWorld()
        apply(worldShape.ctx, { autoGroups: 'off' })
        const agentShape = worldShape.createAgent(`agent-shape-${label}`)
        const healthShape = await runTool(worldShape, 'lazy_tools_health', {}, agentShape)
        if (expectError === null) {
          assert.equal(healthShape.healthy, true, `${label} 是合法写法，不许拉红`)
          assert.deepEqual(
            (healthShape.errors || []).filter((e) => String(e.message).includes('managedRoles')),
            [],
            `${label} 不许报 managedRoles 错`,
          )
        } else {
          assert.equal(healthShape.healthy, false, `${label} 必须让健康灯变红`)
          assert.ok(
            (healthShape.errors || []).some((e) => String(e.message).includes(expectError)),
            `${label} 要报「${expectError}」`,
          )
        }
      }
    } finally {
      if (prevPolicyEnv === undefined) delete process.env.LAZY_TOOLS_POLICY_FILE
      else process.env.LAZY_TOOLS_POLICY_FILE = prevPolicyEnv
      rmSync(tmpShape, { force: true })
    }
  }

  // ③ 热重载：managedRoles 写坏形状时必须保持旧值 + 记账（不许静默清空）
  {
    const prevPolicyEnv = process.env.LAZY_TOOLS_POLICY_FILE
    const tmpReload = join(tmpdir(), `lazy-tools.reload.${Date.now()}.json`)
    try {
      writeFileSync(tmpReload, JSON.stringify({ level: 'high', managedRoles: { reviewer: { allowGroups: ['cua-screen'] } } }), 'utf8')
      process.env.LAZY_TOOLS_POLICY_FILE = tmpReload
      const worldReload = makeWorld()
      apply(worldReload.ctx, { autoGroups: 'off' })
      const firstReload = worldReload.createAgent('agent-reload-1')
      const healthFirst = await runTool(worldReload, 'lazy_tools_health', {}, firstReload)
      assert.ok(healthFirst.policy.managedRoles && healthFirst.policy.managedRoles.reviewer, '初始角色要读进来')
      writeFileSync(tmpReload, JSON.stringify({ level: 'high', managedRoles: 'cua-screen' }), 'utf8')
      const future = new Date(Date.now() + 4000)
      utimesSync(tmpReload, future, future)
      worldReload.createAgent('agent-reload-2')
      const healthSecond = await runTool(worldReload, 'lazy_tools_health', {}, firstReload)
      assert.ok(
        (healthSecond.errors || []).some((e) => String(e.message).includes('managedRoles 形状不合法')),
        '热重载读到坏形状必须记账',
      )
      assert.ok(
        healthSecond.policy.managedRoles && healthSecond.policy.managedRoles.reviewer,
        '坏形状不许清空旧角色',
      )
      // 形状对、但条目全没用：会清空（fail-open 是对的），但必须记账，不许静默
      writeFileSync(tmpReload, JSON.stringify({ level: 'high', managedRoles: { alpha: {} } }), 'utf8')
      const more = new Date(Date.now() + 8000)
      utimesSync(tmpReload, more, more)
      worldReload.createAgent('agent-reload-3')
      const healthThird = await runTool(worldReload, 'lazy_tools_health', {}, firstReload)
      assert.ok(
        (healthThird.errors || []).some((e) => String(e.message).includes('没有任何可用条目')),
        '条目全没用导致清空时必须记账',
      )
      // 改回合法配置：角色要能回来（热重载不是单向门）
      writeFileSync(tmpReload, JSON.stringify({ level: 'high', managedRoles: { reviewer: { allowGroups: ['cua-screen'] } } }), 'utf8')
      const evenMore = new Date(Date.now() + 12000)
      utimesSync(tmpReload, evenMore, evenMore)
      worldReload.createAgent('agent-reload-4')
      const healthFourth = await runTool(worldReload, 'lazy_tools_health', {}, firstReload)
      assert.ok(
        healthFourth.policy.managedRoles && healthFourth.policy.managedRoles.reviewer,
        '改回合法配置后角色必须回来',
      )
    } finally {
      if (prevPolicyEnv === undefined) delete process.env.LAZY_TOOLS_POLICY_FILE
      else process.env.LAZY_TOOLS_POLICY_FILE = prevPolicyEnv
      rmSync(tmpReload, { force: true })
    }
  }
  ok('冷读第三轮回归：组晚到恢复 / 非对象 policy 要响 / 热重载坏形状保旧值')

  // 2026-11-03（读 MyGO 源码发现）：它的真实标签是 `dsh-my-go:<工种>: <任务摘要>`，
  // 不是 `dsh-my-go:<工种>`。只取「最后一段」会拿到任务摘要 ⇒ 认不出角色 ⇒ fail-open。
  log('[81] MyGO 真实标签格式：带任务摘要也要认出角色')
  const candidatesMygo = roleCandidatesFromLabel("dsh-my-go:hermes: 帮我改这个模块，不要动浏览器")
  assert.deepEqual(candidatesMygo, ['hermes'], `候选段应为 [hermes]（dsh- 前缀不算角色）：${JSON.stringify(candidatesMygo)}`)

  const worldMygo = makeWorld()
  worldMygo.ctx.tools.register({ name: 'mg_a__one', description: 'x', parameters: {}, output: {} })
  worldMygo.ctx.tools.register({ name: 'mg_b__one', description: 'x', parameters: {}, output: {} })
  apply(worldMygo.ctx, {
    groups: [
      { id: 'mg-a', match: ['mg_a__*'] },
      { id: 'mg-b', match: ['mg_b__*'] },
    ],
    autoGroups: 'off',
    managedRoles: { hermes: { allowGroups: ['mg-a'] } },
  })
  const mygoChild = worldMygo.createAgent('agent-mygo', (agent) => {
    agent.session = { header: { parentSession: 'p', label: 'dsh-my-go:hermes: 帮我改这个模块，不要动浏览器' } }
  })
  const healthMygo = await runTool(worldMygo, 'lazy_tools_health', {}, mygoChild)
  assert.equal(healthMygo.managed && healthMygo.managed.role, 'hermes', `带摘要的 MyGO 标签也必须认出来：${JSON.stringify(healthMygo.managed)}`)
  assert.equal(healthMygo.managed.source, 'label')
  assert.ok(worldMygo.denyByAgent.get(mygoChild).has('mg_b__one'), '未授权的组要被藏')
  ok('MyGO 真实标签（带摘要）也能认出角色并收紧工具面')

  // 2026-11-03（对比评审指出）：`*` 被字面拦住了，但把**所有组**枚举一遍等价于 `*`。
  log('[82] 全组枚举 = 变相的 *，必须被拒')
  const worldAll = makeWorld()
  worldAll.ctx.tools.register({ name: 'al_a__one', description: 'x', parameters: {}, output: {} })
  worldAll.ctx.tools.register({ name: 'al_b__one', description: 'x', parameters: {}, output: {} })
  apply(worldAll.ctx, {
    groups: [
      { id: 'al-a', match: ['al_a__*'] },
      { id: 'al-b', match: ['al_b__*'] },
    ],
    autoGroups: 'off',
  })
  const bossAll = worldAll.createAgent('agent-all-boss')
  const allIds = (await runTool(worldAll, 'lazy_tools_roles', {}, bossAll)).groupIds
  const allGroups = await runTool(worldAll, 'lazy_tools_roles', { role: 'everything', allowGroups: allIds, basis: '枚举全组' }, bossAll)
  assert.ok(String(allGroups.error || '').includes('等价'), `枚举全部组必须被拒：${JSON.stringify(allGroups)}`)
  assert.equal(allGroups.ok, undefined, '被拒时不许返回 ok')
  ok('全组枚举 = 变相 * ：被拒，并说明只允许人手改文件')

  // 2026-11-03（四家 SA 调研）：别的编排器也往 label 里塞词，但那些词不是角色：
  //   goalloop `Goal-loop wave worker: AC-1`、switchman `… handover backup`、force-collab `协作 1/3`。
  // 用户若正好配了 worker/backup 这种角色名，会被误认 —— 通用词与纯数字必须跳过。
  log('[83] 通用词不当角色：worker / backup / 纯数字都跳过')
  assert.deepEqual(roleCandidatesFromLabel("Goal-loop wave worker: AC-1"), ['ac-1'], "worker 要跳过")
  assert.deepEqual(roleCandidatesFromLabel("dsh-switchman handover backup"), [], "backup 要跳过")
  assert.deepEqual(roleCandidatesFromLabel("协作 1/3"), [], "纯数字要跳过")
  assert.deepEqual(roleCandidatesFromLabel("Agent Team · reviewer"), ['reviewer'], "team 要跳过、reviewer 保留")
  assert.deepEqual(roleCandidatesFromLabel("dsh-my-go:hermes: 帮我改模块"), ['hermes'], "MyGO 的 hermes 不受影响")

  const worldGeneric = makeWorld()
  worldGeneric.ctx.tools.register({ name: 'gn_a__one', description: 'x', parameters: {}, output: {} })
  apply(worldGeneric.ctx, {
    groups: [{ id: 'gn-a', match: ['gn_a__*'] }],
    autoGroups: 'off',
    managedRoles: { worker: { allowGroups: ['gn-a'] } },
  })
  const genericChild = worldGeneric.createAgent('agent-generic', (agent) => {
    agent.session = { header: { parentSession: 'p', label: 'Goal-loop wave worker: AC-1' } }
  })
  const healthGeneric = await runTool(worldGeneric, 'lazy_tools_health', {}, genericChild)
  assert.equal(healthGeneric.managed, null, 'label 里的 worker 是通用词，不许被当成角色')
  ok('通用词护栏：worker/backup/数字不落角色，MyGO 的 hermes 照常')

  // 2026-11-03（MyGO 场景）：受管角色默认把「未归组工具」也藏，而 MyGO 的 need_help /
  // report_submit 正好未归组 —— 写角色时必须告诉调用方会被藏掉哪些，否则「接了反而更坏」。
  log('[84] 写角色时告知：哪些未归组工具会被藏')
  const worldOrphan = makeWorld()
  worldOrphan.ctx.tools.register({ name: 'orphan_tool', description: 'x', parameters: {}, output: {} })
  worldOrphan.ctx.tools.register({ name: 'og_a__one', description: 'x', parameters: {}, output: {} })
  worldOrphan.ctx.tools.register({ name: 'og_b__one', description: 'x', parameters: {}, output: {} })
  apply(worldOrphan.ctx, {
    groups: [
      { id: 'og-a', match: ['og_a__*'] },
      { id: 'og-b', match: ['og_b__*'] },
    ],
    autoGroups: 'off',
  })
  const orphanBoss = worldOrphan.createAgent('agent-orphan-boss')
  const writeOrphan = await runTool(worldOrphan, 'lazy_tools_roles', { role: 'solo', allowGroups: ['og-a'], basis: '测试未归组提示' }, orphanBoss)
  assert.equal(writeOrphan.ok, true, `写入应成功：${JSON.stringify(writeOrphan)}`)
  assert.ok(Array.isArray(writeOrphan.willHideUngrouped), '必须返回 willHideUngrouped 数组')
  assert.ok(writeOrphan.willHideUngrouped.includes('orphan_tool'), `未归组工具要列出来：${JSON.stringify(writeOrphan.willHideUngrouped)}`)
  ok('写角色时列出会被藏的未归组工具（防把编排器求助工具收掉）')

  // 2026-11-03（冷读乙在真机复现）：visible 里混着「注册了但不可 restrict」的名字时，
  // 宿主会让**整批** restrict 抛错 ⇒ 一个都不藏（fail-open）。
  // 修法验证：整批失败要退化成逐个重试，坏名字记一条、其余照藏。
  log('[85] 一个坏名字不许让整批限制静默失效')
  const worldBadName = makeWorld({ nonRestrictable: ['nr_bad'] })
  worldBadName.ctx.tools.register({ name: 'nr_bad', description: 'x', parameters: {}, output: {} })
  worldBadName.ctx.tools.register({ name: 'nr_ok__one', description: 'x', parameters: {}, output: {} })
  apply(worldBadName.ctx, {
    groups: [{ id: 'nr-g', match: ['re:^nr_'], defaultOn: false }],
    autoGroups: 'off',
  })
  const badAgent = worldBadName.createAgent('agent-badname')
  const badDeny = worldBadName.denyByAgent.get(badAgent)
  assert.ok(badDeny.has('nr_ok__one'), `好名字必须照藏；实际 deny=${JSON.stringify([...badDeny])}`)
  const badHealth = await runTool(worldBadName, 'lazy_tools_health', {}, badAgent)
  assert.ok(
    badHealth.errors.some((e) => String(e.message).includes('不可限制')),
    `坏名字必须留一条可查的错误：${JSON.stringify(badHealth.errors)}`,
  )
  ok('不可限制的名字：逐个跳过、其余照藏、留一条可查错误')

  // 2026-11-03 冷读双评审必修 ①：受管角色会藏掉未归组工具（MyGO 的 11 件协议工具就是这样断的），
  // 必须在 health 里点名，否则「接了之后拓扑断掉，但哪儿都看不出来」。
  log('[86] 受管会话：被藏掉的未归组工具要在 health 里点名')
  rmSync(`${NO_SUCH}.policy.json`, { force: true }) // 前面用例写过它，同一进程的 apply 会读进来
  const worldHU = makeWorld()
  worldHU.ctx.tools.register({ name: 'hu_grouped__one', description: 'x', parameters: {}, output: {} })
  worldHU.ctx.tools.register({ name: 'hu_grouped__two', description: 'x', parameters: {}, output: {} })
  worldHU.ctx.tools.register({ name: 'need_help', description: 'x', parameters: {}, output: {} })
  apply(worldHU.ctx, {
    groups: [{ id: 'hu-g', match: ['hu_grouped__*'] }],
    autoGroups: 'off',
    managedRoles: { hu: { allowGroups: ['hu-g'] } },
  })
  const huChild = worldHU.createAgent('agent-hu', (agent) => {
    agent.session = { header: { parentSession: 'p', label: 'v:hu' } }
  })
  const huHealth = await runTool(worldHU, 'lazy_tools_health', {}, huChild)
  assert.ok(huHealth.managed && Array.isArray(huHealth.managed.hiddenUngrouped), '必须有 hiddenUngrouped 数组')
  assert.ok(huHealth.managed.hiddenUngrouped.includes('need_help'), `未归组工具要点名：${JSON.stringify(huHealth.managed.hiddenUngrouped)}`)
  ok('受管会话：hiddenUngrouped 点名被藏的未归组工具')

  // 冷读必修 ②：refreshManagedRoles 不许把已有受管会话的角色覆盖掉
  // 2026-11-04（用户要求 + 冷读必修）：hideTools 退化路径
  //  D 族教训：假宿主要能模拟真实失败 —— 之前的 mock 永远成功，所以「整批失败」的 bug 漏了过去。
  log('[89] hideTools 退化：坏名字逐个跳过；系统性错误不误诊；坏名字进缓存')
  const mkCtx = (mode) => {
    let calls = 0
    const denied = new Set()
    const ctx = {
      on() { return () => {} },
      tools: {
        get() { return undefined },
        restrict(filter) {
          calls += 1
          const deny = Array.isArray(filter && filter.deny) ? filter.deny : []
          // 真宿主文案（app.asar 实测）：tools.restrict() names unknown global tool "x"
          if (mode === 'systemic') throw new Error('restrict backend unavailable')
          // 「系统性错误里恰好含 unknown tool 字样、但不在锚定位」——用来证明分类没有过宽
          if (mode === 'systemic-unknown') throw new Error('restrict backend failed while resolving unknown tool names')
          if (mode === 'ptc' && deny.includes('run_code')) throw new Error('cannot name reserved PTC tool "run_code"')
          // 真宿主的复数形态：2+ 未知名 → 'names unknown global toolS "a", "b"'
          if (mode === 'plural-bad') {
            const bad = deny.filter((n) => n.startsWith('bad_'))
            if (bad.length) throw new Error('tools.restrict() names unknown global toolS "' + bad.join('", "') + '"')
          }
          if (deny.includes('bad_name')) throw new Error('tools.restrict() names unknown global tool "bad_name"')
          for (const n of deny) denied.add(n)
          return () => { for (const n of deny) denied.delete(n) }
        },
      },
    }
    return { ctx, calls: () => calls, denied }
  }

  // ① 坏名字：批量失败 → 逐个重试 → 其余照藏，坏名字记一条
  const hmW1 = mkCtx('badname')
  const hmH1 = createHost(hmW1.ctx)
  const hmAgent1 = { ctx: hmW1.ctx, session: { header: {} } }
  const hmLift1 = hmH1.hideTools(hmAgent1, ['ok_a', 'bad_name', 'ok_b'])
  assert.ok(hmW1.denied.has('ok_a') && hmW1.denied.has('ok_b'), '好名字必须照藏')
  assert.ok(!hmW1.denied.has('bad_name'), '坏名字不该被记为已藏')
  assert.equal(hmW1.calls(), 4, '批量 1 次 + 逐个 3 次 = 4')
  assert.equal(hmH1.counters().restrictCalls, 4, 'restrictCalls 必须按真实调用计（4）')
  assert.ok(typeof hmLift1 === 'function', '要返回解除句柄')

  // ② 第二次调用：坏名字已进缓存，不再重试它（调用次数 = 批量 1 次）
  const hmBefore = hmW1.calls()
  const hmLift2 = hmH1.hideTools(hmAgent1, ['ok_a', 'bad_name', 'ok_b'])
  assert.equal(hmW1.calls() - hmBefore, 1, '坏名字进缓存后，第二次只该有 1 次批量调用')
  assert.equal(hmH1.counters().restrictCalls, 5, '缓存后计数 = 4 + 1')
  assert.ok(typeof hmLift2 === 'function')
  assert.ok(hmW1.denied.has('ok_a'), '缓存后好名字仍要照藏')

  // ③ 系统性错误：不许逐个重试（只 1 次调用），记一条「非名单问题」
  const hmW2 = mkCtx('systemic')
  const hmH2 = createHost(hmW2.ctx)
  const hmLift3 = hmH2.hideTools({ ctx: hmW2.ctx, session: { header: {} } }, ['x1', 'x2', 'x3'])
  assert.equal(hmLift3, null, '系统性失败不该返回句柄')
  assert.equal(hmW2.calls(), 1, '系统性错误不许逐个重试（否则 N 倍开销 + 误诊）')
  assert.equal(hmH2.counters().restrictCalls, 1, '系统性失败只算 1 次调用')
  const hmErrs = hmH2.errors().map((e) => e.message).join('\n')
  assert.ok(hmErrs.includes('非名单问题'), '必须记一条可分辨的系统性错误：' + hmErrs)

  // ③b 反例：系统性错误里**恰好含** "unknown tool" 字样，但不含锚定短语 ⇒ 仍算系统性
  const hmW2b = mkCtx('systemic-unknown')
  const hmH2b = createHost(hmW2b.ctx)
  hmH2b.hideTools({ ctx: hmW2b.ctx, session: { header: {} } }, ['y1', 'y2'])
  assert.equal(hmW2b.calls(), 1, '「unknown tool」字样若不在锚定位，不许当坏名字重试')

  // ③c 两个坏名字（真宿主的复数文案）：必须逐个重试，一个好名字照藏，两个坏名字都被记住
  const hmW2c = mkCtx('plural-bad')
  const hmH2c = createHost(hmW2c.ctx)
  const hmAgent2c = { ctx: hmW2c.ctx, session: { header: {} } }
  hmH2c.hideTools(hmAgent2c, ['ok_z', 'bad_a', 'bad_b'])
  assert.equal(hmW2c.calls(), 4, '复数坏名字：批量 1 + 逐个 3 = 4（不许判成 systemic 只试 1 次）')
  assert.ok(hmW2c.denied.has('ok_z'), '两个坏名字时，好名字仍必须照藏')
  assert.ok(!hmW2c.denied.has('bad_a') && !hmW2c.denied.has('bad_b'), '坏名字不许被记为已藏')
  const hmErrs2c = hmH2c.errors().map((e) => e.message).join('\n')
  assert.ok(hmErrs2c.includes('不可限制'), '复数坏名字也要留一条可查证据：' + hmErrs2c)

  // ③d PTC 的专用文案（run_code 这类保留工具）：也必须按「名字问题」逐个跳过，不许整批失效
  const hmW2d = mkCtx('ptc')
  const hmH2d = createHost(hmW2d.ctx)
  hmH2d.hideTools({ ctx: hmW2d.ctx, session: { header: {} } }, ['ok_q', 'run_code'])
  assert.equal(hmW2d.calls(), 3, 'PTC 保留工具：批量 1 + 逐个 2 = 3')
  assert.ok(hmW2d.denied.has('ok_q'), 'PTC 名字旁边的好工具必须照藏')
  assert.ok(!hmW2d.denied.has('run_code'), '保留工具不许被记为已藏')

  // ④ 脏输入：null / 空数组 / 非数组都不许抛
  const hmW3 = mkCtx('badname')
  const hmH3 = createHost(hmW3.ctx)
  assert.equal(hmH3.hideTools(null, ['a']), null)
  assert.equal(hmH3.hideTools({ ctx: hmW3.ctx }, []), null)
  assert.equal(hmH3.hideTools({ ctx: hmW3.ctx }, 'not-an-array'), null)
  ok('hideTools 退化加固：坏名字缓存 / 系统性错误只一次 / 脏输入不抛 / 计数按真实调用')

  // 2026-11-04 暴力测试：同一会话反复退化 50 次，缓存必须让它不再重复踩；**全部 lift 后层数归零**
  log('[90] hideTools 反复退化 50 次：调用数线性、所有 lift 撤干净')
  let bfLayers = 0
  let bfCalls = 0
  const bfLifts = []
  const bfCtx = {
    on() { return () => {} },
    tools: {
      get() { return undefined },
      restrict(filter) {
        bfCalls += 1
        const deny = Array.isArray(filter && filter.deny) ? filter.deny : []
        if (deny.includes('bad_name')) throw new Error('tools.restrict() names unknown global tool "bad_name"')
        bfLayers += 1
        let released = false
        return () => { if (!released) { released = true; bfLayers -= 1 } }
      },
    },
  }
  const bfHost = createHost(bfCtx)
  const bfAgent = { ctx: bfCtx, session: { header: {} } }
  bfLifts.push(bfHost.hideTools(bfAgent, ['bad_name', 'ok_a']))
  assert.equal(bfCalls, 3, '首次：批量 1 + 坏名 1 + 好名 1 = 3')
  assert.equal(bfLayers, 1, '好名字建立 1 层限制')
  for (let i = 0; i < 49; i++) bfLifts.push(bfHost.hideTools(bfAgent, ['bad_name', 'ok_a']))
  assert.equal(bfCalls, 3 + 49, '缓存后每次只 1 次批量调用（3 + 49 = 52）')
  assert.equal(bfLayers, 50, '50 次调用 = 50 层限制（模拟真实叠加）')
  assert.equal(bfHost.counters().restrictCalls, 52, '计数与真实调用一致')
  // 撤**全部**句柄才叫撤干净（上一版只撤第一个 ⇒ 假绿）
  for (const liftOne of bfLifts) if (typeof liftOne === 'function') liftOne()
  assert.equal(bfLayers, 0, '所有 lift 调完必须 0 层（不许留孤儿）')
  ok('反复退化 50 次：调用数线性、全部 lift 后 0 层')

  // 2026-11-04（第三方报告 A1/A2）：角色表的原型链
  log('[91] 角色表不吃原型链：__proto__ / constructor 都不许借到值')
  const protoRaw = JSON.parse('{"__proto__":{"allowGroups":["x"]},"hermes":{"allowGroups":["ga"]}}')
  const protoNorm = normalizeManagedRoles(protoRaw)
  assert.ok(protoNorm && Object.keys(protoNorm).join() === 'hermes', '__proto__ 不许进表：' + JSON.stringify(protoNorm))
  assert.equal(Object.getPrototypeOf(protoNorm), null, '归一化结果必须是 null 原型')
  assert.equal(normalizeManagedRoles(JSON.parse('{"constructor":{"allowGroups":["x"]}}')), null, 'constructor 键必须被拒')
  const own = resolveManagedRole(
    { session: { header: { parentSession: 'p', label: 'dsh-x:constructor' } } },
    { hermes: { allowGroups: ['ga'], unknown: 'hide' } },
  )
  assert.equal(own, null, 'label=constructor 不许认成角色：' + JSON.stringify(own))
  ok('角色表原型链：__proto__ / constructor 都被拒')

  // 2026-11-04（第三方报告 B1/B2）：label 解析必须确定性，不许从摘要里捞词
  log('[92] label 解析确定性：只认 vendor 后第一段，摘要词不参与')
  const labelWorld = makeWorld()
  labelWorld.ctx.tools.register({ name: 'lc_a__one', description: 'x', parameters: {}, output: {} })
  apply(labelWorld.ctx, { groups: [{ id: 'lc-a', match: ['lc_a__*'] }], autoGroups: 'off', managedRoles: { hermes: { allowGroups: ['lc-a'] } } })
  const mkL = (id, label) => labelWorld.createAgent(id, (agent) => { agent.session = { header: { parentSession: 'p', label } } })
  const h91 = await runTool(labelWorld, 'lazy_tools_health', {}, mkL('agent-b1', 'dsh-my-go:explore: 让 hermes 看看'))
  assert.equal(h91.managed, null, '摘要里的 hermes 不许被认成角色：' + JSON.stringify(h91.managed))
  // 2026-11-04（复读红 1）：roleHint 也必须用同一套确定性候选，否则诊断信息会把摘要词当成角色
  assert.ok(h91.session && h91.session.roleHint, '没配的角色必须在 roleHint 里点名')
  assert.equal(h91.session.roleHint.role, 'explore', '摘要里的 hermes 不许变成 roleHint：' + JSON.stringify(h91.session.roleHint))
  const h92 = await runTool(labelWorld, 'lazy_tools_health', {}, mkL('agent-b2', 'dsh-my-go:hermes: 帮我改模块'))
  assert.equal(h92.managed && h92.managed.role, 'hermes', 'vendor 后第一段必须认出来')
  // 2026-11-04（复读红 2）：首段即角色（`explore: fix login`）时，managed 与 roleHint 不许打架
  // 2026-11-04（复读三轮红）：走 `subagent` 兜底时也不许再给「没配、默认工具面」的错误提示
  const subWorld = makeWorld()
  subWorld.ctx.tools.register({ name: 'lc_b__one', description: 'x', parameters: {}, output: {} })
  apply(subWorld.ctx, { groups: [{ id: 'lc-b', match: ['lc_b__*'] }], autoGroups: 'off', managedRoles: { subagent: { allowGroups: ['lc-b'] } } })
  const subChild = subWorld.createAgent('agent-sub', (agent) => { agent.session = { header: { parentSession: 'p', label: 'explore: fix login' } } })
  const hSub = await runTool(subWorld, 'lazy_tools_health', {}, subChild)
  assert.equal(hSub.managed && hSub.managed.role, 'subagent', '应落到 subagent 兜底')
  assert.equal(hSub.managed && hSub.managed.source, 'subagent', '兜底应记 source=subagent')
  assert.ok(!hSub.session || hSub.session.roleHint == null, 'subagent 兜底时不许再给 roleHint：' + JSON.stringify(hSub.session && hSub.session.roleHint))
  const h94 = await runTool(labelWorld, 'lazy_tools_health', {}, mkL('agent-b4', 'hermes: fix login'))
  assert.equal(h94.managed && h94.managed.role, 'hermes', '首段即角色必须生效')
  assert.ok(!h94.session || h94.session.roleHint == null, 'managed 生效时不许再给 roleHint：' + JSON.stringify(h94.session && h94.session.roleHint))
  const h93 = await runTool(labelWorld, 'lazy_tools_health', {}, mkL('agent-b3', 'v:hermes'))
  assert.equal(h93.managed && h93.managed.role, 'hermes', '短 vendor 前缀也要认')
  ok('label 确定性：摘要词不参与、vendor 后第一段生效')

  // 2026-11-04（与别名共存）：agent 作用域注册的工具不可 restrict，抽屉不许拿它去发 deny
  log('[93] 与作用域内工具共存：别名不被抽屉误藏，也不产生「不可限制」错误')
  const aliasWorld = makeWorld()
  aliasWorld.ctx.tools.register({ name: 'ga_a__one', description: 'x', parameters: {}, output: {} })
  aliasWorld.ctx.tools.register({ name: 'ga_b__one', description: 'x', parameters: {}, output: {} })
  apply(aliasWorld.ctx, { groups: [{ id: 'ga-a', match: ['ga_a__*'] }], autoGroups: 'off', managedRoles: { hermes: { allowGroups: ['ga-a'] } } })
  const aliasChild = aliasWorld.createAgent('agent-alias-coexist', (agent) => {
    agent.session = { header: { parentSession: 'p', label: 'dsh-x:hermes' } }
    // 模拟别名插件在该会话作用域注册了 ext_billing（不是全局工具）
    aliasWorld.addScoped(agent, 'ext_billing')
  })
  const aliasHealth = await runTool(aliasWorld, 'lazy_tools_health', {}, aliasChild)
  assert.equal(aliasHealth.managed && aliasHealth.managed.role, 'hermes', '角色要生效')
  const aliasDeny = aliasWorld.denyByAgent.get(aliasChild)
  assert.ok(aliasDeny.has('ga_b__one'), '角色不允许的全局工具必须被藏')
  assert.ok(!aliasDeny.has('ext_billing'), '作用域内工具不可 restrict，抽屉不许去 deny 它')
  assert.ok((aliasWorld.visibleNames(aliasChild) || []).includes('ext_billing'), '别名必须仍然可见')
  const aliasErrs = aliasHealth.errors || []
  assert.equal(aliasErrs.filter((e) => String(e.message || '').includes('不可限制')).length, 0, '不许再记「不可限制」错误：' + JSON.stringify(aliasErrs))
  ok('与作用域内工具共存：别名不被误藏、无错误记录')

  // 2026-11-05（外部审阅 P0）：disable 的 name 分支已删 —— 传 name 不许把「关」变成「只放这一个」
  log('[94] disable 不接受 name：传了只报错，不改会话模式')
  const dnWorld = makeWorld()
  dnWorld.ctx.tools.register({ name: 'dt_one', description: 'x', parameters: {}, output: {} })
  dnWorld.ctx.tools.register({ name: 'dt_two', description: 'x', parameters: {}, output: {} })
  apply(dnWorld.ctx, { groups: [{ id: 'dt', match: ['dt_*'] }], autoGroups: 'off' })
  const dnAgent = dnWorld.createAgent('agent-disable-name')
  const dnBefore = await runTool(dnWorld, 'lazy_tools_status', {}, dnAgent)
  const dnBeforeGroup = (dnBefore.groups || []).find((g) => g.id === 'dt')
  const dnRes = await runTool(dnWorld, 'lazy_tools_disable', { name: 'dt_one' }, dnAgent)
  assert.ok(dnRes && dnRes.error, '传 name 必须报错：' + JSON.stringify(dnRes))
  assert.ok(String(dnRes.error).includes('group'), '错误文案要说清要 group：' + dnRes.error)
  const dnStatus = await runTool(dnWorld, 'lazy_tools_status', {}, dnAgent)
  const dnGroup = (dnStatus.groups || []).find((g) => g.id === 'dt')
  assert.equal(dnGroup && dnGroup.mode, dnBeforeGroup && dnBeforeGroup.mode, '传 name 不许改变会话模式：' + JSON.stringify(dnGroup))
  assert.notEqual(dnGroup && dnGroup.mode, 'only', '传 name 绝不许变成 only：' + JSON.stringify(dnGroup))
  ok('disable 传 name：只报错、不改模式')

  // 2026-11-05：allowGroups: [] = 只留常驻（以前被当成无效条目丢掉）
  log('[95] allowGroups: [] 合法，语义 = 只留 CORE')
  const coreWorld = makeWorld()
  coreWorld.ctx.tools.register({ name: 'read', description: 'core', parameters: {}, output: {} })
  coreWorld.ctx.tools.register({ name: 'cx_a__one', description: 'x', parameters: {}, output: {} })
  apply(coreWorld.ctx, { groups: [{ id: 'cx-a', match: ['cx_a__*'] }], autoGroups: 'off', managedRoles: { re: { allowGroups: [] } } })
  const coreChild = coreWorld.createAgent('agent-core-only', (agent) => { agent.session = { header: { parentSession: 'p', label: 'dsh-x:re' } } })
  const coreVisible = coreWorld.visibleNames(coreChild) || []
  assert.ok(coreVisible.includes('read'), 'CORE 工具必须可见：' + JSON.stringify(coreVisible))
  assert.ok(!coreVisible.includes('cx_a__one'), '非 CORE 组内工具必须不可见：' + JSON.stringify(coreVisible))
  ok('allowGroups: [] = 只留 CORE')

  // 2026-11-05：errors[] 只进不出 —— health { clear: true } 要能清
  log('[96] health clear：清掉瞬时错误后 healthy 回真')
  const clrWorld = makeWorld()
  clrWorld.ctx.tools.register({ name: 'cl_a', description: 'x', parameters: {}, output: {} })
  apply(clrWorld.ctx, { groups: [{ id: 'cl', match: ['re:['] }], autoGroups: 'off' })
  const clrAgent = clrWorld.createAgent('agent-clear-errors')
  const clrBefore = await runTool(clrWorld, 'lazy_tools_health', {}, clrAgent)
  assert.equal(clrBefore.healthy, false, '坏正则必须把 healthy 拉红')
  assert.ok((clrBefore.errors || []).some((e) => String(e.where || '').includes('group pattern')), '坏正则要记账')
  const clrAfter = await runTool(clrWorld, 'lazy_tools_health', { clear: true }, clrAgent)
  assert.ok(clrAfter.clearedErrors >= 1, '要报清掉几条：' + JSON.stringify(clrAfter.clearedErrors))
  assert.equal(clrAfter.healthy, true, '清掉后 healthy 必须回真：' + JSON.stringify(clrAfter))
  assert.equal((clrAfter.errors || []).length, 0, '清后不许还有错误')
  ok('health clear：healthy 回真')

  // 2026-11-05：守卫不可用必须记账，不许静默全绿
  log('[97] 宿主没有 tools.guard：必须记账且 healthy=false')
  const ngWorld = makeWorld()
  ngWorld.ctx.tools.guard = undefined
  ngWorld.ctx.tools.register({ name: 'ng_a', description: 'x', parameters: {}, output: {} })
  apply(ngWorld.ctx, { groups: [{ id: 'ng', match: ['ng_*'] }], autoGroups: 'off' })
  const ngAgent = ngWorld.createAgent('agent-no-guard')
  const ngHealth = await runTool(ngWorld, 'lazy_tools_health', {}, ngAgent)
  assert.ok((ngHealth.errors || []).some((e) => String(e.where || '') === 'tools.guard'), '缺 guard 必须记账：' + JSON.stringify(ngHealth.errors))
  assert.equal(ngHealth.healthy, false, '缺 guard 不许 healthy=true')
  ok('缺 guard：记账 + 红')

  // 2026-11-05：写用户组文件时目录要跟着文件走（可被 LAZY_TOOLS_GROUPS_FILE 覆盖）
  log('[98] writeUserGroups 指向新目录时不许 ENOENT')
  const { writeUserGroups } = await import('../lib/api.js')
  const oldGroupsFile = process.env.LAZY_TOOLS_GROUPS_FILE
  const newDir = join(tmpdir(), 'lazy-tools-groups-' + Date.now())
  process.env.LAZY_TOOLS_GROUPS_FILE = join(newDir, 'groups.json')
  try {
    const written = writeUserGroups([{ id: 'ug', match: ['ug_*'] }])
    assert.equal(written, process.env.LAZY_TOOLS_GROUPS_FILE)
    assert.ok(existsSync(written), '文件要真的写出来')
    ok('writeUserGroups：目录跟文件走')
  } finally {
    process.env.LAZY_TOOLS_GROUPS_FILE = oldGroupsFile
  }

  // 2026-11-05（外部审阅 C2）：回环桥写操作要自定义头；客户端两条 POST 都必须带头。
  // 这不是行为测试，是**接线测试**：真正的失败模式是「只改了服务端，忘了客户端」。
  log('[99] 桥写操作接线：服务端验头 + 客户端两条 POST 都带头')
  const bridgeApiSrc = readFileSync(new URL('../lib/api.js', import.meta.url), 'utf8')
  const clientSrc = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.ok(bridgeApiSrc.includes("headers['x-lazy-tools']"), '服务端必须验 x-lazy-tools 头')
  assert.ok(bridgeApiSrc.includes('missing x-lazy-tools header'), '缺头必须 403 并有明确错误')
  const headerCount = (clientSrc.match(/'x-lazy-tools': '1'/g) || []).length
  assert.ok(headerCount >= 2, '客户端 request() 与心跳都要带头，实际 ' + headerCount + ' 处')
  ok('桥写操作：服务端验头、客户端两处带头')

  // 2026-11-05（冷读红 1）：guard 缺失是结构问题，health {clear:true} 不许把它洗成 healthy=true
  log('[100] 缺 guard 时 clear 拒绝清空（不许假绿）')
  const ngcWorld = makeWorld()
  ngcWorld.ctx.tools.guard = undefined
  ngcWorld.ctx.tools.register({ name: 'ngc_a', description: 'x', parameters: {}, output: {} })
  apply(ngcWorld.ctx, { groups: [{ id: 'ngc', match: ['ngc_*'] }], autoGroups: 'off' })
  const ngcAgent = ngcWorld.createAgent('agent-no-guard-clear')
  const ngcBefore = await runTool(ngcWorld, 'lazy_tools_health', {}, ngcAgent)
  assert.equal(ngcBefore.healthy, false, '起点必须红')
  assert.ok((ngcBefore.contracts || []).some((c) => c.id === 'tools.guard'), '契约里必须有 tools.guard：' + JSON.stringify(ngcBefore.contracts))
  assert.equal(ngcBefore.contracts.find((c) => c.id === 'tools.guard').ok, false, '缺 guard 契约必须 ok=false')
  const ngcAfter = await runTool(ngcWorld, 'lazy_tools_health', { clear: true }, ngcAgent)
  assert.ok(ngcAfter.clearRefused, '必须拒绝清空：' + JSON.stringify(ngcAfter.clearRefused))
  assert.equal(ngcAfter.healthy, false, 'clear 之后仍是红，不许假绿：' + JSON.stringify(ngcAfter))
  assert.ok((ngcAfter.errors || []).some((e) => String(e.where || '') === 'tools.guard'), '错误也不该被清掉')
  ok('缺 guard：clear 拒绝、healthy 仍红')

  // 2026-11-05（冷读红 3）：桥鉴权原来只有源码字符串测试 —— 反转判据也全绿。
  // 这里直接挂一个假 webServer，走真 handler：无头 403、带头 200。
  log('[101] 桥鉴权行为：无头 403、带头 200、GET 不受限')
  const { mountBridge } = await import('../lib/api.js')
  let bridgeHandler = null
  const bridgeCtx = {
    get(key) {
      if (key === 'webServer') return { register(def) { bridgeHandler = def.handler; return () => {} } }
      return undefined
    },
    inject() { return () => {} },
  }
  const appliedPolicies = []
  const appliedMtimes = []
  mountBridge(bridgeCtx, { own() {}, record() {} }, {
    getState: () => ({ ok: true }),
    applyPolicy: (next) => { appliedPolicies.push(next) },
    setPolicyMtime: (v) => { appliedMtimes.push(v) },
    record() {},
  })
  assert.ok(typeof bridgeHandler === 'function', '桥要注册 handler')

  const fakeRes = () => {
    const out = { code: null, body: null }
    return {
      writeHead(code) { out.code = code },
      end(text) { out.body = text },
      out,
    }
  }
  const fakeReq = (method, url, headers, body) => {
    const handlers = {}
    return {
      method, url, headers,
      on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn) },
      emit(ev, arg) { for (const fn of handlers[ev] || []) fn(arg) },
      body,
    }
  }
  const callBridge = async (method, url, headers, body) => {
    const req = fakeReq(method, url, Object.assign({ host: '127.0.0.1:12345' }, headers || {}), body)
    const res = fakeRes()
    const p = bridgeHandler(req, res)
    if (body !== undefined) {
      setTimeout(() => { req.emit('data', JSON.stringify(body)); req.emit('end') }, 0)
    }
    await p
    return res.out
  }

  const noHeader = await callBridge('POST', '/lazy-tools/api/policy', { 'content-type': 'application/json' }, { level: 'low' })
  assert.equal(noHeader.code, 403, '无 x-lazy-tools 头必须 403：' + JSON.stringify(noHeader))
  assert.equal(appliedPolicies.length, 0, '被拒的请求不许改策略')

  const withHeader = await callBridge('POST', '/lazy-tools/api/policy', { 'content-type': 'application/json', 'x-lazy-tools': '1' }, { level: 'low' })
  assert.equal(withHeader.code, 200, '带头必须放行：' + JSON.stringify(withHeader))
  assert.equal(appliedPolicies.length, 1, '放行后要真的改策略')
  assert.equal(appliedMtimes.length, 1, '写盘后要追平 mtime')
  assert.ok(Number(appliedMtimes[0]) > 0, '追平的 mtime 必须是有效值，不能是 0')

  const getState = await callBridge('GET', '/lazy-tools/api/state', {}, undefined)
  assert.equal(getState.code, 200, 'GET 不受 POST 头限制：' + JSON.stringify(getState))
  ok('桥鉴权行为：无头 403、带头 200、GET 放行')

  // 2026-11-05（元宝挑刺 1）：managedRoles.allowGroups: ['*'] 必须 = 全开，不许记成 hide
  log("[102] allowGroups ['*'] 语义：状态与放行一致")
  rmSync(`${NO_SUCH}.policy.json`, { force: true }) // 前面的 roles 写测试会留下 policy 文件（显式清空语义）
  const starWorld = makeWorld()
  starWorld.ctx.tools.register({ name: 'st_a', description: 'x', parameters: {}, output: {} })
  apply(starWorld.ctx, { groups: [{ id: 'st', match: ['st_*'] }], autoGroups: 'off', managedRoles: { root: { allowGroups: ['*'] } } })
  const starAgent = starWorld.createAgent('agent-star', (a) => { a.session = { header: { parentSession: 'p', label: 'v:root' } } })
  const starStatus = await runTool(starWorld, 'lazy_tools_status', {}, starAgent)
  const starGroup = (starStatus.groups || []).find((g) => g.id === 'st')
  assert.equal(starGroup && starGroup.mode, 'all', "'*' 必须是全开：" + JSON.stringify(starGroup))
  assert.ok((starWorld.visibleNames(starAgent) || []).includes('st_a'), "'*' 下组内工具必须可见")
  ok("allowGroups ['*']：状态 all、工具可见")

  // 2026-11-05（元宝挑刺 2）：DNS rebinding 防护 —— Host 非回环必须 403
  log('[103] 桥 Host 必须回环：evil.example → 403')
  const evil = await callBridge('POST', '/lazy-tools/api/policy', { host: 'evil.example:4321', 'content-type': 'application/json', 'x-lazy-tools': '1' }, { level: 'low' })
  assert.equal(evil.code, 403, '非回环 Host 必须 403：' + JSON.stringify(evil))
  ok('桥 Host：非回环 403')

  // 2026-11-05（元宝挑刺 3）：errors 超过 8 条被挤掉后，同类错误复发必须还能记进来
  log('[104] seenErrors 与 errors 同步：第 1 种错误挤掉后能复发')
  const hostMod = await import('../lib/host.js')
  const h = hostMod.createHost({ get() {}, inject() {}, on() {}, effect() {}, tools: { register() {}, schemas() { return [] }, get() {}, guard() { return () => {} }, view() { return { visible: new Map() } } } })
  for (let i = 1; i <= 9; i += 1) h.record('probe', new Error('e' + i))
  assert.equal(h.errors().length, 8, '最多留 8 条')
  h.record('probe', new Error('e1'))
  assert.ok(h.errors().some((e) => e.message === 'e1'), 'e1 复发必须重新记账：' + JSON.stringify(h.errors()))
  ok('seenErrors 同步：挤掉的错误可复发')

  // 2026-11-06（DSH 2.0.22）：根 schemas(agent) 可能被解析成全局视图，
  // 隐藏的工具会"看起来还在"；如果用它做泄漏检测，就会每轮重建（上一轮实测 6,242 次）。
  // 这里把 schemas 改成返回全局（含隐藏项），断言 view 优先、restrict 不再重跑。
  // 2026-11-06：名字优先走 view；这里只锁顺序（schemas 与 view 同源）。
  log('[105] toolNames 优先 view（不退回 schemas）')
  const hostView = hostMod.createHost({
    get() {},
    inject() {},
    on() {},
    effect() {},
    tools: {
      register() {},
      get() {},
      view() {
        return { visible: new Map([['v_keep', {}]]) }
      },
      schemas() {
        return [{ name: 'v_keep' }, { name: 'v_hide' }]
      },
    },
  })
  assert.deepEqual(hostView.toolNames({}), ['v_keep'], 'view 有名字时不能退回全局 schemas')
  assert.deepEqual(hostView.toolNames({ ctx: {} }), ['v_keep'], '与 agent 参数无关：view 优先')
  ok('toolNames 优先 view（schemas 全局视图不误判）')

  // 对照：view 抛错时退回 schemas 并记账（orchestrator 测试里的 "survives a throwing registry"）
  log('[106] view 抛错时退回 schemas，不变成空')
  const hostFallback = hostMod.createHost({
    get() {},
    inject() {},
    on() {},
    effect() {},
    tools: {
      register() {},
      get() {},
      view() {
        throw new Error('view boom')
      },
      schemas() {
        return [{ name: 's_one' }]
      },
    },
  })
  assert.deepEqual(hostFallback.toolNames({}), ['s_one'], 'view 抛错应退回 schemas')
  assert.equal(hostFallback.errors().some((e) => e.where === 'tools.view'), true, 'view 失败要记账')
  ok('view 抛错：退回 schemas + 记 tools.view')

  // 红 1（冷读）：toolNames 不能信任空视图 —— 与 visibleNames 同一不变量
  log('[107] 空视图必须回退 schemas（不许静默当成没有工具）')
  const hostEmpty = hostMod.createHost({
    get() {},
    inject() {},
    on() {},
    effect() {},
    tools: {
      register() {},
      get() {},
      view() {
        return { visible: new Map() }
      },
      schemas() {
        return [{ name: 's_one' }]
      },
    },
  })
  assert.deepEqual(hostEmpty.toolNames({}), ['s_one'], '空视图必须回退 schemas')
  ok('空视图回退 schemas（同 visibleNames 不变量）')

  // 一类 3 秒重建链的机制：作用域注册的工具可见但不可 restrict，
  // 旧泄漏检测把它当"漏网"，于是每 3 秒重建一次（无报错）。
  // 冷读红 1：scope 同名遮蔽 —— 名字在 restrictableNames 里，但 own 注册永远 visible，
  // 只按名字过滤会每 3 秒重建一次；必须用「本轮之后实际可见」兜底。
  log('[108] scope 同名遮蔽：不反复重建（同步事件 + 3 秒链）')
  const worldSc = makeWorld()
  worldSc.ctx.tools.register({ name: 'sc_global', description: 'x', parameters: {}, output: {} })
  apply(worldSc.ctx, { groups: [{ id: 'sc', match: ['sc_*'], defaultOn: false }], autoGroups: 'off' })
  const agentSc = worldSc.createAgent('agent-scoped')
  worldSc.addScoped(agentSc, 'sc_global') // 同名 scope 注册：永远可见
  worldSc.setSyncRestrictEvents(true)
  process.env.LAZY_TOOLS_COOLDOWN_MS = '20'
  const beforeSc = await runTool(worldSc, 'lazy_tools_health', {}, agentSc)
  worldSc.fireToolsChange()
  await new Promise((resolve) => setTimeout(resolve, 400))
  const settle1 = await runTool(worldSc, 'lazy_tools_health', {}, agentSc)
  worldSc.fireToolsChange()
  await new Promise((resolve) => setTimeout(resolve, 200))
  delete process.env.LAZY_TOOLS_COOLDOWN_MS
  const settle2 = await runTool(worldSc, 'lazy_tools_health', {}, agentSc)
  assert.equal(settle2.stats.rebuilds, settle1.stats.rebuilds, '作用域遮蔽不该形成 3 秒重建链')
  assert.ok(settle1.stats.rebuilds - beforeSc.stats.rebuilds <= 3, `允许一次发现性重建，但不能是风暴：${JSON.stringify(settle1.stats)}`)
  assert.deepEqual(settle2.unhideable, ['sc_global'], '藏不掉的名字要如实记账')
  ok('scope 同名遮蔽：允许一次发现，之后不再重建')

  // 冷读红 2：读不到 restrictableNames 时，旧过滤整体失效 —— 不能退回风暴。
  log('[109] 读不到 restrictableNames：仍不形成重建链')
  const worldNv = makeWorld()
  worldNv.ctx.tools.register({ name: 'nv_global', description: 'x', parameters: {}, output: {} })
  apply(worldNv.ctx, { groups: [{ id: 'nv', match: ['nv_*'], defaultOn: false }], autoGroups: 'off' })
  const agentNv = worldNv.createAgent('agent-no-view')
  worldNv.addScoped(agentNv, 'nv_global')
  const viewBeforeDrop = worldNv.ctx.tools.view
  worldNv.ctx.tools.view = (agent) => {
    const view = viewBeforeDrop(agent)
    return { visible: view.visible }
  }
  worldNv.setSyncRestrictEvents(true)
  process.env.LAZY_TOOLS_COOLDOWN_MS = '20'
  worldNv.fireToolsChange()
  await new Promise((resolve) => setTimeout(resolve, 400))
  const noView1 = await runTool(worldNv, 'lazy_tools_health', {}, agentNv)
  worldNv.fireToolsChange()
  await new Promise((resolve) => setTimeout(resolve, 200))
  delete process.env.LAZY_TOOLS_COOLDOWN_MS
  const noView2 = await runTool(worldNv, 'lazy_tools_health', {}, agentNv)
  assert.equal(noView2.stats.rebuilds, noView1.stats.rebuilds, '读不到 restrictableNames 不该形成重建链')
  ok('restrictableNames 不可读：不重建')

  // 复读黄 2：systemic 失败后不能把"没藏成"锁进 unhideable，否则恢复后永不重试。
  log('[110] systemic restrict 失败后：下一轮能重试、不锁 unhideable')
  const worldTr = makeWorld()
  worldTr.ctx.tools.register({ name: 'fl_tool', description: 'x', parameters: {}, output: {} })
  worldTr.failNextRestrict(1)
  apply(worldTr.ctx, { groups: [{ id: 'fl', match: ['fl_tool'], defaultOn: false }], autoGroups: 'off' })
  const agentTr = worldTr.createAgent('agent-transient')
  const hTr1 = await runTool(worldTr, 'lazy_tools_health', {}, agentTr)
  assert.equal(hTr1.errors.some((e) => e.where === 'tools.restrict'), true, '首次失败要记账')
  process.env.LAZY_TOOLS_COOLDOWN_MS = '20'
  worldTr.fireToolsChange()
  await new Promise((resolve) => setTimeout(resolve, 120))
  delete process.env.LAZY_TOOLS_COOLDOWN_MS
  const hTr2 = await runTool(worldTr, 'lazy_tools_health', {}, agentTr)
  assert.ok(!worldTr.visibleNames(agentTr).includes('fl_tool'), `恢复后要藏住：${JSON.stringify(worldTr.visibleNames(agentTr))}`)
  assert.deepEqual(hTr2.unhideable, [], '失败轮不能留下 unhideable 闩锁')
  ok('systemic 失败后可重试（不锁 unhideable）')

  // 暴力测试 A：正常 world 1000 次 tools/change，不允许增长
  log('[111] 暴力：正常 world 1000 次 tools/change')
  const worldBrA = makeWorld()
  worldBrA.ctx.tools.register({ name: 'br_a', description: 'x', parameters: {}, output: {} })
  apply(worldBrA.ctx, { groups: [{ id: 'br', match: ['br_a'], defaultOn: false }], autoGroups: 'off' })
  const agentBrA = worldBrA.createAgent('agent-brute-a')
  const baseBrA = (await runTool(worldBrA, 'lazy_tools_health', {}, agentBrA)).stats.rebuilds
  process.env.LAZY_TOOLS_COOLDOWN_MS = '0'
  for (let i = 0; i < 1000; i += 1) worldBrA.fireToolsChange()
  delete process.env.LAZY_TOOLS_COOLDOWN_MS
  const afterBrA = await runTool(worldBrA, 'lazy_tools_health', {}, agentBrA)
  assert.ok(afterBrA.stats.rebuilds - baseBrA <= 5, `1000 次事件后重建次数失控：${afterBrA.stats.rebuilds - baseBrA}`)
  ok(`1000 次 tools/change：rebuilds +${afterBrA.stats.rebuilds - baseBrA}`)

  // 暴力测试 B：10 个 agent + 同名遮蔽 + 同步事件，200 次事件后都要收敛
  log('[112] 暴力：10 个 shadow agent + 同步事件 200 次')
  const worldBrC = makeWorld()
  worldBrC.ctx.tools.register({ name: 'sh_global', description: 'x', parameters: {}, output: {} })
  apply(worldBrC.ctx, { groups: [{ id: 'sh', match: ['sh_*'], defaultOn: false }], autoGroups: 'off' })
  const agentsBrC = []
  for (let i = 0; i < 10; i += 1) {
    const agent = worldBrC.createAgent('agent-shadow-' + i)
    worldBrC.addScoped(agent, 'sh_global')
    agentsBrC.push(agent)
  }
  worldBrC.setSyncRestrictEvents(true)
  process.env.LAZY_TOOLS_COOLDOWN_MS = '0'
  for (let i = 0; i < 200; i += 1) worldBrC.fireToolsChange()
  delete process.env.LAZY_TOOLS_COOLDOWN_MS
  for (const agent of agentsBrC) {
    const h = await runTool(worldBrC, 'lazy_tools_health', {}, agent)
    assert.deepEqual(h.unhideable, ['sh_global'])
  }
  const hGlobalC = await runTool(worldBrC, 'lazy_tools_health', {}, agentsBrC[0])
  assert.ok(hGlobalC.stats.rebuilds <= 40, `shadow 重建失控（全局）：${JSON.stringify(hGlobalC.stats)}`)
  ok(`10 个 shadow agent：200 次事件后全局 rebuilds ≤ 40（实际 ${hGlobalC.stats.rebuilds}）`)

  // 暴力测试 C：读不到 restrictableNames + 同步事件 500 次
  log('[113] 暴力：无 restrictableNames 500 次事件')
  const worldBrD = makeWorld()
  worldBrD.ctx.tools.register({ name: 'nv2_global', description: 'x', parameters: {}, output: {} })
  apply(worldBrD.ctx, { groups: [{ id: 'nv2', match: ['nv2_*'], defaultOn: false }], autoGroups: 'off' })
  const agentBrD = worldBrD.createAgent('agent-no-view-2')
  worldBrD.addScoped(agentBrD, 'nv2_global')
  const viewBrD = worldBrD.ctx.tools.view
  worldBrD.ctx.tools.view = (agent) => ({ visible: viewBrD(agent).visible })
  worldBrD.setSyncRestrictEvents(true)
  process.env.LAZY_TOOLS_COOLDOWN_MS = '0'
  for (let i = 0; i < 500; i += 1) worldBrD.fireToolsChange()
  delete process.env.LAZY_TOOLS_COOLDOWN_MS
  const hBrD = await runTool(worldBrD, 'lazy_tools_health', {}, agentBrD)
  assert.ok(hBrD.stats.rebuilds <= 4, `无 restrictableNames 时重建失控：${JSON.stringify(hBrD.stats)}`)
  ok('无 restrictableNames：500 次事件后 rebuilds ≤ 4')

  // 冷读红 2：部分失败不能把失败名字锁进 unhideable（旧 applied 整批布尔会锁）。
  log('[114] 真实部分失败：p_ok 藏住、p_fail systemic、p_bad 坏名')
  const worldPart = makeWorld({ nonRestrictable: ['p_bad'] })
  worldPart.ctx.tools.register({ name: 'p_ok', description: 'x', parameters: {}, output: {} })
  worldPart.ctx.tools.register({ name: 'p_fail', description: 'x', parameters: {}, output: {} })
  worldPart.ctx.tools.register({ name: 'p_bad', description: 'x', parameters: {}, output: {} })
  const undoFail = worldPart.failRestrictSingle('p_fail')
  apply(worldPart.ctx, { groups: [{ id: 'p', match: ['p_*'], defaultOn: false }], autoGroups: 'off' })
  const agentPart = worldPart.createAgent('agent-partial')
  const hPart1 = await runTool(worldPart, 'lazy_tools_health', {}, agentPart)
  const vis1 = worldPart.visibleNames(agentPart)
  assert.equal(vis1.includes('p_ok'), false, 'p_ok 应该被藏住')
  assert.equal(vis1.includes('p_fail'), true, 'p_fail 这轮应该还可见')
  assert.equal((hPart1.unhideable || []).includes('p_fail'), false, 'transient 的 p_fail 不能锁')
  assert.equal((hPart1.unhideable || []).includes('p_bad'), true, '坏名 p_bad 应锁')
  undoFail()
  process.env.LAZY_TOOLS_COOLDOWN_MS = '0'
  worldPart.fireToolsChange()
  delete process.env.LAZY_TOOLS_COOLDOWN_MS
  const hPart2 = await runTool(worldPart, 'lazy_tools_health', {}, agentPart)
  assert.equal(worldPart.visibleNames(agentPart).includes('p_fail'), false, '恢复后应重试并藏住 p_fail')
  assert.equal((hPart2.unhideable || []).includes('p_fail'), false, '恢复后 p_fail 不应留在锁里')
  ok('真实部分失败：transient 不锁，恢复后藏住')

  // 冷读红 2b：reserved PTC 是 permanent，不能每次事件都重试（旧逻辑 500 事件 501 次重建）。
  log('[115] reserved PTC：永久闩锁，不无限重建')
  const worldPtc = makeWorld()
  worldPtc.ctx.tools.register({ name: 'ptc_tool', description: 'x', parameters: {}, output: {} })
  worldPtc.reservePtc('ptc_tool')
  apply(worldPtc.ctx, { groups: [{ id: 'ptc', match: ['ptc_*'], defaultOn: false }], autoGroups: 'off' })
  const agentPtc = worldPtc.createAgent('agent-ptc')
  const hPtc1 = await runTool(worldPtc, 'lazy_tools_health', {}, agentPtc)
  assert.equal((hPtc1.unhideable || []).includes('ptc_tool'), true, 'permanent 名字要锁住')
  process.env.LAZY_TOOLS_COOLDOWN_MS = '0'
  for (let i = 0; i < 200; i += 1) worldPtc.fireToolsChange()
  delete process.env.LAZY_TOOLS_COOLDOWN_MS
  const hPtc2 = await runTool(worldPtc, 'lazy_tools_health', {}, agentPtc)
  assert.ok(hPtc2.stats.rebuilds <= 3, `permanent 名字不该反复重建：${JSON.stringify(hPtc2.stats)}`)
  ok('reserved PTC：200 次事件后 rebuilds ≤ 3')

  log('[116] 晚注册：签名变化清锁，别名变全局后能藏住')
  const worldLate = makeWorld()
  apply(worldLate.ctx, { groups: [{ id: 'late', match: ['late_*'], defaultOn: false }], autoGroups: 'off' })
  const agentLate = worldLate.createAgent('agent-late')
  worldLate.addScoped(agentLate, 'late_tool') // 只有作用域别名，不可 restrict
  process.env.LAZY_TOOLS_COOLDOWN_MS = '0'
  worldLate.fireToolsChange()
  let hLate = await runTool(worldLate, 'lazy_tools_health', {}, agentLate)
  assert.equal((hLate.unhideable || []).includes('late_tool'), true, '别名壳应被锁')
  worldLate.scopedByAgent.get(agentLate).delete('late_tool') // alias 退场
  worldLate.ctx.tools.register({ name: 'late_tool', description: 'x', parameters: {}, output: {} })
  worldLate.fireToolsChange() // 签名变化 → 清锁 → 重试
  delete process.env.LAZY_TOOLS_COOLDOWN_MS
  hLate = await runTool(worldLate, 'lazy_tools_health', {}, agentLate)
  assert.equal(worldLate.visibleNames(agentLate).includes('late_tool'), false, '全局注册后应能藏住')
  assert.equal((hLate.unhideable || []).includes('late_tool'), false, '藏住后不该留锁')
  ok('晚注册：签名变化清锁，别名变全局后能藏住')

  log('[117] 别名壳被组匹配：锁住，不形成 tools/change 重建链')
  const worldShim = makeWorld()
  worldShim.ctx.tools.register({ name: 'al_global', description: 'x', parameters: {}, output: {} })
  apply(worldShim.ctx, { groups: [{ id: 'al', match: ['al_*'], defaultOn: false }], autoGroups: 'off' })
  const agentShim = worldShim.createAgent('agent-shim')
  worldShim.addScoped(agentShim, 'al_shim') // 作用域注册、被组匹配、不可 restrict
  process.env.LAZY_TOOLS_COOLDOWN_MS = '0'
  worldShim.fireToolsChange()
  const baseShim = (await runTool(worldShim, 'lazy_tools_health', {}, agentShim)).stats.rebuilds
  for (let i = 0; i < 100; i += 1) worldShim.fireToolsChange()
  delete process.env.LAZY_TOOLS_COOLDOWN_MS
  const hShim = await runTool(worldShim, 'lazy_tools_health', {}, agentShim)
  assert.ok(hShim.stats.rebuilds - baseShim <= 2, `别名壳不该每次事件重建：+${hShim.stats.rebuilds - baseShim}`)
  assert.equal((hShim.unhideable || []).includes('al_shim'), true, '别名壳应被锁')
  ok('别名壳被组匹配：100 次事件 rebuilds 有界')

  log('[118] 陈旧 hideReport：上轮 transient、本轮退成别名壳，仍要锁')
  const worldStale = makeWorld()
  worldStale.ctx.tools.register({ name: 'g_one', description: 'x', parameters: {}, output: {} })
  worldStale.failRestrictFor('g_one')
  apply(worldStale.ctx, { groups: [{ id: 'g', match: ['g_*'], defaultOn: false }], autoGroups: 'off' })
  const agentStale = worldStale.createAgent('agent-stale')
  const undoStale = worldStale.failRestrictFor('g_one')
  undoStale()
  worldStale.registered.delete('g_one') // 退成 scope 别名
  worldStale.addScoped(agentStale, 'g_one')
  process.env.LAZY_TOOLS_COOLDOWN_MS = '0'
  worldStale.fireToolsChange()
  const baseStale = (await runTool(worldStale, 'lazy_tools_health', {}, agentStale)).stats.rebuilds
  for (let i = 0; i < 100; i += 1) worldStale.fireToolsChange()
  delete process.env.LAZY_TOOLS_COOLDOWN_MS
  const hStale = await runTool(worldStale, 'lazy_tools_health', {}, agentStale)
  assert.ok(hStale.stats.rebuilds - baseStale <= 2, `陈旧报告不该造成每次事件重建：+${hStale.stats.rebuilds - baseStale}`)
  assert.equal((hStale.unhideable || []).includes('g_one'), true, '退成别名后应锁住')
  ok('陈旧 hideReport：退成别名后仍锁，100 次事件有界')

  console.log(`\nsmoke: ${checks} 项全过`)
}

if (process.argv[1] && process.argv[1].endsWith('smoke.mjs')) {
  main().catch((error) => {
    console.error('\nsmoke: 失败')
    console.error(error && error.stack ? error.stack : String(error))
    process.exitCode = 1
  })
}

export { makeWorld, runTool, assertJsonSafe }
