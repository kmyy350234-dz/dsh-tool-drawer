# 工具抽屉 · dsh-tool-drawer

**中文** | [English](README.en.md)

装上两百来个工具之后，问题会变得很明显：模型每一轮都要把这些工具的说明读一遍——哪怕这次只需要改一个错别字。一晚上下来，真正被调用过的工具往往不到一半。

工具抽屉处理的就是这件事：平时用不上的工具组收起来，要用的时候再放出来。

**状态：0.19.3。**

> **0.19.0-dev 新增**：`review:` / `build:` / `research:` 角色 label（按 label 裁工具面）；
> `review:`/`research:` 隐藏 edit/write；`findings` 台账与收敛判定；
> mutation score 校准；`schedule` 官方包默认开启（只给顶层 agent）。
> 这些还在测试，未发版。
 在一台机器上日常使用。配置面仍可能变化。Issue 和 PR 都欢迎，维护是尽力而为；需要稳定保证请自行 fork。DSH 若实现原生按需加载，这个项目应当退场。

实测过的宿主：**DSH 2.0.20-next** 与 **2.0.21-next**（2.0.21 起 `pwsh` 被 `ops_*` 取代；插件不做版本分支，保护清单用两代并集，缺失的名字是空操作）。更早的版本未测。

---

## 装完就能用

默认行为就是全部，**不需要打开任何设置，也不需要写任何配置**：

- 出厂四组（桌面·看 / 桌面·点 / 浏览器·重 / 视觉·重），按最近使用自动收放；
- 被收起的工具**在你真的调用它的时候会自动放出来**（守卫机制），不用先知道它属于哪一组；
- 需要某个能力时，模型调 `lazy_tools_enable` 把组放回来；它直接调用被收起的工具时，守卫会先放回、再直接执行；
- 想看现状：`lazy_tools_status`；想本会话全开：`lazy_tools_mode { idleDays: 0 }`。

一句话：装上，照常用。

## 想自己调的人

按「从轻到重」排，下面四处都是纯文本：

| 想改什么 | 改哪里 |
|---|---|
| 档位 / 闲置天数 / 是否显示控件 / 分类提示开关 | 设置页，或 `~/.dsh/lazy-tools.policy.json` |
| 有共同前缀的工具组（`dsh_browser_*` 这类） | 包的 `cordis.patch.yml` 里的 `groups`，或配置 `extraGroups`（**追加**，不动默认组） |
| 没有共同前缀的工具（`click` / `type_text` 这种裸名） | `~/.dsh/lazy-tools.groups.json`；也可以让 AI 调 `lazy_tools_save_groups`（不传 `groups` 看描述、带 `groups` 落盘） |
| 只想看不想写 | `lazy_tools_status` / `lazy_tools_list` / `lazy_tools_health` |

匹配式支持 `*` 通配和 `re:` 正则；每组可写 `keep`（永不收起）、`expect`（数量断言）。

**三条红线**（这个项目自己也不越过）：**默认**不在会话中途改工具表（例外只有显式动作 `enable`/`disable`/`mode`/`save_groups{applyNow}` 与自愈补开，且都要留痕）· 自救工具永不入组 · 失败必须报出来。展开在 [DESIGN.md](DESIGN.md)。

---

## 省了多少

**实测**（2026-10-28，本机 168 个注册工具）：

```
工具定义合计        178,702 字符   # 只算本会话真正相关的（可见 + 收起）
当前收起 48 个       94,792 字符   （53%）
注册表内可见 101 个  83,910 字符
宿主未挂载 19 个     23,637 字符   # 从没进过上下文，不算「省下的」
```

