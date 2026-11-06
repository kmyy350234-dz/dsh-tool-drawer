// 判据符号的调用点表（grep 级，不是引用图）。修复共享判据时跑，防止「新消费者没接上」。
// 用法：node review/callers.mjs [符号...]
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const symbols = process.argv.slice(2)
const defaultSymbols = ['refreshManagedRoles', 'writeStoredPolicy', 'isAllowedByPolicy', 'hiddenBy', 'rebuild', 'unhideable', 'reconcileLeaks']
const wanted = symbols.length ? symbols : defaultSymbols

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'review') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.(m?js)$/.test(entry.name)) out.push(full)
  }
  return out
}

for (const file of walk(join(root, 'lib'))) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, index) => {
    for (const symbol of wanted) {
      if (new RegExp(`\\b${symbol}\\b`).test(line)) {
        console.log(`${symbol}\t${relative(root, file)}:${index + 1}\t${line.trim().slice(0, 120)}`)
      }
    }
  })
}
