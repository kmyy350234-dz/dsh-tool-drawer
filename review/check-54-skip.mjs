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

// B1 台账接入（2026-11-06 票 findings-54）：findings 收敛必须真的出现在 54 里。
// protectedBy: perf-/54-发版.ps1 的「4e. findings 收敛」段 + review/gate-spec.json 的 notSkippable
// 只断言「字符串存在」会漏掉三种退化：① 步骤被删；② 挪到别的门禁步骤前面去；③ 无台账也不 PASS（把老发版卡死）。
const findingsPos = ps1.indexOf("Step '6h/7' 'findings 收敛'")
const mutPos = ps1.indexOf("Step '6g/7' '变异'")
check('findings 步骤存在（6h/7）', findingsPos > 0, `pos=${findingsPos}`)
check('findings 步骤排在变异（6g）之后', mutPos > 0 && findingsPos > mutPos, `findings=${findingsPos} mut=${mutPos}`)
check('findings 无台账时 PASS（不卡老发版）', /Step '6h\/7' 'findings 收敛' \$true '无台账/.test(ps1))
check('findings 台账路径来自 $SrcRepo', /\$findingsFile = Join-Path \$SrcRepo 'review\/findings\.json'/.test(ps1))
check('findings 调 findings.mjs status', /& \$gateNode \$findingsScript status/.test(ps1))
check('findings 有台账时不可跳过', spec.notSkippable.includes('findings'))

check('包内含英文介绍', /package\/README\.en\.md/.test(ps1))
check('Release 说明含验证证据', /验证证据（自动生成）/.test(ps1))
check('证据含制品 sha256', /制品：.*sha256=/.test(ps1))

const run54 = (args) => spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(here, '..', '..', '..', 'perf-', '54-发版.ps1'), ...args], { encoding: 'utf8', timeout: 30000 })
const bogus = run54(['-Skip', 'bogus', '-Why', 'review-test'])
check('54 运行时拒绝未知 skip', bogus.status !== 0 && /未知跳过项 bogus/.test((bogus.stdout || '') + (bogus.stderr || '')))
const adv = run54(['-Skip', 'adversarial', '-Why', 'review-test'])
check('54 运行时拒绝对抗跳过', adv.status !== 0 && /不可跳过/.test((adv.stdout || '') + (adv.stderr || '')))
// -Skip findings 也不许生效。注意：这个工作树跑 54 时 $SrcRepo 写死指向主检出，拒绝理由可能来自
// 主仓的旧 gate-spec（未知跳过项）或本树的 gate-spec（不可跳过）—— 两种都算过，但退出码必须非 0。
const skipFindings = run54(['-Skip', 'findings', '-Why', 'review-test'])
check(
  '54 运行时拒绝跳过 findings',
  skipFindings.status !== 0 && /(findings.*不可跳过|不可跳过.*findings|未知跳过项.*findings)/.test((skipFindings.stdout || '') + (skipFindings.stderr || '')),
  `exit=${skipFindings.status}`,
)

console.log(`
54 skip：${failed === 0 ? 'PASS' : 'FAIL'}`)
if (failed > 0) process.exitCode = 1