> 这台机器上有 19 个工具（`cua_driver_native__*`）宿主压根没挂到会话里 —— 它们从没花过 token，所以**单列**，不并进「省下了多少」。工具全部挂载的机器上这一项为 0，数字会回到「收起 67 个 / 118,429 字符 / 58%」。
> **缓存账（2026-10-30 补）**：上面报的是「工具 schema 不进请求」省下的**字符数**，不是账单上的等比值。
> 稳态下工具定义本来就在前缀缓存里命中，命中价通常只有未命中的几分之一（具体倍率由服务商决定，这里不编数字）；
> 而**会话中途改工具表**会让后续请求的缓存作废一次 —— 本插件会中途改表的只有：自愈、显式 `enable`/`disable`/`mode`、`save_groups {applyNow:true}`。
> 它们都是「用户或模型当下就要用」，不是优化手段；如果一次会话都没触发，缓存一次都不会被打断。
> **这组数是「冷启动 / 还没用热」时的实测**：用久了，热组会默认开着，收起量自然往下走 —— 那不是虚报，是插件的设计（按使用热度）。复现请跑 `lazy_tools_health { bench: true }`。
> 另有 34 个**不在工具注册表里**的工具：33 个宿主内核（`read` / `write` / `pwsh` / `glob` / `web_fetch` …）+ 1 个 agent 作用域的 `ops_discover_tools` —— 它们不进注册表，也不上表统计，不会被收起。

换算成 token 请用你自己 provider 的 tokenizer —— 这里只报**字符数**，因为不同语言的描述密度差别很大，硬编一个系数等于替读者猜。

**这个数字随时可以自己复现**：

```
lazy_tools_health { bench: true }
```

它会把每个组的工具数、收起的字符数、可见/收起/未挂载三态都列出来（百分比自己除一下）。README 里所有数字都来自这条命令。

> 早期版本写的是「约 220 token/工具」的估算；换成 `lazy_tools_health { bench: true }` 之后，改成实测字符数，读者可以核对。

## 怎么做到「不读」

DSH 的工具注册表支持按 agent 隐藏全局工具，接口是 `restrict({ deny: [...] })`。

每个 agent 创建时，把配置组内的工具填进 `deny`，它们就从模型可见的工具表里消失；解除这条限制即恢复。

整个过程不引入：

- 代理进程（调用不经过中间层）；
- 向量检索（不额外跑模型判断意图）；
- 包装器（真实调用仍是原生调用，参数校验不变）。

不用向量路由的原因：路由错一次，需要的工具会被静默藏掉，模型只会回「没有这个能力」；另外为省 token 引入一个 90MB 编码器并不划算。

## 装法

这是一个 bundle：宿主半边加一个设置页的客户端半边。三种装法，任选其一。

**从 GitHub 直接装（插件市场显示的就是这条）：**

```
dsh plugin --profile web add github:kmyy350234-dz/dsh-tool-drawer
```

**或者用仓库里的 Release 包（不依赖 npm）：**

```
dsh plugin --profile web add https://github.com/kmyy350234-dz/dsh-tool-drawer/releases/latest/download/dsh-tool-drawer.tgz
```

**或者 clone 到任意位置，用插件管理器装：**

```
plugin_manager install_bundle  target: /你的路径/dsh-tool-drawer
```

不建议手改 `cordis.patch.yml`——手写也能运行，但只有宿主半边，**没有设置页**。

bundle 自带的 patch 已配好四组：

| 组 | 收起数量 | 保留（永不收起） |
|---|---|---|
| 桌面·看 | 19 | 无 |
| 桌面·点 | 37 | 无 |
| 浏览器·重 | 28 | open / content / a11y / click / type / wait |
| 视觉·重 | 8 | describe / ocr / crop / bootstrap / materialize / present |

改组成员改 checkout 里的 `cordis.patch.yml`。配置改动重载生效；**改宿主代码需要重启进程**。

## 自动分组

插件越装越多，新插件带进来的工具没人管，就一直可见、一直付 token。`autoGroups` 让插件按**工具名前缀**识别家族，自动给它们建组。

