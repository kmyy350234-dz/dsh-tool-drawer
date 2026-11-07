// 金标锁定：golden 必须对应 provenance.json 记录的基线 hash；--write 改金标后这里会红。
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const base = join(here, 'fixtures', 'golden')
const expected = JSON.parse(readFileSync(join(base, 'provenance.json'), 'utf8'))
const sha = (file) => createHash('sha256').update(readFileSync(join(base, file))).digest('hex')
const checks = [
  ['groups.json', expected.groupsSha256],
  ['state.json', expected.stateSha256],
]
for (const [file, want] of checks) {
  const got = sha(file)
  if (got !== want) throw new Error(`${file} 与 provenance.json 不一致：${got} != ${want}`)
}
console.log(`golden provenance: PASS（baseline ${expected.baseline}）`)
