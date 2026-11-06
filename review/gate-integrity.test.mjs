// 门禁完整性：负向测试冷读裁决（JSON 块）+ verdict 校验 + 变异归因唯一性。
// 用法：node review/gate-integrity.test.mjs
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateVerdict } from './verdict-check.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const dir = mkdtempSync(join(tmpdir(), 'gate-integrity-'))
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `：${detail}` : ''}`)
  if (!ok) failed += 1
}

try {
  mkdirSync(join(dir, 'review'), { recursive: true })
  for (const file of ['verify-coldread.mjs', 'baseline.json']) {
    cpSync(join(here, file), join(dir, 'review', file))
  }
  cpSync(join(root, 'package.json'), join(dir, 'package.json'))
  const writeReport = (content) => {
    const file = join(dir, 'report.md')
    writeFileSync(file, content)
    const out = spawnSync(process.execPath, [join(dir, 'review', 'verify-coldread.mjs'), file], { encoding: 'utf8' })
    return { status: out.status, verdict: JSON.parse(readFileSync(join(dir, 'review', 'verdict.json'), 'utf8')) }
  }
  const run = (block, extra = '') =>
    writeReport(`# x\n${extra}\n\`\`\`verdict\n${JSON.stringify(block)}\n\`\`\`\n`)
  const goodBody = { baseline: 7, unverified: 0, red: 0, A: 0, B: 0 }

  const good = run(goodBody)
  check('裁决：正常 0 红通过', good.status === 0 && good.verdict.ok === true)

  check('裁决：缺 verdict 块必须失败', writeReport('# x\n正文没有块\n').status !== 0)
  check('裁决：red=3 必须失败', run({ ...goodBody, red: 3, A: 3 }).status !== 0)
  check('裁决：unverified=2 必须失败', run({ ...goodBody, unverified: 2 }).status !== 0)
  check('裁决：baseline 999 必须失败', run({ ...goodBody, baseline: 999 }).status !== 0)
  check('裁决：A+B≠red 必须失败', run({ ...goodBody, red: 0, A: 1, B: 1 }).status !== 0)
  check('裁决：坏 JSON 必须失败', writeReport('# x\n```verdict\n{broken\n```\n').status !== 0)
  check('裁决：正文含“对象：”必须失败', run(goodBody, '对象：这是摘要').status !== 0)
  check('裁决：字段 null 必须失败', run({ baseline: 7, unverified: null, red: null, A: null, B: null }).status !== 0)
  check('裁决：字段空串必须失败', run({ baseline: 7, unverified: '', red: '', A: '', B: '' }).status !== 0)
  check('裁决：baseline 字符串必须失败', run({ baseline: '7', unverified: 0, red: 0, A: 0, B: 0 }).status !== 0)
} finally {
  rmSync(dir, { recursive: true, force: true })
}

const version = '0.18.8'
const shape = { version, type: 'cold', exists: true, sha256: 'deadbeefdeadbeef', red: 0, trackA: 0, trackB: 0, unverified: 0, baseline: 7, baselineActual: 7, ok: true }
check('verdict：正常通过', evaluateVerdict(shape, version).ok === true)
check('verdict：null 必须失败', evaluateVerdict(null, version).ok === false)
check('verdict：最小对象必须失败', evaluateVerdict({ ok: true }, version).ok === false)
check('verdict：陈旧版本必须失败', evaluateVerdict({ ...shape, version: '0.18.7' }, version).ok === false)
check('verdict：ok=false 必须失败', evaluateVerdict({ ...shape, ok: false }, version).ok === false)
check('verdict：红数必须失败', evaluateVerdict({ ...shape, red: 1 }, version).ok === false)
check('verdict：未验证必须失败', evaluateVerdict({ ...shape, unverified: 1 }, version).ok === false)
check('verdict：directed 必须失败', evaluateVerdict({ ...shape, type: 'directed' }, version).ok === false)
check('verdict：exists=false 必须失败', evaluateVerdict({ ...shape, exists: false }, version).ok === false)
check('verdict：sha256 空必须失败', evaluateVerdict({ ...shape, sha256: '' }, version).ok === false)
check('verdict：baselineActual 不符必须失败', evaluateVerdict({ ...shape, baseline: 999 }, version).ok === false)
check('verdict：A+B 不符必须失败', evaluateVerdict({ ...shape, trackA: 1, trackB: 1 }, version).ok === false)

const mutations = JSON.parse(readFileSync(join(here, 'mutations.json'), 'utf8'))
const smoke = readFileSync(join(root, 'test', 'smoke.mjs'), 'utf8')
let unique = 0
for (const mutation of mutations) {
  if (!mutation.expectText || mutation.expectTest) continue
  const count = smoke.split(mutation.expectText).length - 1
  if (count === 1) unique += 1
  else console.log(`FAIL 归因不唯一：${mutation.id} expectText 出现 ${count} 次`)
}
check('mutate：每条 expectText 在测试里唯一', unique === mutations.length, `${unique}/${mutations.length}`)

console.log(`\n门禁完整性：${failed === 0 ? 'PASS' : `FAIL（${failed} 项）`}`)
if (failed > 0) process.exitCode = 1