插件目录的收录描述里提醒过：自带分组只覆盖 `cua_driver_native` / `dsh_browser` / `vision` 三类，其他工具要在 `cordis.patch.yml` 里自己加。**`autoGroups` 补的就是这一步**——其余家族会被自动识别成组；想改匹配式或加 `keep` 名单，再回去写配置。

| 模式 | 行为 |
|---|---|
| `off` | 完全不动 |
| `suggest` | 只在 `lazy_tools_list { ungrouped: true }` 的 `autoGroups.suggestions` 里给建议，不建组 |
| `on`（默认） | 自动建组，并按规则默认收起。被收起的工具第一次被调用时会自动放回来，所以「误分组」最多多一次往返 |

**新装的插件可能被自动收起**：自动组的 id 以 `auto-` 开头（如 `auto-foo`），用 `lazy_tools_disable auto-foo` 就能解散；核心工具永不入组；被收起的工具第一次被调用时，守卫会自动把它放回来。

规则都写死在代码里，不靠猜：

- 按 `__` 或 `_` 切段；**子族合计覆盖 ≥80% 才往下切**，否则保留整族（`mnemon` 的 17 个不会被切成两个 3 个）；
- 同一前缀 ≥ `minTools`（默认 3）个才建组；
- 已被现有组覆盖 ≥80% 的前缀跳过；
- **核心工具永不入组**（`read` / `write` / `edit` / `pwsh` / `grep` / `glob` / `skill` / `todo_write` / `lazy_tools_*` 等）；
- 只在会话开始时算一次，整场不变（不打断前缀缓存）；
- 自动组 id 带 `auto-` 前缀，`lazy_tools_status` 里看得见，`lazy_tools_disable auto-xxx` 一条命令解散。

**看不到内核内置工具**：`read`、`schedule`、`job` 这类不在插件注册表里，自动分组不会碰它们。

想自定义匹配式或 keep 名单，仍然写配置——下一节。

## 组怎么配

| 字段 | 说明 |
|---|---|
| `id` | 组 id，工具调用时使用 |
| `match` | 匹配式数组。普通字符串按 glob 处理（`*` 通配、整串锚定）；`re:` 开头按正则处理 |
| `keep` | 有意保留可见的工具名，不会被判定为「漏网」 |
| `expect` | 该组**至少**应有的工具数量（下限）；**少于**它时 `health` 告警，多出来不算漂移（吸纳型组本来就会长新工具） |
| `defaultOn` | `false` 表示默认收起 |
| `title` | 供 `status` 展示的中文名 |

## 受管会话（managedRoles，默认关闭）

> **它做什么、不做什么**：受管角色是在**编排器已经给出的工具集上再收紧**。`restrict` 在作用域链上取交集，
> 所以它**不能给角色加上编排器没给的工具**——worker 没有浏览器工具，抽屉变不出来。
> 它防的是「角色会话里冒出不该有的工具」，不是「给角色分配能力」。

多会话编排器（如 dsh-superagent）用 preset 区分角色。默认情况下本插件不区分角色，所有会话都按热度判断。配置 `managedRoles` 后，某个 preset 会被认成「受管角色」：策略在会话创建时解析一次，会话内不变（前缀稳定、不打断缓存）。

设置页的「角色工具面」可以逐项开关，也可以填角色名+允许组加自定义角色；**默认关闭**，只有勾选/配置后才接管对应 label。

**写在哪**：`~/.dsh/lazy-tools.policy.json` 的 `managedRoles` 字段（**JSON**，不是 YAML；和设置页那些档位存在同一个文件），或者插件的 config（profile 里的 YAML）。两处都有时以 policy.json 为准。

```json
{
  "managedRoles": {
    "dsh-superagent-worker": { "allowGroups": ["cua-screen", "browser-heavy"] },
    "dsh-superagent-router": { "allowGroups": ["cua-screen"] },
    "subagent": { "allowGroups": ["*"] }
  }
}
```

