# 变更记录 / Changelog

格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## [未发布]

## [0.13.2] - 2026-10-27

### 修复
- **lazy_tools_resolve 不再假报成功**：解除本插件限制后，会再查一次「这个工具现在真的可见吗」；如果宿主压根没把它交给本会话（插件未挂载、或刚更新完需要重启），返回 pplied:false + eason:"not-visible" 并写一条错误记录，而不是 pplied:true 让人白等一轮。
- **health 新增静默失败告警**：某个组 on=true 但 isible=0（工具在注册表里、却不在本会话工具表）时，warnings 里会点名该组并提示「宿主没挂载它们 / 可能需要重启」，不再静默 healthy。
## [0.13.1] - 2026-10-27

### 修复
- **自动分组在冷启动时会漏掉工具族**：原先只在插件 pply() 时算一次，而其他插件的工具可能尚未注册（DSH 2.0.20 更新后实测复现：utoGroups: on 却没有建出 uto-mnemon）。现在改为「会话开始的第一次 stateFor 时补算」，直到工具表非空为止；lazy_tools_scan 也改为调用时现算，不再返回陈旧结果。
- 冒烟新增第 37 项：pply() 时没有任何工具、注册发生在之后，仍要能建出自动组。
## [0.13.0] - 2026-10-25

### 新增
- **自动分组**：按工具名前缀识别家族，为「没被现有组覆盖」的那部分自动建组。
  - 三种模式：`off`（不动）/ `suggest`（默认，只在 `lazy_tools_scan` 里给建议）/ `on`（自动建组并按规则收起）。
  - 切分规则：按 `__` 或 `_` 分段；**子族合计覆盖 ≥80% 才往下切**，否则保留整族（避免 mnemon 17 个被切成两个 3 个）。
  - 安全边界：核心工具白名单（read/write/edit/pwsh/grep/glob/skill/todo 等）与 `lazy_tools_*` 永不入组；已被覆盖 ≥80% 的前缀跳过；与手写组冲突时手写组优先。
  - 只在会话开始时计算一次，整场冻结（不打断前缀缓存）；自动组 id 带 `auto-` 前缀，`status` 里可见。
- 设置页新增「自动分组」选择器；`lazy_tools_scan` 输出增加 `autoGroups` 字段（建议 + 被跳过的前缀及原因）。

### 说明
- 自动分组只看到**插件注册的工具**；内核内置工具（read、schedule、job 等）不在注册表里，不会被自动分组。

## [0.12.1] - 2026-10-24

## [0.12.1] - 2026-10-24

### 新增
- `lazy_tools_health` 增加 `client` 字段：客户端半边最后一次上报（`seen` / `at` / `agoSeconds` / `panels`）。
  宿主正常不等于面板挂上——今天出现过「四项契约全绿、客户端条目加载失败、Web 进恢复模式」。
- `assets/icon-180.png`：180×180 位图图标（收录方要求位图）。

## [0.12.0] - 2026-10-24

### 变更
- 包 id 统一为 `dsh-tool-drawer`（`package.json` 的 `name`、`client.js` 的模块 id、bundle patch 的行名三处同改）。
- 旧包名 `dsh-lazy-tools` 升级需先卸旧 bundle。

## [0.11.1] - 2026-10-24

### 修复
- **启动崩溃**：客户端 `apply()` 裸调 `ctx.get('locale')` 在冷启动时会抛错，导致 `web boot: entry did not activate`。
  现在服务探测全部包 try/catch，槽位注册改为局部函数，失败时 `console.error` 并抛出。
- 对照实验证实：还原裸调用 → 冷启动必然恢复模式；运行期重载**复现不出来**（只有冷启动会）。

## [0.11.0] - 2026-10-24

### 新增
- 界面中英双语，跟随宿主语言服务。
- 自定义天数输入（会话级）、「立刻清空」与档位按钮互相独立。

## [0.10.x 及更早]
- 见 GitHub Releases：https://github.com/kmyy350234-dz/dsh-tool-drawer/releases
