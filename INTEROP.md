# 和别的插件一起用（互操作）

工具抽屉只做一件事：决定「哪些工具此刻对模型可见」。所以它天生是叠加型的 —— 它不替换任何工具，也不管工具怎么实现。

下面三类是最常一起装的。

---

## 1. `dsh-ops`（T-Auto/dsh-ops）

它用 `ops_*` 替换官方 `read` / `glob` / `grep` / `pwsh`，并自带 PTC 渐进披露。

**关系：互补。** 它换实现，我们管可见性。

**怎么叠：** 它会注册一批 `ops_*` 工具。两种做法：

- **自动**：把 `autoGroups` 设成 `on`（或 `suggest` 先看建议），我们的前缀聚类会认出 `ops` 家族；
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

**不需要任何配置**：`autoGroups` 默认是 `suggest`，`lazy_tools_scan` 会告诉你「发现哪些前缀家族、建议怎么建组」；确认后用 `lazy_tools_save_groups` 或手写进 groups 文件。

---

## 冲突排查顺序

如果装了别的插件之后「工具忽然不见了」，按这个顺序查（前两条各一行命令）：

1. `lazy_tools_status` —— 是不是某个组把它的工具收起来了？`visible: 0` 的那一组就是。
2. `lazy_tools_health` —— `warnings` 会点名「组开着但一个都不可见」；那是**宿主没挂载**，不是抽屉藏的。
3. 把组 `lazy_tools_enable` 之后仍不可见 ⇒ 与抽屉无关，去查那个插件本身是否加载成功。

**其余插件不会与本体冲突**：我们只用 `agent.ctx.tools.restrict`（作用域级掩码）和 `systemPrompt`，不注册工具、不改宿主配置、不占端口（设置页那条是回环）。