> **组 id 必须是这台机器上真实存在的**：默认四组是 `cua-screen` / `cua-input` / `browser-heavy` / `vision-heavy`，
> 另有你手写组的 id、以及自动分组生成的 `auto-<前缀>`。不确定就先跑 `lazy_tools_status` 看 `groups[].id`。

规则：

- 只认结构信号：`agentPresets.composedPreset` 的 preset id，以及 `session.header.parentSession`（子代理 → `subagent` 键）；不认插件名、不认标题；
- **封闭默认**：角色没授权的组、以及没有归组的工具，一律隐藏（`unknown: 'hide'`）；
- 受管会话里 `enable` / `disable` 会被拒绝，自愈也不会绕过策略——改策略请改配置；
- **写错组 id 会被抓出来**（2026-11-02 加）：启动时校验 `allowGroups`，`health.errors` 会写明「哪个角色的哪些 id 不存在」。
  如果某个角色的组**全都不存在**，这个角色**不生效**（退回普通会话行为）——否则受管会话里既不能 `enable`、自愈也不绕过，
  就等于把一个会话锁到只剩核心工具，还全程静默；
- `allowGroups: ["*"]` 表示这个角色不按组设限（逃生口）；
- `allowGroups: []` 表示**只留常驻工具（CORE）**，其余全部收起（2026-11-05 起合法）；
- `health` 新增 `managed: { role, allowGroups, unknown }`，没有受管就是 `null`；
- 不配置 `managedRoles` 时行为与旧版完全一致（默认关闭）。

测试：冒烟 `[61]` 覆盖 worker / subagent / 普通会话三条路径与 enable 拒绝；`[71]` 覆盖「组 id 写错」的三种情况
（全错停用、半错照用、`*` 放行）。

### 给子代理分角色：只认宿主给的信号，不做文本约定（2026-11-03）

给子代理分角色，走的是**宿主原生信号**，不引入我们自己的提示词协议：

1. **会话 label**（首选）——编排器给子会话打 `vendor:role` 这类标签时，取候选段挑 `managedRoles` 里配过的；
2. `subagent` 通用键——任何用 `subagent` 派工的场景；
3. preset id——一角色一 preset 的场景。

> **为什么不做 `[role:xxx]` 这种文本标记**（0.18.1 短暂有过、0.18.2 删除）：
> 它要求「派工的人」改提示词才能生效，而多数编排器的 label 里本来就没有角色词——
> 两个通道解决的是同一件事，多一个私有协议只会多一套行为要解释。
> 0.17.0 立过一条红线：**不再监听 inbox 消息**。那条红线现在恢复。
### 角色信号是**厂商无关**的（2026-11-03）

生态里各家给子会话打「角色」的写法不同，我们**不认厂商名**，只按顺序试这**三**种，**每一种都要求 `managedRoles` 里配过那个键**：

| 顺序 | 信号 | 例子 | `health.managed.source` |
|---|---|---|---|
| 1 | **会话标签里的候选段**（按 `:` `/` `|` 空白切开，逐段小写，**挑 `managedRoles` 里配过的那个**） | `dsh-my-go:hermes: 帮我改模块` → `hermes` | `label` |
| 2 | 子会话通用键 | 任意子代理 | `subagent` |
| 3 | preset id | `cordis` / 自定义 preset | `preset` |

- 标签只在**子会话**上认（`header.parentSession`）；普通会话的标签不生效。
- 认不出 / 没配 ⇒ 不做任何事（失败方向放开）。**`[role:xxx]` 提示词标记已删除**（0.18.2）：写了也不会生效，也不会报错。
- 所以 MyGO（真实标签是 `dsh-my-go:<工种>: <任务摘要>`，见它 `preset/shared/misc.mjs` 的 `agentLabel`）这类编排器**不用改一行代码**就能对接；
- ⚠️ 但**配置的键要写工种名本身**（`hermes`），不要写 `dsh-my-go:hermes` —— 前缀只是标签的一部分，不是角色名。

