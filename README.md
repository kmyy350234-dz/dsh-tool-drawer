# 工具抽屉 · dsh-lazy-tools

**中文** | [English](README.en.md)

> 你装了一堆插件，工具表越堆越长，每一轮请求都在为「永远用不到」的工具付 token。
> **工具抽屉**把重工具组收起来；常用的留在台面，一周没碰的自己沉底；真要用的时候，一句话、一步调用、或者它自己拦下来补开。

**状态：** `0.11.0` — 在一台 DSH 上每天使用中；配置面仍可能变。
Issue / PR 都欢迎，但维护是**尽力而为**：需要稳定保证的请自行 fork。
如果 DSH 将来原生支持按需加载，这个项目应当退场（见[退场条件](#退场条件)）。

---

## 为什么需要它

每一条工具定义，都在**每一次请求**里占 token。一个桌面自动化插件能带 50+ 个工具，浏览器插件 30+，视觉插件十几个——几百条定义，模型每轮都要读，哪怕这次的任务根本用不到。

本机实测：**181 个工具里有 92 个被四组收起**，按 220 token/工具折算，**每轮少约 2 万 token**（数据来源：140 个工具 ≈ 31.1k token 的实测样本，按比例外推）。

## 和其他做法的区别

| 做法 | 代价 |
|---|---|
| MCP 代理（`search_tools` + `execute_tool`） | 每次真实调用都过一层通用包装，参数校验不再是原生的 |
| 向量路由（意图 → 工具） | 约 90 MB 编码器 + 每轮一次检索；**而且路由错了会悄悄把你要的工具藏起来** |
| **本插件** | 在 agent 自己的作用域上调一次 `restrict({deny})`——没有进程、没有额外跳转、没有模型、没有第三方包（唯一的 import 是宿主自带的 `@deepseek-ai/schemastery`，只用来画设置页，运行时解析，拿不到就降级） |

核心就一句话：**把门控放在「注册表作用域层」，而不是传输层或序列化层。** 如果你的宿主提供「按 agent 隐藏全局工具」的能力，就该用它。设计与取舍见 [DESIGN.md](DESIGN.md)。

## 安装

这是一个 **bundle**（宿主半边 + 一个设置页客户端半边）。把仓库 clone 到任意位置，然后用插件管理器安装——**不要手改 `cordis.patch.yml`**：

```
plugin_manager install_bundle  target: /你的路径/dsh-lazy-tools
```

它会把 checkout 链接进 profile、选中 bundle、并启动客户端半边。bundle 的 patch 已经带了四组（桌面·看 19 / 桌面·点 37 / 浏览器·重 28 / 视觉·重 8）以及 `keep` 列表和 `autoHints`；改组成员就改 checkout 里的 `cordis.patch.yml`（或在 profile patch 里覆盖那一行）。

配置改动重载即生效；**宿主代码改动需要重启进程**。设置页由客户端半边绘制，通过 loopback 路由和宿主通信。

手写 `cordis.patch.yml` 那一行仍然可行（见 [examples/profile-patch.snippet.yml](examples/profile-patch.snippet.yml)），但只能拿到宿主半边，**没有设置页**。

## 配置（每组）

| 字段 | 含义 |
|---|---|
| `id` | 组 id，所有工具调用都用它 |
| `match` | 匹配式数组。普通字符串是 glob（`*` 通配、整串锚定）；`re:` 前缀表示直接用正则 |
| `keep` | 永不当作「漏网」的工具名——你故意留着可见的那些 |
| `expect` | 这一组应该有多少个工具。数字对不上会在 `lazy_tools_health` 的 `warnings[]` 里报 |
| `defaultOn` | `false` = 默认收起（几乎总是你想要的） |
| `autoHints` | 可选词组：用户消息里出现就在模型读到之前把这一组打开（子串匹配、忽略大小写）。**把用户实际会打的变体都列上**——`截图` 匹配不到 `截个图` |
| `title`、`hint` | 给 `lazy_tools_status` 看的自由文本标签 |

## 八个工具

| 工具 | 做什么 |
|---|---|
| `lazy_tools_status` | 每组：`on`、`mode`（`hide`/`only`/`all`）、`matched`、`visible`、`expect*`、`hot`、`lastUsed` |
| `lazy_tools_enable {group \| groups, only?}` | 开启一组；`only: ['名字']` 只放这几个（其余仍收起）；`groups: [...]` 批量 |
| `lazy_tools_disable {group \| groups}` | 重新收起（同时清掉 `only` 白名单） |
| `lazy_tools_list {group?}` | 列出组内工具名（包括当前被隐藏的，用 `visible` 标注） |
| `lazy_tools_resolve {name, apply?}` | **一步**：按名字或片段找到所属组，只放它一个出来。适合在 `unknown tool` 报错之后立刻用 |
| `lazy_tools_mode {level?, idleDays?, reset?, collapse?}` | **只对当前会话**：改收敛阈值并重算默认开关；`reset:true` 回全局；`collapse:true` 立刻清空本会话 |
| `lazy_tools_scan` | 把当前可见工具按名字前缀分桶，方便你写新的组匹配式 |
| `lazy_tools_health` | 契约自检（`register`/`schemas`/`restrict`/`agent/created`）、`healthy`、`warnings`、`stray`、`usage`、`autoOpened`、`selfHealed`、最近的错误 |

`healthy: true` 的含义是：四个契约都通 **且** 没有错误 **且** 没有警告。

## 设置项

`lib/config.js` 导出一份 `Config`，DSH 会在自己的设置页里渲染这些字段：

| 字段 | 默认 | 含义 |
|---|---|---|
| `level` | `medium` | 自动收敛的力度：`low` 14 天 / `medium` 7 天 / `high` 3 天 |
| `presets` | `{14,7,3}` | 三档各自多少天——按你自己的节奏改 |
| `idleDays` | 跟随 `level` | 手动覆盖天数（`0` = 不按时间收敛） |
| `minTools` | `3` | 小于这个数量的组不值得动 |
| `showDock` | `false` | 在输入框上方显示档位控件 |
| `showClear` | `false` | 在输入框上方显示独立的「立刻清空」按钮 |

两个界面开关**互相独立**；控件按对话挂载，所以勾选后要切一次对话（或刷新页面）才会出现。设置面板是双语的，跟随宿主语言服务。

组定义（`groups:`）留在 bundle patch 里——写一次就不常动，而且嵌套数组在表单里很难看。其余字段可以放着自己用。

`Config` 的 schema 是运行时解析的：扫 `%USERPROFILE%\.dsh\profiles\*\` 找 `@deepseek-ai/schemastery`（DSH 自带的包），只用 Node 内置模块。找不到就让 `Config = undefined`——**没有设置页，插件本身不受影响。**

设置面板会写 `~/.dsh/lazy-tools.policy.json`，它优先于 YAML 默认值。删掉该文件即回到 bundle patch 的默认。

## 为什么它「像是有智能」（但里面没有模型）

大多数人是装一堆插件、每个都很少用——但真到要用的时候，工具必须在。

三个确定性机制覆盖这件事，**没有一个在猜**：

0. **用量账本 + 会话开始决策** —— 每次真实调用都记进 `~/.dsh/lazy-tools.usage.json`（只存时间戳，不存参数）。会话开始时：`idleDays` 内用过的组、或 `defaultOn: true` 的组保持打开，其余收起。**决策只发生在会话边界**，所以永远不会打掉正在命中的前缀缓存。
1. **`autoHints`** —— 用户消息进来时宿主会发 `agent/inbox/inserted`；文本里含配置的词，就在**模型读到消息之前**把组打开，工具就是「本来就在」。它从不自动关，每次自动开都记账（`health` 里的 `autoOpened`），方便事后查误开。
2. **`lazy_tools_resolve` / 自愈** —— 调用失败（`unknown tool`）时，`resolve` 找到所属组并只放出那一个；另有一个 dispatch 守卫会在调用被拒**之前**尝试放出来，让模型直接重试（`selfHealed` 计这两个）。

没有 embedding、没有裁判模型、没有代理：所谓的「智能」只是**利用宿主本来就给出的证据**（一条消息、一个报错），而不是要求模型记住规则。

## 它帮你防住什么

- **漏网工具** —— 插件升级新增了 `vendor__new_tool`，如果没有任何组匹配它，它会悄悄变回可见、安静烧 token。`stray` 会推导每组的前缀家族，把「看起来像这一族、但没有任何组匹配」的可见工具点出来（`keep` 里排除）。
- **计数漂移** —— `expect` 把「该藏 28 个」变成一条会检查的断言。
- **作用域竞争** —— 子 agent 可能在 `tools/change` 处理器跑到一半时被销毁；这种限制失败记为 `agent 已销毁`，**不算失败**。
- **重载孤儿** —— 限制的解除函数通过 `ctx.effect` 挂生命周期，热重载会把它解除掉，而不是留下孤儿让 `enable` 假成功。

## 测试

```bash
node test/smoke.mjs   # 32 项断言，跑在假宿主上，不需要 DSH
```

假宿主只实现本插件依赖的四个契约，所以契约一变，测试会先红，而不是你的会话先坏。

## 局限（请务必读）

1. **只能藏全局工具**。注册在 agent 作用域里的工具（有些插件家族这么干）藏不了——宿主会拒绝。
2. **按名字分组**。DSH 的 `ToolSchema` 没有标签，所以组只能是对名字的 glob/正则。
3. **开关会打断前缀缓存**。开一次就让它开着；需要反复切换时，优先用 `only:` 而不是整组开。
4. **自动收敛只在会话开始**。它不会在干活途中重排，因为那会打掉当前任务的前缀缓存。
5. **失败方向是放开**：契约坏了，工具就都回来、多花点 token——不会把你锁在外面。
6. **自愈只对「存在但被隐藏」的工具有效**。拼错的名字、还没加载的插件修不了；那种情况用 `lazy_tools_resolve` 给片段找。
7. **界面双语，工具描述不是**。设置面板和输入框那一行跟随宿主语言服务；模型看到的工具描述是开机注册一次的，仍是中文——宿主进程看不到界面语言。

## 退场条件

如果 DSH 哪天原生支持按需加载（它已经带着 `deferLoading` 和工具增补消息），这个项目应当退场，而不是去竞争。

## 先行工作与致谢

这里没有新点子。下面是塑造过它的项目和论文——前三个我仔细读过，4–7 主要看 README。如果我曲解了你的项目，开个 Issue，我改。

| 项目 | 它在哪一层 | 我取了什么 / 为什么不同 |
|---|---|---|
| [tool-attention](https://github.com/asadani/tool-attention) — [arXiv:2604.21816](https://arxiv.org/abs/2604.21816) | 每轮基于 embedding 的意图路由 + 两段式 schema 加载 | 它量化了「工具税」有多大；我不用 embedding，因为路由错了会悄悄藏掉你要的工具，而且为了省 token 引入一个大编码器不划算 |
| [mcp-lazy-load](https://github.com/PeterCha90/mcp-lazy-load) | MCP 代理，暴露 `search_tools` / `execute_tool` | 它展示了能省到什么程度；我选择让真实调用保持原生，而不是过一层通用执行器 |
| [dsh-mcp-loader](https://github.com/MikotoMyWife/dsh-mcp-loader) | DSH 插件：按服务器的 loader + 按 agent 的 `restrict` 掩码 | 和我同一层机制（它也记录了 `restrict` 只接受全局注册的名字）；我这份不绑命名空间，并且多了 `only:` |
| [lazy-mcp](https://github.com/voicetreelab/lazy-mcp) | 代理层，按服务器分树 | 分组词汇的参考 |
| [opencode-lazy-loading](https://github.com/omarwaly-ai/opencode-lazy-loading) | 请求层剥离 | 「大幅缩减」这一说法的参考 |
| [dsh-sieve](https://github.com/Sev7eEn7/dsh-sieve) | DSH 上下文过滤，带裁判模型 | 我避开「模型在环」判断的理由 |
| [microsoft/agent-framework — progressive disclosure 示例](https://github.com/microsoft/agent-framework/blob/e39a8a2e/python/samples/02-agents/mcp/mcp_progressive_disclosure.py) | 按需暴露 MCP 工具 | 术语参考 |

## 它不是什么

- **不是代理、不是网关、不是 MCP 客户端**：不碰传输层，不加跳跃。
- **不是自动路由**：它从不猜你想要哪个工具；是你要，它才开。
- **不是安全边界**：把工具从模型列表里藏起来而已，不会阻止执行。权限请用宿主自己的机制。

## 许可

MIT — 见 [LICENSE](LICENSE)。

---

## English summary

**On-demand tool groups for DeepSeek Harness.** Hide heavy tool groups from every request; bring
them back with one call, a keyword, or a dispatch guard that self-heals. 181 tools → 89 visible,
≈20k tokens per request avoided on one machine. No proxy, no embeddings, no judge model: gating
happens at the registry-scope layer, so real calls stay native. Install with
`plugin_manager install_bundle`, configure in the DSH settings page. MIT licensed; maintenance is
best-effort. Full rationale and trade-offs: [DESIGN.md](DESIGN.md).
