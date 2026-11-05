// config.js：profiles 目录存在但不可读（这里用「是文件」造 ENOTDIR）时，import 不能崩。
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const home = mkdtempSync(join(tmpdir(), 'lt-config-'))
let failed = 0

try {
  mkdirSync(join(home, '.dsh'), { recursive: true })
  writeFileSync(join(home, '.dsh', 'profiles'), 'not a directory')
  const script = `import(${JSON.stringify(pathToFileURL(join(root, 'lib', 'config.js')).href)}).then(() => { console.log('IMPORT-OK') }).catch((e) => { console.error('IMPORT-FAIL', e && e.code); process.exit(1) })`
  const run = spawnSync(process.execPath, ['-e', script], {
    env: { ...process.env, USERPROFILE: home, HOME: home },
    encoding: 'utf8',
    timeout: 30000,
  })
  const ok = run.status === 0 && /IMPORT-OK/.test(run.stdout || '')
  console.log(`${ok ? 'PASS' : 'FAIL'} config readdir 不可读时 import 不崩：${(run.stdout || run.stderr || '').trim()}`)
  if (!ok) failed += 1
} finally {
  rmSync(home, { recursive: true, force: true })
}

console.log(`\nconfig：${failed === 0 ? 'PASS' : 'FAIL'}`)
if (failed > 0) process.exitCode = 1
