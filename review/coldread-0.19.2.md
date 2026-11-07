# 0.19.2 冷读记录

- 范围：`df478b2..1e7aabc`（0.19.1 发版点到 0.19.2 待发点）
- 续读（同一评审者，非独立冷读）：`c82bac9e`，2026-11-07
- 结论：**0 红 / 0 未验证 / baseline 7/7**

## 本轮改了什么

1. `package.json files` 移除 `test`：安装包不再带测试；
2. 54 包内容检查不再要求 `package/test/smoke.mjs`，并新增“包内出现 `package/test/*` 就拒绝”；
3. 0.19.1 之后的 UI 收口：角色工具面收进「高级」折叠；
4. 版本 0.19.2、CHANGELOG/README 同步。

## 冷读证据

| 项 | 结果 |
|---|---|
| 包内容 | PASS：0.19.2 = 171,973 字节 / 34 条目，`package/test/*`=0，`package/review/*`=0；0.19.1 = 230,463 字节，test=3 |
| 54 包检查 | PASS：四个必需文件都在，新包 test 命中 0，老包 test 命中 3 → 极性正确 |
| 高级折叠 | PASS：真组件挂载 `DETAILS=2`；自定义角色输入在新 details 子树内；添加角色/勾组正常 |
| baseline | PASS：7 条，FAIL 0，UNVERIFIED 0 |
| 冒烟 / 对抗 | 132 / 29 全过，RED 0 |
| 编码 | 287 项 / 0 问题（含 bundle 生成文件） |
| mutation | 8/8 |

## 黄项处理

- 尺寸数字改为“约 172 KB（-25.4%）”，不再写不可复现的精确值；
- 编码数 286 → 287；
- 去掉 CHANGELOG 中间多余 BOM，只留文件头一个；
- 54 顶部注释同步“test/review 不在包内”；
- `scripts.test` 仍指向仓库内 `test/`（安装包无 test，但用户不需要 `npm test`；不影响运行）。

## 裁决

```verdict
{"baseline": 7, "unverified": 0, "red": 0, "A": 0, "B": 0}
```
