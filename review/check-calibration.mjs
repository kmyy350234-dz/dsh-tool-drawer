// 校准集：拿四份已知答案的报告给冷读裁判做回归（B2）。
// 用法：node review/check-calibration.mjs
// 每份报告的裁决都写到 os.tmpdir() 下的临时目录 —— 绝不碰 review/verdict.json。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const verifier = join(here, 'verify-coldread.mjs')
const verdictFile = join(here, 'verdict.json')
const unverifiedFile = join(here, 'unverified.json')

const cases = [
  { file: 'good.md', ok: true },
  { file: 'bad-red.md', ok: false },
  { file: 'bad-unverified.md', ok: false },
  { file: 'bad-missing.md', ok: false },
]

const readOrNull = (path) => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

const before = readOrNull(verdictFile)
const beforeUnverified = readOrNull(unverifiedFile)
const diffs = []
const work = mkdtempSync(join(tmpdir(), 'coldread-calibration-'))
let passed = 0

try {
  for (const item of cases) {
    const out = join(work, `${item.file.replace(/\.md$/u, '')}.verdict.json`)
    const run = spawnSync(process.execPath, [verifier, join(here, 'calibration', item.file), '--out', out], {
      encoding: 'utf8',
      timeout: 60000,
    })
    if (run.error) {
      diffs.push(`${item.file}：裁判没跑起来（${run.error.message}）`)
      continue
    }
    if (!existsSync(out)) {
      diffs.push(`${item.file}：没有写出 ${out}（status=${run.status}）`)
      continue
    }
    let verdict = null
    try {
      verdict = JSON.parse(readFileSync(out, 'utf8'))
    } catch (error) {
      diffs.push(`${item.file}：输出不是 JSON（${String(error && error.message)}）`)
      continue
    }
    const problems = []
    if (verdict.ok !== item.ok) problems.push(`ok 期望 ${item.ok}，实际 ${verdict.ok}`)
    if (verdict.type !== 'cold') problems.push(`type 期望 cold，实际 ${verdict.type}`)
    if (item.ok && run.status !== 0) problems.push(`退出码期望 0，实际 ${run.status}`)
    if (!item.ok && run.status === 0) problems.push('失败用例的退出码不能是 0')
    if (!item.ok && !(Array.isArray(verdict.reasons) && verdict.reasons.length > 0)) problems.push('失败用例没给原因')
    if (problems.length) {
      diffs.push(`${item.file}：${problems.join('；')}（reasons=${JSON.stringify(verdict.reasons)}）`)
      continue
    }
    passed += 1
    console.log(`PASS ${item.file}  ok=${verdict.ok}  type=${verdict.type}`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}

// 这一条是任务硬要求：校准跑完，仓库里的 verdict 必须一个字节都没变。
if (readOrNull(verdictFile) !== before) diffs.push('review/verdict.json 被覆盖了 —— 校准必须走 --out')
if (readOrNull(unverifiedFile) !== beforeUnverified) diffs.push('review/unverified.json 被覆盖了 —— 校准必须走 --out')

if (diffs.length) {
  console.log(`校准：FAIL ${passed}/${cases.length}`)
  for (const diff of diffs) console.log(`  - ${diff}`)
  process.exitCode = 1
} else {
  console.log(`校准：PASS ${passed}/${cases.length}`)
}
