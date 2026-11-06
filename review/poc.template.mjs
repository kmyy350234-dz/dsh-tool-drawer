// POC 模板：任何怀疑复制本文件，改 5 行就能跑。
// 运行：node review/poc.template.mjs
import { makeWorld, runTool } from '../test/smoke.mjs'

const world = makeWorld()
world.ctx.tools.register({ name: 'poc_tool', description: 'x', parameters: {}, output: {} })
const { apply } = await import('../lib/index.js')
apply(world.ctx, { groups: [{ id: 'poc', match: ['poc_*'], defaultOn: false }], autoGroups: 'off' })
const agent = world.createAgent('poc-agent')

// 改这里：你的怀疑
const health = await runTool(world, 'lazy_tools_health', {}, agent)
console.log(JSON.stringify({ hidden: health.session.hidden, visible: health.session.visible, rebuilds: health.stats.rebuilds }))
