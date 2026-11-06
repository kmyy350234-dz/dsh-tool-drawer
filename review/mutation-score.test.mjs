// 变异分数负向测试：valid / 缺 protectedBy / expectText 重复三种临时清单，外加仓库真清单与 --run 解析。
// protectedBy: review/mutation-score.mjs 的 metadataScore / summarizeRun / CLI 退出码
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { summarizeRun } from './mutation-score.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, 'mutation-score.mjs')
const dir = mkdtempSync(join(tmpdir(), 'mutation-score-'))
let checks = 0
let failed = 0
const check = (name, ok, detail = '') => {
  checks += 1
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `：${detail}` : ''}`)
}

let seq = 0
const runFile = (mutations) => {
  seq += 1
  const file = join(dir, `mutations-${seq}.json`)
  writeFileSync(file, JSON.stringify(mutations))
  const out = spawnSync(process.execPath, [script, '--file', file], { encoding: 'utf8' })
  const lines = (out.stdout || '').trim().split(/\r?\n/)
  let json = null
  try {
    json = JSON.parse(lines[lines.length - 1])
  } catch {
    json = null
  }
  return { status: out.status, json, stderr: (out.stderr || '').trim() }
}

try {
  // 1) valid：两条都有 protectedBy、expectText 互不重复 ⇒ exit 0、满分。
  const valid = runFile([
    { id: 'm1', file: 'lib/index.js', find: 'a', replace: 'b', expectText: '甲断言', protectedBy: 'test/smoke.mjs [1] 甲' },
    { id: 'm2', file: 'lib/index.js', find: 'c', replace: 'd', expectText: '乙断言', protectedBy: 'test/smoke.mjs [2] 乙' },
  ])
  check('valid：exit 0', valid.status === 0, `exit=${valid.status}${valid.stderr ? ` ${valid.stderr}` : ''}`)
  check(
    'valid：total=2 / protected=2 / score=1',
    Boolean(valid.json) && valid.json.total === 2 && valid.json.protected === 2 && valid.json.score === 1,
    JSON.stringify(valid.json),
  )
  check(
    'valid：missing / duplicates 为空',
    Boolean(valid.json) && valid.json.missing.length === 0 && valid.json.duplicates.length === 0,
    JSON.stringify(valid.json),
  )

  // 2) 缺 protectedBy：那一条进 missing，分数要掉下来，退出码必须 1。
  const missing = runFile([
    { id: 'm1', expectText: '甲断言' },
    { id: 'm2', expectText: '乙断言', protectedBy: 'test/smoke.mjs [2] 乙' },
  ])
  check('缺 protectedBy：exit 1', missing.status === 1, `exit=${missing.status}`)
  check(
    '缺 protectedBy：missing 点名 m1',
    Boolean(missing.json) && missing.json.missing.length === 1 && missing.json.missing[0] === 'm1',
    JSON.stringify(missing.json),
  )
  check('缺 protectedBy：score=0.5', Boolean(missing.json) && missing.json.score === 0.5, JSON.stringify(missing.json))

  // 3) expectText 重复：两条断言文本一样 ⇒ duplicates 命中，退出码必须 1。
  const duplicate = runFile([
    { id: 'm1', expectText: '同一条断言', protectedBy: 'test/smoke.mjs [1]' },
    { id: 'm2', expectText: '同一条断言', protectedBy: 'test/smoke.mjs [2]' },
  ])
  check('expectText 重复：exit 1', duplicate.status === 1, `exit=${duplicate.status}`)
  check(
    'expectText 重复：duplicates 命中',
    Boolean(duplicate.json) &&
      duplicate.json.duplicates.length === 1 &&
      duplicate.json.duplicates[0] === '同一条断言',
    JSON.stringify(duplicate.json),
  )

  // 4) 仓库真清单：8 条必须全部有 protectedBy，否则这票之后被人改漏会当场红。
  const real = spawnSync(process.execPath, [script], { encoding: 'utf8' })
  let realJson = null
  try {
    realJson = JSON.parse((real.stdout || '').trim().split(/\r?\n/).pop())
  } catch {
    realJson = null
  }
  check('仓库清单：exit 0', real.status === 0, `exit=${real.status}`)
  check(
    '仓库清单：protected=total 且无重复',
    Boolean(realJson) &&
      realJson.total > 0 &&
      realJson.protected === realJson.total &&
      realJson.missing.length === 0 &&
      realJson.duplicates.length === 0,
    JSON.stringify(realJson),
  )

  // 5) --run 解析：PASS 记击杀；FAIL/MISS 和没跑到的都算 survived；清单外 id 不算数。
  const parsed = summarizeRun(
    [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    [
      'PASS a：甲 变红',
      'FAIL b：期待「乙」红，实际 exit=0',
      'MISS c：变异点没找到',
      'PASS zzz：不在清单里的 PASS 不算',
    ].join('\n'),
  )
  check(
    '--run 解析：killed=1 / survived=2',
    parsed.total === 3 && parsed.killed === 1 && parsed.survived === 2,
    JSON.stringify(parsed),
  )
  check(
    '--run 解析：score=1/3 且不认清单外 id',
    parsed.score === Number((1 / 3).toFixed(4)),
    JSON.stringify(parsed),
  )
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\nmutation-score：${failed === 0 ? 'PASS' : 'FAIL'} ${checks - failed}/${checks}`)
if (failed > 0) process.exitCode = 1
