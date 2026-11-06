import assert from 'node:assert/strict'
import { summarizeFindings, validateFindings } from './findings.mjs'

const base = {
  round: 2,
  lastNewRound: 1,
  items: [
    { id: 'F1', gapType: 'missing', severity: 'blocking', status: 'fixed', openedRound: 1, closedRound: 2, evidence: 'x:1' },
    { id: 'F2', gapType: 'partial', severity: 'suggestion', status: 'deferred', openedRound: 1, closedRound: 2, evidence: 'x:2', reason: '下一版' },
  ],
}

assert.deepEqual(validateFindings(base), [])
const s = summarizeFindings(base)
assert.equal(s.open, 0)
assert.equal(s.blockingOpen, 0)
assert.equal(s.fixed, 1)
assert.equal(s.deferred, 1)
assert.equal(s.converged, false, 'round-lastNewRound=1 不能算连续两轮')

const s2 = summarizeFindings({ ...base, round: 3 })
assert.equal(s2.converged, true, 'round 3 / lastNewRound 1 / open 0 应收敛')

const open = summarizeFindings({ ...base, round: 3, items: [{ ...base.items[0], status: 'open', closedRound: undefined }] })
assert.equal(open.open, 1)
assert.equal(open.converged, false)

const bad = validateFindings({
  ...base,
  items: [{ id: 'F1', gapType: 'nope', severity: 'blocking', status: 'deferred', openedRound: 1 }],
})
assert.ok(bad.length >= 3, '非法 gap/deferred 无 reason 必须报错')

const dup = validateFindings({ ...base, items: [base.items[0], base.items[0]] })
assert.ok(dup.some((e) => e.includes('重复')))

console.log('findings：PASS 6/6')
