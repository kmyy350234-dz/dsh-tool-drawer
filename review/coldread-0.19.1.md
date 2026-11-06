# 冷读 0.19.1（e7425de..d9e0c9b，第三轮 0 红）

独立冷读，无上下文。前两轮各报 3 红 / 1 红，均已修并逐条复验。

## 修复记录

- A-1：自定义角色加完后 `setNewRoleGroups([])`，组件级复跑不再 `prev.filter is not a function`。
- A-2：`sessionSelfHealed` helper + `lazy_tools_status.selfHealed` 行为测试；删/改受保护代码 6 条变异全部变红。
- B-1：`check-54-skip` 接受 `$findingsDetail` 写法；源仓缺 54 → exit 1。
- B-2：区分源仓/发布包布局；发布包缺 `perf-` → `SKIP exit 0`，发布仓 `CI=true gate` 复跑 PASS。
- C8：`lazy_tools_status` 无 agent 时不再 `WeakMap` 崩。
- C4：自定义角色名转小写，避免 `Review` 永远匹配不到 label。
- C5/C6：README n=3 与漏抓 blocking 表述校正；`cordis.patch.yml` 末尾 LF。

## 第三轮复跑

- 发布包布局 + `CI=true gate.mjs`：基线 7/7、门禁 PASS、exit 0。
- 源仓 `check-baseline.mjs`：7 条 / FAIL 0 / UNVERIFIED 0。
- smoke 132、对抗 29/RED 0、gate-integrity PASS、mutation 8/8、findings 6/6、编码 283/0。
- 未发现新红；C9（源码文本断言对等价改写过严）仍是黄。

```verdict
{"baseline": 7, "unverified": 0, "red": 0, "A": 0, "B": 0}
```
