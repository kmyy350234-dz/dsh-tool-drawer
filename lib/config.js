// 设置页的来源：DSH 会用插件的 Config（schemastery）自动渲染设置表单。
//
// 三条实测结论（2026-10-24）：
//   1. schemastery 是宿主自带的包（`@deepseek-ai/schemastery`，3.18.4），不额外下载；
//      它的 ESM 入口是 **默认导出**（`import Schema from '...'`），没有具名 Schema。
//   2. `groups` 用 `Schema.array(Schema.any())` 就能原样保留每个组的全部字段
//      （match / keep / expect / autoHints 都实测过），设置页不必理解组。
//   3. 未知顶层键不会被剥离。
//
// 为什么不用裸导入：本插件放在仓库里（file:// 行），从那里往上找 node_modules
// 找不到 profile 装的包。所以这里按 `%USERPROFILE%\.dsh\profiles\*\` 逐个试解析。
// 只用 node 内置模块（module/fs/path/url），不下载任何东西；全失败就把 Config
// 设成 undefined —— 宿主只是不渲染设置页，插件本体照常工作。
import { createRequire } from 'node:module'
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

function resolveSchemastery() {
  const require = createRequire(import.meta.url)
  const home = process.env.USERPROFILE || process.env.HOME
  const candidates = []
  if (home) {
    const profilesRoot = join(home, '.dsh', 'profiles')
    if (existsSync(profilesRoot)) {
      for (const entry of readdirSync(profilesRoot)) candidates.push(join(profilesRoot, entry))
    }
    candidates.push(join(home, '.dsh'))
  }
  for (const dir of candidates) {
    try {
      return require.resolve('@deepseek-ai/schemastery', { paths: [dir] })
    } catch {
      // 继续下一个候选目录
    }
  }
  try {
    return require.resolve('@deepseek-ai/schemastery')
  } catch {
    return null
  }
}

let Config

const resolved = resolveSchemastery()
if (resolved) {
  try {
    const loaded = await import(pathToFileURL(resolved).href)
    const Schema = loaded.default || loaded
    Config = Schema.object({
      level: Schema.union(['low', 'medium', 'high'])
        .default('medium')
        .description('自动收敛档位：low（14 天）/ medium（7 天，默认）/ high（3 天）'),
      idleDays: Schema.number()
        .description('多少天没被调用就默认收起；不填就跟档位走，写 0 表示不按时间收敛'),

      // 注意：`warmRatio`（组热判据）**故意**不进设置页 —— 它是内部判据，用户不需要懂。
      // 需要调的人走配置文件或 `/policy`（逃生门），设置页只留「装了就能用」的那几项。
      minTools: Schema.number()
        .default(3)
        .description('少于这么多个工具的组不值得动它'),
      classifyNudge: Schema.boolean()
    .default(true)
    .description('发现没有前缀、也没归组的裸名工具时，在系统提示里提醒 agent 分类一次（可关闭；关掉后仍可手动调 lazy_tools_classify）'),
  showDock: Schema.boolean()
        .default(false)
        .description('在输入框上方显示「工具抽屉」控件；默认关闭，想用的人自己打开'),
      showClear: Schema.boolean()
        .default(false)
        .description('在输入框上方显示「立刻清空」按钮；默认关闭，与档位按钮互相独立'),
      presets: Schema.object({
        low: Schema.number().default(14).description('低档 = 多少天'),
        medium: Schema.number().default(7).description('中档 = 多少天'),
        high: Schema.number().default(3).description('高档 = 多少天'),
      }).description('三档各自对应多少天，可以按自己的节奏改'),
      autoGroups: Schema.union(['off', 'suggest', 'on'])
        .default('suggest')
        .description('自动分组：off 关闭 / suggest 只在 scan 里给建议 / on 自动建组并按规则收起'),
      extraGroups: Schema.array(Schema.any()).description('追加的组（不动默认四组）：给没有共同前缀的工具手写名单用'),
  groups: Schema.array(Schema.any()).description('工具组定义（高级，会整体替换默认四组）'),
    })
  } catch {
    Config = undefined
  }
}

export { Config }
