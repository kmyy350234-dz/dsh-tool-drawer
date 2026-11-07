import { CORE_TOOLS } from './autogroups.js'

// 纯组匹配：普通 glob（`*` 通配、整串锚定），或 `re:` 前缀的直接正则。
// 正则写错不许把插件带崩 —— 返回 null，由调用方记账。
function matcherFor(pattern) {
  const source = String(pattern)
  try {
    if (source.startsWith('re:')) return new RegExp(source.slice(3))
    // 转义集必须包含 ? —— 2026-10-29 第三方复核指出：漏了它，手写 `foo?bar` 会变成
    // 正则 /^foo?bar$/（匹配 fobar），照文档写却静默不生效。`*` 不在这里转义，它是通配符。
    const escaped = source.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp('^' + escaped.replace(/\*/g, '.*') + '$')
  } catch {
    return null
  }
}

// 把一批组定义编译成 { ...g, res }：无效条目跳过并记账；expect 夹成有限正整数。
function compileGroups(list, manual = false, { host = { record() {}, log() {} }, compatNotes = new Set() } = {}) {
  return list
    .filter((g) => g && typeof g.id === 'string' && Array.isArray(g.match) && g.match.length)
    .map((g) => {
      let res = []
      for (const pattern of g.match) {
        const re = matcherFor(pattern)
        if (re) res.push(re)
        else host.record('group pattern', new Error(`无效的匹配式 ${JSON.stringify(String(pattern))}（组 ${g.id}），已忽略`))
      }
      // 只接受真正的 number，不做类型强转（expect: '19' / true 这类笔误不猜语义，按未设置处理）
      const expect = typeof g.expect === 'number' && Number.isFinite(g.expect) && g.expect > 0 ? Math.round(g.expect) : undefined
      // 注意：必须先把原值摘掉，否则 `...g` 会把 NaN 又带回来（2026-10-30 对抗测试 缺陷3）。
      const { expect: _rawExpect, ...rest } = g
      // 0.17.0 删掉了 autoHints：旧配置里还写着它时不能静默；但这是**兼容提示、不是故障**，
      // 按组只记一次、进 health.notes —— 记成 error 会让老用户 health 永久 false（训练人忽略红灯）。
      if (Object.prototype.hasOwnProperty.call(rest, 'autoHints') && !compatNotes.has(g.id)) {
        compatNotes.add(g.id)
        host.log('warn', `group ${g.id}: autoHints was removed in 0.17.0; ignored`)
      }
      // universal：这个组的匹配式能匹配**任意名字**（`*` / `re:.*`）—— 与工具数量无关地判定，
      // 所以 cua_* 这类前缀组不会被误伤（2026-10-31，回答「宿主改名追不动」）。
      const sentinel = '\u0000lazy-tools-probe\u0000'
      // 2026-11-06（冷读红 2）：单探针可被 re:^[a-z0-9_]+$ 绕过；用多个异形探针，全中才算“万能匹配”。
      const probes = ['zz_probe_alpha', 'probe_beta_9', '000_probe', 'x_y_z9', 'zzprobealpha']
      // 2026-11-05（外部审阅抓到的 P0）：V8 在**首次 test() 时才编译**正则 ——
      // 超长模式会在 test 抛 SyntaxError，把整个 apply 带崩（加载即失败）。
      // 所以这里真的执行一次 test；抛错的匹配式按无效处理并记账，不许逃出 apply。
      const tested = []
      for (const re of res) {
        try {
          re.test(sentinel)
          tested.push(re)
        } catch (error) {
          host.record(
            'group pattern',
            new Error(`匹配式执行失败（组 ${g.id}）：${String((error && error.message) || error)}，已忽略`),
          )
        }
      }
      res = tested
      const universal = res.some((re) => probes.every((probe) => re.test(probe)))
      return {
        ...rest,
        res,
        ...(manual ? { manual: true } : {}),
        ...(universal ? { universal: true } : {}),
        ...(expect === undefined ? {} : { expect }),
      }
    })
    .filter((g) => g.res.length)
}

function commonPrefix(list) {
    if (!list.length) return ''
    let prefix = list[0]
    for (const name of list.slice(1)) {
      let i = 0
      while (i < prefix.length && i < name.length && prefix[i] === name[i]) i += 1
      prefix = prefix.slice(0, i)
      if (!prefix) break
    }
    return prefix
  }


// 这个组真正能收的工具 = 匹配到、且不是常驻/自救工具。
function membersOf(g, pool = []) {
  return pool.filter((name) => !CORE_TOOLS.has(name) && g.res.some((re) => re.test(name)))
}

function groupOf(toolName, groups = []) {
  for (const g of groups) if (g.res.some((re) => re.test(toolName))) return g.id
  return null
}

export { matcherFor, compileGroups, commonPrefix, membersOf, groupOf }
