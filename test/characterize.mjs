// 行为快照（ref-00a）：先冻结纯函数/分组编译的可观察输出。
// 用法：
//   node test/characterize.mjs --write    生成/更新 test/fixtures/golden/groups.json
//   node test/characterize.mjs --compare  与快照逐字比较，不一致 exit 1
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileGroups, commonPrefix, matcherFor } from '../lib/groups-core.js'
import { pickNumber, pickRatio } from '../lib/startup.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const golden = join(here, 'fixtures', 'golden', 'groups.json')
const mode = process.argv[2]

const patterns = ['foo', 'foo*', 'foo?bar', 're:^cua_', 're:[', '*.js', 'a.b', 're:^[a-z0-9_]+$']
const probeNames = ['foo', 'foobar', 'fobar', 'cua_x', 'x.js', 'axb', 'abc_1']
const matcher = patterns.map((pattern) => {
  const re = matcherFor(pattern)
  return {
    pattern,
    ok: Boolean(re),
    matches: re ? probeNames.filter((name) => re.test(name)) : [],
  }
})

const common = [
  [],
  ['cua_driver_native__a'],
  ['cua_driver_native__a', 'cua_driver_native__b', 'cua_driver_native__c'],
  ['a', 'ab', 'abc'],
  ['x', 'y'],
].map((list) => ({ list, prefix: commonPrefix(list) }))

const picks = [
  [1, 2, 3],
  [NaN, 2, 3],
  [NaN, NaN, 3],
  [0.01, 1, 0.3],
  [12, 1, 0.3],
].map(([a, b, fallback]) => ({
  a: Number.isFinite(a) ? a : String(a),
  b: Number.isFinite(b) ? b : String(b),
  fallback,
  number: pickNumber(a, b, fallback),
  ratio: pickRatio(a, b, fallback),
}))

const records = []
const logs = []
const compile = compileGroups(
  [
    { id: 'web', match: ['web_*'], defaultOn: true, expect: 2 },
    { id: 'bad', match: ['re:['] },
    { id: 'manual', match: ['*'], manual: true },
    { id: 'nope', match: [] },
  ],
  false,
  {
    host: { record: (where, error) => records.push({ where, message: String(error.message) }), log: (level, msg) => logs.push({ level, msg }) },
    compatNotes: new Set(),
  },
).map((g) => ({
  id: g.id,
  res: g.res.map((re) => String(re)),
  manual: Boolean(g.manual),
  universal: Boolean(g.universal),
  expect: g.expect ?? null,
}))

const snapshot = { matcher, commonPrefix: common, picks, compile, records, logs }
const text = JSON.stringify(snapshot, null, 2) + '\n'

if (mode === '--write') {
  mkdirSync(dirname(golden), { recursive: true })
  writeFileSync(golden, text)
  console.log(`written ${golden}`)
  process.exit(0)
}
if (mode !== '--compare') {
  console.error('用法: node test/characterize.mjs --write|--compare')
  process.exit(2)
}
if (!existsSync(golden)) {
  console.error(`缺少快照 ${golden}；先跑 --write`)
  process.exit(1)
}
const expected = readFileSync(golden, 'utf8')
if (expected !== text) {
  console.error('行为与快照不一致（ref-00a）')
  const a = expected.split('\n')
  const b = text.split('\n')
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) {
      console.error(`第一处差异 line ${i + 1}`)
      console.error(`  快照: ${a[i] ?? '<缺>'}`)
      console.error(`  当前: ${b[i] ?? '<缺>'}`)
      break
    }
  }
  process.exit(1)
}
console.log('characterize: PASS（与快照一致）')
