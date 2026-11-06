// 冷读裁决的判定函数：独立可测，gate 与 gate-integrity 共用。
export function evaluateVerdict(verdict, version) {
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
  return { ok: reasons.length === 0, reasons }
}
