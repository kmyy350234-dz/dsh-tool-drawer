// 门禁：基线 + 异常 + unverified；可选流程检查 / 变异 / 冷读裁决。
// 用法：node review/gate.mjs [--process] [--mutations] [--mutation-score] [--cold-read]
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateVerdict } from './verdict-check.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const flags = new Set(process.argv.slice(2))
const run = (args) => spawnSync(process.execPath, args, {
  cwd: root,
  encoding: 'utf8',
  timeout: 300000,
  maxBuffer: 32 * 1024 * 1024,
})

let bad = 0
const step = (label, args) => {
  const result = run(args)
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  if (result.status !== 0) bad += 1
  console.log(`[gate] ${label}: ${result.status === 0 ? 'PASS' : 'FAIL'}`)
}

step('基线', ['review/check-baseline.mjs'])
step('异常', ['review/anomalies.mjs'])
step('校准', ['review/check-calibration.mjs'])
if (flags.has('--process')) step('流程一致性', ['review/check-process.mjs'])
if (flags.has('--findings')) {
  const findingsFile = join(root, 'review', 'findings.json')
  if (!existsSync(findingsFile)) console.log('[gate] findings 收敛: SKIP（无台账）')
  else {
    // 钉死台账路径：findings.mjs 认 LAZY_TOOLS_FINDINGS_FILE，残留变量能把门禁指去假台账。
    const prev = process.env.LAZY_TOOLS_FINDINGS_FILE
    process.env.LAZY_TOOLS_FINDINGS_FILE = findingsFile
    try { step('findings 收敛', ['review/findings.mjs', 'status']) } finally {
      if (prev === undefined) delete process.env.LAZY_TOOLS_FINDINGS_FILE
      else process.env.LAZY_TOOLS_FINDINGS_FILE = prev
    }
  }
}
if (flags.has('--mutations')) step('变异', ['review/mutate.mjs'])
if (flags.has('--mutation-score')) step('变异分数', ['review/mutation-score.mjs'])
if (flags.has('--cold-read')) step('冷读裁决', ['review/verify-coldread.mjs'])

// 2026-11-06（冷读红 B-1）：verdict 必须完整且版本匹配；null/最小/陈旧文件都算失败。
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
let verdict = null
let verdictFileExists = false
try {
  verdictFileExists = true
  verdict = JSON.parse(readFileSync(join(here, 'verdict.json'), 'utf8'))
} catch {
  verdict = null
}
if (verdictFileExists && process.env.CI !== 'true') {
  const judged = evaluateVerdict(verdict, pkg.version)
  if (verdict && typeof verdict === 'object') {
    console.log(`冷读裁决：type=${verdict.type} red=${verdict.red} unverified=${verdict.unverified} ok=${verdict.ok}`)
  }
  for (const reason of judged.reasons) console.log(`  - ${reason}`)
  if (!judged.ok) bad += 1
} else if (process.env.CI === 'true') {
  console.log('[gate] CI 环境：verdict 由 54-发版 脚本判定，这里跳过')
}

let unverified = { count: 0, items: [] }
try {
  unverified = JSON.parse(readFileSync(join(here, 'unverified.json'), 'utf8'))
} catch {
  console.log('UNVERIFIED review/unverified.json 缺失')
  bad += 1
}
if (unverified.count > 0) {
  console.log(`
UNVERIFIED ${unverified.count} 条：`)
  for (const item of unverified.items || []) console.log(`  - ${item}`)
  bad += 1
}

console.log(`
门禁：${bad === 0 ? 'PASS' : 'FAIL'}（unverified=${unverified.count || 0}）`)
if (bad > 0) process.exitCode = 1
