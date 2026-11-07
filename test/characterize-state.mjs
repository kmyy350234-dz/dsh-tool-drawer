// 状态行为快照（ref-00f）：在假宿主上冻结 apply/stateFor/rebuild 的可观察状态。
// 用法：node test/characterize-state.mjs --write|--compare
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { makeWorld } from './world.mjs'
import { apply } from '../lib/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const golden = join(here, 'fixtures', 'golden', 'state.json')
const mode = process.argv[2]
const noSuch = join(tmpdir(), 'lazy-tools.characterize-state')
process.env.LAZY_TOOLS_GROUPS_FILE = `${noSuch}.groups.json`
process.env.LAZY_TOOLS_POLICY_FILE = `${noSuch}.policy.json`
process.env.LAZY_TOOLS_USAGE_FILE = `${noSuch}.usage.json`

const runTool = async (world, name, args, agent) => world.registered.get(name).execute(args || {}, { agent })

async function snapshot() {
  const world = makeWorld()
  for (const name of ['cua_a', 'cua_b', 'other_tool']) {
    world.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
  }
  apply(world.ctx, {
    groups: [
      { id: 'cua', match: ['cua_*'], title: 'CUA', defaultOn: false },
      { id: 'idle', match: ['other_tool'], title: 'idle', defaultOn: true },
    ],
  })
  const agent = world.createAgent('agent-state')
  const status = await runTool(world, 'lazy_tools_status', {}, agent)
  const enable = await runTool(world, 'lazy_tools_enable', { group: 'cua' }, agent)
  const afterEnable = await runTool(world, 'lazy_tools_status', {}, agent)
  const collapse = await runTool(world, 'lazy_tools_mode', { collapse: true }, agent)
  const afterCollapse = await runTool(world, 'lazy_tools_status', {}, agent)
  return {
    status: {
      groups: status.groups.map((g) => ({ id: g.id, on: g.on, mode: g.mode, matched: g.matched, visible: g.visible })),
      hiddenTools: status.hiddenTools,
      selfHealed: status.selfHealed,
    },
    denyAfterCreate: [...world.denyByAgent.get(agent)].sort(),
    activeRestrictions: world.activeRestrictions(agent).map((r) => [...r.names].sort()),
    enable,
    afterEnable: afterEnable.groups.map((g) => ({ id: g.id, on: g.on, mode: g.mode, visible: g.visible })),
    collapse,
    afterCollapse: afterCollapse.groups.map((g) => ({ id: g.id, on: g.on, mode: g.mode, visible: g.visible })),
  }
}

const data = await snapshot()
const text = JSON.stringify(data, null, 2) + '\n'
if (mode === '--write') {
  mkdirSync(dirname(golden), { recursive: true })
  writeFileSync(golden, text)
  console.log(`written ${golden}`)
  process.exit(0)
}
if (mode !== '--compare') {
  console.error('用法: node test/characterize-state.mjs --write|--compare')
  process.exit(2)
}
if (!existsSync(golden)) {
  console.error(`缺少快照 ${golden}；先跑 --write`)
  process.exit(1)
}
if (readFileSync(golden, 'utf8') !== text) {
  console.error('状态行为与快照不一致（ref-00f）')
  process.exit(1)
}
console.log('characterize-state: PASS（与快照一致）')
