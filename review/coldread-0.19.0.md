# 冷读 0.19.0（262bebe..8d644f8）

独立冷读，无上下文，只读。基线 7/7 PASS，A=0（区间无 lib/client/test 改动），B 正常路径四项过。

## B 轨候选（黄，单列，不混入 0 红）

1. gate `--findings` 用 `existsSync` 决定是否跑，而 `findings.mjs` 认 `LAZY_TOOLS_FINDINGS_FILE`；残留 env 可把门禁指去假台账。54 已钉死，gate/audit 未钉死。
2. `CI=true` 时 gate 跳过 verdict；坏 verdict 在 CI=true 下 exit 0（54 单独判）。
3. `unverified.json` 缺失会 FAIL，但 `{}`、`[]`、`{"count":null}`、`{"count":-5}` 会 PASS。
4. `check-54-skip` 缺 54 文件时直接 PASS（公开仓 CI 空过）。
5. `gate-integrity.test` 只测 verify-coldread/evaluateVerdict，不调用 gate。

## 覆盖声明

- 未跑 54 完整发版、pnpm pack、audit 信号/超时分支、lib/client/test 全量逐行（区间无改动）。
- 冷读后已修第 1 条（gate 钉死 env，`ca2743c`），并校正 CHANGELOG 的 BOM/281 计数；其余黄留票。

```verdict
{"baseline": 7, "unverified": 0, "red": 0, "A": 0, "B": 0}
```
