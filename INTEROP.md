﻿﻿# 和别的插件一起用（互操作）

工具抽屉只做一件事：决定「哪些工具此刻对模型可见」。所以它天生是叠加型的 —— 它不替换任何工具，也不管工具怎么实现。

下面三类是最常一起装的。

---

## 1. `dsh-ops`（T-Auto/dsh-ops）

它用 `ops_*` 替换官方 `read` / `glob` / `grep` / `pwsh`，并自带 PTC 渐进披露。

**关系：互补。** 它换实现，我们管可见性。

**怎么叠：** 它会注册一批 `ops_*` 工具。两种做法：

- **自动**：`autoGroups` 默认就是 `on`，前缀聚类会认出 `ops` 家族（先想看建议再收纳，就把它调回 `suggest`）；
- **手写**：在 `~/.dsh/lazy-tools.groups.json` 里加一组，`match` 里写具体工具名。

> ⚠️ 注意：它的 `ops_read_files` / `ops_discover_tools` 这类是常驻工具，**不要放进组里** —— `lazy_tools_save_groups` 会拒绝，手写组也请避开。

**实测（2026-10-28，非推演）**：把它声明的 18 个工具名喂给自动分组，得到：

```
auto-ops  expect=16  match=re:^ops(_|__|$)
```

两个常驻工具被白名单正确排除。

---

## 2. 桌面操作类（`deepseek-computer-use` 等）

这类插件给的是**能力**（看窗口、点击、输入），工具名常常是裸名（`click` / `type_text` / `list_windows`），没有共同前缀。

**关系：互补，且正好互相需要。** 它们每加一个，就多一批「没人管、每轮都在占上下文」的工具。

**怎么叠（2026-10-28 的实际做法）**：按「副作用」分三组，写进 `~/.dsh/lazy-tools.groups.json`：

| 组 | 装什么 | 判断标准 |
|---|---|---|
| `cu-observe` | `list_apps` `list_windows` `get_window` `get_window_state` `computer_use_health` | 调用它**不改变**任何状态 |
| `cu-act` | `click` `type_text` `press_key` `scroll` `drag` `set_value` `perform_secondary_action` `activate_window` `launch_app` | 会发输入或改窗口状态 |
| `cu-audio` | `start_audio_recording` `stop_audio_recording` | 另一套能力，且要先在插件配置里开 |

也可以让 AI 自己做：`lazy_tools_classify` 拿材料 → 分组 → `lazy_tools_save_groups` 落盘（默认下次会话生效）。

> ⚠️ 这类插件的工具描述很长（实测 `cua_driver_native__*` 平均约 2.2k 字符/工具），不收起的话单是 schema 就要几万字符。

---

## 3. 其它按前缀命名的插件

大部分插件会用 `xxx_yyy` 命名（`dsh_browser_*`、`vision_*`、`mnemon_*`）。

**不需要任何配置**：`autoGroups` 默认是 `on`（2026-10-29 从 `suggest` 改的 —— `suggest` 只写建议、普通用户根本碰不到，等于功能不存在）。想要「先审核再收纳」的人，把它调回 `suggest`，再用 `lazy_tools_scan` 看建议、`lazy_tools_save_groups` 落盘。

---

## 冲突排查顺序

如果装了别的插件之后「工具忽然不见了」，按这个顺序查（前两条各一行命令）：

1. `lazy_tools_status` —— 是不是某个组把它的工具收起来了？`visible: 0` 的那一组就是。
2. `lazy_tools_health` —— 看那个组上有没有 `blocked: "host-not-mounted"`。
   - 有：宿主没把它挂到本会话（如 `cua_driver_native__*` 自 DSH 2.0.20 起就挂不上），抽屉已**静音待命**，`healthy` 不受影响；
   - 没有、却还在 `warnings` 里：要么是抽屉自己收了没还回来，要么是工具挂过又消失 —— 那才是真问题。
3. 把组 `lazy_tools_enable` 之后仍不可见 ⇒ 与抽屉无关，去查那个插件本身是否加载成功。

**其余插件不会与本体冲突**：我们只用 `agent.ctx.tools.restrict`（作用域级掩码）和 `systemPrompt`，不注册工具、不改宿主配置、不占端口（设置页那条是回环）。

## 4. SA / 多角色编排器（MyGO、team-conductor、goalloop…）

这类插件一次派很多子会话，每个角色本该看不同的工具面。我们的接法是**认会话 label 里的候选段**，
挑 `managedRoles` 里配过的那个。**每个厂商的 label 里有没有角色词，决定了要不要对方配合。**

