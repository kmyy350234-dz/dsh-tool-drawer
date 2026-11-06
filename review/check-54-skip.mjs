// 54 发版脚本的 skip 语义静态检查：对抗在 skip 之前、一致性跳过必须判 FAIL。
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ps1Path = join(here, '..', '..', '..', 'perf-', '54-发版.ps1')
if (!existsSync(ps1Path)) {
  console.log('54 skip：PASS（SKIP：本环境没有 perf-/54-发版.ps1）')
  process.exit(0)
}
const ps1 = readFileSync(ps1Path, 'utf8')
const spec = JSON.parse(readFileSync(join(here, 'gate-spec.json'), 'utf8'))
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `：${detail}` : ''}`)
  if (!ok) failed += 1
}

const advPos = ps1.indexOf("$advScript = Join-Path $SrcRepo \"test/adversarial.mjs\"")
const skipPos = ps1.indexOf("Test-Skipped 'smoke'")
check('对抗在 skip 之前', advPos > 0 && skipPos > 0 && advPos < skipPos, `adv=${advPos} skip=${skipPos}`)
check(
  '一致性跳过必须判 FAIL',
  /Test-Skipped 'consistency'\)\s*\{\s*Step '6e\/7' '一致性断言' \$false/.test(ps1),
)
check(
  'gate-spec 只允许 smoke / encoding',
  JSON.stringify(spec.skippable) === JSON.stringify(['smoke', 'encoding']),
  JSON.stringify(spec.skippable),
)
check('54 拒绝未知 skip', /-notin @\('smoke', 'encoding'\)/.test(ps1))
check('对抗不可跳过', spec.notSkippable.includes('adversarial'))
check('一致性不可跳过', spec.notSkippable.includes('consistency'))
check('gate-spec 缺失直接报错', /缺 review\/gate-spec\.json/.test(ps1))

const run54 = (args) => spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(here, '..', '..', '..', 'perf-', '54-发版.ps1'), ...args], { encoding: 'utf8', timeout: 30000 })
const bogus = run54(['-Skip', 'bogus', '-Why', 'review-test'])
check('54 运行时拒绝未知 skip', bogus.status !== 0 && /未知跳过项 bogus/.test((bogus.stdout || '') + (bogus.stderr || '')))
const adv = run54(['-Skip', 'adversarial', '-Why', 'review-test'])
check('54 运行时拒绝对抗跳过', adv.status !== 0 && /不可跳过/.test((adv.stdout || '') + (adv.stderr || '')))

console.log(`\n54 skip：${failed === 0 ? 'PASS' : 'FAIL'}`)
if (failed > 0) process.exitCode = 1
