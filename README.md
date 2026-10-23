# 工具抽屉 · dsh-lazy-tools

**中文** | [English](README.en.md)

我装了两百来个工具。桌面自动化的、浏览器的、识图的，全都开着。

问题在于：模型每一轮都要把这些工具的说明读一遍——哪怕我这次只是让它改个错别字。一晚上下来，真正碰过的工具不到一半。

所以我写了个东西，把平时用不上的那几组收起来，要用的时候再放出来。

**状态：0.11.0。** 在一台机器上每天用着。配置面还可能变。Issue 和 PR 都欢迎，但维护是尽力而为——需要稳定保证就自己 fork。DSH 哪天真做了原生按需加载，这东西就该退休。

---

## 到底省了多少

量出来的数字：**本机 181 个工具，四组一共收起 92 个。**

92 × 220 ≈ **每轮省 2 万 token 左右**。

220 这个系数不是猜的：我拿一份 140 个工具的清单量过，约 31.1k token，折下来每个工具约 220 token，再按这个比例外推到 92 个。**这是外推，不是逐项精算**，量级可用，别当财务数字。

省下的是上下文占用和首字延迟。**账单上省多少我不敢承诺**——DSH 有前缀缓存，工具表稳定的时候大部分本来就命中缓存，真正省下来的钱比 2 万 token 的名义值小得多。

## 怎么做到「不读」

DSH 的工具注册表允许按 agent 隐藏全局工具，接口是 `restrict({ deny: [...] })`。

我在每个 agent 创建时，把自己配好的组名下的工具填进 `deny`，它们就从模型看到的工具表里消失了。要开回来，就是解除这条限制。

整个过程里：

- 没有代理进程，调用不经过任何中间层；
- 没有向量检索，不额外跑模型判断你要什么；
- 真实调用还是原生调用，参数校验一点没变。

为什么不用向量路由：路由错一次，你要的工具就被悄悄藏起来，模型只会说「我没有这个能力」；而且为了省 token 再引一个 90MB 的编码器，不划算。

## 装法

这是个 bundle：宿主半边加上一个设置页的客户端半边。clone 到任意位置，然后用插件管理器装：

```
plugin_manager install_bundle  target: /你的路径/dsh-lazy-tools
```

不要手改 `cordis.patch.yml`——手写也能跑，但只有宿主半边，**没有设置页**。

bundle 自带的 patch 已经配好四组：

| 组 | 收起的工具数 | 留着的（永不收） |
|---|---|---|
| 桌面·看 | 19 | 无 |
| 桌面·点 | 37 | 无 |
| 浏览器·重 | 28 | open / content / a11y / click / type / wait |
| 视觉·重 | 8 | describe / ocr / crop / bootstrap / materialize / present |

要改组成员，改 checkout 里的 `cordis.patch.yml`。配置改动重载就生效；**改宿主代码要重启进程**。

## 组怎么配

| 字段 | 说明 |
|---|---|
| `id` | 组 id，工具调用里用它 |
| `match` | 匹配式数组。普通字符串当 glob（`*` 通配、整串锚定），`re:` 开头当正则 |
| `keep` | 故意留着的工具名。列在这里的不会被当成「漏网」 |
| `expect` | 这一组应该有几个工具。数字对不上时 `health` 会警告 |
| `defaultOn` | `false` 就是默认收起，一般都用这个 |
| `autoHints` | 关键词表。用户消息里出现这些词，就在模型读到消息之前把组打开 |
| `title` / `hint` | 给 `status` 看的标签 |

`autoHints` 有个坑要知道：**它是子串匹配**。配了 `截图`，用户打「截个图」就匹配不上。所以要把各种说法都列进去：截图、截个图、截屏、看窗口。

## 八个工具

