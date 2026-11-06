// findings 台账：把“N 红”变成可逐条关闭的条目，并提供收敛判定（B1）。
// 用法：
//   node review/findings.mjs status [--json]
// 台账格式（review/findings.json）：
//   {
//     "round": 3,
//     "lastNewRound": 1,
//     "items": [
//       { "id": "F1", "gapType": "missing", "severity": "blocking",
//         "status": "fixed", "evidence": "lib/x.js:12", "openedRound": 1, "closedRound": 3 }
//     ]
//   }
// 收敛：round >= 2 且 open=0 且 round - lastNewRound >= 2（连续两轮没有新 finding）。
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export const GAPS = new Set(['missing', 'partial', 'contradicts', 'unrequested'])
export const SEVERITIES = new Set(['blocking', 'suggestion', 'nit'])
export const STATUSES = new Set(['open', 'fixed', 'deferred'])

export function validateFindings(data) {
  const errors = []
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ['台账必须是对象']
  const round = data.round
  if (!Number.isInteger(round) || round < 0) errors.push('round 必须是非负整数')
  const lastNewRound = data.lastNewRound
  if (!Number.isInteger(lastNewRound) || lastNewRound < 0) errors.push('lastNewRound 必须是非负整数')
  if (lastNewRound > round) errors.push('lastNewRound 不能大于 round')
  if (!Array.isArray(data.items)) {
    errors.push('items 必须是数组')
    return errors
  }
  const ids = new Set()
  data.items.forEach((item, i) => {
    const at = `items[${i}]`
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`${at} 必须是对象`)
      return
    }
    if (typeof item.id !== 'string' || !item.id.trim()) errors.push(`${at}.id 必填`)
    if (ids.has(item.id)) errors.push(`${at}.id 重复：${item.id}`)
    ids.add(item.id)
    if (!GAPS.has(item.gapType)) errors.push(`${at}.gapType 非法`)
    if (!SEVERITIES.has(item.severity)) errors.push(`${at}.severity 非法`)
    if (!STATUSES.has(item.status)) errors.push(`${at}.status 非法`)
    if (!Number.isInteger(item.openedRound) || item.openedRound < 1) errors.push(`${at}.openedRound 必须是正整数`)
    if (item.openedRound > round) errors.push(`${at}.openedRound 不能大于 round`)
    if (item.status === 'fixed' || item.status === 'deferred') {
      if (!Number.isInteger(item.closedRound) || item.closedRound < item.openedRound) {
        errors.push(`${at}.closedRound 必须是 >= openedRound 的整数`)
      }
      if (item.closedRound > round) errors.push(`${at}.closedRound 不能大于 round`)
    }
    if (item.status === 'deferred' && (typeof item.reason !== 'string' || !item.reason.trim())) {
      errors.push(`${at} deferred 必须写 reason`)
    }
  })
  return errors
}

export function summarizeFindings(data) {
  const items = Array.isArray(data && data.items) ? data.items : []
  const round = Number.isInteger(data && data.round) ? data.round : 0
  const lastNewRound = Number.isInteger(data && data.lastNewRound)
    ? data.lastNewRound
    : items.reduce((max, item) => Math.max(max, item.openedRound || 0), 0)
  const open = items.filter((item) => item.status === 'open')
  const blockingOpen = open.filter((item) => item.severity === 'blocking')
  const newThisRound = items.filter((item) => item.openedRound === round)
  const converged = round >= 2 && open.length === 0 && round - lastNewRound >= 2
  return {
    round,
    lastNewRound,
    total: items.length,
    open: open.length,
    blockingOpen: blockingOpen.length,
    fixed: items.filter((item) => item.status === 'fixed').length,
    deferred: items.filter((item) => item.status === 'deferred').length,
    newThisRound: newThisRound.length,
    converged,
  }
}

function main() {
  const file = process.env.LAZY_TOOLS_FINDINGS_FILE || join(here, 'findings.json')
  if (!existsSync(file)) {
    console.log(`findings：没有台账（${file}）`)
    process.exitCode = 2
    return
  }
  let data
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    console.error(`findings：JSON 解析失败：${String(error && error.message)}`)
    process.exitCode = 2
    return
  }
  const errors = validateFindings(data)
  if (errors.length) {
    console.error('findings：台账不合法')
    for (const error of errors) console.error(`  - ${error}`)
    process.exitCode = 2
    return
  }
  const summary = summarizeFindings(data)
  console.log(JSON.stringify(summary, null, 2))
  process.exitCode = summary.converged ? 0 : 1
}

if (process.argv[1] && process.argv[1].endsWith('findings.mjs')) main()
