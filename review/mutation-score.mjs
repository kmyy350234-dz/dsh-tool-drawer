// 变异分数：默认只验元数据（protectedBy 非空 / expectText 唯一）；--run 实跑变异算击杀率。
// 用法：
//   node review/mutation-score.mjs                     # 元数据模式（gate --mutation-score 用这个）
//   node review/mutation-score.mjs --file <清单.json>   # 元数据模式，指定清单（负向测试用）
//   node review/mutation-score.mjs --run               # 跑 review/mutate.mjs，解析 PASS/FAIL
// 退出码：0 全绿；1 缺元数据 / expectText 重复 / 有 survived / 变异跑崩。
// 输出：元数据模式一行 JSON {total,protected,missing,duplicates,score}；
//       --run 模式先转发 mutate.mjs 原输出，再输出一行 JSON {total,killed,survived,score}。
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)

// 元数据口径：
// - missing：protectedBy 不是非空字符串，或 expectText 不是非空字符串（没有断言文本就谈不上唯一）；
// - duplicates：非空 expectText 出现多于一次；
// - protected：protectedBy 非空的条数；score = protected / total（total=0 记 0）。
export function metadataScore(mutations) {
  const list = Array.isArray(mutations) ? mutations : []
  const total = list.length
  const missing = []
  const duplicates = []
  const seen = new Map()
  let protectedCount = 0

  for (let index = 0; index < total; index += 1) {
    const mutation = list[index]
    const id = mutation && typeof mutation.id === 'string' && mutation.id.trim() ? mutation.id : `#${index + 1}`
    if (!mutation || typeof mutation.protectedBy !== 'string' || !mutation.protectedBy.trim()) {
      missing.push(id)
    } else {
      protectedCount += 1
    }
    const expectText = mutation && mutation.expectText
    if (typeof expectText !== 'string' || !expectText.trim()) {
      if (!missing.includes(id)) missing.push(id)
      continue
    }
    seen.set(expectText, (seen.get(expectText) || 0) + 1)
  }
  for (const [text, count] of seen) if (count > 1) duplicates.push(text)

  const score = total === 0 ? 0 : Number((protectedCount / total).toFixed(4))
  return { total, protected: protectedCount, missing, duplicates, score }
}

// 解析 mutate.mjs 输出：`PASS <id>：` = 击杀；`FAIL|MISS <id>：` = 没击杀。
// survived 按清单总数减击杀数算 —— mutate 中途崩掉、没跑到的条目也算 survived，不许假绿。
export function summarizeRun(mutations, output) {
  const list = Array.isArray(mutations) ? mutations : []
  const known = new Set(
    list.map((mutation) => mutation && mutation.id).filter((id) => typeof id === 'string' && id),
  )
  const killed = new Set()

  for (const line of String(output || '').split(/\r?\n/)) {
    const pass = line.match(/^PASS\s+(\S+?)\s*[：:]/)
    if (pass && known.has(pass[1])) killed.add(pass[1])
  }

  const total = list.length
  const killedCount = killed.size
  const survived = Math.max(0, total - killedCount)
  const score = total === 0 ? 0 : Number((killedCount / total).toFixed(4))
  return { total, killed: killedCount, survived, score }
}

function main() {
  const args = process.argv.slice(2)
  const runMode = args.includes('--run')
  const fileIndex = args.indexOf('--file')
  if (runMode && fileIndex >= 0) {
    console.error('mutation-score：--run 只跑仓库自带清单，不能和 --file 同用')
    process.exitCode = 2
    return
  }
  if (fileIndex >= 0 && !args[fileIndex + 1]) {
    console.error('mutation-score：--file 后面要跟清单路径')
    process.exitCode = 2
    return
  }
  const file = fileIndex >= 0 ? resolve(args[fileIndex + 1]) : join(here, 'mutations.json')

  let mutations
  try {
    mutations = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    console.error(`mutation-score：读清单失败 ${file}：${String(error && error.message)}`)
    process.exitCode = 1
    return
  }
  if (!Array.isArray(mutations)) {
    console.error(`mutation-score：清单必须是数组：${file}`)
    process.exitCode = 1
    return
  }

  if (!runMode) {
    const report = metadataScore(mutations)
    console.log(JSON.stringify(report))
    if (report.missing.length > 0 || report.duplicates.length > 0) process.exitCode = 1
    return
  }

  const run = spawnSync(process.execPath, ['review/mutate.mjs'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 900000,
    maxBuffer: 32 * 1024 * 1024,
  })
  const output = `${run.stdout || ''}\n${run.stderr || ''}`
  process.stdout.write(output.endsWith('\n') ? output : `${output}\n`)
  if (run.error) console.error(`mutation-score：mutate.mjs 没跑起来：${String(run.error.message)}`)

  const report = summarizeRun(mutations, output)
  console.log(JSON.stringify(report))
  // mutate.mjs 自己退出非 0 但条目全 PASS：说明它报了别的红（如对照组冒烟未过），不许当真绿。
  if (report.survived > 0 || run.status !== 0) process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