| 工具 | 干什么 |
|---|---|
| `lazy_tools_status` | 看每组的状态：开没开、模式、匹配到几个、可见几个、是不是「热的」、上次用是什么时候 |
| `lazy_tools_enable` | 开一组。给 `only: ['名字']` 就只放这几个出来，其余仍然收着；给 `groups: [...]` 批量开 |
| `lazy_tools_disable` | 关一组，顺便清掉 `only` 白名单 |
| `lazy_tools_list` | 列出一组里有哪些工具，包括现在被藏着的 |
| `lazy_tools_resolve` | 只知道工具名、不知道属于哪组时用这个：给名字或片段，它找到组、只放那一个出来 |
| `lazy_tools_mode` | 只改当前会话的策略。`reset` 回全局，`collapse` 立刻清空 |
| `lazy_tools_scan` | 把可见工具按名字前缀分组，写新组的时候用 |
| `lazy_tools_health` | 自检四个宿主契约，顺便报 warnings、漏网工具、自动开过的次数、自愈过的次数 |

`healthy: true` 的意思是：四个契约都通，没有错误，没有警告。

## 设置页

`lib/config.js` 导出 schema，DSH 设置页会把这些字段画出来：

| 字段 | 默认 | 说明 |
|---|---|---|
| `level` | `medium` | 收敛力度：低 14 天、中 7 天、高 3 天 |
| `presets` | `{14,7,3}` | 三档各是多少天，按自己的节奏改 |
| `idleDays` | 跟 `level` 走 | 手动指定天数，写 0 表示不按时间收 |
| `minTools` | `3` | 少于这么多工具的组不动它 |
| `showDock` | `false` | 在输入框上方显示档位按钮 |
| `showClear` | `false` | 在输入框上方显示独立的「立刻清空」按钮 |

两个界面开关互相独立。控件是按对话挂载的，所以勾上之后要切一次对话（或者刷新页面）才会出现——不是没生效。

组定义留在 bundle 的 patch 里。写一次就不常动，而且嵌套数组在表单里很难看。