测试：冒烟 `[74]`。

### 角色怎么配：**不用你手写**（2026-11-03）

角色 → 组的映射由 **AI 自己配**：`lazy_tools_roles`（不传参数=只读；传 `role + allowGroups + basis`=写入）。

```text
lazy_tools_roles({ role: "hermes", allowGroups: ["write"], basis: "写模块，不碰浏览器" })
→ 写进 policy.json，带 createdBy: "ai" + at + basis → 下一个会话立即生效（不用重启）
```

工具层强制三条不变量（人手写 JSON 可以绕过，AI 不行）：

| 不变量 | 原因 |
|---|---|
| 组 id 必须真实存在 | 写错一个就是"会话被锁到只剩核心工具"（`#71`） |
| **不许写 `*`** | `*` 是放开限制的逃生口，**只允许人手改文件** |
| 必须带 `basis` | 让"为什么这么配"留在记录里，权限不是一个凭空的决定 |

- **喜欢折腾的人**：直接改 `policy.json` 的 `managedRoles`（可以写 `*`、可以不带 basis）——**改完不用重启**，下一个会话生效；
- `health.managed` 显示 `createdBy` / `basis`，一眼看出这个角色是谁配的、为什么；
- 受管会话里不能给自己改配置（否则"角色"就管不住自己了）。

测试：冒烟 `[75]`（热重载）、`[76]`（三条不变量 + 写入即生效）。

### 角色工具面实测（n=3 组，不宣称普遍优越）

> 这组数据只证明“角色在什么边界上更容易赢/输”，不是“角色普遍更好”。

| 任务 | 直派 | 角色 | 结论 |
|---|---|---|---|
| findings 接进 54 | 7:17，2 文件，无 env 钉死 | 6:54，4 文件+3 文档，env 钉死 | 净时间直派略赢；质量角色赢（堵 fail-open） |
| B3 mutation score | 4 文件，12/12 测试，查 mutate 退出码 | 4 文件+3 文档，8/8 测试，不查退出码 | 直派代码更严；角色文档更多 |
| 5 文件审计 | 11:48，8 findings（2 blocking） | 10:29，10 findings（1 blocking，多抓 save_groups 无守卫） | 各漏对方一条 blocking；两边都 FAIL |

**能读出来的：**

- 角色买“独立视角/覆盖”，直派买“代码直接/快”；没有稳定的速度优势。
- 角色自己也会制造测试 bug（findings 54 的文案顺序断言），所以“有角色”不等于“更可靠”。
- 这些数字 n 很小，不能当承诺；复现记录在 `perf-/A1-效率对照-20261106.md` 与 `perf-/角色与直派-分工-20261106.md`。

**谁能直接用：**

- 需要 DSH 2.0.x + 本插件；更关键的是**得有 label/预设工作流**（如 `review:` / `build:` / `research:`）。
- 没有 label 工作流时，角色工具面**不会生效**；抽屉仍然只是普通的按需工具组。
- 我们没有内置“supervisor 工作流”给外部用户；本仓库的 A1 工作法是配套文档，不是插件自带能力。
- 如果别人的角色/编排方案更好：应该换或接，不要为了“我们有这个功能”硬用；如果更差，也不靠这组小样本证明我们更好。

## 会话级目录（0.18）

常驻提示里列出的组，按**每个会话实际挂载的工具**算，不是一张全局固定清单：

- 挂载集 = 本会话可见的工具 ∪ 本插件自己藏起来的工具，只列其中有成员的组；
- **一组都没挂载时整段提示消失**（宿主会丢掉空段）——不会再出现「目录里列着一个这个会话根本碰不到的组」；
- 被外部挡掉的（宿主的权限门、别的插件的 deny）**不算挂载**，不会被广告；
- 「有 N 个工具没归组、去分组」这句提醒只在**默认 preset 的人工会话**里出现，角色会话不会被引导去改全局分组表；
- 读不到会话信息（老宿主、服务缺失、认不出的作用域）时**退回 0.17.x 行为**：照旧列全部组。失败方向是「照旧」，不是「变短」。

