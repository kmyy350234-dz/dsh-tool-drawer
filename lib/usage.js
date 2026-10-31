// 用量账本：哪一组「最近被真的调用过」。
//
// 为什么需要它：默认收起哪几组，不该拍脑袋，也不该让用户去选 —— 由「过去的实际使用」
// 决定。这里只记时间戳，不记内容。
//
// 文件：~/.dsh/lazy-tools.usage.json
//   { "groups": { "<组 id>": "2026-10-24T00:40:00.000Z" }, "tools": { "<工具名>": "..." } }
//
// 阈值按 AI 生态的节奏定（2026-10-24 用户要求「时间再激进些，现在 AI 一天一个样子」）：
// low 14 天 / medium 7 天 / high 3 天 —— 一周没碰过的工具组，基本就是沉底了。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

const DAY = 24 * 60 * 60 * 1000

export const LEVEL_DAYS = { low: 14, medium: 7, high: 3 }

export function usageFile() {
  // 测试用：允许用环境变量把账本指到临时文件，避免碰真机数据。
  const override = process.env.LAZY_TOOLS_USAGE_FILE
  if (override) return override
  const home = process.env.USERPROFILE || process.env.HOME || '.'
  return join(home, '.dsh', 'lazy-tools.usage.json')
}

export function loadUsage() {
  const empty = { groups: {}, tools: {}, stats: { toolCalls: 0, selfHealed: 0 } }
  try {
    const file = usageFile()
    if (!existsSync(file)) return empty
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const groups = raw && typeof raw.groups === 'object' && raw.groups ? raw.groups : {}
    const tools = raw && typeof raw.tools === 'object' && raw.tools ? raw.tools : {}
    // 2026-10-30：计数器也要跨重载活下来 —— 否则 firstTryRate 每次插件重载就归零，永远拿不到数据。
    const s = raw && typeof raw.stats === 'object' && raw.stats ? raw.stats : {}
    const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.round(v) : 0)
    const stats = { toolCalls: num(s.toolCalls), selfHealed: num(s.selfHealed) }
    return { groups, tools, stats }
  } catch {
    return empty
  }
}

export function saveUsage(usage) {
  try {
    const file = usageFile()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(usage, null, 1)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

/** 记一次调用：工具名 + 它所属的组（可能没有组）。 */
export function recordUsage(usage, toolName, groupId, at = new Date()) {
  const iso = at.toISOString()
  if (toolName) usage.tools[toolName] = iso
  if (groupId) usage.groups[groupId] = iso
  return iso
}


/**
 * 单个工具最近 idleDays 天内被调用过吗？（2026-10-28 加）
 *
 * 为什么需要：组级热度太粗 —— 「桌面·点」有 37 个工具，用户只常用其中一个，
 * 整个组就保持展开，另外 36 个继续每轮付 token。会话开始时按工具级热度把
 * 「常用的那几个」放进 only 白名单、其余继续收着，比缩短闲置天数更精细。
 */
export function isToolHot(usage, toolName, idleDays, now = Date.now()) {
  if (!Number.isFinite(idleDays) || idleDays <= 0) return true
  const last = usage && usage.tools ? usage.tools[toolName] : null
  if (!last) return false
  const ts = Date.parse(last)
  if (!Number.isFinite(ts)) return false
  return now - ts < idleDays * DAY
}

export { DAY }
