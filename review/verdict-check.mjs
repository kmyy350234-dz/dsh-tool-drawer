// 冷读裁决的判定函数：独立可测，gate 与 gate-integrity 共用。
// 2026-11-07（冷读 B 红）：verdict 字段可以被伪造，必须校验报告本体。
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

const DIRECTED_MARKERS = /改动摘要|已知风险|逐条核对|点名|本轮改了什么|对象\s*[：:]/

function checkReport(verdict, baseDir, reasons) {
  if (typeof verdict.report !== 'string' || !verdict.report.trim()) {
    reasons.push('verdict.report 缺失')
    return
  }
  const reportPath = isAbsolute(verdict.report) ? verdict.report : resolve(baseDir, verdict.report)
  if (!existsSync(reportPath)) {
    reasons.push(`verdict.report 不存在：${verdict.report}`)
    return
  }
  let text = ''
  try {
    text = readFileSync(reportPath, 'utf8')
  } catch (error) {
    reasons.push(`verdict.report 读不到：${String(error && error.message)}`)
    return
  }
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 16)
  if (typeof verdict.sha256 !== 'string' || verdict.sha256.toLowerCase() !== hash) {
    reasons.push(`verdict.sha256 与报告不符（报告 ${hash}）`)
  }
  if (DIRECTED_MARKERS.test(text)) {
    reasons.push('verdict.report 含定向标记，不能算 cold')
  }
}

export function evaluateVerdict(verdict, version, options = {}) {
  const reasons = []
  if (!verdict || typeof verdict !== 'object') {
    return { ok: false, reasons: ['verdict 缺失或不是对象'] }
  }
  if (verdict.type !== 'cold') reasons.push('verdict.type 不是 cold')
  if (verdict.exists !== true) reasons.push('verdict.exists 不是 true')
  if (typeof verdict.sha256 !== 'string' || verdict.sha256.length < 8) reasons.push('verdict.sha256 缺失')
  if (verdict.version !== version) reasons.push(`verdict 版本 ${verdict.version} ≠ package ${version}`)
  if (typeof verdict.ok !== 'boolean') reasons.push('verdict.ok 不是布尔')
  if (!Number.isInteger(verdict.red) || verdict.red < 0) reasons.push('verdict.red 不是非负整数')
  if (!Number.isInteger(verdict.unverified) || verdict.unverified < 0) reasons.push('verdict.unverified 不是非负整数')
  if (!Number.isInteger(verdict.baseline) || verdict.baseline <= 0) reasons.push('verdict.baseline 必须 > 0')
  if (!Number.isInteger(verdict.baselineActual) || verdict.baseline !== verdict.baselineActual) {
    reasons.push(`verdict.baseline ${verdict.baseline} ≠ baselineActual ${verdict.baselineActual}`)
  }
  if (!Number.isInteger(verdict.trackA) || !Number.isInteger(verdict.trackB)) reasons.push('verdict.A/B 必须是整数')
  else if (verdict.trackA + verdict.trackB !== verdict.red) reasons.push('A+B ≠ red')
  if (verdict.ok !== true) reasons.push('verdict.ok 不是 true')
  if (verdict.red > 0) reasons.push(`红 ${verdict.red}`)
  if (verdict.unverified > 0) reasons.push(`未验证 ${verdict.unverified}`)
  if (options.checkReport === true) checkReport(verdict, options.baseDir || process.cwd(), reasons)
  return { ok: reasons.length === 0, reasons }
}
