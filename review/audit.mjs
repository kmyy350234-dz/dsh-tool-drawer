// 审计薄壳：只把 review/gate.mjs 的完整输出落成一份报告，自己不跑任何检查。
// 用法：node review/audit.mjs --out <报告路径>
//
// 为什么是薄壳（2026-11-06 票 a7）：原方案让 audit 自己顺序跑 baseline / 对抗 / 变异分数，
// 那三步是 gate.mjs 的真子集（少掉 anomalies / calibration / verdict / unverified / 流程一致性），
// 会造出「audit 绿、gate 红」的假绿。所以这里不重写编排，只转发。
//
// 契约（每条都能用命令证伪）：
//   1. 子进程固定为 `node review/gate.mjs --mutation-score --process --findings`，不追加、不改写参数；
//   2. --out 必填；缺参数 exit 2，不猜默认路径；
//   3. 报告 = 头部说明 + gate stdout + gate stderr；两段原文完整落盘，不裁剪、不改写
//      （只做两种排版：小节之间加空行分隔；原文结尾没有换行时补一个换行，否则下个标题会粘在同一行）；
//   4. 退出码 = gate 退出码；gate 被信号杀死或超时 => 1；audit 自己出错（参数/写报告）=> 2；
//   5. 不跑检查、不写 review/verdict.json、review/unverified.json、review/findings.json
//      （后三个是门禁输入/台账，误写会洗掉证据，所以 --out 指到它们时直接拒绝）。
//
// 实测（2026-11-06，Node v24.21.0，Windows，本机）：
//   PASS：临时放一份收敛台账 review/findings.json => exit 0，报告含「门禁：PASS」；
//   FAIL：台账不收敛 => exit 1，报告含「门禁：FAIL」；
//   两次跑完 review/verdict.json 与 review/unverified.json 的 sha256 均不变。
import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const GATE = join(here, 'gate.mjs')
const GATE_ARGS = ['--mutation-score', '--process', '--findings']
// 只是安全网；gate 每个步骤自己有 300s 超时，正常一轮是分钟级。
const TIMEOUT_MS = 45 * 60 * 1000
// 报告不许写成这三个文件：它们是门禁的输入/台账，覆盖掉就洗掉了证据。
const GUARDED = ['verdict.json', 'unverified.json', 'findings.json']

const usage = '用法：node review/audit.mjs --out <报告路径>（--out 必填，没有默认路径）'

class UsageError extends Error {}

const parseArgs = (argv) => {
  let out = ''
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--out') {
      const value = argv[i + 1] || ''
      if (!value || value.startsWith('--')) throw new UsageError(`--out 后面缺少报告路径。${usage}`)
      out = value
      i += 1
    } else if (arg.startsWith('--out=')) {
      const value = arg.slice('--out='.length)
      if (!value) throw new UsageError(`--out= 后面缺少报告路径。${usage}`)
      out = value
    } else {
      throw new UsageError(`不认识的参数：${arg}。${usage}`)
    }
  }
  if (!out) throw new UsageError(`缺少 --out。${usage}`)
  const target = resolve(out)
  const parent = dirname(target)
  if (!existsSync(parent) || !statSync(parent).isDirectory()) {
    throw new UsageError(`报告目录不存在：${parent}（不猜、不自动建）`)
  }
  // NTFS 大小写不敏感，必须按真实路径 + 小写比较；realpath 同时挡住 junction/symlink。
  const canonicalParent = realpathSync.native(parent).toLowerCase()
  const canonical = join(canonicalParent, basename(target).toLowerCase())
  const guardedDir = realpathSync.native(here).toLowerCase()
  for (const name of GUARDED) {
    if (canonical === join(guardedDir, name)) {
      throw new UsageError(`报告不能写成 review/${name}（它是门禁输入/台账，audit 不许覆盖）`)
    }
  }
  if (existsSync(target)) {
    throw new UsageError(`报告已存在：${target}（audit 不覆盖已有文件；换路径或先删）`)
  }
  return target
}

// 原文直接落盘；只有「结尾没有换行」时补一个，否则下一个小节标题会粘在同一行。
const block = (text) => (text && !text.endsWith('\n') ? `${text}\n` : text)

const main = () => {
  let outPath
  try {
    outPath = parseArgs(process.argv.slice(2))
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    console.error(`audit：${error.message}`)
    process.exitCode = 2
    return
  }

  const started = new Date()
  const result = spawnSync(process.execPath, [GATE, ...GATE_ARGS], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: TIMEOUT_MS,
  })
  const stdout = result.stdout || ''
  const stderr = result.stderr || ''

  // 原样透传：gate 的每一行失败都要出现在 audit 自己的输出里（规范第 6 条：失败必须计数并输出），
  // 否则 CI 日志里只剩一个退出码，排查又要去翻文件。
  if (stdout) process.stdout.write(stdout)
  if (stderr) process.stderr.write(stderr)

  let exitCode = result.status
  let note = ''
  if (result.error && result.error.code === 'ETIMEDOUT') {
    exitCode = 1
    note = `gate 超过 ${TIMEOUT_MS / 60000} 分钟被超时终止`
  } else if (result.error) {
    exitCode = 2
    note = `audit 起不了 gate：${result.error.message}`
  } else if (result.status === null) {
    exitCode = 1
    note = `gate 被信号 ${result.signal || '未知'} 终止`
  }

  const report = [
    '# 审计报告（review/audit.mjs 生成，只转发 gate 输出）',
    '',
    `- 时间：${started.toISOString()}（UTC）`,
    `- 工作目录：${root}`,
    `- 子进程：${process.execPath} ${GATE} ${GATE_ARGS.join(' ')}`,
    `- gate 退出码：${result.status === null ? 'null' : result.status}`,
    `- audit 退出码：${exitCode}`,
    ...(note ? [`- 注意：${note}`] : []),
    '',
    '## gate stdout（原样）',
    '',
    block(stdout),
    '## gate stderr（原样）',
    '',
    block(stderr),
    '',
  ].join('\n')

  try {
    // 含中文的报告按仓库约定带 BOM；wx = 绝不覆盖（上面 exists 检查挡早了一步，这里挡竞态）。
    writeFileSync(outPath, '\uFEFF' + report, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    console.error(`audit：报告写入失败（${outPath}）：${error.message}`)
    process.exitCode = 2
    return
  }
  console.error(`audit：报告已写入 ${outPath}`)
  process.exitCode = exitCode
}

main()
