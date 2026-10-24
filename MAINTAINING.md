# 维护者须知 / Maintainer notes

写给要改这个插件的人（包括下一个我）。这不是功能文档，是**工序**——今天踩过的坑都在这里。

For whoever changes this plugin (including future me). Not feature docs — **procedure**. Every item below is a mistake already made.

---

## 1. 改了客户端半边，必须冷启动验证 / Any `client.js` change requires a cold boot

运行中重载**不算验证**。

2026-10-24 实测：把 `apply()` 里的 `ctx.get('locale')` 改回裸调用后，
- 「装卸触发客户端重载」→ 面板照常挂上，看起来没问题；
- **冷启动** → 必然 `web boot: 1 entry did not activate` + `dsh-tool-drawer: failed`，Web 进恢复模式。

**原因**：`ctx.get('locale')` 在启动那一刻（语言服务未就绪）会抛错，运行期调用完全正常。
所以「热重载通过」是假阳性。

**验证三步，缺一不可**：

1. 启动不进恢复模式；
2. 设置页「工具抽屉」在、输入框上方控件在；
3. `lazy_tools_health` 的 `client.seen === true`（这一条只有冷启动才可能是 true）。

---

## 2. 恢复模式下用户无法操作 / Recovery mode leaves the user stuck

这是操作层面的铁律：

- 让用户重启去验证**有风险的改动**之前，先把退路交到他手上：
  - 要么**先在 UI 里把 bundle 禁用**，再改代码；
  - 要么写清禁用步骤；
- 更好的做法：在**隔离 profile** 里验完再碰主环境。

恢复模式只挡住了界面，宿主是活的——所以远程修还是能修（改文件、卸装、再让用户重启）。

---

## 3. 回滚 / Rollback

```powershell
# 1) 卸掉 bundle
plugin_manager remove_bundle dsh-tool-drawer
# 2) 删掉残留软链（pnpm 卸依赖后不会删它，留着会让客户端扫描到一个孤儿包）
Remove-Item "$env:USERPROFILE\.dsh\profiles\<profile>\node_modules\dsh-tool-drawer" -Force
# 3) 重启
```

**第 2 步最容易漏**，也是「删了重装还是失败」的常见原因。

---

## 4. 改包名或挪目录 / Renaming the package

顺序不能反：

1. `remove_bundle`；
2. 确认 profile 的 `package.json` 依赖**和** `node_modules` 软链都消失；
3. 改**三处**：`package.json` 的 `name`、`client.js` 的 `__ModuleLoader__.load({ id })`、`cordis.patch.yml` 里的 `name`；
4. `install_bundle`；
5. 冷启动验证（见第 1 节）。

`remove_bundle` 报 `bundle-in-use` 时，先清 `package.json` 里 `desktopNextDeselectedBundles` 和 `dependencies` 的残留。

---

## 5. 发布前 / Before a release

- 三处版本一致（`package.json`、Release tag、README 若提到版本）；
- `node test/smoke.mjs` → 32 项全过；
- 中英 README 同步（英文不是翻译腔，是独立写的）；
- Release 说明写「改了什么 / 为什么 / 怎么验证」，不要只写「修复若干问题」；
- 图标用 **180×180 PNG**（awesome 列表等收录方只收位图，SVG 会回退成作者头像）。

---

## 6. 提交信息 / Commit messages

写「**为什么**」，不是「改了什么」。例：

```
client: guard service probes at boot (ctx.get('locale') throws before locale mounts)
```

好提交信息让下一个人在 `git log` 里就能看懂风险在哪。
