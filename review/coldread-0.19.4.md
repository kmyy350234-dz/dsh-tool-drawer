# 冷读报告 — 0.19.4

> 独立冷读代理：892522ba（无本项目先前上下文）。只读，未改源码。
> 范围：`f445b2a..884374c`，A 发布物 + B 门禁两轨。

## 结论

- 基线 `check-baseline`：7/7 PASS，FAIL 0，UNVERIFIED 0。
- A 轨：对 `test/characterize.mjs`、`test/characterize-state.mjs` 各做一次“删被保护代码”变异，均 exit 1；`smoke` 新增 catchup 断言由 `mutate 9/9` 覆盖；`test/world.mjs` 与原内联假宿主逐行一致（仅空行差异）。
- B 轨：`verify-coldread` 12 例（最后块 / A+B / baseline 动态）PASS；gate 好裁决 PASS，坏 red/sha/version/缺失均 FAIL；`mutate 9/9` 且 `expectText` 唯一；`54-skip 19/19`，只允许 `smoke` / `encoding`，对抗 / 一致性 / findings 拒跳。
- 不计 red 的候选：
  1. baseline 的 `[105]/[107]` 只匹配日志行，删掉断言后 `check-baseline` 仍 7/7 PASS；
  2. 两个新快照测试不在 baseline/gate/54，只在 CI/package.json 跑；
  3. gate 在 `CI=true` 时跳过 verdict；
  4. 54 的 verdict 检查不复核 A+B/baseline。
- 另：工作树有 `M review/last-smoke.txt`，不是本次评审写的；评审只写系统临时目录，未动它。

## 机器块

```verdict
{"baseline": 7, "unverified": 0, "red": 0, "A": 0, "B": 0}
```