测试：冒烟 `[64]`（没挂 / 被外部挡的组不广告、空则空段、认不出作用域退回旧行为）与
`[65]`（分类提示只在默认会话出现）。

## 八个工具

| 工具 | 作用 |
|---|---|
| `lazy_tools_status` | 查看每组状态：开关、模式、匹配数量、可见数量、是否热、上次使用时间 |
| `lazy_tools_enable` | 打开一组；`only: ['名字']` 只放指定工具；`groups: [...]` 批量打开；**`name: '工具名'` 按名字一步开一个**（原 resolve） |
| `lazy_tools_disable` | 收起一组，同时清除 `only` 白名单 |
| `lazy_tools_list` | 列出组内工具（含被隐藏的）；`ungrouped: true` 附带前缀分桶 + 未归组工具的描述（原 scan / classify） |
| `lazy_tools_mode` | 仅修改当前会话策略；`reset` 回全局，`collapse` 立即清空 |
| `lazy_tools_health` | 自检五个宿主契约，输出 warnings / 漏网工具 / 自愈次数；**`bench: true` 附带基准账**（注册总数、可见/收起、每组字符数 —— README 数字的唯一来源） |
| `lazy_tools_save_groups` | 把分好的组写进 `~/.dsh/lazy-tools.groups.json`；默认下次会话生效，`applyNow: true` 才立刻生效 |
| `lazy_tools_roles` | 查看/配置「角色 → 允许哪些组」；写入后即时生效（AI 自配会带 `createdBy` / `basis`，可追溯） |

`healthy: true` 表示：五个契约均通过（register / schemas / restrict / guard / agent 事件），无错误（宿主销毁竞态除外，那条只留证据不拉红灯），无警告。

## 设置页

设置页由客户端半边渲染，通过**本机回环路由**（`127.0.0.1`）与宿主半边通信，不连任何外部地址。

> 2026-11-05 起，这条路由的 **Host 必须是回环**（`127.0.0.1` / `localhost` / `[::1]`）；用反代或局域网机器名访问设置页会被 403。要那样用，请在反代上把 Host 改写成回环。插件市场的能力扫描把这类调用标成「会联网」，指的是这一次本机 HTTP 调用，不是外网上传。

宿主默认**只监听 `127.0.0.1`**（2026-10-29 实测：DSH 的 web 服务在 `127.0.0.1` 上，同一进程没有任何 `0.0.0.0` 监听）。所以这条桥**不需要再做一层鉴权**——加 token 属于「为回环工具新造一个部件」，按本项目红线不成立。若哪天宿主改成监听 `0.0.0.0`，那是宿主配置问题，应改监听地址，而不是在本插件里造鉴权层。

`lib/config.js` 导出 schema，DSH 设置页据此渲染字段：

| 字段 | 默认 | 说明 |
|---|---|---|
| `level` | `medium` | 收敛力度：低 14 天、中 7 天、高 3 天 |
| `presets` | `{14,7,3}` | 三档各自的天数，可修改 |
| `idleDays` | 跟随 `level` | 手动指定天数；0 表示不按时间收敛 |
| `minTools` | `3` | **自动分组**的建组门槛：同前缀少于 3 个不建组（下限 3，填更小也按 3 跑） |
| `showDock` | `false` | 在输入框上方显示档位按钮 |
| `showClear` | `false` | 在输入框上方显示独立的「立刻清空」按钮 |
| `classifyNudge` | `true` | 有裸名工具没归组时，在常驻提示里提醒模型分类（一次，落盘后长期生效） |
| `autoGroups` | `on` | 自动分组：`off` / `suggest` / `on` |