| 插件 | 子会话 label 实际长什么样 | 能否零改动接上 |
| --- | --- | --- |
| **MyGO**（`Tisitan/dsh-my-go`） | `dsh-my-go:hermes: <任务摘要>` | ✅ **能**（真机验过：visible 90 → 30，`source: label`） |
| **dsh-team-conductor** | `Agent Team · <成员名>`（成员名自由） | ⚠️ Lead 用角色词命名成员时才命中；它的 session 引擎不产生 subagent label，收不到 |
| **dsh-goalloop-agentteams** | `Goal-loop wave worker: AC-1, AC-2` | ❌ 没有角色词（连成员名都没有）；需对方把角色前置到 description |
| **dsh-force-collab** | `协作 1/3` | ❌ 只有序号；需对方把分工拼进 label |
| **dsh-switchman** | `dsh-switchman handover backup` | — 不是角色编排器（唯一子会话是上下文备份），不用接 |

> 别家不改也没关系：**按 `managedRoles` 的键，把自己的角色词放进子会话 label**（`vendor:role` 或 `vendor:role: 摘要` 都行）；
> 我们不再支持提示词里的 `[role:xxx]` 标记（0.18.2 删除，避免私有协议）。

### 通用词护栏（2026-11-03）

别的编排器也往 label 里塞词，但那些词不是角色：`worker`（goalloop）、`backup`（switchman）、
`1`/`3`（force-collab 的序号）。**通用词、纯数字、`dsh-` 前缀一律不当角色**，
所以就算你正好配了一个叫 `worker` 的角色，也不会被这些 label 误命中。

### MyGO（`Tisitan/dsh-my-go`）现成配方

它的子会话 label 是 `dsh-my-go:<工种>: <任务摘要>`，**我们直接能认**。
但它有 11 个编排工具是**裸名**（`go_work` / `continue` / `need_help` / `forward` /
`orchestration_status` / `list_subagents` / `heartbeat` / `report_submit` / `report_fetch` /
`chain_start` / `chain_resolve`），自动分组建不了组（阈值 3 个同前缀）⇒ **受管角色默认会把它们藏掉，星型拓扑当场断掉**。

所以接 MyGO 之前，**先建一个组装这 11 个名字**，再让每个角色带上它：

文件是 `~/.dsh/lazy-tools.groups.json`（一个**数组**，把下面这个元素加进现有数组末尾）：

```json
[
  {
    "id": "mygo-tools",
    "title": "MyGO 协议工具",
    "defaultOn": true,
    "match": ["go_work", "continue", "need_help", "forward", "orchestration_status",
              "list_subagents", "heartbeat", "report_submit", "report_fetch",
              "chain_start", "chain_resolve"]
  }
]
```

```text
// 然后给每个工种配角色时带上它
lazy_tools_roles({ role: "hermes", allowGroups: ["cu-observe", "mygo-tools"], basis: "MyGO 的 hermes 要能求助/交报告" })
```

> ⚠️ **`unknown: "show"` 救不了这种情况**：它只影响「没归组」的工具；
> 一旦建了 `mygo-tools` 组，那 11 个工具就算「已归组」，
> 角色没把 `mygo-tools` 写进 `allowGroups` 就照样被藏（`isAllowedByPolicy` 只看 allowGroups）。
> 所以：**要么不建组（靠 `unknown:"show"`），要么建了组就必须让每个角色显式带上它**——不能两头都要。

> ⚠️ **改完 `groups.json` 要重启 DSH**（组只在插件 apply 时读一次）；不想重启就用
> `lazy_tools_save_groups({ groups: [...], applyNow: true })` 走工具写，它会立刻生效。
> 否则手写之后马上去 `lazy_tools_roles`，会被「这些组不存在：mygo-tools」拒掉。

> ⚠️ 组一定要 `"defaultOn": true` —— 这是**协议工具**，主编会话（非受管）也要用；
> 写成 `false` 的话主编的 `need_help` / `report_submit` 也会被收起，星型拓扑还是断。

> ⚠️ 别把 `dsh-my-go` 当角色名配进去——角色键要写**工种名本身**（`hermes`）。
> ⚠️ 配完先灰度一个工种：派一个子会话 → `lazy_tools_health` 看 `managed.source === "label"` 与
> `managed.hiddenUngrouped` 是否为空（不为空说明还有协议工具被藏）。
