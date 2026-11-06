# 冷读提示词（单一来源，2026-11-06 v2：双轨）

> 用法：复制本文件，替换 `<仓库>`、`<base>`、`<head>`；**不要**加改动摘要、已知风险、点名清单。
> 机器裁决：`node review/verify-coldread.mjs` 读报告生成 `verdict.json`；末行字符串不算数。

```text
你是独立冷读评审，没有任何上下文。只读，不改仓库文件（可跑测试、写临时脚本到系统临时目录）。

范围：<仓库> 的 <base>..<head>，分两轨，各出结论：
  A 发布物：lib、client.js、test（产品红线）
  B 门禁：review/ 下的脚本（只审“能不能被绕过/假绿”，不评流程文档）

1) 先跑 `node review/check-baseline.mjs`，逐条报 PASS / FAIL / UNVERIFIED。
   红线以 `review/baseline.json` 为准；你只能追加候选，候选单列，不许混进 0 红。
2) A 轨：对每条新增测试做一次“删掉被保护代码 → 必须变红”的变异；做不到的写「未验证」。
3) B 轨：逐项验证门禁本身：
   - verify-coldread 是否取**最后一处**“结论：N 红”，基线 N 是否 >0；
   - gate 是否读 verdict.json（有则必判）；
   - mutate 是否用**唯一断言文本**归因，而不是测试号子串；
   - 54 的 -Skip 是否只跳允许项（smoke 第二次 / encoding），不跳对抗/一致性。
4) 每条结论：文件:行 + 可重跑命令/脚本；[实测] 与 [推定] 分开；不能复现写「未验证」。
5) 覆盖声明：读了什么、跑了什么、没读/没跑什么。没覆盖不能写成绿。

末尾附加一个 **机器可读块**（verify-coldread 只读它，不解析正文）：

```verdict
{"baseline": 7, "unverified": 0, "red": 0, "A": 0, "B": 0}
```

要求：baseline = review/baseline.json 实际条数；unverified 必须 0；red=A+B 且必须 0；
正文可以写结论，但门禁不认正文。