schema 是运行时找的：扫 `%USERPROFILE%\.dsh\profiles\*\` 找 DSH 自带的 `@deepseek-ai/schemastery`，只用 Node 内置模块。找不到就让 `Config` 变成 undefined——没有设置页，插件本身照常跑。

设置页写的策略存到 `~/.dsh/lazy-tools.policy.json`，优先级高于 YAML 默认值。删掉这个文件就回到默认。

## 它为什么看起来像会自己判断

因为我没让它判断，我让它**按证据触发**。三个机制，都不猜：

**一、用量账本。** 每次真实调用，记一条时间戳进 `~/.dsh/lazy-tools.usage.json`（只记时间和工具名，不记参数）。新会话开始时算一遍：某组在 `idleDays` 天内用过，就默认开着；没用过，就默认收着。

这个决策**只在会话开始做一次**，中途绝不动。因为中途改工具表会把前缀缓存打断——省下来的 token 还不够赔缓存。

**二、关键词预开。** 用户消息进 inbox 时，宿主会发 `agent/inbox/inserted` 事件。我在那时候看一眼文本，命中配置的词就把组打开。

关键是时机：**模型还没读到这条消息，工具就已经在了。**

它从不自动关，每次自动开都记一笔（`health` 里的 `autoOpened`），方便你事后查有没有误开。

**三、自愈。** 有些时候模型就是要调一个被藏起来的工具。这时有一个 dispatch 守卫在调用被拒之前拦住它：认出这个工具属于哪组，只把它放出来，然后回一句「已为你打开，请重新调用一次」。

模型重试一次就成。用户那边什么都看不到。次数记在 `health` 的 `selfHealed` 里。

## 它防的是什么

**漏网的。** 插件升级加了个新工具，你的组匹配式没覆盖到——它就会悄悄变回可见，安静烧 token。`health` 里的 `stray` 会推导每组的名字前缀，把「看起来像这一族、但没被任何组匹配」的工具点出来（`keep` 里的除外）。

**数字漂移的。** 我给每组写了 `expect`（应该有几个）。哪次工具数量变了，`health` 直接警告，不用我肉眼看。

**竞态的。** 子 agent 可能在限制建到一半时被销毁。这种情况记成「agent 已销毁」，**不算失败**，不然体检结果会被这类噪音污染。

**孤儿限制的。** 解除函数挂在 `ctx.effect` 上，热重载会把它解除掉，而不是留一条孤儿限制让 `enable` 假成功。

## 测试

```
node test/smoke.mjs
```

32 项断言，跑在一个假宿主上，不需要装 DSH。

假宿主只实现本插件依赖的四个契约。所以宿主一改契约，测试先红，而不是你的会话先坏。

## 局限（这部分请一定看）

1. **只能藏全局工具。** 有些插件把工具注册在 agent 作用域里，那种藏不了，宿主会直接拒绝。
2. **按名字分组。** DSH 的工具定义没有标签，只能对名字写 glob 或正则。改名就漏。
3. **开关会打断前缀缓存。** 开一次就让它开着。非要反复切，优先用 `only:` 而不要整组开。
4. **自动收敛只在会话开始。** 干活途中不会重排，理由同上：那会把当前会话的缓存打掉。
5. **失败方向是放开。** 契约坏了、文件读不到，工具全部回到可见——多花 token，但不会让你少个能力。
6. **自愈只对「存在但被隐藏」的工具有效。** 拼错的名字、还没加载的插件，修不了。那种情况用 `resolve` 给片段找。
7. **界面双语，工具描述不是。** 设置面板和输入框那一行跟着宿主语言走；模型看到的工具描述是开机注册一次的，还是中文——宿主进程看不到界面语言。

## 什么时候它该退休

DSH 已经在带 `deferLoading` 和工具增补消息了。哪天它做成原生的按需加载，这东西就该退出，而不是继续跟它抢活。

## 借鉴了谁

这里没有原创的点子，只有取舍。前三个我仔细读过，后面几个主要看 README：

| 项目 | 它做的事 | 我取了什么，哪里不同 |
|---|---|---|
| [tool-attention](https://github.com/asadani/tool-attention)（[论文](https://arxiv.org/abs/2604.21816)） | 每轮用 embedding 做意图路由，再分两段加载 schema | 它把「工具税」量清楚了；我没用 embedding，理由是路由错了会静默藏掉要用的工具 |
| [mcp-lazy-load](https://github.com/PeterCha90/mcp-lazy-load) | MCP 代理，暴露 `search_tools` / `execute_tool` | 证明能省到很夸张的程度；我选择让调用保持原生，不过通用执行器 |
| [dsh-mcp-loader](https://github.com/MikotoMyWife/dsh-mcp-loader) | DSH 插件，按服务器加载 + 按 agent 打 `restrict` 掩码 | 和我同一层。它也写过「`restrict` 只接受全局注册的名字」这条限制 |
| [lazy-mcp](https://github.com/voicetreelab/lazy-mcp) | 代理层，按服务器分树 | 分组词汇的参考 |
| [opencode-lazy-loading](https://github.com/omarwaly-ai/opencode-lazy-loading) | 请求层剥离 | 「大幅缩减」这个说法的参考 |
| [dsh-sieve](https://github.com/Sev7eEn7/dsh-sieve) | DSH 上下文过滤，带裁判模型 | 我避开「模型在环」判断的理由 |
| [microsoft/agent-framework 的 progressive disclosure 示例](https://github.com/microsoft/agent-framework/blob/e39a8a2e/python/samples/02-agents/mcp/mcp_progressive_disclosure.py) | 按需暴露 MCP 工具 | 术语参考 |

如果哪个作者觉得我写错了他的项目，开个 Issue 说一声，我改。

## 它不是什么

- **不是代理，不是网关，不是 MCP 客户端。** 不碰传输层，不加跳跃。
- **不是自动路由。** 它从不猜你想要哪个工具。是你要，它才开。
- **不是安全边界。** 藏起来只是从模型列表里拿掉，不代表不能执行。要拦权限请用宿主自己的机制。

## 许可

MIT，见 [LICENSE](LICENSE)。

---

## English summary

Tool Drawer for DeepSeek Harness: keeps heavy tool groups out of every request and brings them back
on demand (one call, a keyword, or a dispatch guard). 181 tools, 92 hidden, ≈20k tokens per request
avoided on one machine. No proxy, no embeddings, no judge model — real calls stay native. Install with
`plugin_manager install_bundle`; configure in the DSH settings page. MIT, best-effort maintenance.
