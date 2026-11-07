import { markSeen } from './state-ops.js'
export function createRebuild({
  host,
  stateFor,
  stats,
  PROCESS_LIFTS,
  CORE_TOOLS,
  ROLE_HIDEABLE_CORE,
  isAllowedByPolicy,
  groupOf,
  hiddenBy,
  nowIso,
}) {
  const rebuild = (agent) => {
    const st = stateFor(agent)
    if (st.rebuilding) {
      st.pendingRebuild = true
      return
    }
    st.rebuilding = true
    stats.rebuilds += 1
    try {
      let rounds = 0
      do {
        st.pendingRebuild = false
        rebuildOnce(agent, st)
        rounds += 1
      } while (st.pendingRebuild && rounds < 5)
      if (st.pendingRebuild) {
        st.pendingRebuild = false
        host.log('warn', 'rebuild still pending after 5 rounds; dropped (possible change loop)')
      }
    } finally {
      st.rebuilding = false
    }
  }

  const rebuildOnce = (agent, st) => {
    // 解除旧限制：失败重试一次（学自 dsh-ops 的 clear()：孤儿限制比不解除更危险，
    // 它会让下一次 rebuild 叠在旧掩码上，出现"改了没生效"的假象）。
    const leftovers = []
    for (const lift of st.lifts) {
      let ok = false
      for (let attempt = 0; attempt < 2 && !ok; attempt += 1) {
        try {
          lift()
          ok = true
        } catch (error) {
          if (attempt === 1) {
            host.record('lift', error)
            leftovers.push(lift)
          }
        }
      }
    }
    st.lifts = leftovers
    if (leftovers.length) host.log('warn', `lift failed twice; ${leftovers.length} restriction(s) kept for retry`)
    PROCESS_LIFTS.delete(agent)
    // 2026-11-01（0.18 隔离约束①）：只在「本会话当前可见」的名字里选要藏的。
    // 别人已经藏掉的名字不再由我们 deny —— 否则撤销我们这层也放不出来，账还会算在别人头上。
    const visibleAfterLift = host.toolNames(agent)
    const source = visibleAfterLift
    const wanted = st.managed
      ? source.filter((name) => (!CORE_TOOLS.has(name) || ROLE_HIDEABLE_CORE.has(name)) && !isAllowedByPolicy(st.managed, name, groupOf))
      : source.filter((name) => hiddenBy(st, name))
    // 2026-11-04（与别名/scoped 工具共存）：宿主只允许 mask **全局工具**，
    // 别的插件注册在 agent 作用域的工具（如别名转发壳）天然不可 restrict。
    // 不去 deny 它们 —— 否则每次 rebuild 都换一条「这些名字不可限制」，
    // health 被永久拖红，而它们本来也不归我们管。读不到可 restrict 名单时保持旧行为（照藏）。
    const restrictable = host.restrictableNames(agent)
    const hidden = restrictable ? wanted.filter((name) => restrictable.has(name)) : wanted
    let applied = false
    if (hidden.length) {
      const lift = host.hideTools(agent, hidden)
      if (lift) {
        st.lifts.push(lift)
        PROCESS_LIFTS.set(agent, lift)
        stats.hideEvents += 1
        applied = true
      }
    }
    // 记下「这个会话里真正挂载过的工具名」。用途只有一个：health 要能分清
    //   ① 宿主压根没挂到本会话（如 cua_driver_native__* 自 DSH 2.0.20 起挂不上）→ 静音待命；
    //   ② 挂过又不见了，且不是我们收的 → 真异常，必须响。
    // 没有这份记录，两种情况长得一模一样，只能一律报警 —— 报警久了就没人看了。
    markSeen(st, host.toolNames(agent))
    // 2026-11-01（0.18 隔离约束②）：撤销后回读。上一轮我们藏过、现在仍不可见、
    // 且不是本轮要藏的名字 ⇒ 被外部层挡住（不是我们）。只记证据，不抢别人的锁。
    // 2026-11-06（冷读红 1/红 2）：用**实际可见**算「藏不掉」的名单。
    // 真宿主里 scope 同名注册的工具永远 visible；reserved PTC（run_code）的 restrict 必抛；
    // 而 restrictableNames 读不到时旧过滤会整体失效 —— 只看名单都不能代表"藏得住"。
    // 于是把「想藏但本轮之后还看得见」记下来，泄漏检测不再把它们当漏网，避免 3 秒重建链。
    const stillVisible = host.toolNames(agent)
    // 2026-11-06（冷读 2 红）：逐名字判断，而不是整批布尔。
    //   - denied：这一批 restrict 确实点过名（成功或逐名字成功）；
    //   - permanent：badname（unknown / reserved PTC），永久藏不掉；
    //   - transient：这轮失败（systemic/inactive），下一轮必须重试，不能锁。
    // 2026-11-06（复读红 1 + 新洞 1）：只排除 transient。
    //   - shadow（deny 了仍可见）、permanent（badname）、以及**从未进 hidden 的 scope 别名**
    //     都属于「这轮藏不掉」，要锁，否则每次 tools/change 都算漏网（别名壳 3 秒链）；
    //   - transient（这轮 restrict 系统失败）不锁，下一轮重试。
    // 锁本身会在 restrictableNames 签名变化时整体清空，给晚注册的工具一次机会。
    const hideReport = host.hideReport(agent) || { transient: [] }
    // hidden 为空 = 本轮根本没调用 hideTools，报告是**上一轮**的；此时所有 leftover 都该锁，
    // 否则「上轮 transient、本轮退成 scope 别名壳」的名字会永远算漏网（复读黄项）。
    const transient = hidden.length > 0 ? new Set(hideReport.transient || []) : new Set()
    st.unhideable = wanted.filter((name) => stillVisible.includes(name) && !transient.has(name))
    // 外部变化的判据：可限制名单变了（如 alias 退场 / 全局工具晚注册），才值得清闩锁重试；
    // 单纯 tools/change（比如我们自己的 restrict）不该造成 churn。
    st.restrictableSig = restrictable ? [...restrictable].sort().join('\n') : null
    const nextHidden = new Set(hidden)
    const stuck = (st.hiddenNames || []).filter(
      (name) => !visibleAfterLift.includes(name) && !nextHidden.has(name) && !CORE_TOOLS.has(name),
    )
    st.foreign = stuck.length ? { count: stuck.length, sample: stuck.slice(0, 8) } : null
    st.hiddenNames = hidden.slice()
    stats.lastHidden = {
      agentId: agent && agent.id ? String(agent.id) : null,
      hidden: hidden.length,
      applied,
      at: nowIso(),
    }
    // applied 必须跟 hidden 一起打：2026-10-23 实测出现过「restrict 失败、
    // 日志里却照样写 hidden=102」，这种账不能留。
    host.log(
      'info',
      `agent=${String(agent && agent.id)} hidden=${hidden.length} applied=${applied ? 'yes' : 'no'} groups=${[...st.modes.keys()].join(',') || '-'}`,
    )
  }
  return { rebuild, rebuildOnce }
}
