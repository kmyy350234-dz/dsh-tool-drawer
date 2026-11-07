// 启动/策略用的纯小工具（无 DSH 依赖，方便单测与复用）。

function text(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }]
}

function nowIso() {
  try {
    return new Date().toISOString()
  } catch {
    return null
  }
}

const pickNumber = (a, b, fallback) => (Number.isFinite(a) ? a : Number.isFinite(b) ? b : fallback)
// 比例类参数（0~1）：夹到 [0.05, 1]，防手改文件写成 0 或 12 导致「永不整组开 / 一热就全开」。
const pickRatio = (a, b, fallback) => {
  const raw = Number.isFinite(a) ? a : Number.isFinite(b) ? b : fallback
  return Math.min(1, Math.max(0.05, raw))
}

export { text, nowIso, pickNumber, pickRatio, loadPolicy }

function loadPolicy({ cfg, host, readStoredPolicyStrict, LEVEL_DAYS, normalizeAutoMode, normalizeManagedRoles }) {
  const storedRead = (() => {
    try {
      return readStoredPolicyStrict()
    } catch (error) {
      return { ok: false, error }
    }
  })()
  const stored = storedRead.ok && storedRead.policy ? storedRead.policy : {}
  if (!storedRead.ok) {
    host.record(
      'policy file',
      new Error(`policy.json 读不出来（${String((storedRead.error && storedRead.error.message) || storedRead.error)}）—— 本次按插件配置/默认值启动，磁盘上的设置没有被应用`),
    )
  }
  const level = stored.level || (typeof cfg.level === 'string' ? cfg.level : 'medium')
  // 三档的天数可改：存储值 > 配置值 > 内置默认（14 / 7 / 3）
  const presets = {
    low: pickNumber(stored.presets && stored.presets.low, cfg.presets && cfg.presets.low, LEVEL_DAYS.low),
    medium: pickNumber(stored.presets && stored.presets.medium, cfg.presets && cfg.presets.medium, LEVEL_DAYS.medium),
    high: pickNumber(stored.presets && stored.presets.high, cfg.presets && cfg.presets.high, LEVEL_DAYS.high),
  }
  const policy = {
    level,
    // 天数不写就跟档位走（档位天数本身可自定义）
    idleDays: pickNumber(stored.idleDays, cfg.idleDays, presets[level] ?? presets.medium),
    // minTools 下限 3：自动分组要求「同一前缀 ≥3 个」才建组，填 2 不会生效（2026-10-30）。
    // 在加载时就夹住 —— health 里看到的是**生效值**，不是用户填的值。
    minTools: Math.max(3, pickNumber(stored.minTools, cfg.minTools, 3)),
    // 组热判据：组内「热工具」占比 ≥ warmRatio 才整组开（2026-10-30 从硬编码改成可配）
    warmRatio: pickRatio(stored.warmRatio, cfg.warmRatio, 0.3),
    presets,
    showDock: typeof stored.showDock === 'boolean' ? stored.showDock : cfg.showDock === true,
    // 裸名工具分类提示：默认开（false 才关）
    classifyNudge: typeof stored.classifyNudge === 'boolean' ? stored.classifyNudge : cfg.classifyNudge !== false,
    showClear: typeof stored.showClear === 'boolean' ? stored.showClear : cfg.showClear === true,
    // 自动分组：off 不动 / suggest 只建议 / on 直接建组并收起（2026-10-25 加）
    autoGroups: normalizeAutoMode(stored.autoGroups, cfg.autoGroups),
  // 受管角色（默认关闭）：preset id / 'subagent' → { allowGroups, unknown }
  managedRoles: (() => {
    // 2026-11-03（冷读第三轮）：文件里**写了**这个键就必须验形状。以前看的是归一化后的 stored ——
    // 字符串/数组在 normalizePolicy 那一步已经被丢掉，于是"写坏了"和"没写"长得一模一样
    // （静默清空角色）。合法空对象 {} = 没有角色，不许误报。
    const rawStored = storedRead.ok && storedRead.raw ? storedRead.raw : null
    const hasStoredRoles = Boolean(rawStored && Object.prototype.hasOwnProperty.call(rawStored, 'managedRoles'))
    // 2026-11-03（复读遗留 A）：删键 = **显式清空**，不回退到插件配置。
    // 只有「文件根本不存在」才回退 cfg —— 那才是"从没配过"。
    const fileExists = Boolean(storedRead.ok && storedRead.raw)
    if (fileExists && !hasStoredRoles && cfg.managedRoles) {
      host.log('info', 'policy.json 里已删除 managedRoles（按显式清空处理，插件配置里的角色不再生效）')
    }
    const raw = hasStoredRoles ? rawStored.managedRoles : fileExists ? null : cfg.managedRoles
    if (hasStoredRoles) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        host.record(
          'managedRoles',
          new Error('policy.json 里 managedRoles 形状不合法（应为 { 角色: { allowGroups: [...] } }），已忽略文件里的这一项'),
        )
        return null
      }
      if (Object.keys(raw).length === 0) return null
    }
    const normalized = normalizeManagedRoles(raw)
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length && !normalized) {
      host.record('managedRoles', new Error('managedRoles 里没有任何可用条目（每条要有 allowGroups 数组；空数组合法＝只留常驻），已忽略'))
    }
    return normalized
  })(),
  }
  return { policy }
}
