---
name: single-conversation-sa
description: 单对话 SA（supervisor）工作法：用 subagent 的 description 作为 label，把活分给 review / build / research 三个角色，按交付物和 verdict 收敛。开工、派子代理、验收、发版前读。
whenToUse: 用户说「按 A1 流程做」「派 review/build/research」「这张票走一遍」「supervisor 该怎么分」时读。
---

# 单对话 SA：一个 supervisor，三个角色

## 0. 先说清楚边界（实测，2026-11-06）

- **子代理的 label = `subagent` 工具的 `description`**。
  官方 `dsh-tool-subagent` 把 `args.description` 直接传给 `startActivation({ label })`。
  所以 supervisor 必须写：
  - `description: "review: 审计 0.19 角色面"`
  - `description: "build: 实现角色默认值"`
  - `description: "research: 查官方 schedule 能力"`
- **角色只认 label 第一段**（`labelRoleCandidates`）：`review:` / `build:` / `research:`。
  MyGO 旧标签 `dsh-my-go:hermes: ...` 仍按第二段解析；不要改这个顺序。
- **CORE 边界（2026-11-06 实测+修正）**：`read/glob/grep/pwsh/skill/todo_write/...` 仍受保护；
  但 `edit/write` 已加入 `ROLE_HIDEABLE_CORE`，受管 `review:`/`research:` **会真正藏掉 edit/write**。
  ⇒ review 的只读是**工具面 + 提示词双保险**；但 `pwsh` 仍可见，pwsh 能写仓库，所以 review 仍不得用 pwsh 改文件。
- **冷读是另一条线**：冷读子代理**不读 spec、不给背景**，只读发布物；它不能用 `review:` 角色，
  也不能复用 review 报告。发版 verdict 只认冷读。
- **schedule 工具只给 supervisor**：`dsh-tool-schedule` 在 `delegationDepth > 0` 时直接拒绝；
  子代理不能建定时任务。用户没明确要求时，不主动创建。

## 1. 分派前先判类型

| 用户说什么 | 先派 | 产出 | 然后 |
|---|---|---|---|
| 「值不值得做 / 查一下」 | `research:` | `assessment.md`：go / clarify / kill（建议） | 用户拍板；go 才进 build |
| 「做这个功能 / 修这个 bug」 | `build:` | `spec.md` + `plan.md` + `tasks.md` + 代码/测试；bug 加 `assess.md` + `test-report.md` | 进 review |
| 「审一下 / 验收」 | `review:` | `review-report.md` + verdict：blocking/suggestion/nit | 红回 build；绿由用户决定发不发 |
| 「发版」 | 不派 review；走独立冷读 + 54 | `冷读-<版本>.md` + `verdict.json` | 54 门禁 |

## 2. 子代理契约

### `research:`

只做建议，不做决定：

```markdown
## 结论
go / clarify / kill（三选一，必须给理由）

## 证据
- 支持：
- 反证：
- 未验证：

## 如果 go，最小验证
```

规则：
- 证据不足只能 `clarify`，不能 `go`；
- `kill` 要写“为什么不做”，不是“做不了”；
- 不替用户拍板；用户说做才进 build。

### `build:`

功能：
1. `spec.md`：目标、用户故事、验收（可证伪）、不做、回滚；
2. `plan.md`：改哪些文件、依赖、风险、复杂度例外；
3. `tasks.md`：任务、顺序、测试；
4. 实现 + 测试；测试与代码同票；
5. 交付时写“改了什么 / 证据 / 回滚”。

bug：
1. `assess.md`：现象、根因、复现、风险；
2. 修复 + 回归测试；
3. `test-report.md`：命令、结果、证据；verdict `verified / partial / failed`。

规则：
- 票是入口，spec 不能超票范围；扩大要新票；
- 不顺手重构；重构单独票；
- 不自己宣布“已验证”，交给 review。

### `review:`

只做规格 conform，不做冷读：

```markdown
## Scope
commit / 文件 / 对应 spec

## Findings
| id | gapType | severity | class | evidence | status |
|---|---|---|---|---|---|
| F1 | missing/partial/contradicts/unrequested | blocking/suggestion/nit | ... | 文件:行 | open/fixed/deferred |

## 做得对
- ...

## Verdict
open blocking = 0 ? PASS : FAIL
```

规则：
- 读 spec/plan/tasks，按验收逐条对；
- **不写“冷读”**；不引用冷读提示词；
- 红只给 blocking；nit 不挡；
- 不自己改代码（工具面已隐藏 edit/write；`pwsh` 仍可见，但不得用 pwsh 写仓库）。

### 冷读（独立，不是 review）

- 不给背景、不给 spec、不给“已知问题”；
- 只读发布物/改动；
- 输出 JSON verdict 块（见 `review/coldread-prompt.md`）；
- 发版只认这一份。

## 3. supervisor 的收敛循环

```
派 review → 读 findings
  ├─ open blocking > 0 → 派 build 修（只修 findings）
  ├─ 新 finding → round + 1
  └─ 连续两轮 new=0 && open=0 → 收敛
最多 3 轮；剩余 deferred 必须写 reason + owner + release notes
```

规则：
- supervisor 不自己审自己；
- 不把 review 的“建议”当 blocking；
- 不因为“怕超时”跳过复读；
- 没有 findings 表，就不算收敛。

## 4. 发版前

1. 独立冷读（无 spec）；
2. `verify-coldread` PASS；
3. `gate` PASS（baseline / anomalies / 校准 / 可选 process、mutations、cold-read；findings 是人工表，不在 gate）；
4. 54 dry-run；CI 绿；制品 hash 一致；
5. 用户点头才发。

## 4.5 定时任务（官方 schedule 包）

- 官方包 `@deepseek-ai/dsh-tool-schedule` 已装进 profile；工具组 `schedule` 是 `defaultOn: true`，**不需要手动 enable**。
- 顶层 supervisor 直接可用：`schedule_create/list/view/edit`。
- **只有顶层能用**：子代理调用会返回 `{ code: "subagent_session" }`（官方包自己拒绝）。
- 用户没明确要求时，不主动建任务。
- review/research 角色看不到 schedule 组；build 角色能看到但会被官方包拒绝。

## 4.6 直派 vs 角色：默认路由

- **默认直派**：单文件、小改、写工具/测试/脚本，不要套 spec/plan/tasks。
- **升级到 `build:`**：多文件实现、需要明确验收/回滚、需要交接文档。
- **升级到 `review:`**：独立审计、发版边界、需要“漏了会出事”的检查。
- **`research:` 只给建议**，不拍板。

实测边界（n 小，方向）：角色买“独立/覆盖”，直派买“快/代码直接”；没有“角色普遍更快”的数据。
## 5. 明确不做

- 不建 Agent Teams / 多会话团队（A2 不是方向）；
- 不让子代理建定时任务；
- 不让 `review:` 冒充冷读；
- 不把 `auto-review` 当代码审查（它是工具调用安全闸）；
- 不在 review 里顺手改代码。
