# 0.19.3 冷读记录

- 范围：`df478b2..f2a7582`（0.19.1 发版点 → 0.19.3 待发点）
- 独立冷读：`c82bac9e`，2026-11-07
- 结论：**0 红 / 0 未验证 / baseline 7/7**

## 本轮改了什么

1. `engines.dsh = ">=0.2.2-rc.1 <0.3.0-0"`；
2. `dsh.compatibility` 同范围（惰性元数据；0.2.2 的 app-boot 只读 `engines.dsh`）；
3. 真实宿主证据：当前 DSH Web 的 `/lazy-tools/api/state` 返回 200；
4. CI 新增 `host-0-2-2`：Ubuntu 上安装 `@deepseek-ai/dsh@0.2.2-rc.1`，建临时 profile，`dsh plugin add link:` 后 compose 本插件；
5. 54 SyncList 用 `.github` 目录项同步 workflow，不重复单列。

## 冷读证据

| 项 | 结果 |
|---|---|
| 版本范围 | PASS：semver 实测 `0.2.2-rc.1/0.2.2/0.2.3` 入；`0.2.1/0.2.2-rc.0/0.3.*` 出 |
| workflow | PASS：源仓 HEAD 与成功 run `42275874585` 的 blob 逐字节相同（`b7989b5…`）；源仓干净 |
| 54 SyncList | PASS：无重复 `.github/workflows/test.yml`，保留 `.github` 目录 |
| 包 | PASS：172,282 字节 / 34 条目；test=0、review=0；version 0.19.3、engines 声明在包内 |
| UI | PASS：`DETAILS=2`；角色面板在「高级：角色工具面」；勾组→建角色正常 |
| 冒烟 / 对抗 | 132 / 29 全过，RED 0 |
| baseline | 7 条，FAIL 0，UNVERIFIED 0 |

## CI

- run `42275874585`：`smoke` + `真实宿主 0.2.2-rc.1` 两个 job 都 success；
- 宿主 job 实际执行：安装 `@deepseek-ai/dsh@0.2.2-rc.1` → `--from-default-profile headless` → `plugin add link:` → `--dump-config | grep dsh-tool-drawer`。

## 边界

- CI 证明“真实 DSH 0.2.2-rc.1 能安装并 compose 本插件”；
- 不证明所有工具调用行为都在真实宿主上逐条跑过；
- `dsh.compatibility` 不被 0.2.2 宿主读取，是给后续市场/工具用的惰性字段。

## 裁决

```verdict
{"baseline": 7, "unverified": 0, "red": 0, "A": 0, "B": 0}
```
