# 变更记录 / Changelog

格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## [未发布]

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