两个界面开关互相独立。控件按对话挂载，勾选后需切换一次对话（或刷新页面）才会出现。

组定义保留在 bundle 的 patch 中：写一次后很少改动，且嵌套数组在表单中可读性差。

schema 在运行时解析：扫描 `%USERPROFILE%\.dsh\profiles\*\` 查找 DSH 自带的 `@deepseek-ai/schemastery`，只使用 Node 内置模块。未找到时 `Config` 为 undefined——没有设置页，插件本身正常运行。

设置页写入的策略保存在 `~/.dsh/lazy-tools.policy.json`，优先级高于 YAML 默认值；删除该文件即回到默认。

## 为什么它表现得像会自己判断

它不判断，只按证据触发。两个机制都不包含猜测：

**一、用量账本。** 每次真实调用记录一条时间戳到 `~/.dsh/lazy-tools.usage.json`（只记时间与工具名，不记参数）。新会话开始时计算：**组内热工具占比**达到 `warmRatio`（默认 30%）才整组打开；没到阈值只放「热的那几个」（`only`）；一个都不热才整组收起。组级时间戳只用于展示 `lastUsed`，不参与决策（2026-10-30 改）。

该决策**默认只在会话开始时执行一次**。原因：中途修改工具表会使前缀缓存失效，省下的 token 不足以抵消损失。**被允许的例外**只有显式动作（`enable`/`disable`/`mode`/`save_groups{applyNow}`）与自愈补开（模型已经叫错了名字，不补就白花一轮）。

**二、自愈。** 当模型调用被隐藏的工具时，一个 dispatch 守卫会在拒绝之前拦截：识别所属组，只放出该工具，**然后直接放行这一次调用**（2026-11-05 起；以前是返回「请重试」，在 UI 上会显示成一次假失败）。

补开后直接执行，用户侧无感知。次数记录在 `health.stats.selfHealed`。

## 它防的是什么

**漏网工具。** 插件升级新增工具而组匹配式未覆盖时，该工具会重新变为可见并持续占用 token。`health.stray` 会推导每组的名字前缀，列出「看起来属于该族、但未被任何组匹配」的可见工具（`keep` 中的除外）。

**数量漂移。** 每组配置 `expect`（**下限**）；工具数**少于**它时 `health` 告警 —— 多出来是吸纳型组的正常状态，不报。

**客户端没挂上。** `health.client` 记录浏览器那半边最后一次上报（`seen` / `at` / `agoSeconds` / 挂了哪些面板）。宿主一切正常**不等于**设置页挂上了：2026-10-24 就出现过「宿主四项契约全绿、客户端条目加载失败、Web 进恢复模式」的情况，这个字段把那类问题从「只能靠重启发现」变成一条能查的数据。

**竞态。** 子 agent 可能在限制建立过程中被销毁；这类失败只计入 `stats.restrictSkipped`，**不进 `errors`**（否则多会话场景会把错误槽占满）。

**孤儿限制。** 解除函数挂在 `ctx.effect` 上，热重载会解除它们。
但 `own()` 目前是**先置位 done、再调 dispose**：如果 dispose 抛错，后续 lift 与热重载都不会再试（已知问题，票 `lift-orphan-done-before-dispose` 修）。

## 测试

```
node test/smoke.mjs
```

以 `node test/smoke.mjs` 的输出为准（项数以实际输出为准，不写死），运行在假宿主上，不需要安装 DSH。

假宿主实现本插件依赖的四个**契约**（register / schemas / restrict / agent-created），外加宿主那条**可选**的
`tools.view(scope)` 只读视图（提示段的主读路径就是它；视图缺失、返回空、抛错三种退化都有用例钉住）。
宿主契约变化时，测试先失败，而不是会话先出问题。

> 要改这个插件？先读 [MAINTAINING.md](MAINTAINING.md)：改客户端半边必须冷启动验证，恢复模式下用户无法操作。

## 局限（请务必阅读）

1. **只能隐藏全局工具。** 注册在 agent 作用域中的工具无法隐藏，宿主会拒绝。
   若一批里混进这种名字，插件会**逐个重试**：能藏的照藏，藏不掉的记一条并跳过（不再让整批失效）。
2. **按名字分组。** DSH 的工具定义没有标签，只能对名字写 glob 或正则；改名会导致漏配。
3. **开关会打断前缀缓存。** 打开一次后尽量保持；需要反复切换时优先使用 `only:`，不要整组开关。
4. **自动收敛只在会话开始。** 运行期间不重排，理由同上。
5. **失败方向是放开。** 契约异常或文件不可读时，工具全部回到可见状态：多花 token，但不会减少能力。
6. **自愈只对「存在但被隐藏」的工具有效。** 拼写错误、尚未加载的插件无法修复，这类情况用 `lazy_tools_enable { name: '片段' }` 按片段查找（原 `resolve`，0.16.0 并入）。
7. **界面双语，工具描述不是。** 设置面板和输入框那一行跟随宿主语言服务；模型读取的工具描述在启动时注册一次，仍为中文——宿主进程无法感知界面语言。

## 退场条件

DSH 已带有 `deferLoading` 与工具增补消息。若其实现原生按需加载，这个项目应当退场，而不是继续并行维护。

## 借鉴与参考

这里没有原创机制，只有取舍。前三个项目阅读较深，其余主要参考 README：

| 项目 | 做法 | 取舍 |
|---|---|---|
| [tool-attention](https://github.com/asadani/tool-attention)（[论文](https://arxiv.org/abs/2604.21816)） | 每轮基于 embedding 的意图路由，两段式加载 schema | 量化了「工具税」；未采用 embedding，因为路由错误会静默隐藏所需工具 |
| [mcp-lazy-load](https://github.com/PeterCha90/mcp-lazy-load) | MCP 代理，暴露 `search_tools` / `execute_tool` | 证明可大幅缩减；选择保持原生调用，不经过通用执行器 |
| [dsh-mcp-loader](https://github.com/MikotoMyWife/dsh-mcp-loader) | DSH 插件，按服务器加载并对 agent 施加 `restrict` 掩码 | 同一机制层；本实现不绑定命名空间，并增加 `only:` |
| [lazy-mcp](https://github.com/voicetreelab/lazy-mcp) | 代理层，按服务器分树 | 分组词汇参考 |
| [opencode-lazy-loading](https://github.com/omarwaly-ai/opencode-lazy-loading) | 请求层剥离 | 大幅缩减说法的参考 |
| [dsh-sieve](https://github.com/Sev7eEn7/dsh-sieve) | DSH 上下文过滤，带裁判模型 | 避免「模型在环」判断的理由 |
| [microsoft/agent-framework 的 progressive disclosure 示例](https://github.com/microsoft/agent-framework/blob/e39a8a2e/python/samples/02-agents/mcp/mcp_progressive_disclosure.py) | 按需暴露 MCP 工具 | 术语参考 |

若相关作者认为描述有误，可开 Issue 指正。

## 它不是什么

- **不是代理、网关或 MCP 客户端。** 不接触传输层，不增加跳跃。
- **不是自动路由。** 不猜测用户意图，仅在明确请求时打开。
- **不是安全边界。** 隐藏只是从模型列表中移除，不阻止执行；权限控制请使用宿主机制。

## 许可

MIT，见 [LICENSE](LICENSE)。

---

## English summary

Tool Drawer for DeepSeek Harness: keeps heavy tool groups out of every request and restores them on
demand (one call, a dispatch guard that reopens it, or an on-demand enable). The numbers are measured, not estimated — see the
table above (that table is the **only** place these figures live). No proxy, no embeddings, no judge model — real calls stay
native. Install with `plugin_manager install_bundle`; configure in the DSH settings page. MIT,
best-effort maintenance.
