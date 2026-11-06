// 机器判冷读：读报告末尾的 ```verdict JSON 块，不再解析自由文本。
// 用法：node review/verify-coldread.mjs [报告路径]
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version
const reportPath = process.argv[2] || join(root, '..', '..', 'perf-', `冷读-${version}.md`)

const verdict = {
  version,
  report: reportPath,
  exists: existsSync(reportPath),
  type: 'missing',
  red: null,
  trackA: null,
  trackB: null,
  unverified: null,
  baseline: null,
  baselineActual: null,
  sha256: null,
  ok: false,
  reasons: [],
}

let baselineActual = null
try {
  const list = JSON.parse(readFileSync(join(here, 'baseline.json'), 'utf8'))
  baselineActual = Array.isArray(list) ? list.length : null
} catch {
  baselineActual = null
}
verdict.baselineActual = baselineActual

if (verdict.exists) {
  const text = readFileSync(reportPath, 'utf8')
  verdict.sha256 = createHash('sha256').update(text).digest('hex').slice(0, 16)
  const forbidden = /改动摘要|已知风险|逐条核对|点名|本轮改了什么|对象\s*[：:]/
  verdict.type = forbidden.test(text) ? 'directed' : 'cold'

  // 只认最后一个 ```verdict 块；JSON 解析失败即失败。
  const blocks = [...text.matchAll(/```verdict\s*\r?\n([\s\S]*?)```/g)]
  const block = blocks.length ? blocks[blocks.length - 1][1] : null
  if (!block) {
    verdict.reasons.push('缺 ```verdict JSON 块')
  } else {
    try {
      const body = JSON.parse(block)
      const int = (value) => typeof value === 'number' && Number.isInteger(value) && value >= 0
      verdict.red = int(body.red) ? body.red : null
      verdict.trackA = int(body.A) ? body.A : null
      verdict.trackB = int(body.B) ? body.B : null
      verdict.unverified = int(body.unverified) ? body.unverified : null
      verdict.baseline = int(body.baseline) && body.baseline > 0 ? body.baseline : null
      if (verdict.red === null) verdict.reasons.push('verdict.red 必须是整数')
      if (verdict.unverified === null) verdict.reasons.push('verdict.unverified 必须是整数')
      if (verdict.baseline === null) verdict.reasons.push('verdict.baseline 必须是正整数')
      if (verdict.trackA === null || verdict.trackB === null) verdict.reasons.push('verdict.A/B 必须是整数')
      if (verdict.trackA + verdict.trackB !== verdict.red) verdict.reasons.push(`A+B=${verdict.trackA + verdict.trackB} ≠ red ${verdict.red}`)
      if (baselineActual === null) verdict.reasons.push('读不到 review/baseline.json')
      else if (verdict.baseline !== baselineActual) verdict.reasons.push(`baseline ${verdict.baseline} ≠ baseline.json ${baselineActual}`)
      if (verdict.red !== 0) verdict.reasons.push(`red ${verdict.red}`)
      if (verdict.unverified !== 0) verdict.reasons.push(`unverified ${verdict.unverified}`)
    } catch (error) {
      verdict.reasons.push(`verdict JSON 解析失败：${String(error && error.message)}`)
    }
  }
  if (verdict.type !== 'cold') verdict.reasons.push('报告含改动摘要/清单/对象：只能算定向核对')
} else {
  verdict.reasons.push('报告不存在')
}

verdict.ok = verdict.reasons.length === 0
writeFileSync(join(here, 'verdict.json'), JSON.stringify(verdict, null, 2) + '\n')
writeFileSync(
  join(here, 'unverified.json'),
  JSON.stringify({ count: verdict.unverified || 0, items: verdict.unverified ? ['见冷读报告 verdict 块'] : [] }, null, 2) + '\n',
)

console.log(`冷读裁决：${verdict.ok ? 'PASS' : 'FAIL'}  类型=${verdict.type}  红=${verdict.red}  未验证=${verdict.unverified}  基线=${verdict.baseline}/${verdict.baselineActual}`)
for (const reason of verdict.reasons) console.log(`  - ${reason}`)
if (!verdict.ok) process.exitCode = 1
