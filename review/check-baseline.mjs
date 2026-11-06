// 红线基线：逐条跑 PASS / FAIL / UNVERIFIED；UNVERIFIED 不算绿。
// 用法：node review/check-baseline.mjs   （cwd = _tools/lazy-tools）
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const lines = JSON.parse(readFileSync(join(here, 'baseline.json'), 'utf8'))

let failed = 0
let unverified = 0
for (const item of lines) {
  const args = item.cmd || []
  if (args.length === 0) {
    unverified += 1
    console.log(`UNVERIFIED ${item.id}：没有命令`)
    continue
  }
  const target = join(root, args[0])
  try {
    readFileSync(target)
  } catch {
    unverified += 1
    console.log(`UNVERIFIED ${item.id}：缺文件 ${args[0]}`)
    continue
  }
  const run = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 32 * 1024 * 1024,
  })
  const out = `${run.stdout || ''}\n${run.stderr || ''}`
  const exitOk = run.status === (item.expectExit ?? 0)
  const regexOk = item.expectRegex ? new RegExp(item.expectRegex, 'm').test(out) : true
  if (exitOk && regexOk) {
    console.log(`PASS ${item.id}  ${item.desc || ''}`)
  } else {
    failed += 1
    console.log(`FAIL ${item.id}  exit=${run.status} expect=${item.expectExit ?? 0}`)
    console.log(out.split('\n').slice(-12).join('\n'))
  }
}

console.log(`\n基线：${lines.length} 条；FAIL ${failed}；UNVERIFIED ${unverified}`)
if (failed > 0 || unverified > 0) process.exitCode = 1
