// 生成 review bundle：文件清单 + 全量源码 + diff + 测试输出 + 基线/未验证。
// 用法：node review/build-bundle.mjs <base-commit> [outfile]
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const base = process.argv[2] || '0b0fbfb'
const outfile = process.argv[3] || join(here, 'bundle.md')

const git = (args) => {
  const run = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return (run.stdout || '').trim()
}
const head = git(['rev-parse', '--short', 'HEAD'])
const range = `${base}..HEAD`
const diff = git(['diff', '--stat', range]) + '\n\n' + git(['diff', range])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.isFile() && /\.(m?js|json|md|ps1)$/.test(entry.name)) out.push(full)
  }
  return out
}

const files = [
  ...walk(join(root, 'lib')),
  join(root, 'client.js'),
  join(root, 'package.json'),
  join(root, 'CHANGELOG.md'),
  join(root, 'README.md'),
  join(root, 'DESIGN.md'),
  join(root, 'test', 'smoke.mjs'),
  join(root, 'test', 'adversarial.mjs'),
].filter((file) => {
  try {
    readFileSync(file)
    return true
  } catch {
    return false
  }
})

const read = (file) => readFileSync(file, 'utf8')
const lastSmoke = (() => {
  try {
    return read(join(here, 'last-smoke.txt'))
  } catch {
    return '(no last-smoke.txt)'
  }
})()
const lastAdversarial = (() => {
  try {
    return read(join(here, 'last-adversarial.txt'))
  } catch {
    return '(no last-adversarial.txt)'
  }
})()
let baseline = '(missing)'
let unverified = '(missing)'
try {
  baseline = read(join(here, 'baseline.json'))
} catch {}
try {
  unverified = read(join(here, 'unverified.json'))
} catch {}

const parts = []
parts.push(`# REVIEW BUNDLE — lazy-tools ${head}\n`)
parts.push(`range: ${range}\n`)
parts.push(`file_count: ${files.length}\n`)
parts.push(
  files
    .map((file) => `${relative(root, file)}\t${read(file).split('\n').length} lines`)
    .join('\n'),
)
parts.push('\n## DIFF\n\n```diff\n' + diff + '\n```\n')
parts.push('\n## SOURCE\n')
for (const file of files) {
  parts.push(`\n### ${relative(root, file)}\n\n\`\`\`js\n${read(file)}\n\`\`\`\n`)
}
parts.push('\n## TEST OUTPUT (smoke)\n\n```\n' + lastSmoke + '\n```\n')
parts.push('\n## TEST OUTPUT (adversarial)\n\n```\n' + lastAdversarial + '\n```\n')
parts.push('\n## BASELINE\n\n```json\n' + baseline + '\n```\n')
parts.push('\n## UNVERIFIED\n\n```json\n' + unverified + '\n```\n')

const bundle = parts.join('\n')
writeFileSync(outfile, bundle)
console.log(`bundle: ${outfile}  ${(bundle.length / 1024).toFixed(1)} KB  files=${files.length}  range=${range}`)
