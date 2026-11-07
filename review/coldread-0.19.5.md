# 冷读报告 — 0.19.5

> 独立冷读代理 `cd4c29f5`，无项目上下文；只读，未改仓库。范围 `884374c..2f47f7a`。
> 本文件是冷读结论/证据归档；机器裁决以末尾 verdict 块为准。

## 结论

- 基线 `check-baseline`：7/7 PASS，FAIL 0，UNVERIFIED 0。
- A 轨：新增测试逐项做了“删被保护代码 → 必须变红”的变异；仓库 `mutate 19/19`，额外 15 个自建变异 15/15，`golden-lock 2/2`。
- B 轨：`verify-coldread` 最后块/A+B=red/baseline 均按预期；gate 读 verdict，坏 red/坏 JSON/缺失均 FAIL；mutate 用唯一 `expectText`；54 `-Skip` 拒绝未知项、对抗、findings。
- **red = 0，unverified = 0，baseline = 7。**

## 未计入 red 的候选

1. **B-1**：gate 接受“伪造 0 红 verdict”，只要 sha 对上、报告没有 verdict 块也能 PASS。
2. **B-2**：`CI=true` 时 gate 跳过 verdict；CI 因此不判裁决。
3. **B-3**：54 的冷读判定不复核 `A+B=red` / `baseline=baselineActual`。
4. **B-4**：54 skip 门禁不验“对抗真的跑了”，删执行块仍可能 PASS。
5. **B-5**：基线 `[105]/[107]` 只匹配日志行，删断言保留日志仍 PASS。
6. **A-1**：`installBridge` 包装层接线只测 handler/effect，未调用接线。
7. **A-2**：smoke 临时路径固定，并发跑会互相污染。

## 覆盖声明

读了 `review/` 基线、gate、verify、mutate、skip 脚本；`lib/` 相关段；smoke 新增 hunk 与 [21]/[54]/[105]/[107]/bridge 段；golden-lock。
跑了 check-baseline、mutate、mutation-score、gate-integrity、check-54-skip、gate、characterize、characterize-state、golden-lock、smoke 及临时变异。
未读 `client.js` 全文、smoke 全文 3109 行、54 全文；未跑 `pnpm pack`/发布；`-Skip smoke/encoding` 允许路径为推定。

```verdict
{"baseline": 7, "unverified": 0, "red": 0, "A": 0, "B": 0}
```
