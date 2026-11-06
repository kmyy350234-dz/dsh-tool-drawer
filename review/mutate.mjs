// 自动变异：每条 mutations.json 在临时副本上应用，要求冒烟失败且命中预期测试。
// 用法：node review/mutate.mjs
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const mutations = JSON.parse(readFileSync(join(here, 'mutations.json'), 'utf8'))

let failed = 0
// 2026-11-06（冷读 B-3）：先跑未变异对照组，expectText 不能在绿跑输出里出现。
const baselineRun = spawnSync(process.execPath, ['test/smoke.mjs'], {
  cwd: root,
  encoding: 'utf8',
  timeout: 120000,
  maxBuffer: 32 * 1024 * 1024,
})
const baselineOut = (baselineRun.stdout || '') + '\n' + (baselineRun.stderr || '')
if (baselineRun.status !== 0) {
  console.log('FAIL 对照组 smoke 未通过，变异结果不可信')
  process.exitCode = 1
}
for (const mutation of mutations) {
  const work = mkdtempSync(join(tmpdir(), 'lt-mutate-'))
  try {
    cpSync(root, work, {
      recursive: true,
      filter: (src) => !src.includes(`${join(root, '.git')}`) && !src.includes(`${join(root, 'review', '.mutate')}`),
    })
    const file = join(work, mutation.file)
    const before = readFileSync(file, 'utf8')
    if (!before.includes(mutation.find)) {
      failed += 1
      console.log(`MISS ${mutation.id}：变异点没找到`)
      continue
    }
    writeFileSync(file, before.replace(mutation.find, mutation.replace))
    const run = spawnSync(process.execPath, ['test/smoke.mjs'], {
      cwd: work,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 32 * 1024 * 1024,
    })
    const out = `${run.stdout || ''}\n${run.stderr || ''}`
    const caught = run.status !== 0 && out.includes(mutation.expectText) && !baselineOut.includes(mutation.expectText)
    if (caught) {
      console.log(`PASS ${mutation.id}：${mutation.expectText} 变红`)
    } else {
      failed += 1
      console.log(`FAIL ${mutation.id}：期待「${mutation.expectText}」红，实际 exit=${run.status}`)
      console.log(out.split('\n').slice(-6).join('\n'))
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

console.log(`\n变异：${mutations.length} 条；未抓住 ${failed}`)
if (failed > 0) process.exitCode = 1
