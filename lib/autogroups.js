// 自动分组：从工具名里识别「工具家族」，给还没被任何组覆盖的那部分生成建议组。
//
// 为什么要它：默认只覆盖 cua_driver_native / dsh_browser / vision 三类；
// 用户装的新插件（mnemon、schedule、job…）没有组，就会一直可见、一直付 token。
//
// 设计边界（2026-10-25 与用户确认）：
//   · 只做「明显能分」的：同一前缀段 ≥ minTools 个、且没被现有组吃掉才建；
//   · 核心工具永不入组（白名单写死，不做成配置）；
//   · 极端需求留给配置文件（手写组永远优先于自动组）。
//
// 本文件是纯函数，不碰 ctx，方便单测。

/** 核心工具：藏了会拖慢/拖坏基本操作与自救，永不自动分组。 */
export const CORE_TOOLS = new Set([
  // 两代宿主工具名并存（2026-10-31）：DSH 2.0.21 起 dsh-ops 用 ops_* 取代了官方 pwsh。
  // 不存在的名字在清单里是空操作，所以两个版本共用同一份代码，不做版本分支。
  'read', 'write', 'edit', 'glob', 'grep', 'pwsh', 'skill', 'todo_write',
  'ask_user_question', 'present', 'plugin_manager', 'working_directory',
  'load_workspace_dependencies', 'ops_read_files', 'ops_discover_tools',
  'ops_bash', 'ops_grep', 'ops_glob', 'ops_inspect_local_file', 'ops_result',
  'lazy_tools_status', 'lazy_tools_enable', 'lazy_tools_disable', 'lazy_tools_list',
  'lazy_tools_resolve', 'lazy_tools_mode', 'lazy_tools_scan', 'lazy_tools_health',
  'lazy_tools_classify', 'lazy_tools_save_groups', 'lazy_tools_bench',
])

/** 受保护前缀：这些家族里混着自救工具，整族都不自动分组。 */
export const PROTECTED_PREFIXES = new Set(['lazy', 'lazy_tools', 'lazy-tools', 'ops'])

/** 名字 → 段数组。`__` 是硬分隔（cua_driver_native__x 整段算一个家族名），否则按单个 `_` 切。 */
export function tokenize(name) {
  const text = String(name || '')
  if (!text) return []
  if (text.includes('__')) return [text.split('__')[0]].filter(Boolean)
  return text.split('_').filter(Boolean)
}

/** 前缀段 → 匹配式（正则，整串锚定）。 */
export function matchPattern(segments) {
  const body = segments.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('_')
  return `re:^${body}(_|__|$)`
}

/** 组 id：auto-<段1-段2>。 */
export function autoGroupId(segments) {
  return 'auto-' + segments.join('-')
}

function trieInsert(root, segments, name) {
  let node = root
  for (const segment of segments) {
    if (!node.children.has(segment)) node.children.set(segment, { count: 0, names: [], children: new Map() })
    node = node.children.get(segment)
    node.count += 1
    node.names.push(name)
  }
  return node
}


/**
 * 主入口。
 * @param {string[]} names 全部工具名
 * @param {(name: string) => boolean} isCovered 是否已被现有组覆盖
 * @param {{minTools?: number, maxGroups?: number}} options
 * @returns {{suggestions: Array<{id: string, match: string[], title: string, expect: number, tools: string[]}>, skipped: Array<{prefix: string, reason: string, count: number}>}}
 */
export function suggestGroups(names, isCovered = () => false, options = {}) {
  const minTools = Number.isFinite(options.minTools) ? Math.max(2, Math.round(options.minTools)) : 3
  const maxGroups = Number.isFinite(options.maxGroups) ? Math.max(1, Math.round(options.maxGroups)) : 8

  const all = [...new Set(names.map(String))].filter(Boolean)
  const uncovered = all.filter((name) => !CORE_TOOLS.has(name) && !isCovered(name))

  // trie：按段建树，同时记下整条前缀（用于 80% 规则与 id）
  const root = { children: new Map() }
  const prefixOf = new Map() // toolName -> token 数组
  for (const name of uncovered) {
    const segments = tokenize(name)
    if (!segments.length) continue
    prefixOf.set(name, segments)
    trieInsert(root, segments, name)
  }

  // 收集候选家族（带完整前缀）。
  // 切分规则：只有当「子族合计能覆盖本节点 ≥80%」时才往下切，否则保留整族。
  // 否则像 mnemon(17) 会被切成 mnemon_memory_body(3) + mnemon_document(3)，大族反而丢了。
  const raw = []
  const walk = (node, prefix, out = raw) => {
    const childFamilies = []
    for (const [segment, child] of node.children) {
      walk(child, prefix.concat(segment), childFamilies)
    }
    const coveredByChildren = childFamilies.reduce((sum, family) => sum + family.names.length, 0)
    if (childFamilies.length && node.names.length && coveredByChildren >= node.names.length * 0.8) {
      out.push(...childFamilies)
    } else if (node.names.length >= minTools) {
      out.push({ segments: prefix, names: node.names })
    }
  }
  for (const [segment, child] of root.children) walk(child, [segment])

  const skipped = []
  const suggestions = []
  for (const candidate of raw) {
    const prefixText = candidate.segments.join('_')
    // 80% 规则：这个前缀下的全部工具里，未被覆盖的要占绝大多数；
    // 否则说明它已经被现有组吃掉了，不该再建一个残缺组。
    const allWithPrefix = all.filter((name) => {
      const segments = prefixOf.get(name) || tokenize(name)
      return candidate.segments.every((segment, index) => segments[index] === segment)
    })
    const ratio = allWithPrefix.length ? candidate.names.length / allWithPrefix.length : 0
    if (ratio < 0.8) {
      skipped.push({ prefix: prefixText, reason: `已被现有组覆盖 ${Math.round((1 - ratio) * 100)}%`, count: candidate.names.length })
      continue
    }
    if (PROTECTED_PREFIXES.has(candidate.segments[0])) {
      skipped.push({ prefix: prefixText, reason: '受保护前缀（含自救工具）', count: candidate.names.length })
      continue
    }
    suggestions.push({
      id: autoGroupId(candidate.segments),
      match: [matchPattern(candidate.segments)],
      title: prefixText,
      expect: candidate.names.length,
      tools: candidate.names.slice().sort(),
    })
  }

  suggestions.sort((a, b) => b.expect - a.expect)
  const capped = suggestions.slice(0, maxGroups)
  for (const drop of suggestions.slice(maxGroups)) {
    skipped.push({ prefix: drop.title, reason: `超过 ${maxGroups} 组上限`, count: drop.expect })
  }
  return { suggestions: capped, skipped }
}

/**
 * 自动分组模式：只接受 off / suggest / on，其余回落到 **on**。
 *
 * 2026-10-29 把兜底从 'suggest' 改成 'on'：'suggest' 只往 scan 里塞建议，普通用户既不会去 scan，
 * 也就永远拿不到「第三方插件装上就被管」的收益 —— 等于功能不存在。
 * 真正兜底的是这几道护栏：同族 >= minTools(3) 才建组、子族合计覆盖 >=80% 才往下切、
 * 核心工具白名单永不入组、建好的组随时 disable、被收起的工具第一次被调用时守卫会自动放回。
 * 想先审核再收纳的人，设置页把「自动分组」调回「只建议」即可。
 */
export function normalizeAutoMode(...values) {
  for (const value of values) {
    if (value === 'off' || value === 'suggest' || value === 'on') return value
  }
  return 'on'
}