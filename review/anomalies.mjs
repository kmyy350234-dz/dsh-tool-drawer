// 测试输出落盘 + 异常扫描：NaN / undefined / 裸输出 / 被截断的标题。
// 用法：node review/anomalies.mjs
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const jobs = [
  ['smoke', ['test/smoke.mjs']],
  ['adversarial', ['test/adversarial.mjs']],
]

const anomalies = []
let failed = 0
for (const [name, args] of jobs) {
  const run = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 32 * 1024 * 1024,
  })
  const out = `${run.stdout || ''}\n${run.stderr || ''}`
  writeFileSync(join(here, `last-${name}.txt`), out)
  if (run.status !== 0) failed += 1
  const lines = out.split('\n')
  lines.forEach((line, index) => {
    const text = line.trim()
    if (text === 'NaN' || text === 'undefined') {
      anomalies.push({ job: name, line: index + 1, kind: 'bare-value', text })
    } else if (/^\s*(NaN|undefined)\s*$/.test(line)) {
      anomalies.push({ job: name, line: index + 1, kind: 'bare-value', text })
    } else if (text.startsWith('[') && !text.includes(']')) {
      anomalies.push({ job: name, line: index + 1, kind: 'truncated-title', text })
    }
  })
}

const report = { jobs: jobs.map(([name]) => name), exitFailures: failed, anomalies }
writeFileSync(join(here, 'anomalies.json'), JSON.stringify(report, null, 2))
for (const a of anomalies) console.log(`ANOMALY ${a.job}:${a.line} ${a.kind} ${a.text}`)
console.log(`\n异常：${anomalies.length}；退出失败：${failed}`)
if (anomalies.length > 0 || failed > 0) process.exitCode = 1
