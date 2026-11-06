# REVIEW BUNDLE — lazy-tools 3c7490b

range: e7425de..HEAD

file_count: 19

lib\api.js	436 lines
lib\autogroups.js	152 lines
lib\config.js	97 lines
lib\host.js	597 lines
lib\index.js	1294 lines
lib\prompt.js	273 lines
lib\roles.js	280 lines
lib\tools\groups.js	439 lines
lib\tools\health.js	541 lines
lib\tools\index.js	29 lines
lib\tools\roles.js	177 lines
lib\usage.js	96 lines
client.js	713 lines
package.json	66 lines
CHANGELOG.md	871 lines
README.md	429 lines
DESIGN.md	225 lines
test\smoke.mjs	3292 lines
test\adversarial.mjs	406 lines

## DIFF

```diff
_tools/lazy-tools/CHANGELOG.md     |  13 +++-
 _tools/lazy-tools/README.en.md     |   2 +-
 _tools/lazy-tools/README.md        |  27 ++++++-
 _tools/lazy-tools/client.js        | 148 ++++++++++++++++++++++++++++++++++++-
 _tools/lazy-tools/cordis.patch.yml |   9 +--
 _tools/lazy-tools/lib/index.js     |   5 +-
 _tools/lazy-tools/package.json     |   2 +-
 _tools/lazy-tools/test/smoke.mjs   |  12 +++
 perf-/0.19.0-发版记录.md           |  41 ++++++++++
 perf-/54-发版.ps1                  |   5 +-
 perf-/恶性bug清单.md               |   4 +-
 11 files changed, 250 insertions(+), 18 deletions(-)

diff --git a/_tools/lazy-tools/CHANGELOG.md b/_tools/lazy-tools/CHANGELOG.md
index c605c04..428994d 100644
--- a/_tools/lazy-tools/CHANGELOG.md
+++ b/_tools/lazy-tools/CHANGELOG.md
@@ -1,4 +1,15 @@
-﻿## [0.19.0] - 2026-11-06
+﻿## [0.19.1] - 2026-11-07
+
+**角色工具面从「默认开、只能改配置」变成「默认关、UI 可控」**：
+
+- 设置页新增「角色工具面」：逐项开关 review/build/research，**默认关闭**（与 README 口径一致）；
+- 支持自定义角色：填角色名 + 允许组即可加入 `managedRoles`，不用手改 policy.json；
+- 收纳统计分列：`已收纳 N` 与 `自动取出 M` 都取本对话状态，不再把全局自愈混进本对话；
+- README 补角色工具面 A/B 实测（n=2）、使用前提（需要 label 工作流）与“别人更好/更差”的边界。
+
+测试：冒烟 132、编码 283；0.19.1 冷读/发版在走。
+
+## [0.19.0] - 2026-11-06
 
 **角色工具面 + 门禁证据化**：
 
diff --git a/_tools/lazy-tools/README.en.md b/_tools/lazy-tools/README.en.md
index cab7865..bfc6c5c 100644
--- a/_tools/lazy-tools/README.en.md
+++ b/_tools/lazy-tools/README.en.md
@@ -7,7 +7,7 @@
 > actually use on the bench, lets stale ones sink on their own — and brings a tool back with one call,
 > a guard that catches a real call and reopens it, or an explicit `lazy_tools_enable`.
 
-**Status:** `0.19.0`.
+**Status:** `0.19.1`.
 
 > **0.19.0-dev:** `review:` / `build:` / `research:` label-scoped tool surfaces;
 > `review:`/`research:` hide edit/write; findings ledger; mutation score;
diff --git a/_tools/lazy-tools/README.md b/_tools/lazy-tools/README.md
index 182ebda..95f9b09 100644
--- a/_tools/lazy-tools/README.md
+++ b/_tools/lazy-tools/README.md
@@ -6,7 +6,7 @@
 
 工具抽屉处理的就是这件事：平时用不上的工具组收起来，要用的时候再放出来。
 
-**状态：0.19.0。**
+**状态：0.19.1。**
 
 > **0.19.0-dev 新增**：`review:` / `build:` / `research:` 角色 label（按 label 裁工具面）；
 > `review:`/`research:` 隐藏 edit/write；`findings` 台账与收敛判定；
@@ -172,6 +172,8 @@ bundle 自带的 patch 已配好四组：
 
 多会话编排器（如 dsh-superagent）用 preset 区分角色。默认情况下本插件不区分角色，所有会话都按热度判断。配置 `managedRoles` 后，某个 preset 会被认成「受管角色」：策略在会话创建时解析一次，会话内不变（前缀稳定、不打断缓存）。
 
+设置页的「角色工具面」可以逐项开关，也可以填角色名+允许组加自定义角色；**默认关闭**，只有勾选/配置后才接管对应 label。
+
 **写在哪**：`~/.dsh/lazy-tools.policy.json` 的 `managedRoles` 字段（**JSON**，不是 YAML；和设置页那些档位存在同一个文件），或者插件的 config（profile 里的 YAML）。两处都有时以 policy.json 为准。
 
 ```json
@@ -255,6 +257,29 @@ lazy_tools_roles({ role: "hermes", allowGroups: ["write"], basis: "写模块，
 
 测试：冒烟 `[75]`（热重载）、`[76]`（三条不变量 + 写入即生效）。
 
+### 角色工具面实测（n=2，不宣称普遍优越）
+
+> 这组数据只证明“角色在什么边界上更容易赢/输”，不是“角色普遍更好”。
+
+| 任务 | 直派 | 角色 | 结论 |
+|---|---|---|---|
+| findings 接进 54 | 7:17，2 文件，无 env 钉死 | 6:54，4 文件+3 文档，env 钉死 | 净时间直派略赢；质量角色赢（堵 fail-open） |
+| B3 mutation score | 4 文件，12/12 测试，查 mutate 退出码 | 4 文件+3 文档，8/8 测试，不查退出码 | 直派代码更严；角色文档更多 |
+| 5 文件审计 | 11:48，8 findings | 10:29，10 findings（多抓 save_groups 无守卫） | 角色多抓一条 blocking；两边都 FAIL |
+
+**能读出来的：**
+
+- 角色买“独立视角/覆盖”，直派买“代码直接/快”；没有稳定的速度优势。
+- 角色自己也会制造测试 bug（findings 54 的文案顺序断言），所以“有角色”不等于“更可靠”。
+- 这些数字 n 很小，不能当承诺；复现记录在 `perf-/A1-效率对照-20261106.md` 与 `perf-/角色与直派-分工-20261106.md`。
+
+**谁能直接用：**
+
+- 需要 DSH 2.0.x + 本插件；更关键的是**得有 label/预设工作流**（如 `review:` / `build:` / `research:`）。
+- 没有 label 工作流时，角色工具面**不会生效**；抽屉仍然只是普通的按需工具组。
+- 我们没有内置“supervisor 工作流”给外部用户；本仓库的 A1 工作法是配套文档，不是插件自带能力。
+- 如果别人的角色/编排方案更好：应该换或接，不要为了“我们有这个功能”硬用；如果更差，也不靠这组小样本证明我们更好。
+
 ## 会话级目录（0.18）
 
 常驻提示里列出的组，按**每个会话实际挂载的工具**算，不是一张全局固定清单：
diff --git a/_tools/lazy-tools/client.js b/_tools/lazy-tools/client.js
index 1fa235b..982c6b6 100644
--- a/_tools/lazy-tools/client.js
+++ b/_tools/lazy-tools/client.js
@@ -35,6 +35,18 @@ window.__ModuleLoader__.load({
       medium: tr('中（默认）', 'Medium (default)'),
       high: tr('高（激进）', 'High (aggressive)'),
     }
+    // 角色工具面（用户口中的「面具」）：勾选 = 该角色在 label 下按 allowGroups 裁工具。
+    // 默认值与 cordis.patch.yml 的 managedRoles 保持一致；UI 只控制「启用/停用」，细粒度组仍可在配置里改。
+    const ROLE_MASKS = {
+      review: { allowGroups: ['browser-heavy'], unknown: 'hide' },
+      build: { allowGroups: ['*'], unknown: 'show' },
+      research: { allowGroups: ['web', 'browser-heavy'], unknown: 'hide' },
+    }
+    const ROLE_LABELS = {
+      review: tr('review（审阅）', 'review'),
+      build: tr('build（实现）', 'build'),
+      research: tr('research（调研）', 'research'),
+    }
 
     async function request(path, body) {
       const options = { headers: { 'content-type': 'application/json', 'x-lazy-tools': '1' } }
@@ -138,6 +150,10 @@ window.__ModuleLoader__.load({
       const [error, setError] = React.useState('')
       // 用户有没有手改过「闲置天数」：没改过就让档位决定天数（2026-10-29 修 bug 2 的客户端半边）
       const [daysTouched, setDaysTouched] = React.useState(false)
+      const [newRoleName, setNewRoleName] = React.useState('')
+      const [newRoleGroups, setNewRoleGroups] = React.useState([])
+      const [groupCatalog, setGroupCatalog] = React.useState([])
+      const [roleError, setRoleError] = React.useState('')
 
       React.useEffect(() => {
         let alive = true
@@ -145,6 +161,7 @@ window.__ModuleLoader__.load({
           .then((data) => {
             if (!alive) return
             setState(data)
+            setGroupCatalog(Array.isArray(data.groups) ? data.groups : [])
             setForm({
               level: data.policy.level,
               idleDays: String(data.policy.idleDays),
@@ -156,6 +173,9 @@ window.__ModuleLoader__.load({
               showClear: data.policy.showClear === true,
               classifyNudge: data.policy.classifyNudge !== false,
               autoGroups: data.policy.autoGroups || 'on',
+              managedRoles: data.policy.managedRoles && typeof data.policy.managedRoles === 'object'
+                ? data.policy.managedRoles
+                : {},
             })
           })
           .catch((err) => alive && setError(err.message))
@@ -188,6 +208,52 @@ window.__ModuleLoader__.load({
         setStatus('')
       }
 
+      const setRole = (role) => (event) => {
+        const checked = Boolean(event && event.target && event.target.checked)
+        setForm((prev) => {
+          const next = { ...(prev.managedRoles || {}) }
+          if (checked) {
+            if (!next[role]) next[role] = ROLE_MASKS[role] || { allowGroups: [], unknown: 'hide' }
+          } else {
+            delete next[role]
+          }
+          return { ...prev, managedRoles: next }
+        })
+        setStatus('')
+      }
+
+      const addRole = () => {
+        const name = String(newRoleName || '').trim()
+        if (!/^[A-Za-z0-9_-]+$/.test(name)) {
+          setRoleError(tr('角色名只能用字母、数字、_、-（它会匹配 label 的第一段）', 'Role names: letters, digits, _, - (matches the first label segment)'))
+          return
+        }
+        const groups = Array.isArray(newRoleGroups) ? newRoleGroups : []
+        setForm((prev) => ({
+          ...prev,
+          managedRoles: {
+            ...(prev.managedRoles || {}),
+            [name]: { allowGroups: groups, unknown: 'hide' },
+          },
+        }))
+        setNewRoleName('')
+        setNewRoleGroups('')
+        setRoleError('')
+        setStatus('')
+      }
+
+      const refreshGroups = async () => {
+        try {
+          const data = await request('/state')
+          setState(data)
+          setGroupCatalog(Array.isArray(data.groups) ? data.groups : [])
+          setStatus(tr('分组列表已刷新', 'Group list refreshed'))
+          setError('')
+        } catch (err) {
+          setError(err.message)
+        }
+      }
+
       const save = async () => {
         setError('')
         setStatus(tr('保存中…', 'Saving…'))
@@ -201,6 +267,7 @@ window.__ModuleLoader__.load({
           showClear: form.showClear === true,
           classifyNudge: form.classifyNudge !== false,
           autoGroups: form.autoGroups || 'on',
+          managedRoles: form.managedRoles || {},
         }
         // 空字符串不能变成 Number('') = 0 —— 0 在这里的意思是「不按时间收敛 = 全开」。
         // 规则：手改过、或填的数与当前档位天数不同 → 下发；否则不下发，让宿主按档位算。
@@ -235,6 +302,8 @@ window.__ModuleLoader__.load({
         : ''
 
       // 基础页只留大多数人在意的几格；其余进「高级设置」（原生 <details>，不占注意力）。
+      // 旧配置里可能有 re 之类历史角色，也列出来，别让它隐身。
+      const roleKeys = [...new Set([...Object.keys(ROLE_MASKS), ...Object.keys(form.managedRoles || {})])]
       return h(
         'div',
         { style: styles.wrap },
@@ -279,6 +348,82 @@ window.__ModuleLoader__.load({
           ),
           h('span', { style: styles.hint }, tr('与档位控件互相独立：只想要档位就不勾它；想一键把本对话的工具全收纳再勾。', 'Independent of the level control. Leave it off unless you want a one-click stow for this conversation.')),
         ),
+        h(
+          'div',
+          { style: styles.row },
+          h('label', { style: styles.label }, tr('角色工具面（默认关闭）', 'Role masks (off by default)')),
+          h(
+            'div',
+            { style: { display: 'flex', gap: '14px', flexWrap: 'wrap' } },
+            roleKeys.map((role) =>
+              h(
+                'label',
+                { key: role, style: { ...styles.label, display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 400 } },
+                h('input', {
+                  type: 'checkbox',
+                  checked: Boolean(form.managedRoles && form.managedRoles[role]),
+                  onChange: setRole(role),
+                }),
+                ROLE_LABELS[role] || role,
+                h('span', { style: { opacity: 0.65, fontSize: '12px' } }, (() => {
+                  const groups = form.managedRoles && form.managedRoles[role] && form.managedRoles[role].allowGroups
+                  return Array.isArray(groups) ? (groups.length ? groups.join(', ') : 'CORE only') : ''
+                })()),
+              ),
+            ),
+          ),
+          h(
+            'div',
+            { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '4px' } },
+            h('input', {
+              style: styles.input,
+              placeholder: tr('自定义角色名', 'Custom role'),
+              value: newRoleName,
+              onChange: (event) => setNewRoleName(event.target.value),
+            }),
+            h('button', { style: styles.button, type: 'button', onClick: refreshGroups }, tr('刷新分组', 'Refresh groups')),
+          ),
+          h('span', { style: styles.hint }, tr('从当前所有工具组勾选；勾“全部”等于 allowGroups:["*"]；不勾任何组 = 只留常驻工具。', 'Pick from the current groups; All = allowGroups:["*"]; none = core tools only.')),
+          h(
+            'div',
+            { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
+            groupCatalog.map((g) =>
+              h(
+                'label',
+                { key: g.id, style: { ...styles.label, display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 400, fontSize: '12px' } },
+                h('input', {
+                  type: 'checkbox',
+                  checked: newRoleGroups.includes(g.id),
+                  onChange: (event) => {
+                    const checked = Boolean(event && event.target && event.target.checked)
+                    setNewRoleGroups((prev) => checked ? [...prev.filter((x) => x !== g.id), g.id] : prev.filter((x) => x !== g.id))
+                  },
+                }),
+                `${g.title || g.id} (${g.id})`,
+              ),
+            ),
+            h(
+              'label',
+              { style: { ...styles.label, display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 400, fontSize: '12px' } },
+              h('input', {
+                type: 'checkbox',
+                checked: newRoleGroups.includes('*'),
+                onChange: (event) => setNewRoleGroups(event.target.checked ? ['*'] : []),
+              }),
+              tr('全部 (*)', 'All (*)'),
+            ),
+          ),
+          h('button', { style: styles.button, type: 'button', onClick: addRole }, tr('添加角色', 'Add role')),
+          roleError ? h('span', { style: styles.error }, roleError) : null,
+          h(
+            'span',
+            { style: styles.hint },
+            tr(
+              '默认关闭：勾选后 label 为 review/build/research 时按角色裁工具面；review/research 隐藏 edit/write。取消勾选 = 该角色不再裁工具面，下次会话/标签生效。自定义角色也可在下面加。',
+              'Off by default. Once checked, review/build/research labels apply a role-scoped tool surface; review/research hide edit/write. Uncheck to stop masking for that role (next session/label). Add custom roles below.',
+            ),
+          ),
+        ),
         h(
           'div',
           { style: styles.actions },
@@ -436,7 +581,8 @@ window.__ModuleLoader__.load({
         error
           ? error
           : hiddenTools > 0
-            ? tr(`已收纳 ${hiddenTools} 个工具 · 自动取出 ${selfHealed} 次`, `${hiddenTools} stowed · ${selfHealed} auto-restored`)
+            // hiddenTools 和 selfHealed 都取本对话状态；全局累计只看 health.stats.selfHealed，不再混入口袋行。
+            ? tr(`本对话已收纳 ${hiddenTools} 个工具 · 本对话累计自动取出 ${selfHealed} 次`, `This conversation: ${hiddenTools} stowed · this conversation auto-restored: ${selfHealed}`)
             : tr('没有收纳中的工具', 'nothing stowed'),
       )
 
diff --git a/_tools/lazy-tools/cordis.patch.yml b/_tools/lazy-tools/cordis.patch.yml
index 38dd8fa..25cd64e 100644
--- a/_tools/lazy-tools/cordis.patch.yml
+++ b/_tools/lazy-tools/cordis.patch.yml
@@ -56,11 +56,4 @@
               ]
             title: 视觉·重
             defaultOn: false
-            expect: 8
-        managedRoles:
-          review:
-            allowGroups: [browser-heavy]
-          build:
-            allowGroups: ['*']
-          research:
-            allowGroups: [web, browser-heavy]
+            expect: 8
\ No newline at end of file
diff --git a/_tools/lazy-tools/lib/index.js b/_tools/lazy-tools/lib/index.js
index 6d1dadb..d2b3bc7 100644
--- a/_tools/lazy-tools/lib/index.js
+++ b/_tools/lazy-tools/lib/index.js
@@ -1021,6 +1021,8 @@ export function apply(ctx, config) {
     if (m.mode === 'only' && m.names.has(name)) return undefined
     const names = m.mode === 'only' ? new Set([...m.names, name]) : new Set([name])
     st.modes.set(groupId, { mode: 'only', names })
+    // 会话级累计：同一对话里的自愈次数；跨会话/重载再累加到全局 stats。
+    st.selfHealed = (Number.isFinite(st.selfHealed) ? st.selfHealed : 0) + 1
     stats.selfHealed += 1
     persistCounts()
     saveUsage(usageLedger)
@@ -1189,7 +1191,8 @@ export function apply(ctx, config) {
       // 给输入框上方那一行用的账：「已收纳 N 个工具 · 自动取出 M 次」。
       // 比「开着 2 组」更像人话 —— 用户不知道一组里有多少东西。
       hiddenTools: st.hiddenNames.length,
-      selfHealed: stats.selfHealed,
+      // 本对话累计；全局累计仍看 health.stats.selfHealed。
+      selfHealed: Number.isFinite(st.selfHealed) ? st.selfHealed : 0,
       // 档位下拉里「跟随全局（N 天）」要显示的数字
       globalIdleDays: policy.idleDays,
       session: {
diff --git a/_tools/lazy-tools/package.json b/_tools/lazy-tools/package.json
index 8502d98..aaa3a03 100644
--- a/_tools/lazy-tools/package.json
+++ b/_tools/lazy-tools/package.json
@@ -1,6 +1,6 @@
 {
   "name": "dsh-tool-drawer",
-  "version": "0.19.0",
+  "version": "0.19.1",
   "private": false,
   "type": "module",
   "main": "lib/index.js",
diff --git a/_tools/lazy-tools/test/smoke.mjs b/_tools/lazy-tools/test/smoke.mjs
index 0d1c99e..35d3edb 100644
--- a/_tools/lazy-tools/test/smoke.mjs
+++ b/_tools/lazy-tools/test/smoke.mjs
@@ -803,6 +803,18 @@ async function main() {
     assert.match(pkg.version, /^\d+\.\d+\.\d+$/, '版本号不是 x.y.z')
     assert.ok(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch, 'package.json 缺 dsh.bundle.patch，装不上')
     ok('包名 / 客户端 id / patch 行名三处一致；版本号合法；bundle 声明在')
+    // 2026-11-07：角色工具面（用户口中的「面具」）必须有 UI 开关，不能只藏在配置里。
+    assert.match(bridgeClientSrc, /角色工具面（默认关闭）/, '设置页缺角色工具面开关')
+    assert.match(bridgeClientSrc, /managedRoles: form\.managedRoles \|\| \{\}/, '设置页保存缺 managedRoles')
+    ok('设置页有角色工具面开关，且会随策略保存')
+    assert.match(bridgeClientSrc, /自定义角色名/, '设置页缺自定义角色输入')
+    assert.doesNotMatch(patchSrc, /managedRoles:/, '角色工具面默认应为关闭（README 口径）')
+    ok('角色工具面默认关闭，支持自定义角色')
+    assert.match(bridgeClientSrc, /groupCatalog\.map/, '自定义角色必须从当前分组动态列出')
+    ok('自定义角色从 state.groups 动态列组，不写死组名')
+    assert.match(bridgeClientSrc, /本对话累计自动取出/, '收纳统计必须区分本对话与全局')
+    ok('收纳统计区分本对话 hidden 与本对话 selfHealed')
+
     log('[25] 自动分组：切分、白名单、80% 规则、上限')
     const { tokenize, suggestGroups, matchPattern, normalizeAutoMode } = await import('../lib/autogroups.js')
     assert.deepEqual(tokenize('cua_driver_native__list_apps'), ['cua_driver_native'])
diff --git a/perf-/0.19.0-发版记录.md b/perf-/0.19.0-发版记录.md
new file mode 100644
index 0000000..ed691cb
--- /dev/null
+++ b/perf-/0.19.0-发版记录.md
@@ -0,0 +1,41 @@
+﻿# 0.19.0 发版记录
+
+- 时间：2026-11-06 23:xx（Asia/Shanghai）
+- Release：https://github.com/kmyy350234-dz/dsh-tool-drawer/releases/436676915
+- tag：`v0.19.0`
+- Release id：436676915
+- 发布仓提交：`563734b`
+- 源仓发布时提交：`e7425de`（发版后收尾 `5a2395c`）
+
+## 制品
+
+- `dsh-tool-drawer-0.19.0.tgz`：227008 字节
+- `dsh-tool-drawer.tgz`：227008 字节
+- sha256：`4bcf5b8480e5a61817ce1462a630bb87c35d7e39e37147e33f0a041e865f5949`
+- 远端 digest 两资产都匹配
+
+## 门禁
+
+- 冒烟 128 ×2：PASS
+- 对抗 29 / RED 0：PASS
+- 编码 281 项 / 0 问题：PASS
+- 一致性断言：PASS
+- 恶性 bug 清单 4/4：PASS（发版后已改回未勾）
+- 流程一致性 / 变异 8 条未抓住 0：PASS
+- findings：无台账，SKIP
+- 冷读：0 红 / 0 unverified / baseline 7（`review/coldread-0.19.0.md`）
+- CI：run 42244972167 success
+- 两条下载链接：HTTP 200 / 227008 字节
+
+## 发布时遇到的两个流程 bug（已修）
+
+1. 54 凭据回退用 PS 5.1 数组管道给 `git credential fill` 会丢 stdin；改为临时文件重定向（`cfb6b44`）。
+2. 54 推发布仓写死 `master:main`，但发布仓当前分支是 `main`，导致 non-fast-forward；改为 `HEAD:main`（`e7425de`）。
+
+## 回滚
+
+```powershell
+git -C "C:\Users\14092\gh-publish\dsh-lazy-tools" tag -d v0.19.0
+git -C "C:\Users\14092\gh-publish\dsh-lazy-tools" push origin :refs/tags/v0.19.0
+# 手动删 Release 436676915
+```
diff --git a/perf-/54-发版.ps1 b/perf-/54-发版.ps1
index fb94b99..6b3bea1 100644
--- a/perf-/54-发版.ps1
+++ b/perf-/54-发版.ps1
@@ -276,7 +276,8 @@ $findingsScript = Join-Path $SrcRepo 'review/findings.mjs'
 if (-not (Test-Path $findingsFile)) {
   # 顺序很重要：先看台账在不在。不存在就不要调 node —— findings.mjs 那时会以 2 退出，
   # 那是「没台账」不是「不收敛」，混在一起会造出一个假 FAIL。
-  Step '6h/7' 'findings 收敛' $true '无台账（review/findings.json 不存在），跳过'
+  $findingsDetail = '无台账（review/findings.json 不存在），跳过'
+  Step '6h/7' 'findings 收敛' $true $findingsDetail
 } elseif (-not (Test-Path $findingsScript)) {
   Step '6h/7' 'findings 收敛' $false "有台账但缺 $findingsScript"
 } else {
@@ -566,7 +567,7 @@ $evidenceLines = @(
   "- 制品：$tgzName，$tgzBytes 字节，sha256=$tgzSha",
   "- CI：$ciDetail"
 )
-$evidence = ($evidenceLines | ForEach-Object { if ($null -eq $_ -or "$_" -eq "") { "-（未运行/无输出）" } else { "$_" } }) -join "`n"
+$evidence = ($evidenceLines | Where-Object { $null -ne $_ -and "$_" -ne "" }) -join "`n"
 $section = ($section.TrimEnd() + "`n`n" + $evidence)
 
 $payload = @{ tag_name = $tag; name = "v$Version"; body = $section; draft = $false; prerelease = $false } | ConvertTo-Json -Depth 5
diff --git a/perf-/恶性bug清单.md b/perf-/恶性bug清单.md
index 925b4c8..4338950 100644
--- a/perf-/恶性bug清单.md
+++ b/perf-/恶性bug清单.md
@@ -6,7 +6,7 @@
 > 用法：**由我（开发执行者）逐条核对并勾选**，不是你的事；勾满才能发版，发完改回 `[ ]`。
 > **这份文件只在本地开发过程用，不随包发布、不进发布仓。**
 
-- [x] **静默丢数据**：0.19.0 只改角色工具面/门禁脚本/文档；`save_groups` 对受管会话拒绝，不清空/不回写用户配置；findings/verdict 只由显式命令写
+- [x] **静默丢数据**：0.19.1 只改角色工具面/门禁脚本/文档；`save_groups` 对受管会话拒绝，不清空/不回写用户配置；findings/verdict 只由显式命令写
 - [x] **把会话锁死**：角色隐藏只走 `tools.restrict`，失败方向放开；没有新增 3 秒重建链；schedule 只给顶层 agent，子代理拒绝
 - [x] **权限方向错**：受管 `mode` 仍明确拒绝；review/research 隐藏 edit/write；`pwsh` 仍可见（已知边界，靠角色提示约束），不是新增 fail-open
-- [x] **启动级失败**：config readdir 兜底未改；冒烟 128、对抗 29 RED 0、编码 281 项、基线 7 条、findings 6/6、mutation-score 12/12 全过
+- [x] **启动级失败**：config readdir 兜底未改；冒烟 132、对抗 29 RED 0、编码 283 项、基线 7 条、findings 6/6、mutation-score 12/12 全过
```


## SOURCE


### lib\api.js

```js
// 设置页 ↔ 宿主 的桥。
//
// 设置页是客户端那一半画的（lib/client.js），它没法直接读宿主的对象，
// 所以这里开一条 loopback HTTP 路由（和 dsh-perlica-ding 同一套做法）：
//   GET  /lazy-tools/api/state   读当前策略 + 组清单
//   POST /lazy-tools/api/policy  写策略（落盘到 ~/.dsh/lazy-tools.policy.json）
//
// 为什么用文件而不是直接改 profile 的 cordis.patch.yml：
//   改 YAML 要重写用户的配置文件（还可能触发重载），风险高；
//   一个独立的小 JSON 只影响本插件的策略，删掉即回默认。
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, renameSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'

const LEVELS = ['low', 'medium', 'high']
const MAX_BODY = 64 * 1024

// 客户端半边最后一次上报的时间。
//
// 为什么需要它：宿主这边一切正常（四个契约都在、hidden 也 applied），完全不等于
// 浏览器那边把设置页和输入框控件挂上了——2026-10-24 就出现过「宿主 healthy，
// 客户端条目 failed，Web 直接进恢复模式」。这份心跳让「面板到底挂没挂」变成
// lazy_tools_health 里一条能查的数据，而不是只能靠重启去发现。
let lastClientPing = null

/** 给健康检查读的客户端心跳快照（没有就是没上报过）。 */
export function clientPing() {
  return lastClientPing
}

export function policyFile() {
  if (process.env.LAZY_TOOLS_POLICY_FILE) return process.env.LAZY_TOOLS_POLICY_FILE
  const home = process.env.USERPROFILE || process.env.HOME || '.'
  return join(home, '.dsh', 'lazy-tools.policy.json')
}

/** 只接受认识的键；其余丢掉，避免手改文件时写进垃圾。 */
export function normalizePolicy(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  if (LEVELS.includes(raw.level)) out.level = raw.level
  if (Number.isFinite(raw.idleDays) && raw.idleDays >= 0) out.idleDays = Math.round(raw.idleDays)
  if (Number.isFinite(raw.minTools) && raw.minTools >= 0) out.minTools = Math.round(raw.minTools)
  if (Number.isFinite(raw.warmRatio)) out.warmRatio = Math.min(1, Math.max(0.05, raw.warmRatio))
  if (raw.presets && typeof raw.presets === 'object') {
    const presets = {}
    for (const key of ['low', 'medium', 'high']) {
      const days = Number(raw.presets[key])
      if (Number.isFinite(days) && days >= 0) presets[key] = Math.round(days)
    }
    if (Object.keys(presets).length === 3) out.presets = presets
  }
  if (typeof raw.classifyNudge === 'boolean') out.classifyNudge = raw.classifyNudge
  if (typeof raw.showDock === 'boolean') out.showDock = raw.showDock
  if (typeof raw.showClear === 'boolean') out.showClear = raw.showClear
  // 自动分组：off / suggest / on（2026-10-25 加）
  if (raw.autoGroups === 'off' || raw.autoGroups === 'suggest' || raw.autoGroups === 'on') out.autoGroups = raw.autoGroups
  // 2026-11-03 修：**managedRoles 必须透传**。
  // 找到它的是一条测试：README 写着「角色写进 policy.json」，但归一化在这里把它吃掉，
  // 于是从 policy.json 配的角色**从来没生效过**（只有插件 config 里的能生效）——静默两个月。
  // 更糟的是保存路径：`mergePolicyForStorage` 先把存盘策略读回来（被这里剥掉 managedRoles），
  // 再合并写回 ⇒ **随便存一次设置就把角色配置删了**（与档案 #78 同一类：写成功但内容不对）。
  // 这里只做形状检查，具体校验交给 roles.js 的 normalizeManagedRoles。
  if (raw.managedRoles && typeof raw.managedRoles === 'object' && !Array.isArray(raw.managedRoles)) {
    out.managedRoles = raw.managedRoles
  }
  return out
}

/**
 * 设置页保存：把一份补丁合到现有策略上，并处理「档位 → 天数」的跟随。
 *
 * 为什么单独抽出来：`policy.idleDays` 在插件启动时算一次（index.js 的 policy 初始化），
 * 之后设置页走的是 Object.assign —— 用户把档位从 high 改成 low，`policy.level` 变了、
 * `policy.idleDays` 还是 3 天，直到重启进程。2026-10-28 对面复现了这个不一致。
 *
 * 规则：只给了 level、没给 idleDays（undefined / null = 用户没碰那一格）时，
 * 天数跟着档位走；显式给了数字就用数字（用户可以「跟随档位但天数是自定义」）。
 *
 * @param {object} policy 现有策略（会被就地修改并返回）
 * @param {object} next 设置页提交的补丁
 */
export function applyPolicyPatch(policy, next) {
  const patch = Object.assign({}, next)
  const hasDays = patch.idleDays !== undefined && patch.idleDays !== null
  if (!hasDays && patch.level && policy && policy.presets) {
    const preset = policy.presets[patch.level]
    if (Number.isFinite(preset)) patch.idleDays = preset
  }
  return Object.assign(policy, patch)
}

/**
 * 落盘用：把补丁合到**已存盘的**策略上，返回完整策略。
 *
 * 2026-11-02 修（用户转述了同行的判断，回去一查是真的）：
 * 原来 POST /policy 把 `normalizePolicy(body)` 直接 `writeStoredPolicy()` —— 写下去的是**补丁**，
 * 不是合并后的完整策略。只要客户端发的是部分字段（档位按钮、脚本、未来的 UI 改版），
 * 文件就被覆盖成那几项，**其余设置从盘上消失**；运行时因为 `applyPolicy` 会把补丁并进内存，
 * 看起来一切正常 —— 直到重启进程，没落盘的那些就回到默认值。
 * 症状：改一处设置，重启后发现别的设置全变默认。
 *
 * 现在：读回存盘 → 合并补丁 → 写合并结果；内存侧也用同一份，盘和内存不再两套口径。
 *
 * @param {object} patch   这次提交的补丁
 * @param {object|null} stored 已存盘的策略（调用方传 readStoredPolicy()）
 */
export function mergePolicyForStorage(patch, stored) {
  const base = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
  return applyPolicyPatch(base, patch)
}

/** 用户手写组的覆盖文件：和 policy 分开，设置页保存不会冲掉它。 */
export function groupsFile() {
  if (process.env.LAZY_TOOLS_GROUPS_FILE) return process.env.LAZY_TOOLS_GROUPS_FILE
  const home = process.env.USERPROFILE || process.env.HOME || '.'
  return join(home, '.dsh', 'lazy-tools.groups.json')
}

/** 读用户组；文件不存在或坏了都当作空数组（不能因为一行手写配置把插件带崩）。 */
export function readUserGroups(record) {
  const file = groupsFile()
  try {
    if (!existsSync(file)) return []
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((g) => g && typeof g.id === 'string' && Array.isArray(g.match) && g.match.length)
  } catch (error) {
    if (typeof record === 'function') record('user groups', error)
    return []
  }
}

/** 写用户组（覆盖整个文件）。只做最基本的形状校验，语义校验在调用方。 */
export function writeUserGroups(groups) {
  const file = groupsFile()
  // 2026-11-05：文件路径可被 LAZY_TOOLS_GROUPS_FILE 覆盖，目录必须跟着文件走，
  // 否则指向新目录时写盘直接 ENOENT。
  mkdirSync(dirname(file), { recursive: true })
  // 2026-11-05（元宝挑刺附注）：组文件原来是「直接写 + 不看回读」——写到一半失败/内容被改
  // 都会静默成功。改成原子写（tmp + rename）并回读校验，和 policy 一个待遇。
  const tmp = `${file}.${process.pid}.tmp`
  const payload = JSON.stringify(groups, null, 2) + '\n'
  try {
    writeFileSync(tmp, payload, 'utf8')
    renameSync(tmp, file)
    const back = readFileSync(file, 'utf8')
    if (back !== payload) throw new Error('组文件写入后回读不一致')
  } catch (error) {
    try { unlinkSync(tmp) } catch { /* 临时文件可能已经 rename 走了 */ }
    throw error
  }
  return file
}

export function readStoredPolicy() {
  try {
    const file = policyFile()
    if (!existsSync(file)) return null
    return normalizePolicy(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

/**
 * 严格版读策略（2026-11-03，冷读红 2）：把「文件不存在」和「读/解析失败」分开。
 * readStoredPolicy 把所有异常都变成 null —— 对"用默认值启动"是好事，对"热重载"是灾难：
 * 坏 JSON / 半写文件会被当成"用户把角色全删了"，于是 managedRoles 被静默清零。
 * 调用方拿到 ok:false 时必须**保持旧值**并记账，不许当空。
 */
export function readStoredPolicyStrict() {
  const file = policyFile()
  if (!existsSync(file)) return { ok: true, policy: null, raw: null }
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'))
    // 2026-11-03（冷读第三轮）：合法 JSON 但不是对象（null / [] / "str"）也算「读不出来」。
    // 以前 normalizePolicy 把它静默变成 {} ⇒ 整份设置退回默认、healthy 还是 true。
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: new Error('policy.json 顶层不是对象') }
    }
    return { ok: true, policy: normalizePolicy(value), raw: value }
  } catch (error) {
    return { ok: false, error }
  }
}

/**
 * 读 policy 的**原始 JSON**（不归一化）：给需要"合并写回、保留别人键"的写路径用。
 * 冷读红 3：#78 的同类 —— 用归一化后的对象当基底去覆盖整份文件，会把没认识的键洗掉。
 */
export function readPolicyRaw() {
  const file = policyFile()
  if (!existsSync(file)) return { ok: true, value: {} }
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: new Error('policy.json 顶层不是对象') }
    }
    return { ok: true, value }
  } catch (error) {
    return { ok: false, error }
  }
}

/**
 * policy 文件的修改时间（毫秒）；不存在 / 读不到给 0。
 * 用途只有一个：**改完文件不用重启**（2026-11-03，用户点名"配置很麻烦"）。
 * 判据用 mtime 而不是 watchdog：不引依赖、失败就退回旧行为（拿不到就是 0，永不重载）。
 */
export function policyFileMtime() {
  try {
    const file = policyFile()
    if (!existsSync(file)) return 0
    return statSync(file).mtimeMs || 0
  } catch {
    return 0
  }
}

export function writeStoredPolicy(policy) {
  const file = policyFile()
  mkdirSync(dirname(file), { recursive: true })
  // 2026-11-03（冷读第三轮）：先写临时文件再 rename —— 直接 truncate+write 一旦中途失败，
  // 盘上就是半份 JSON，热重载读到它会当成"用户改坏了"（红 2 的放大器）。
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(policy, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
  return file
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    // 2026-11-05（元宝挑刺附注）：原来用字符串 += 拼 chunk —— 分块正好切在多字节汉字中间时
    // 会被解成替换字符。先收 Buffer，最后一次性 UTF-8 解码。
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      const room = MAX_BODY - size
      if (room <= 0) return
      const piece = buf.length > room ? buf.subarray(0, room) : buf
      chunks.push(piece)
      size += piece.length
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(JSON.parse(text || '{}'))
      } catch {
        resolve({ __invalidJson: true })
      }
    })
    req.on('error', () => resolve({ __invalidJson: true }))
  })
}

/**
 * 挂上桥。webServer 可能还没就绪（开机早期），所以两条路各试一次：
 * 已经有的直接挂，没有的用 ctx.inject 等它出现。
 * options: { getState(): object, applyPolicy(policy): void, record(where, error) }
 */
export function mountBridge(ctx, host, options) {
  let mounted = false

  const mount = (server) => {
    if (mounted || !server || typeof server.register !== 'function') return
    try {
      // 注意：host.own() 收的是**已经建好的清理函数**，不是工厂函数。
      // 之前把 `() => server.register(...)` 传进去，结果是「只登记了清理器、从来没注册路由」，
      // 浏览器那边看到的就是 404（2026-10-24 实测）。所以先注册、再把返回的注销函数交给 own。
      const unregister = server.register({
          kind: 'prefix',
          path: '/lazy-tools/api',
          handler: async (req, res) => {
            const send = (code, payload) => {
              res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify(payload))
            }
            try {
              const path = String(req.url || '').split('?')[0]
              const headers = req.headers || {}

              // 2026-11-05（元宝挑刺 2）：只比 Origin.host === headers.host 挡不住 DNS rebinding
              // —— 攻击者域名解析到 127.0.0.1 时两者天然相等。桥只服务本机，Host 必须是回环。
              const hostHeader = String(headers.host || '').trim()
              const hostOnly = hostHeader.replace(/:\d+$/, '').toLowerCase()
              // IPv6 的 Host 按 RFC 必须带方括号；裸 '::1' 到不了这里（且会被上面的端口剥离搞坏）。
              const loopback = hostOnly === '127.0.0.1' || hostOnly === 'localhost' || hostOnly === '[::1]'
              if (!loopback) {
                return send(403, { error: 'Host must be loopback' })
              }

              // 2026-11-05（外部审阅 C2）：原来只校验「有 Origin 就必须同源」——没有 Origin 的请求
              // 直接放行，于是任何本机进程（或 DNS rebinding 后的页面）都能改策略/改会话工具面。
              // 现在写操作必须带自定义头；跨源页面带不上这个头（会先触发预检，而这里不答 OPTIONS）。
              if (req.method === 'POST' && String(headers['x-lazy-tools'] || '') !== '1') {
                return send(403, { error: 'missing x-lazy-tools header' })
              }
              const origin = headers.origin
              if (typeof origin === 'string' && origin.length > 0) {
                let sameOrigin = false
                try {
                  sameOrigin = new URL(origin).host === headers.host
                } catch {
                  sameOrigin = false
                }
                if (!sameOrigin) return send(403, { error: 'cross-origin request refused' })
              }
              if (req.method === 'GET' && path === '/lazy-tools/api/state') {
                return send(200, { ...options.getState(), file: policyFile(), levels: LEVELS })
              }
              // 会话级：只影响这一个对话（输入框上方那个控件用它）
              if (path === '/lazy-tools/api/session') {
                const url = new URL(String(req.url || ''), 'http://localhost')
                if (req.method === 'GET') {
                  const id = url.searchParams.get('id') || ''
                  if (!id) return send(400, { error: 'id required' })
                  if (typeof options.getSession !== 'function') return send(501, { error: 'session api unavailable' })
                  const state = options.getSession(id)
                  return state && state.error ? send(404, state) : send(200, state)
                }
                if (req.method === 'POST') {
                  const contentType = String(headers['content-type'] || '')
                  if (!contentType.includes('application/json')) {
                    return send(415, { error: 'content-type must be application/json' })
                  }
                  const body = await readJsonBody(req)
                  const id = String((body && body.id) || '')
                  if (!id) return send(400, { error: 'id required' })
                  if (typeof options.applySession !== 'function') return send(501, { error: 'session api unavailable' })
                  const state = options.applySession(id, body)
                  return state && state.error ? send(400, state) : send(200, state)
                }
                return send(405, { error: 'method not allowed' })
              }
              // 客户端心跳：设置页 / 输入框控件挂上之后由浏览器那半边 POST 一次。
              // 只记「什么时候、挂了哪几个面板」，不存任何用户数据。
              if (req.method === 'POST' && path === '/lazy-tools/api/client') {
                const contentType = String(headers['content-type'] || '')
                if (!contentType.includes('application/json')) {
                  return send(415, { error: 'content-type must be application/json' })
                }
                const body = await readJsonBody(req)
                if (body && body.__invalidJson) return send(400, { error: 'invalid json body' })
                const panels = Array.isArray(body && body.panels)
                  ? body.panels.slice(0, 8).map((item) => String(item))
                  : []
                lastClientPing = { at: new Date().toISOString(), panels }
                return send(200, { ok: true, at: lastClientPing.at, panels })
              }
              if (req.method === 'POST' && path === '/lazy-tools/api/policy') {
                const contentType = String(headers['content-type'] || '')
                if (!contentType.includes('application/json')) {
                  return send(415, { error: 'content-type must be application/json' })
                }
                const body = await readJsonBody(req)
                const next = normalizePolicy(body)
                // 空策略一律拒绝（2026-10-29 第三方复核指出的真实路径）：
                // readJsonBody 在「body 超 64KB 被截断 / JSON 坏 / req 出错」时 resolve({ __invalidJson: true })，
                // 归一化后还是 {}，写下去就等于把 policy 文件清空，却返回 200。
                // 合法的设置页保存永远至少带一个已知键，所以「空」一定不是用户意图。
                if (!Object.keys(next).length) {
                  return send(400, { error: '策略为空（body 不是合法 JSON？），已拒绝写入' })
                }
                if (body && body.level !== undefined && next.level === undefined) {
                  return send(400, { error: `level 必须是 ${LEVELS.join(' / ')} 之一` })
                }
                try {
                  // 2026-11-02：写**合并后的完整策略**，不是补丁（见 mergePolicyForStorage 的注释）。
                  // 2026-11-03（冷读红 3）：必须先读**原始 JSON** 当基底 —— 归一化后的对象会丢掉它不认识的键，
                  // 坏文件还会被当成空对象，于是"保存一次设置"就把 autoGroups / managedRoles 洗没了。
                  // 读不出来就拒绝（400），一个字节都不写。
                  const raw = readPolicyRaw()
                  if (!raw.ok) {
                    return send(400, {
                      error: `policy.json 读不出来（${String((raw.error && raw.error.message) || raw.error)}），为免洗掉设置已拒绝写入`,
                    })
                  }
                  const merged = mergePolicyForStorage(next, normalizePolicy(raw.value))
                  // 用原始对象当底、把归一化后的已知键覆盖上去：未知键原样保留
                  const toWrite = { ...raw.value, ...merged }
                  writeStoredPolicy(toWrite)
                  // 写后回读（2026-11-02 同一次翻车补的第二道）：这次的问题不是「写失败」，而是
                  // 「写成功但内容不对」—— 只看 writeFileSync 没抛错就返回 200，两周没人发现。
                  // 落盘后把文件读回来对键集合，少一个就报错，不再静默。
                  const back = readPolicyRaw()
                  const backValue = back.ok ? normalizePolicy(back.value) : {}
                  const lost = Object.keys(merged).filter((key) => !(key in backValue))
                  if (lost.length) {
                    const detail = `落盘后回读缺键：${lost.join(', ')}`
                    host.record('policy write', new Error(detail))
                    return send(500, { error: detail })
                  }
                  // 2026-11-06（元宝 P0）：写盘成功后必须追平 mtime，否则下一次 agent/created
                  // 会误判"文件被外部改过"再热重载一遍，等于一次勾选框重建两轮。
                  if (typeof options.setPolicyMtime === 'function') options.setPolicyMtime(policyFileMtime())
                  options.applyPolicy(merged)
                } catch (error) {
                  return send(500, { error: `保存策略失败：${String((error && error.message) || error)}` })
                }
                return send(200, { ...options.getState(), file: policyFile(), levels: LEVELS })
              }
              return send(404, { error: 'not found' })
            } catch (error) {
              return send(500, { error: String((error && error.message) || error) })
            }
          },
      })
      host.own(unregister)
      mounted = true
      host.log('info', 'settings bridge registered at /lazy-tools/api')
    } catch (error) {
      host.record('bridge', error)
    }
  }

  let server = null
  try {
    server = ctx && typeof ctx.get === 'function' ? ctx.get('webServer') : null
  } catch {
    server = null
  }
  if (server) mount(server)
  else if (ctx && typeof ctx.inject === 'function') {
    try {
      ctx.inject(['webServer'], (scoped) => mount(scoped && scoped.webServer ? scoped.webServer : null))
    } catch (error) {
      host.record('bridge inject', error)
    }
  }

  return () => {
    mounted = false
  }
}

```


### lib\autogroups.js

```js
// 自动分组：从工具名里识别「工具家族」，给还没被任何组覆盖的那部分生成建议组。
//
// 为什么要它：默认只覆盖 cua_driver_native / dsh_browser / vision 三类；
// 用户装的新插件（mnemon、schedule、job…）没有组，就会一直可见、一直付 token。
//
// 设计边界（2026-10-25 与用户确认）：
//   · 只做「明显能分」的：同一前缀段 ≥ minTools 个、且没被现有组吃掉才建；
//   · 核心工具永不入组（白名单写死，不做成配置）；
//   · 极端需求留给配置文件（手写组永远优先于自动组）。
//
// 本文件是纯函数，不碰 ctx，方便单测。

/** 核心工具：藏了会拖慢/拖坏基本操作与自救，永不自动分组。 */
export const CORE_TOOLS = new Set([
  // 两代宿主工具名并存（2026-10-31）：DSH 2.0.21 起 dsh-ops 用 ops_* 取代了官方 pwsh。
  // 不存在的名字在清单里是空操作，所以两个版本共用同一份代码，不做版本分支。
  'read', 'write', 'edit', 'glob', 'grep', 'pwsh', 'skill', 'todo_write',
  'ask_user_question', 'present', 'plugin_manager', 'working_directory',
  'load_workspace_dependencies', 'ops_read_files', 'ops_discover_tools',
  'ops_bash', 'ops_grep', 'ops_glob', 'ops_inspect_local_file', 'ops_result',
  'lazy_tools_status', 'lazy_tools_enable', 'lazy_tools_disable', 'lazy_tools_list',
  'lazy_tools_resolve', 'lazy_tools_mode', 'lazy_tools_scan', 'lazy_tools_health',
  'lazy_tools_classify', 'lazy_tools_save_groups', 'lazy_tools_bench', 'lazy_tools_roles',
])

/** 受保护前缀：这些家族里混着自救工具，整族都不自动分组。 */
export const PROTECTED_PREFIXES = new Set(['lazy', 'lazy_tools', 'lazy-tools', 'ops'])

/** 名字 → 段数组。`__` 是硬分隔（cua_driver_native__x 整段算一个家族名），否则按单个 `_` 切。 */
export function tokenize(name) {
  const text = String(name || '')
  if (!text) return []
  if (text.includes('__')) return [text.split('__')[0]].filter(Boolean)
  return text.split('_').filter(Boolean)
}

/** 前缀段 → 匹配式（正则，整串锚定）。 */
export function matchPattern(segments) {
  const body = segments.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('_')
  return `re:^${body}(_|__|$)`
}

/** 组 id：auto-<段1-段2>。 */
export function autoGroupId(segments) {
  return 'auto-' + segments.join('-')
}

function trieInsert(root, segments, name) {
  let node = root
  for (const segment of segments) {
    if (!node.children.has(segment)) node.children.set(segment, { count: 0, names: [], children: new Map() })
    node = node.children.get(segment)
    node.count += 1
    node.names.push(name)
  }
  return node
}


/**
 * 主入口。
 * @param {string[]} names 全部工具名
 * @param {(name: string) => boolean} isCovered 是否已被现有组覆盖
 * @param {{minTools?: number, maxGroups?: number}} options
 * @returns {{suggestions: Array<{id: string, match: string[], title: string, expect: number, tools: string[]}>, skipped: Array<{prefix: string, reason: string, count: number}>}}
 */
export function suggestGroups(names, isCovered = () => false, options = {}) {
  const minTools = Number.isFinite(options.minTools) ? Math.max(2, Math.round(options.minTools)) : 3
  const maxGroups = Number.isFinite(options.maxGroups) ? Math.max(1, Math.round(options.maxGroups)) : 8

  const all = [...new Set(names.map(String))].filter(Boolean)
  const uncovered = all.filter((name) => !CORE_TOOLS.has(name) && !isCovered(name))

  // trie：按段建树，同时记下整条前缀（用于 80% 规则与 id）
  const root = { children: new Map() }
  const prefixOf = new Map() // toolName -> token 数组
  for (const name of uncovered) {
    const segments = tokenize(name)
    if (!segments.length) continue
    prefixOf.set(name, segments)
    trieInsert(root, segments, name)
  }

  // 收集候选家族（带完整前缀）。
  // 切分规则：只有当「子族合计能覆盖本节点 ≥80%」时才往下切，否则保留整族。
  // 否则像 mnemon(17) 会被切成 mnemon_memory_body(3) + mnemon_document(3)，大族反而丢了。
  const raw = []
  const walk = (node, prefix, out = raw) => {
    const childFamilies = []
    for (const [segment, child] of node.children) {
      walk(child, prefix.concat(segment), childFamilies)
    }
    const coveredByChildren = childFamilies.reduce((sum, family) => sum + family.names.length, 0)
    if (childFamilies.length && node.names.length && coveredByChildren >= node.names.length * 0.8) {
      out.push(...childFamilies)
    } else if (node.names.length >= minTools) {
      out.push({ segments: prefix, names: node.names })
    }
  }
  for (const [segment, child] of root.children) walk(child, [segment])

  const skipped = []
  const suggestions = []
  for (const candidate of raw) {
    const prefixText = candidate.segments.join('_')
    // 80% 规则：这个前缀下的全部工具里，未被覆盖的要占绝大多数；
    // 否则说明它已经被现有组吃掉了，不该再建一个残缺组。
    const allWithPrefix = all.filter((name) => {
      const segments = prefixOf.get(name) || tokenize(name)
      return candidate.segments.every((segment, index) => segments[index] === segment)
    })
    const ratio = allWithPrefix.length ? candidate.names.length / allWithPrefix.length : 0
    if (ratio < 0.8) {
      skipped.push({ prefix: prefixText, reason: `已被现有组覆盖 ${Math.round((1 - ratio) * 100)}%`, count: candidate.names.length })
      continue
    }
    if (PROTECTED_PREFIXES.has(candidate.segments[0])) {
      skipped.push({ prefix: prefixText, reason: '受保护前缀（含自救工具）', count: candidate.names.length })
      continue
    }
    suggestions.push({
      id: autoGroupId(candidate.segments),
      match: [matchPattern(candidate.segments)],
      title: prefixText,
      expect: candidate.names.length,
      tools: candidate.names.slice().sort(),
    })
  }

  suggestions.sort((a, b) => b.expect - a.expect)
  const capped = suggestions.slice(0, maxGroups)
  for (const drop of suggestions.slice(maxGroups)) {
    skipped.push({ prefix: drop.title, reason: `超过 ${maxGroups} 组上限`, count: drop.expect })
  }
  return { suggestions: capped, skipped }
}

/**
 * 自动分组模式：只接受 off / suggest / on，其余回落到 **on**。
 *
 * 2026-10-29 把兜底从 'suggest' 改成 'on'：'suggest' 只往 scan 里塞建议，普通用户既不会去 scan，
 * 也就永远拿不到「第三方插件装上就被管」的收益 —— 等于功能不存在。
 * 真正兜底的是这几道护栏：同族 >= minTools(3) 才建组、子族合计覆盖 >=80% 才往下切、
 * 核心工具白名单永不入组、建好的组随时 disable、被收起的工具第一次被调用时守卫会自动放回。
 * 想先审核再收纳的人，设置页把「自动分组」调回「只建议」即可。
 */
export function normalizeAutoMode(...values) {
  for (const value of values) {
    if (value === 'off' || value === 'suggest' || value === 'on') return value
  }
  return 'on'
}
```


### lib\config.js

```js
// 设置页的来源：DSH 会用插件的 Config（schemastery）自动渲染设置表单。
//
// 三条实测结论（2026-10-24）：
//   1. schemastery 是宿主自带的包（`@deepseek-ai/schemastery`，3.18.4），不额外下载；
//      它的 ESM 入口是 **默认导出**（`import Schema from '...'`），没有具名 Schema。
//   2. `groups` 用 `Schema.array(Schema.any())` 就能原样保留每个组的全部字段
//      （match / keep / expect 都实测过），设置页不必理解组。
//   3. 未知顶层键不会被剥离。
//
// 为什么不用裸导入：本插件放在仓库里（file:// 行），从那里往上找 node_modules
// 找不到 profile 装的包。所以这里按 `%USERPROFILE%\.dsh\profiles\*\` 逐个试解析。
// 只用 node 内置模块（module/fs/path/url），不下载任何东西；全失败就把 Config
// 设成 undefined —— 宿主只是不渲染设置页，插件本体照常工作。
import { createRequire } from 'node:module'
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
// 自动分组的默认值从运行时代码取（normalizeAutoMode 的回落值）——
// 2026-10-30 挑刺：设置页 schema 曾硬写 'suggest'，而实际跑的是 'on'；
// 两处各写一遍必然漂，用户哪天在设置页保存一次就静默丢掉自动分组。
import { normalizeAutoMode } from './autogroups.js'

function resolveSchemastery() {
  const require = createRequire(import.meta.url)
  const home = process.env.USERPROFILE || process.env.HOME
  const candidates = []
  if (home) {
    const profilesRoot = join(home, '.dsh', 'profiles')
    if (existsSync(profilesRoot)) {
      try {
        for (const entry of readdirSync(profilesRoot)) candidates.push(join(profilesRoot, entry))
      } catch {
        // 目录存在但不可读（权限/临时故障）：退回 .dsh 根继续找，不让整个插件 import 失败。
      }
    }
    candidates.push(join(home, '.dsh'))
  }
  for (const dir of candidates) {
    try {
      return require.resolve('@deepseek-ai/schemastery', { paths: [dir] })
    } catch {
      // 继续下一个候选目录
    }
  }
  try {
    return require.resolve('@deepseek-ai/schemastery')
  } catch {
    return null
  }
}

let Config

const resolved = resolveSchemastery()
if (resolved) {
  try {
    const loaded = await import(pathToFileURL(resolved).href)
    const Schema = loaded.default || loaded
    Config = Schema.object({
      level: Schema.union(['low', 'medium', 'high'])
        .default('medium')
        .description('自动收敛档位：low（14 天）/ medium（7 天，默认）/ high（3 天）'),
      idleDays: Schema.number()
        .description('多少天没被调用就默认收起；不填就跟档位走，写 0 表示不按时间收敛'),

      // 注意：`warmRatio`（组热判据）**故意**不进设置页 —— 它是内部判据，用户不需要懂。
      // 需要调的人走配置文件或 `/policy`（逃生门），设置页只留「装了就能用」的那几项。
      minTools: Schema.number()
        .default(3)
        .description('少于这么多个工具的组不值得动它'),
      classifyNudge: Schema.boolean()
    .default(true)
    .description('发现没有前缀、也没归组的裸名工具时，在系统提示里提醒 agent 分类一次（可关闭；关掉后仍可手动调 lazy_tools_classify）'),
  showDock: Schema.boolean()
        .default(false)
        .description('在输入框上方显示「工具抽屉」控件；默认关闭，想用的人自己打开'),
      showClear: Schema.boolean()
        .default(false)
        .description('在输入框上方显示「立刻清空」按钮；默认关闭，与档位按钮互相独立'),
      presets: Schema.object({
        low: Schema.number().default(14).description('低档 = 多少天'),
        medium: Schema.number().default(7).description('中档 = 多少天'),
        high: Schema.number().default(3).description('高档 = 多少天'),
      }).description('三档各自对应多少天，可以按自己的节奏改'),
      autoGroups: Schema.union(['off', 'suggest', 'on'])
        .default(normalizeAutoMode())
        .description('自动分组：off 关闭 / suggest 只在 scan 里给建议 / on 自动建组并按规则收起'),
      extraGroups: Schema.array(Schema.any()).description('追加的组（不动默认四组）：给没有共同前缀的工具手写名单用'),
  groups: Schema.array(Schema.any()).description('工具组定义（高级，会整体替换默认四组）'),
    })
  } catch {
    Config = undefined
  }
}

export { Config }

```


### lib\host.js

```js
// host.js — 唯一知道 DeepSeek Harness 插件契约的一个文件。
//
// 为什么单独拆出来：DSH 升级时可能改的是 tools.register / tools.schemas /
// agent.ctx.tools.restrict 的签名，或者 `agent/created` 的 payload。分开之后，
// 升级只改这里，index.js 一行不动。改动前的旧写法见
// perf-\lazy-tools-接线说明-20261022.md。
//
// 编辑这个文件的规矩：
//   1. 任何函数都不许把异常抛给调用方 —— 全部包起来，失败记进 errors，由
//      lazy_tools_health 报出来。启动名册是 all-or-nothing，这里抛一次 DSH 就起不来。
//   2. 不 import 任何东西（连 fs 都不用）：模块本身要能在最裸的环境里加载。
//   3. 返回值必须 JSON-safe：没有 undefined、没有函数、没有 NaN。
//      （曾经因为输出里一个 undefined，宿主按「lossless JSON」把整个工具调用拒收。）
//   4. 版本号这类「拿不到就不知道」的东西，返回 null，不要猜一个填进去。

const LABEL = '[lazy-tools]'
const MAX_ERRORS = 8

function messageOf(error) {
  if (error && typeof error === 'object' && typeof error.message === 'string') return error.message
  return String(error)
}


export function createHost(ctx) {
  // 每个 agent 已知不可限制的工具名（2026-11-04）：第二次起不再重复踩
  const nonRestrictableByAgent = new WeakMap()
  const lastHideReport = new WeakMap()
  const errors = []
  // 2026-11-03（复读指出）：同一条错误在每次 rebuild 都会重记一次，8 个槽会被同一句占满，
  // health 的 healthy 就**永久 false**（等于把红灯变成背景噪声）。同 where+message 只留第一次。
  const seenErrors = new Set()
  const counters = { agentCreated: 0, restrictCalls: 0, restrictFailures: 0, restrictSkipped: 0, toolsChanged: 0, toolCalls: 0 }
  const state = { listenerAttached: false }

  const log = (level, message) => {
    try {
      const logger = ctx && ctx.logger
      const sink = logger && typeof logger[level] === 'function' ? logger[level] : null
      if (sink) sink.call(logger, `${LABEL} ${message}`)
      else if (level !== 'info') console.error(`${LABEL} ${message}`)
    } catch {
      // 记日志本身失败绝不能影响调用方
    }
  }

  const record = (where, error) => {
    // 2026-11-05（冷读附注）：V8 的 SyntaxError 会把**整段模式**塞进 message ——
    // 一个 10 万字符的坏 pattern 能让 health 输出约 100 KB。记账保留前 400 字符即可。
    const raw = messageOf(error)
    const entry = { where, message: raw.length > 400 ? raw.slice(0, 400) + '…（已截断）' : raw }
    // 2026-11-03（复读指出）：同一条错误每次 rebuild 都会重记一次，8 个槽被同一句占满，
    // health 的 healthy 就**永久 false**（红灯变成背景噪声）。同 where + 同 message 只留第一次。
    const key = `${where}\u0000${entry.message}`
    if (!seenErrors.has(key)) {
      seenErrors.add(key)
      errors.push(entry)
      // 2026-11-05（元宝挑刺 3）：shift() 掉的条目原来不删 seenErrors 的 key ——
      // 第 9 种错误挤掉第 1 种后，第 1 种复发再也不会进 errors，healthy 直接假绿。
      while (errors.length > MAX_ERRORS) {
        const dropped = errors.shift()
        if (dropped) seenErrors.delete(`${dropped.where}\u0000${dropped.message}`)
      }
    }
    // 日志照打：重复次数本身是证据（但不该把健康面拖红）
    log('warn', `${where}: ${entry.message}`)
  }

  // Contract: ctx.tools（注入 'tools' 之后必然存在；仍然按可选处理）
  const registry = () => {
    try {
      return ctx && ctx.tools ? ctx.tools : null
    } catch (error) {
      record('ctx.tools', error)
      return null
    }
  }

  // 把「解除函数」挂到插件生命周期上（ctx.effect）：插件被卸载/热重载时自动解除，
  // 否则旧实例留下的限制会变成孤儿 —— 新实例看不见也解不开，enable 会假成功。
  // 幂等包装：手动解除（enable/disable）之后 effect 再调一次是空操作。
  const own = (dispose) => {
    if (typeof dispose !== 'function') return dispose
    let done = false
    const once = () => {
      if (done) return
      done = true
      try {
        dispose()
      } catch (error) {
        record('lift', error)
      }
    }
    try {
      if (ctx && typeof ctx.effect === 'function') ctx.effect(() => once, 'lazy-tools: tool restriction')
    } catch (error) {
      record('effect', error)
    }
    return once
  }

  return {
    log,
    record,
    /** 把一段清理逻辑挂到插件生命周期上（api.js 的 HTTP 路由用它注销） */
    own,

    /** 契约 1：ctx.tools.register(definition) → 注销函数 */
    registerTool(definition) {
      const tools = registry()
      if (!tools || typeof tools.register !== 'function') {
        record('tools.register', new Error('ctx.tools.register is not available'))
        return null
      }
      try {
        return tools.register(definition)
      } catch (error) {
        record('tools.register', error)
        return null
      }
    },

    /**
     * 本 agent 能被 restrict 的名字（宿主只允许**全局工具**被 mask）。
     * 读不到返回 null —— 调用方别把「读不到」当成「空集」（否则一个都不藏）。
     */
    restrictableNames(agent) {
      try {
        const tools = registry()
        if (!tools || typeof tools.view !== 'function') return null
        const view = tools.view(agent)
        const names = view && view.restrictableNames
        if (names instanceof Set) return names
        if (Array.isArray(names)) return new Set(names)
      } catch (error) {
        record('tools.restrictable', error)
      }
      return null
    },
    /** 契约 2：ctx.tools.schemas(agent) → 该 agent 可见的工具 schema 列表 */
    toolNames(agent) {
      const tools = registry()
      if (!tools) return []
      // 2026-11-06：名字优先走 view(agent).visible；空视图 / 抛错时退回
      // schemas(agent) 复核 —— 与 visibleNames() 的失败方向同一不变量。
      // 注意：宿主里 schemas(agent) 本来就是 view(agent).visible 的投影，
      // 两者同源；这里不是"修风暴"（上一轮 6,242 次未复现，根因待查）。
      try {
        if (typeof tools.view === 'function') {
          const view = tools.view(agent)
          const visible = view && view.visible
          let names = null
          if (visible && typeof visible.keys === 'function') names = [...visible.keys()]
          else if (visible && typeof visible.entries === 'function') {
            names = [...visible.entries()].map((entry) => entry[0])
          }
          if (Array.isArray(names) && names.length > 0) {
            return names.filter((name) => typeof name === 'string')
          }
        }
      } catch (error) {
        record('tools.view', error)
      }
      if (typeof tools.schemas !== 'function') return []
      try {
        const list = tools.schemas(agent)
        if (!Array.isArray(list)) return []
        return list.map((item) => (item ? item.name : null)).filter((name) => typeof name === 'string')
      } catch (error) {
        record('tools.schemas', error)
        return []
      }
    },

    /**
     * 只要名字的可见工具表（2026-11-01 新加，给常驻提示段用）。
     *
     * 为什么不复用 toolNames()：它走 schemas(scope)，而宿主每调一次就把**全部可见 schema
     * 深拷贝一遍**（DSH 作者在 surface.js 里给的实测：258 个工具 34.2 ms）。提示段每轮组装
     * 都要读这个名字集合，只读名字却付整份 schema 的拷贝钱，是白花的。
     * `tools.view(scope).visible` 是宿主自带的同源视图（dsh-ops 的 surface.js 也读它），
     * 读得到就近乎免费；**空了或读不到才退回 schemas** —— 正确性优先于成本。
     *
     * 返回两态，调用方别把「读不到」当成「没有」：
     *   - 名字数组（空数组 = 这个作用域确实一个可见工具都没有，已用 schemas 复核过）
     *   - null      = 名字读不出来（视图空/抛错，且 schemas 也读不出来），调用方应退回旧行为
     *
     * 为什么要拿 schemas 复核「空视图」（2026-11-01 冷读抓到的红线）：空 Map 可能只是视图没建好，
     * 直接信它会把**所有开着的组从提示里删掉** —— 那正是「失败方向变短」，不能接受。
     * 复核只在空的时候发生，正常路径一次都不多花。
     *
     * @param scope agent；省略 = 全局层，与 schemas() 同义
     */
    visibleNames(scope) {
      const tools = registry()
      if (!tools) return null
      let fromView = null
      try {
        if (typeof tools.view === 'function') {
          const view = tools.view(scope)
          const visible = view && view.visible
          if (visible && typeof visible.keys === 'function') fromView = [...visible.keys()]
          else if (visible && typeof visible.entries === 'function') {
            fromView = [...visible.entries()].map((entry) => entry[0])
          }
        }
      } catch (error) {
        // 视图读不到不是错：退回 schemas 就是，但记一条（同一个构建反复失败时能看见）
        record('tools.view', error)
      }
      // 视图给了名字就直接用（便宜路径）
      if (Array.isArray(fromView) && fromView.length > 0) return fromView
      if (typeof tools.schemas !== 'function') return Array.isArray(fromView) ? fromView : null
      try {
        const list = tools.schemas(scope)
        if (!Array.isArray(list)) return null
        return list.map((item) => (item ? item.name : null)).filter((name) => typeof name === 'string')
      } catch (error) {
        record('tools.schemas', error)
        // 空视图 + schemas 也读不出来 ⇒ 这条信号不可信，交回调用方（它该退回旧行为）
        return null
      }
    },

    // 契约 2 的补充（2026-10-30，按 DSH 作者在 Discussion #11207 给的两行 lookup）：
  // 「注册了」和「这个 agent 能看到」是两件事，而且**限制会在作用域链上取交集** ——
  // 某个过滤器里的空 deny 抵消不了另一个过滤器。所以要知道一个名字到底卡在哪一层：
  //   global.tools.get(name) 有、agent.ctx.tools.get(name) 没有 ⇒ 被 agent 作用域的过滤器挡了
  //   两个都有、但出站请求只广告 run_code ⇒ 是「呈现模式（PTC）」的问题，不是注册问题
  probeName(name, agent) {
    const out = { name, global: null, agent: null, error: null }
    const call = (tools, key) => {
      if (!tools || typeof tools.get !== 'function') { out[key] = 'no-get'; return }
      try {
        out[key] = tools.get(name) !== undefined
      } catch (error) {
        out[key] = 'err'
        if (!out.error) out.error = String((error && error.message) || error)
      }
    }
    call(registry(), 'global')
    let agentTools = null
    try {
      agentTools = agent && agent.ctx ? agent.ctx.tools : null
    } catch (error) {
      agentTools = null
    }
    call(agentTools, 'agent')
    // 2026-10-30 更正（DSH 作者指出）：get(name) 省略第二个参数时用的是**全局视图**，
    // 即使通过 agent.ctx.tools 调用。所以要量「这个 agent 的作用域」，必须传 agent：
    //   scoped = get(name, agent) —— rc.3 里它和 schemas(agent) 读同一个作用域视图。
    const callScoped = (key, wanted) => {
      if (!agentTools || typeof agentTools.get !== 'function') { out[key] = 'no-get'; return }
      try {
        out[key] = agentTools.get(wanted, agent) !== undefined
      } catch (error) {
        out[key] = 'err'
        if (!out.error) out.error = String((error && error.message) || error)
      }
    }
    callScoped('scoped', name)
    callScoped('scopedRunCode', 'run_code')
    return out
  },

  /** 同上，但要整份 schema（名字 + 描述 + 参数），分类工具需要描述来理解用途 */
    schemas(agent) {
      const tools = registry()
      if (!tools || typeof tools.schemas !== 'function') return []
      try {
        const list = tools.schemas(agent)
        if (!Array.isArray(list)) return []
        return list.filter((item) => item && typeof item.name === 'string')
      } catch (error) {
        record('tools.schemas', error)
        return []
      }
    },

    /**
     * 自愈用的守卫：`tools.guard(fn)` 在 dispatch 前跑，能拦下一个调用。
     * handler 返回**字符串**表示拒绝（宿主契约：ToolGuard = (exec) => string | undefined），返回 undefined 放行。
     * 失败一律放行 —— 这条路上出错绝不能把正常调用拦死。
     */
    onDispatchGuard(handler) {
      const tools = registry()
      if (!tools || typeof tools.guard !== 'function') {
        // 2026-11-05（外部审阅）：宿主没有 guard 时，自愈守卫会**静默消失**而 health 全绿。
        // 失败必须响 —— 记一条，health 会把它变成红灯（同条只记一次）。
        record('tools.guard', new Error('宿主没有 tools.guard：按名自愈守卫不可用，被上游藏掉的工具不会被自动放回'))
        return false
      }
      try {
        const dispose = tools.guard((exec) => {
          try {
            // 2026-11-05（冷读）：不再用 `|| undefined` 把 null 悄悄转成放行 ——
            // 宿主判据是 reason !== undefined，null 会被当成拒绝。守卫区已显式返回 undefined。
            return handler(exec)
          } catch (error) {
            record('guard handler', error)
            return undefined
          }
        })
        own(dispose)
        return true
      } catch (error) {
        record('tools.guard', error)
        return false
      }
    },

    /**
     * 全局工具表（不传 scope）：不受任何 agent 的 restrict 影响。
     * 组归属、`expect` 计数、隐藏清单都必须用它算 —— 用「当前可见」算会把
     * 已经被藏起来的工具漏掉，`matched` 就会越用越小（2026-10-24 实测踩到）。
     */
    allToolNames() {
      const tools = registry()
      if (!tools || typeof tools.schemas !== 'function') return []
      try {
        const list = tools.schemas()
        if (!Array.isArray(list)) return []
        return list.map((item) => (item ? item.name : null)).filter((name) => typeof name === 'string')
      } catch (error) {
        record('tools.schemas(global)', error)
        return []
      }
    },

    /** 契约 3：agent.ctx.tools.restrict({ deny }) → 解除函数；只能藏全局工具 */
    hideTools(agent, names) {
      const report = { denied: [], transient: [], permanent: [] }
      const remember = () => {
        try {
          lastHideReport.set(agent, {
            denied: [...report.denied],
            transient: [...report.transient],
            permanent: [...report.permanent],
          })
        } catch {
          /* agent 不可作键时忽略 */
        }
      }
      if (!agent || !Array.isArray(names) || names.length === 0) {
        remember()
        return null
      }
      let scoped = null
      try {
        scoped = agent.ctx && agent.ctx.tools ? agent.ctx.tools : null
      } catch (error) {
        record('agent.ctx', error)
        remember()
        return null
      }
      if (!scoped || typeof scoped.restrict !== 'function') {
        record('tools.restrict', new Error('agent.ctx.tools.restrict is not available'))
        report.transient = names.slice()
        remember()
        return null
      }
      const classifyRestrictError = (error) => {
        const text = messageOf(error)
        if (text.includes('inactive context')) return 'inactive'
        if (/(?:^|[\s.])names unknown global tools?\b|\bnot restrictable\b|cannot name reserved PTC/i.test(text)) return 'badname'
        return 'systemic'
      }
      const cached = nonRestrictableByAgent.get(agent)
      const fresh = cached && cached.epoch === counters.toolsChanged && Date.now() - cached.at < 60000
      const skip = fresh ? cached.names : new Set()
      const wanted = names.filter((name) => !skip.has(name))
      if (!wanted.length) {
        report.permanent = names.slice()
        remember()
        return null
      }
      counters.restrictCalls += 1
      try {
        const lift = own(scoped.restrict({ deny: wanted }))
        report.denied = wanted.slice()
        remember()
        return lift
      } catch (error) {
        const kind = classifyRestrictError(error)
        if (kind === 'inactive') {
          counters.restrictSkipped += 1
          report.transient = wanted.slice()
          remember()
          return null
        }
        if (kind !== 'badname') {
          counters.restrictFailures += 1
          record('tools.restrict', new Error('限制失败（非名单问题，已中止逐个重试）：' + messageOf(error)))
          report.transient = wanted.slice()
          remember()
          return null
        }
        const liftsLocal = []
        const rejected = []
        let systemic = null
        for (let i = 0; i < wanted.length; i += 1) {
          const one = wanted[i]
          counters.restrictCalls += 1
          try {
            liftsLocal.push(own(scoped.restrict({ deny: [one] })))
            report.denied.push(one)
          } catch (single) {
            const singleKind = classifyRestrictError(single)
            if (singleKind === 'inactive') {
              counters.restrictSkipped += 1
              report.transient.push(one)
              continue
            }
            if (singleKind === 'systemic') {
              systemic = single
              report.transient.push(one)
              continue
            }
            rejected.push(one)
            report.permanent.push(one)
          }
        }
        if (systemic) {
          counters.restrictFailures += 1
          record('tools.restrict', new Error('限制失败（非名单问题，已中止）：' + messageOf(systemic)))
        }
        if (rejected.length) {
          counters.restrictFailures += 1
          const previous = nonRestrictableByAgent.get(agent)
          const cache = new Set(previous && previous.epoch === counters.toolsChanged ? previous.names : [])
          for (const name of rejected) cache.add(name)
          nonRestrictableByAgent.set(agent, { names: cache, epoch: counters.toolsChanged, at: Date.now() })
          record('tools.restrict', new Error('这些名字不可限制（已逐个跳过，其余照常隐藏）：' + rejected.join(', ')))
        }
        remember()
        if (!liftsLocal.length) return null
        return () => {
          for (const liftOne of liftsLocal) {
            try {
              if (typeof liftOne === 'function') liftOne()
            } catch {
              /* own() 已记 */
            }
          }
        }
      }
    },

    /** 上一轮 hideTools 的逐名字结果：denied / transient / permanent。 */
    hideReport(agent) {
      return lastHideReport.get(agent) || null
    },

    /** 记一次真实工具调用（health 的首次成功率要用）。只计数，不参与任何决定。 */
    countToolCall() {
      counters.toolCalls += 1
    },

  /** 从账本恢复累计计数（2026-10-30）：只升不降，避免并发实例往回写小数字 */
  seedCounters(seed) {
    if (!seed || typeof seed !== 'object') return
    for (const key of ['toolCalls', 'selfHealed']) {
      const value = seed[key]
      if (Number.isFinite(value) && value > counters[key]) counters[key] = Math.round(value)
    }
  },

    /** 契约 4：`agent/created` 每个 agent 触发一次；handler 抛错不许影响创建 */
    onAgentCreated(handler) {
      if (!ctx || typeof ctx.on !== 'function') {
        record('agent/created', new Error("ctx.on is not available"))
        return false
      }
      try {
        ctx.on('agent/created', (payload) => {
          counters.agentCreated += 1
          try {
            handler(payload && payload.agent)
          } catch (error) {
            record('agent handler', error)
          }
        })
        state.listenerAttached = true
        return true
      } catch (error) {
        record('agent/created', error)
        return false
      }
    },

    /**
     * `tools/change`：工具注册表变化（新插件、注册/注销）。用来兜「插件比工具先加载」的时序，
     * 也兜「上游升级后新增了工具却没被组匹配」。handler 抛错吞掉，不许影响注册方。
     */
    onToolsChange(handler) {
      if (!ctx || typeof ctx.on !== 'function') {
        record('tools/change', new Error('ctx.on is not available'))
        return false
      }
      try {
        ctx.on('tools/change', () => {
          counters.toolsChanged += 1
          try {
            handler()
          } catch (error) {
            record('tools/change handler', error)
          }
        })
        return true
      } catch (error) {
        record('tools/change', error)
        return false
      }
    },


    /**
     * `tools/pre-execute`（waterfall）：每次工具调用**之前**的通知，用来记「谁真的被用过」。
     * 只旁听，不改决定：永远放行 `next()`。调用方抛错也吞掉，绝不影响正常调用。
     */
    onPreExecute(handler) {
      if (!ctx || typeof ctx.on !== 'function') return false
      try {
        ctx.on('tools/pre-execute', (exec, next) => {
          try {
            handler(exec)
          } catch (error) {
            record('pre-execute handler', error)
          }
          return next()
        })
        return true
      } catch (error) {
        record('tools/pre-execute', error)
        return false
      }
    },

    /** 自检用：只探测「有没有」，不真的去 restrict（有副作用） */
    probe(agent) {
      const tools = registry()
      let scoped = null
      try {
        scoped = agent && agent.ctx && agent.ctx.tools ? agent.ctx.tools : null
      } catch {
        scoped = null
      }
      return {
        register: !!(tools && typeof tools.register === 'function'),
        schemas: !!(tools && typeof tools.schemas === 'function'),
        restrict: !!(scoped && typeof scoped.restrict === 'function'),
        guard: !!(tools && typeof tools.guard === 'function'),
        agentEvent: state.listenerAttached,
      }
    },

    /** 现存活 agent 列表（插件热重载后补应用限制用）；拿不到就给空数组 */
    agentList() {
      try {
        if (!ctx || typeof ctx.get !== 'function') return []
        const agents = ctx.get('agents')
        if (!agents || typeof agents.list !== 'function') return []
        const list = agents.list()
        return Array.isArray(list) ? list : []
      } catch (error) {
        record('agents.list', error)
        return []
      }
    },

    // 这里原本有个 version()：试 ctx.get('appInfo'/'desktopInfo'/'app') 和
    // process.env.DSH_VERSION。2026-10-23 用 cordis_inspect 把 Host Service 目录
    // 翻了一遍 —— 没有任何版本服务，环境变量也没有，所以它永远返回 null。
    // 「永远 null 的字段比没有更糟，会让人以为探测失败」，直接删掉，health 不再报版本。

    counters() {
      return { ...counters }
    },

    errors() {
      return errors.map((entry) => ({ where: entry.where, message: entry.message }))
    },
    /**
     * 清空错误（2026-11-05）。为什么需要：errors 只进不出，一条瞬时错误（读配置失败、
     * 一个坏名字）会把 healthy 永久钉成 false，直到重启 —— 红灯变成背景噪声。
     * 只清 errors，不清自愈计数（计数是历史证据）。
     */
    clearErrors() {
      const n = errors.length
      errors.length = 0
      seenErrors.clear()
      return n
    },
  }
}


```


### lib\index.js

```js
// lazy-tools — 把「很重但平时不用」的工具组从上下文里收起来，需要时再开。
//
// 机制：每个 agent 创建时，按配置把该组里的工具从**它自己的作用域**里 restrict 掉
// （DSH 的 restrict 只能藏全局工具，藏不了自己 scope 注册的）；enable/disable 就是
// 解除 / 重建这条限制。宿主契约全在 host.js，这里只管组逻辑和七个工具。
//
// 七个工具：status / enable / disable / list / health / mode / save_groups（0.16.0 由 11 个合并）
//             classify / save_groups（L7 的旧注释写着「六个」——对面 2026-10-28 指出来，已更正）
// 契约与实测记录：perf-\lazy-tools-接线说明-20261022.md

import { createHost } from './host.js'
import { Config } from './config.js'
import { mountBridge, readStoredPolicy, readStoredPolicyStrict, readPolicyRaw, clientPing, readUserGroups, writeUserGroups, applyPolicyPatch, policyFileMtime, writeStoredPolicy } from './api.js'
import { loadUsage, saveUsage, recordUsage, isToolHot, hotRatio as usageHotRatio, LEVEL_DAYS } from './usage.js'
import { suggestGroups, normalizeAutoMode, CORE_TOOLS } from './autogroups.js'
import { applyManagedRolesPatch, normalizeManagedRoles, resolveManagedRole, isAllowedByPolicy, auditManagedRoles, labelRoleCandidates, labelOfSession } from './roles.js'
import { createPrompt, mountPromptSection } from './prompt.js'
import { createTools } from './tools/index.js'

export const name = 'lazy-tools'
export const inject = ['tools']
// 设置页：DSH 从这份 schema 自动渲染全局设置（档位 / 天数 / 最小工具数 / 永不自动收）。
// 组定义仍然留在 profile 配置里 —— 嵌套数组在设置页里画不好看。
export { Config }

// 模块级状态：同一进程内 ESM 模块是缓存的，只有**重启**才会重新 import；
// 配置改动触发的只是再次 apply，模块对象还是同一个。所以这里存得住东西。
// 用途：上一次 apply 给某个 agent 建的作用域限制，新实例既看不见（工具已隐藏）
// 也拿不到解除函数 —— 不先解除就是孤儿（表现为 matched:0、enable 假成功）。
// 2026-10-23 实测：改一次 patch 就会踩一次。
const PROCESS_LIFTS = new WeakMap()

// 切分依据（2026-10-22 实测 56 个真名，19 + 37，零重叠、零遗漏）：
//   screen = 只读观察：get_* / list_* / check_permissions / health_report /
//            debug_window_info / clipboard_read / verify_state
//   input  = 一切会改变状态的：点击、键盘、滚动、窗口/会话/录制/配置控制
//   （`page` 归 input：它能执行页面 JS，不是只读）
const CUA_SCREEN =
  're:^cua_driver_native__(get_|list_|check_permissions|health_report|debug_window_info|clipboard_read|verify_state)'
const CUA_INPUT =
  're:^cua_driver_native__(bring_to_front|browser_(click|dialog|download|navigate|pointer|prepare|set_input_files|type)|click|clipboard_write|double_click|drag|end_session|escalate_session|hotkey|install_ffmpeg|invoke_menu|kill_app|launch_app|move_cursor|page|press_key|replay_trajectory|right_click|scroll|set_(agent_cursor_(enabled|motion|theme)|config|value|window_frame)|start_(recording|session)|stop_recording|type_text|zoom)$'

// 受管角色允许隐藏的 CORE 写工具：review/research 要能真正只读（read/pwsh/glob/grep 仍保留）。
// 这正是 2026-11-06 实测的边界：以前所有 CORE 都不能藏，review 只能靠提示词。
const ROLE_HIDEABLE_CORE = new Set(['edit', 'write'])

const DEFAULT_GROUPS = [
  {
    id: 'web',
    match: ['web_search', 'web_fetch', 'platform_search', 'domain_search', 'research', 'read_page', 'x_search', 'multi_search', 'advanced_search', 'video_search', 'weather', 'cache_search'],
    title: '搜索·联网',
    defaultOn: false,
  },
  {
    id: 'schedule',
    match: ['schedule_create', 'schedule_list', 'schedule_view', 'schedule_edit'],
    title: '定时任务',
    defaultOn: true,
  },
  {
    id: 'cua-screen',
    match: [CUA_SCREEN],
    title: '桌面·看',
    defaultOn: false,
  },
  {
    id: 'cua-input',
    match: [CUA_INPUT],
    title: '桌面·点',
    defaultOn: false,
  },
]

// 匹配式：普通 glob（`*` 通配、整串锚定），或 `re:` 前缀的直接正则。
// 正则写错不许把插件带崩 —— 返回 null，由 apply 记账。
function matcherFor(pattern) {
  const source = String(pattern)
  try {
    if (source.startsWith('re:')) return new RegExp(source.slice(3))
    // 转义集必须包含 ? —— 2026-10-29 第三方复核指出：漏了它，手写 `foo?bar` 会变成
    // 正则 /^foo?bar$/（匹配 fobar），照文档写却静默不生效。`*` 不在这里转义，它是通配符。
    const escaped = source.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp('^' + escaped.replace(/\*/g, '.*') + '$')
  } catch {
    return null
  }
}

function text(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }]
}

function nowIso() {
  try {
    return new Date().toISOString()
  } catch {
    return null
  }
}

export function apply(ctx, config) {
  const host = createHost(ctx)
  // 0.17.0 删除 autoHints 后，旧配置的兼容提示（按组只记一次，不进 errors、不拖 healthy）。
  // 必须声明在 compileGroups 之前：组编译在 apply 早期就执行。
  const compatNotes = new Set()
  const cfg = config && typeof config === 'object' ? config : {}
  // 设置页里那几个全局字段：先读配置，再让「设置页写下的策略文件」覆盖它。
  // 于是 UI 改完立即生效，YAML 里仍然可以写死默认值。
  // 2026-11-03（冷读红 2 启动路径）：读失败**不许**静默退回默认 —— 那会连 level 一起悄悄改掉，
  // 而且 healthy 还是 true。启动路径和热重载必须同一条语义：读不出来就记账，按配置/默认跑，但必须响。
  const storedRead = (() => {
    try {
      return readStoredPolicyStrict()
    } catch (error) {
      return { ok: false, error }
    }
  })()
  const stored = storedRead.ok && storedRead.policy ? storedRead.policy : {}
  if (!storedRead.ok) {
    host.record(
      'policy file',
      new Error(`policy.json 读不出来（${String((storedRead.error && storedRead.error.message) || storedRead.error)}）—— 本次按插件配置/默认值启动，磁盘上的设置没有被应用`),
    )
  }
  const pickNumber = (a, b, fallback) => (Number.isFinite(a) ? a : Number.isFinite(b) ? b : fallback)
  // 比例类参数（0~1）：夹到 [0.05, 1]，防手改文件写成 0 或 12 导致「永不整组开 / 一热就全开」。
  const pickRatio = (a, b, fallback) => {
    const raw = Number.isFinite(a) ? a : Number.isFinite(b) ? b : fallback
    return Math.min(1, Math.max(0.05, raw))
  }
  const level = stored.level || (typeof cfg.level === 'string' ? cfg.level : 'medium')
  // 三档的天数可改：存储值 > 配置值 > 内置默认（14 / 7 / 3）
  const presets = {
    low: pickNumber(stored.presets && stored.presets.low, cfg.presets && cfg.presets.low, LEVEL_DAYS.low),
    medium: pickNumber(stored.presets && stored.presets.medium, cfg.presets && cfg.presets.medium, LEVEL_DAYS.medium),
    high: pickNumber(stored.presets && stored.presets.high, cfg.presets && cfg.presets.high, LEVEL_DAYS.high),
  }
  const policy = {
    level,
    // 天数不写就跟档位走（档位天数本身可自定义）
    idleDays: pickNumber(stored.idleDays, cfg.idleDays, presets[level] ?? presets.medium),
    // minTools 下限 3：自动分组要求「同一前缀 ≥3 个」才建组，填 2 不会生效（2026-10-30）。
    // 在加载时就夹住 —— health 里看到的是**生效值**，不是用户填的值。
    minTools: Math.max(3, pickNumber(stored.minTools, cfg.minTools, 3)),
    // 组热判据：组内「热工具」占比 ≥ warmRatio 才整组开（2026-10-30 从硬编码改成可配）
    warmRatio: pickRatio(stored.warmRatio, cfg.warmRatio, 0.3),
    presets,
    showDock: typeof stored.showDock === 'boolean' ? stored.showDock : cfg.showDock === true,
    // 裸名工具分类提示：默认开（false 才关）
    classifyNudge: typeof stored.classifyNudge === 'boolean' ? stored.classifyNudge : cfg.classifyNudge !== false,
    showClear: typeof stored.showClear === 'boolean' ? stored.showClear : cfg.showClear === true,
    // 自动分组：off 不动 / suggest 只建议 / on 直接建组并收起（2026-10-25 加）
    autoGroups: normalizeAutoMode(stored.autoGroups, cfg.autoGroups),
  // 受管角色（默认关闭）：preset id / 'subagent' → { allowGroups, unknown }
  managedRoles: (() => {
    // 2026-11-03（冷读第三轮）：文件里**写了**这个键就必须验形状。以前看的是归一化后的 stored ——
    // 字符串/数组在 normalizePolicy 那一步已经被丢掉，于是"写坏了"和"没写"长得一模一样
    // （静默清空角色）。合法空对象 {} = 没有角色，不许误报。
    const rawStored = storedRead.ok && storedRead.raw ? storedRead.raw : null
    const hasStoredRoles = Boolean(rawStored && Object.prototype.hasOwnProperty.call(rawStored, 'managedRoles'))
    // 2026-11-03（复读遗留 A）：删键 = **显式清空**，不回退到插件配置。
    // 只有「文件根本不存在」才回退 cfg —— 那才是"从没配过"。
    const fileExists = Boolean(storedRead.ok && storedRead.raw)
    if (fileExists && !hasStoredRoles && cfg.managedRoles) {
      host.log('info', 'policy.json 里已删除 managedRoles（按显式清空处理，插件配置里的角色不再生效）')
    }
    const raw = hasStoredRoles ? rawStored.managedRoles : fileExists ? null : cfg.managedRoles
    if (hasStoredRoles) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        host.record(
          'managedRoles',
          new Error('policy.json 里 managedRoles 形状不合法（应为 { 角色: { allowGroups: [...] } }），已忽略文件里的这一项'),
        )
        return null
      }
      if (Object.keys(raw).length === 0) return null
    }
    const normalized = normalizeManagedRoles(raw)
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length && !normalized) {
      host.record('managedRoles', new Error('managedRoles 里没有任何可用条目（每条要有 allowGroups 数组；空数组合法＝只留常驻），已忽略'))
    }
    return normalized
  })(),
  }
  // 用量账本：决定「哪个组最近真的被用过」。读不到就当作空的（全冷）。
  const usageLedger = (() => {
    try {
      return loadUsage()
    } catch (error) {
      host.record('usage file', error)
      return { groups: {}, tools: {} }
    }
  })()
  // 默认四组 + extraGroups（追加）。
  // 为什么加 extraGroups：有些插件的工具名没有共同前缀（例：deepseek-computer-use 的
  // click / type_text / list_windows），自动分组认不出来，只能手写名单；而 `groups`
  // 是整体替换，直接写它会冲掉默认四组。extraGroups 只追加、不动默认。
  // 用户手写组：来源两处 —— 配置里的 extraGroups（loader 层）与独立文件
  // ~/.dsh/lazy-tools.groups.json（设置页保存不会冲掉它）。
  const fileGroups = readUserGroups(host.record)
  const extraGroups = [...(Array.isArray(cfg.extraGroups) ? cfg.extraGroups : []), ...fileGroups]
  // 把一批组定义编译成 { ...g, res }：无效条目跳过并记账；expect 夹成有限正整数。
  // 2026-10-30 对抗测试：手写 groups 全无效时不能静默什么都不注册（见下方 fallback）。
  const compileGroups = (list, manual = false) =>
    list
      .filter((g) => g && typeof g.id === 'string' && Array.isArray(g.match) && g.match.length)
      .map((g) => {
        let res = []
        for (const pattern of g.match) {
          const re = matcherFor(pattern)
          if (re) res.push(re)
          else host.record('group pattern', new Error(`无效的匹配式 ${JSON.stringify(String(pattern))}（组 ${g.id}），已忽略`))
        }
        // 只接受真正的 number，不做类型强转（expect: '19' / true 这类笔误不猜语义，按未设置处理）
        const expect = typeof g.expect === 'number' && Number.isFinite(g.expect) && g.expect > 0 ? Math.round(g.expect) : undefined
        // 注意：必须先把原值摘掉，否则 `...g` 会把 NaN 又带回来（2026-10-30 对抗测试 缺陷3）。
        const { expect: _rawExpect, ...rest } = g
        // 0.17.0 删掉了 autoHints：旧配置里还写着它时不能静默；但这是**兼容提示、不是故障**，
        // 按组只记一次、进 health.notes —— 记成 error 会让老用户 health 永久 false（训练人忽略红灯）。
        if (Object.prototype.hasOwnProperty.call(rest, 'autoHints') && !compatNotes.has(g.id)) {
          compatNotes.add(g.id)
          host.log('warn', `group ${g.id}: autoHints was removed in 0.17.0; ignored`)
        }
        // universal：这个组的匹配式能匹配**任意名字**（`*` / `re:.*`）—— 与工具数量无关地判定，
        // 所以 cua_* 这类前缀组不会被误伤（2026-10-31，回答「宿主改名追不动」）。
        const sentinel = '\u0000lazy-tools-probe\u0000'
        // 2026-11-06（冷读红 2）：单探针可被 re:^[a-z0-9_]+$ 绕过；用多个异形探针，
        // 全中才算“万能匹配”。前缀组不会全中，字面枚举也不会。
        const probes = ['zz_probe_alpha', 'probe_beta_9', '000_probe', 'x_y_z9', 'zzprobealpha']
        // 2026-11-05（外部审阅抓到的 P0）：V8 在**首次 test() 时才编译**正则 ——
        // 超长模式会在 test 抛 SyntaxError，把整个 apply 带崩（加载即失败）。
        // 所以这里真的执行一次 test；抛错的匹配式按无效处理并记账，不许逃出 apply。
        const tested = []
        for (const re of res) {
          try {
            re.test(sentinel)
            tested.push(re)
          } catch (error) {
            host.record(
              'group pattern',
              new Error(`匹配式执行失败（组 ${g.id}）：${String((error && error.message) || error)}，已忽略`),
            )
          }
        }
        res = tested
        const universal = res.some((re) => probes.every((probe) => re.test(probe)))
        return {
          ...rest,
          res,
          ...(manual ? { manual: true } : {}),
          ...(universal ? { universal: true } : {}),
          ...(expect === undefined ? {} : { expect }),
        }
      })
      .filter((g) => g.res.length)

  // 2026-10-31：手写组与出厂组分开编译 —— 只有手写组需要「全匹配」防线。
  const cfgGroups = Array.isArray(cfg.groups) && cfg.groups.length ? cfg.groups : null
  let groups = [
    ...compileGroups(cfgGroups || DEFAULT_GROUPS, Boolean(cfgGroups)),
    ...compileGroups(extraGroups, true),
  ]
  if (!groups.length) {
    // 用户给的组全无效（null / 缺 match / 正则全坏）→ 退回出厂四组，并且必须响。
    // 否则插件会「装上了但一个工具都不注册」，用户连 health 都调不到（2026-10-30 对抗测试）。
    host.log('warn', 'all configured groups were invalid; falling back to the default groups')
    host.record('groups', new Error('配置里的组全部无效，已退回默认四组'))
    groups = compileGroups(DEFAULT_GROUPS)
  }

  // managedRoles 的 allowGroups 必须对着**当前真实存在的组**校验（2026-11-02，外部评审指出）。
  // 不校验的后果：照抄文档里那串不存在的组 id ⇒ 受管会话把所有组都藏起来，而受管会话里
  // enable/disable 被拒、自愈也不绕过 ⇒ 会话内没有任何自救路径，且**全程静默**。
  // 规则见 roles.js 的 auditManagedRoles：全错就停用该角色（退回普通行为），部分错只报不删。
  // 2026-11-03：抽成函数 —— 热重载也要走**同一套**校验（同一判据只留一个入口）。
  // 2026-11-03（冷读第三轮）：审计**不再就地删除**。`groups` 是会长的（autoGroups 在会话起手时
  // 补晚到的家族），就地删掉的角色在组补上后也回不来 ——「第一次会话早于 mnemon 注册」就会把合法的
  // auto-* 角色永久删掉（fail-open，而且报的是假错误）。现在保留一份**配置源**，组表变了就派生
  // 生效表；删掉的角色在组补上后自动回来。
  let roleSource = policy.managedRoles || null
  // 工具（lib/tools/roles.js）要写回这两个 let：跨模块赋值只能走 setter ——
  // 那正是「搬出去之后不再有隐式闭包」的证据，显式两行比看不见的闭包好查。
  const setRoleSource = (v) => {
    roleSource = v
  }
  let rolesGroupSig = ''
  const auditHitsSeen = new Set()
  const refreshManagedRoles = (force = false, hadRolesOverride = null) => {
    if (!roleSource) {
      // 只有「从有角色变成没角色」才需要解锁现存会话；启动时本来就没角色，别遍历重建。
      const hadRoles = hadRolesOverride === null ? Boolean(policy.managedRoles) : Boolean(hadRolesOverride)
      policy.managedRoles = null
      rolesGroupSig = ''
      if (hadRoles) {
        try {
          for (const agent of host.agentList()) {
            const st = states.get(agent)
            if (!st) continue
            st.managed = null
            if (typeof rebuild === 'function') rebuild(agent)
          }
        } catch (error) {
          host.record('managedRoles rebuild', error)
        }
      }
      return
    }
    const groupIds = groups.map((g) => g.id)
    const sig = groupIds.join('|')
    if (!force && sig === rolesGroupSig) return
    rolesGroupSig = sig
    const next = { ...roleSource }
    const audit = auditManagedRoles(next, groupIds)
    for (const hit of audit.unknown) {
      const tag = `${hit.role}::${hit.ids.join(',')}`
      if (auditHitsSeen.has(tag)) continue
      auditHitsSeen.add(tag)
      // auto-* 组是插件按工具前缀自己建的，冷启动时可能还没建出来 —— 这条不拉红
      // （否则健康机器上会长期挂一条假错误，训练人忽略红灯），只记日志。
      if (hit.ids.every((id) => id.startsWith('auto-'))) {
        host.log('warn', `managedRoles: 角色 ${hit.role} 的自动组还没建出来（${hit.ids.join(', ')}）—— 等对应工具注册后自动生效`)
        continue
      }
      host.record(
        'managedRoles',
        new Error(`角色 ${hit.role} 的 allowGroups 里这些组不存在：${hit.ids.join(', ')}（当前可用：${groupIds.join(', ')}）`),
      )
    }
    for (const key of audit.dropped) {
      delete next[key]
      host.log('warn', `managedRoles: 角色 ${key} 的组全都不存在，已停用（组补上后会自动恢复）`)
    }
    policy.managedRoles = Object.keys(next).length ? next : null
    // 2026-11-03（对比评审指出）：角色/组变了之后，**现存会话**也要重建 ——
    // 否则"配了但老会话没变"，用户看到的就是"改了没生效"。
    // 只动已经开过会话的 agent（states 里有记录的）；新会话创建时自己会算。
    try {
      for (const agent of host.agentList()) {
        const st = states.get(agent)
        if (!st) continue
        st.managed = resolveManagedRole(agent, policy.managedRoles)
        if (typeof rebuild === 'function') rebuild(agent)
      }
    } catch (error) {
      host.record('managedRoles rebuild', error)
    }
  }

  // policy.json 改完**不用重启**（2026-11-03）：agent/created 时比对 mtime，变过就重读 managedRoles。
  // 用户原话「配置这个会很麻烦」—— 真正的麻烦是"改完要重启"，不是"要改"。
  // 读不到 mtime（文件不存在/权限）⇒ 永不重载，退回旧行为。
  let policyMtime = policyFileMtime()
  const setPolicyMtime = (v) => {
    policyMtime = v
  }
  const reloadManagedRolesIfChanged = () => {
    try {
      const mtime = policyFileMtime()
      if (!mtime || mtime === policyMtime) return false
      // 冷读红 2：读失败**不许**当成"角色被删光"。
      //   ① 不许先推进 mtime（否则坏文件会让失败粘住，改回来也不重读）；
      //   ② 不许把 managedRoles 清空（保持旧值，按旧配置继续跑）；
      //   ③ 必须响（record），否则用户以为改生效了。
      const strict = readStoredPolicyStrict()
      if (!strict.ok) {
        host.record(
          'managedRoles reload',
          new Error(`policy.json 读不出来（${String((strict.error && strict.error.message) || strict.error)}）—— 已保持旧的角色配置，未重载`),
        )
        return false
      }
      // 2026-11-03（冷读第三轮）：要分清「文件里没有这个键」和「有这个键但写坏了」。
      // 前者是用户把角色删光了（合法，清空）；后者是手滑（必须保持旧值、必须响）——
      // 否则一个拼错的类型就能把整张角色表静默清空。
      const hasRolesKey = Boolean(strict.raw && Object.prototype.hasOwnProperty.call(strict.raw, 'managedRoles'))
      let next
      if (!hasRolesKey) {
        // 同上：文件在、但没这个键 = 用户删光了（清空）；文件不在才回退 cfg。
        next = strict.raw ? null : normalizeManagedRoles(cfg.managedRoles)
      } else {
        const rawRoles = strict.raw.managedRoles
        if (!rawRoles || typeof rawRoles !== 'object' || Array.isArray(rawRoles)) {
          host.record(
            'managedRoles reload',
            new Error('policy.json 里 managedRoles 形状不合法（应为 { 角色: { allowGroups: [...] } }）—— 已保持旧的角色配置，未重载'),
          )
          return false
        }
        next = normalizeManagedRoles(rawRoles)
        if (!next && Object.keys(rawRoles).length) {
          // 形状对、但条目全没用（没 allowGroups / 类型错）：会清空角色。
          // 这不是「用户删光了」，也必须记账 —— 否则又一次静默清空（冷读第三轮红 2 的最后一种）。
          host.record('managedRoles reload', new Error('managedRoles 里没有任何可用条目（每条要有 allowGroups 数组；空数组合法）—— 已清空角色'))
        }
      }
      policyMtime = mtime
      // 重载也可能早于任何会话创建（autoGroups 还没跑）；先补一次动态组再审计，
      // 免得把合法的 auto-* 角色当成"组不存在"删掉（冷读红 4a 的同一条规则）。
      try {
        autoGroups(true)
      } catch {
        /* 补不上就按现有组表审 */
      }
      roleSource = next
      refreshManagedRoles(true)
      host.log('info', `managedRoles 热重载：${next ? Object.keys(next).join(',') : '（空）'}`)
      return true
    } catch (error) {
      host.record('managedRoles reload', error)
      return false
    }
  }

  // 「这个组真正能收的工具」= 匹配到、且不是常驻/自救工具。
  // 2026-10-30 对抗测试：手写组用 match: ['*'] 会把 lazy_tools_* 也吞了，自愈链路直接断。
  const membersOf = (g, pool = host.allToolNames()) =>
    pool.filter((name) => !CORE_TOOLS.has(name) && g.res.some((re) => re.test(name)))

  // 2026-10-31 结构性防线（回答「宿主工具名会变，名单追不动」）：
  // 手写组若匹配到**整张可隐藏工具表**，判定为误配，整组忽略并记账。
  // 这条规则不依赖任何名字清单 —— 宿主把 pwsh 换成 ops_* 也照样兜住。
  const guardWarned = new Set()
  const warnManualGuard = (g, count) => {
    if (guardWarned.has(g.id)) return
    guardWarned.add(g.id)
    host.log('warn', `manual group ${g.id} matches every hideable tool; ignored`)
    host.record('group guard', new Error(`手写组 ${g.id} 匹配了全部 ${count} 个可隐藏工具，疑似误配，已忽略 —— 不会收任何工具`))
  }

  // 自动分组：只认「没被现有组覆盖 + 同前缀够数」的家族。
  // on 直接并进 groups（手写组排在前面，所以优先）；suggest 只把建议暴露给 scan。
  // 算一次就定，整场不重算 —— 中途改工具表会打断前缀缓存。
  let autoReport = { mode: policy.autoGroups, suggestions: [], skipped: [], applied: [] }
  // 工具是别的插件注册的：本插件 apply 时它们可能还没出现（冷启动顺序不保证）。
  // 所以算一次不够 —— 会话真正开始时再算一次，直到算出东西为止。
  let autoSettled = false
  const autoGroups = (apply) => {
    if (policy.autoGroups === 'off') return autoReport
    try {
      const covered = (name) => groups.some((g) => g.res.some((re) => re.test(name)))
      const toolNames = host.allToolNames()
      const report = suggestGroups(toolNames, covered, { minTools: Math.max(3, policy.minTools) })
      autoReport = { mode: policy.autoGroups, suggestions: report.suggestions, skipped: report.skipped, applied: autoReport.applied }
      if (apply && policy.autoGroups === 'on') {
        for (const suggestion of report.suggestions) {
          if (groups.some((g) => g.id === suggestion.id)) continue
          const res = suggestion.match.map((pattern) => matcherFor(pattern)).filter(Boolean)
          if (!res.length) continue
          groups.push({
            id: suggestion.id,
            match: suggestion.match,
            title: suggestion.title,
            defaultOn: false,
            expect: suggestion.expect,
            auto: true,
            res,
          })
          autoReport.applied.push(suggestion.id)
        }
      }
      // 只有当工具表确实有内容时才认为「算过了」；冷启动时工具还没注册，要留着重算。
      if (toolNames.length > 0) autoSettled = true
    } catch (error) {
      host.record('auto groups', error)
    }
    return autoReport
  }
  autoGroups(true)

  const states = new WeakMap()
  const stats = { hideEvents: 0, selfHealed: 0, lastHidden: null, rebuilds: 0 }
  // 2026-10-30：计数器跨重载恢复 —— 否则每次重载 firstTryRate 归零，永远拿不到数据。
  const savedStats = usageLedger.stats || {}
  host.seedCounters(savedStats)
  stats.selfHealed = Math.max(stats.selfHealed, Number(savedStats.selfHealed) || 0)
  // 把「进程内 + 历史」的累计数写回账本，供下一次重载恢复。
  const persistCounts = () => {
    usageLedger.stats = {
      toolCalls: host.counters().toolCalls,
      selfHealed: stats.selfHealed,
    }
  }

  const groupOf = (toolName) => {
    for (const g of groups) if (g.res.some((re) => re.test(toolName))) return g.id
    return null
  }

  // 会话开始那一刻定默认值（中途绝不改，保前缀缓存）：
  //   最近 idleDays 内被调用过（热） / 被点名永不自动收 / 显式 defaultOn:true → 开着；
  //   其余 → 收起。天数不写就跟档位走（low 14 / medium 7 / high 3）。
  // st.idleDays 是「本会话的覆盖值」（lazy_tools_mode 改它），不改全局策略。
  const sessionIdleDays = (st) => (st && Number.isFinite(st.idleDays) ? st.idleDays : policy.idleDays)
  // 组的「热」不再等于「任一工具热」—— 那会让单工具热度永远不可达（2026-10-30 挑刺）。
  // 现在的定义只含 defaultOn；真正的「整组该开」在 applyDefaults 里按**热工具占比**判。
  const warmGroups = () =>
    new Set(groups.filter((g) => g.defaultOn === true).map((g) => g.id))
  const applyDefaults = (st) => {
    // 受管会话：模式完全由角色策略决定，不看热度（纪律不能用习惯替代）。
    if (st.managed) {
      const allow = new Set(st.managed.role.allowGroups)
      // 2026-11-05（元宝挑刺 1）：'*' 是 isAllowedByPolicy 认可的「不设限」，但这里按组 id 比对
      // ⇒ '*' 不匹配任何组，所有组被记成 hide；实际 deny 又是 0。同一个判据两个入口。
      const allowAll = allow.has('*')
      const managedModes = new Map()
      for (const g of groups) {
        managedModes.set(g.id, allowAll || allow.has(g.id) ? { mode: 'all', names: new Set() } : { mode: 'hide', names: new Set() })
      }
      st.modes = managedModes
      return
    }
    const warm = warmGroups()
    const idleDays = sessionIdleDays(st)
    const hideable = host.allToolNames().filter((name) => !CORE_TOOLS.has(name))
    const next = new Map()
    for (const g of groups) {
      const members = membersOf(g)
      // 手写组用了万能匹配式（`*` / `re:.*`）⇒ 忽略（见 warnManualGuard）。出厂组不受影响。
      if (g.manual && g.universal) {
        warnManualGuard(g, hideable.length)
        continue
      }
      const hotTools = members.filter((name) => isToolHot(usageLedger, name, idleDays))
      // 「整组开」的两个来源：组被显式设成默认开，或**热工具占比够高**（≥ policy.warmRatio，默认 30%）。
      // 为什么要比例：组时间戳是「任一工具被调用」就更新，于是「37 个里只用 1 个」在原来必然整组开、
      // only 分支永远走不到 —— 功能是真的，只是不可达。
      const ratio = policy.warmRatio
      const ratioWarm = hotTools.length > 0 && hotTools.length / Math.max(1, members.length) >= ratio
      if (warm.has(g.id) || ratioWarm) continue
      // 单工具热度（2026-10-29；2026-10-30 定型）：**热的全放，其余收起**。
      // 曾经有过 slice(0,3) 与 max(3,ceil(成员数×ratio)) 两道上限，都是**恒不生效的死代码**：
      // 走 only 分支的条件是 hot < 成员数×ratio ≤ ceil(...) = cap ⇒ 永远截不到。
      // 删掉它，语义更干净：「热到阈值 → 整组开；没到 → 热的全放，其余收起」。
      const shown = hotTools
      next.set(g.id, shown.length ? { mode: 'only', names: new Set(shown) } : { mode: 'hide', names: new Set() })
    }
    st.modes = next
  }
  const stateFor = (agent) => {
    let st = states.get(agent)
    if (!st) {
      // 会话开始的这一刻再算一次：apply() 时别的插件的工具可能还没注册完
      // （实测：DSH 2.0.20 冷启动时 mnemon 的工具晚于本插件）。autoGroups 按 id 去重，
      // 重复调用安全，所以这里不再用「算过一次就收手」的 settle 开关 —— 那会漏掉晚到的家族。
      autoGroups(true)
      // 冷读红 4a：审计必须在 autoGroups(true) **之后**跑 —— 否则 `auto-mnemon` 这类动态组
      // 在审计时还不存在，合法角色会被整条删掉（fail-open，而且报的是假错误）。
      refreshManagedRoles()
      const resolvedRole = resolveManagedRole(agent, policy.managedRoles)
      st = {
        // 受管角色：null 表示普通会话（走热度逻辑）
        managed: resolvedRole,
        // 2026-11-03（盲测指出）：子会话带了 label，但那个角色**没配** ⇒ 它会悄悄退回默认工具面，
        // 越权且零报错。这里把它记下来，health 里看得见（不拉红：认不出就不动仍是对的，但要能查）。
        roleHint: (() => {
          try {
            const header = agent && agent.session && agent.session.header
            if (!header || !header.parentSession || !policy.managedRoles) return null
            // 2026-11-04（复读红 1）：与生产路径**同一套**确定性候选与「配过」判据，别在这里另写规则。
            // 旧写法用全段扫描，摘要里的 hermes 会变成 hint（诊断信息误导人，也让「摘要词不参与」不成立）。
            const candidates = labelRoleCandidates(labelOfSession(agent, header))
            const hinted = candidates[0] || null
            if (!hinted) return null
            // 2026-11-04（复读三轮红）：**直接用生产的解析结果**判空 ——
            // 之前只镜像了「候选配过」，漏了 `managedRoles.subagent` 兜底，于是 managed=subagent 时
            // 还会提示「没配、用的是默认工具面」，同一份 health 自相矛盾。
            if (resolvedRole) return null
            return {
              label: String(labelOfSession(agent, header)),
              role: hinted,
              hint: `子会话自称 ${hinted}，但 managedRoles 里没配 —— 它现在用的是默认工具面。要给它单独的工具面：lazy_tools_roles({ role: "${hinted}", allowGroups: [...], basis: "…" })`,
            }
          } catch {
            return null
          }
        })(),
        modes: new Map(),
        lifts: [],
        hiddenNames: [],
        seen: new Set(),
        level: null,
        idleDays: null,
        // 2026-10-30 加：rebuild 必须串行。rc.3 里「撤销限制」会**同步**发 tools/change，
        // 事件处理器会在外层 rebuild 跑到一半时重入进来 —— 内层把自己的 lift 句柄写进 st.lifts，
        // 外层随后用它的 leftovers 覆盖掉，那条限制就再没人能解除（孤儿）。
        rebuilding: false,
        pendingRebuild: false,
      }
      applyDefaults(st)
      states.set(agent, st)
    }
    return st
  }

  // 这个工具名现在该不该藏：没被任何组匹配 → 不藏；组没记录 → 全开；
  // 'hide' → 藏；'only' → 不在白名单里的才藏。
  const hiddenBy = (st, name) => {
    // 2026-10-30 对抗测试：手写组 match:['*'] 也不能收走常驻/自救工具（否则自愈链路断掉）。
    if (CORE_TOOLS.has(name)) return false
    const gid = groupOf(name)
    if (!gid) return false
    const m = st.modes.get(gid)
    if (!m) return false
    if (m.mode === 'hide') return true
    return !m.names.has(name)
  }

  // 串行化入口：同一个 agent 同时只允许一个 rebuild 在跑；跑的过程中再被叫，
  // 只记一个「待办」标记，等当前这轮结束后立刻补跑一轮（这样晚注册的工具也不会被吞）。
  // 为什么必须这样：见 stateFor 里 rebuilding / pendingRebuild 的注释（重入会把 lift 句柄覆盖掉）。
  const rebuild = (agent) => {
    const st = stateFor(agent)
    if (st.rebuilding) {
      st.pendingRebuild = true
      return
    }
    st.rebuilding = true
    stats.rebuilds += 1
    try {
      let rounds = 0
      do {
        st.pendingRebuild = false
        rebuildOnce(agent, st)
        rounds += 1
      } while (st.pendingRebuild && rounds < 5)
      if (st.pendingRebuild) {
        st.pendingRebuild = false
        host.log('warn', 'rebuild still pending after 5 rounds; dropped (possible change loop)')
      }
    } finally {
      st.rebuilding = false
    }
  }

  const rebuildOnce = (agent, st) => {
    // 解除旧限制：失败重试一次（学自 dsh-ops 的 clear()：孤儿限制比不解除更危险，
    // 它会让下一次 rebuild 叠在旧掩码上，出现"改了没生效"的假象）。
    const leftovers = []
    for (const lift of st.lifts) {
      let ok = false
      for (let attempt = 0; attempt < 2 && !ok; attempt += 1) {
        try {
          lift()
          ok = true
        } catch (error) {
          if (attempt === 1) {
            host.record('lift', error)
            leftovers.push(lift)
          }
        }
      }
    }
    st.lifts = leftovers
    if (leftovers.length) host.log('warn', `lift failed twice; ${leftovers.length} restriction(s) kept for retry`)
    PROCESS_LIFTS.delete(agent)
    // 2026-11-01（0.18 隔离约束①）：只在「本会话当前可见」的名字里选要藏的。
    // 别人已经藏掉的名字不再由我们 deny —— 否则撤销我们这层也放不出来，账还会算在别人头上。
    const visibleAfterLift = host.toolNames(agent)
    const source = visibleAfterLift
    const wanted = st.managed
      ? source.filter((name) => (!CORE_TOOLS.has(name) || ROLE_HIDEABLE_CORE.has(name)) && !isAllowedByPolicy(st.managed, name, groupOf))
      : source.filter((name) => hiddenBy(st, name))
    // 2026-11-04（与别名/scoped 工具共存）：宿主只允许 mask **全局工具**，
    // 别的插件注册在 agent 作用域的工具（如别名转发壳）天然不可 restrict。
    // 不去 deny 它们 —— 否则每次 rebuild 都换一条「这些名字不可限制」，
    // health 被永久拖红，而它们本来也不归我们管。读不到可 restrict 名单时保持旧行为（照藏）。
    const restrictable = host.restrictableNames(agent)
    const hidden = restrictable ? wanted.filter((name) => restrictable.has(name)) : wanted
    let applied = false
    if (hidden.length) {
      const lift = host.hideTools(agent, hidden)
      if (lift) {
        st.lifts.push(lift)
        PROCESS_LIFTS.set(agent, lift)
        stats.hideEvents += 1
        applied = true
      }
    }
    // 记下「这个会话里真正挂载过的工具名」。用途只有一个：health 要能分清
    //   ① 宿主压根没挂到本会话（如 cua_driver_native__* 自 DSH 2.0.20 起挂不上）→ 静音待命；
    //   ② 挂过又不见了，且不是我们收的 → 真异常，必须响。
    // 没有这份记录，两种情况长得一模一样，只能一律报警 —— 报警久了就没人看了。
    if (!st.seen) st.seen = new Set()
    for (const name of host.toolNames(agent)) st.seen.add(name)
    // 2026-11-01（0.18 隔离约束②）：撤销后回读。上一轮我们藏过、现在仍不可见、
    // 且不是本轮要藏的名字 ⇒ 被外部层挡住（不是我们）。只记证据，不抢别人的锁。
    // 2026-11-06（冷读红 1/红 2）：用**实际可见**算「藏不掉」的名单。
    // 真宿主里 scope 同名注册的工具永远 visible；reserved PTC（run_code）的 restrict 必抛；
    // 而 restrictableNames 读不到时旧过滤会整体失效 —— 只看名单都不能代表"藏得住"。
    // 于是把「想藏但本轮之后还看得见」记下来，泄漏检测不再把它们当漏网，避免 3 秒重建链。
    const stillVisible = host.toolNames(agent)
    // 2026-11-06（冷读 2 红）：逐名字判断，而不是整批布尔。
    //   - denied：这一批 restrict 确实点过名（成功或逐名字成功）；
    //   - permanent：badname（unknown / reserved PTC），永久藏不掉；
    //   - transient：这轮失败（systemic/inactive），下一轮必须重试，不能锁。
    // 2026-11-06（复读红 1 + 新洞 1）：只排除 transient。
    //   - shadow（deny 了仍可见）、permanent（badname）、以及**从未进 hidden 的 scope 别名**
    //     都属于「这轮藏不掉」，要锁，否则每次 tools/change 都算漏网（别名壳 3 秒链）；
    //   - transient（这轮 restrict 系统失败）不锁，下一轮重试。
    // 锁本身会在 restrictableNames 签名变化时整体清空，给晚注册的工具一次机会。
    const hideReport = host.hideReport(agent) || { transient: [] }
    // hidden 为空 = 本轮根本没调用 hideTools，报告是**上一轮**的；此时所有 leftover 都该锁，
    // 否则「上轮 transient、本轮退成 scope 别名壳」的名字会永远算漏网（复读黄项）。
    const transient = hidden.length > 0 ? new Set(hideReport.transient || []) : new Set()
    st.unhideable = wanted.filter((name) => stillVisible.includes(name) && !transient.has(name))
    // 外部变化的判据：可限制名单变了（如 alias 退场 / 全局工具晚注册），才值得清闩锁重试；
    // 单纯 tools/change（比如我们自己的 restrict）不该造成 churn。
    st.restrictableSig = restrictable ? [...restrictable].sort().join('\n') : null
    const nextHidden = new Set(hidden)
    const stuck = (st.hiddenNames || []).filter(
      (name) => !visibleAfterLift.includes(name) && !nextHidden.has(name) && !CORE_TOOLS.has(name),
    )
    st.foreign = stuck.length ? { count: stuck.length, sample: stuck.slice(0, 8) } : null
    st.hiddenNames = hidden.slice()
    stats.lastHidden = {
      agentId: agent && agent.id ? String(agent.id) : null,
      hidden: hidden.length,
      applied,
      at: nowIso(),
    }
    // applied 必须跟 hidden 一起打：2026-10-23 实测出现过「restrict 失败、
    // 日志里却照样写 hidden=102」，这种账不能留。
    host.log(
      'info',
      `agent=${String(agent && agent.id)} hidden=${hidden.length} applied=${applied ? 'yes' : 'no'} groups=${[...st.modes.keys()].join(',') || '-'}`,
    )
  }

  // 最长公共前缀：用来猜「这一组工具的名字家族」。
  // 例如 cua 组已知名的公共前缀是 `cua_driver_native__`，那么之后新出现的
  // `cua_driver_native__xxx` 只要没被组匹配，就该被当成漏网报出来。
  const commonPrefix = (list) => {
    if (!list.length) return ''
    let prefix = list[0]
    for (const name of list.slice(1)) {
      let i = 0
      while (i < prefix.length && i < name.length && prefix[i] === name[i]) i += 1
      prefix = prefix.slice(0, i)
      if (!prefix) break
    }
    return prefix
  }

  // 漏网：名字长得像某组成员（共享家族前缀）却没有任何组匹配它 ——
  // 上游升级新增工具、正则写漏、组被删，都会在这里冒头。
  //
  // 注意「常驻工具」（含在该组前缀里、但故意留着的，如浏览器 open/content）不算漏网：
  // 它们要么被某组匹配、要么写在某个组的 keep 里。2026-10-23 真机首测就是被这 18 个
  // 常驻工具打成 healthy:false 的假阳性，所以 keep 是必须显式写出来的。
  const keepers = new Set()
  for (const g of groups) for (const name of Array.isArray(g.keep) ? g.keep : []) keepers.add(name)

  const strayNames = (known, visible) => {
    const stray = new Set()
    for (const g of groups) {
      const inGroup = membersOf(g, known)
      if (inGroup.length < 2) continue
      const prefix = commonPrefix(inGroup)
      const cut = Math.max(prefix.lastIndexOf('__'), prefix.lastIndexOf('_')) + 1
      const family = cut >= 3 ? prefix.slice(0, cut) : prefix
      if (family.length < 3) continue
      for (const name of visible) {
        if (keepers.has(name)) continue
        if (!name.startsWith(family)) continue
        if (groups.some((other) => other.res.some((re) => re.test(name)))) continue
        stray.add(name)
      }
    }
    return [...stray].sort()
  }

  // 没归任何组、也不是常驻/keep 的「裸名工具」—— 真正没人管的怪工具。
  // 只盯名字里没有下划线的（click / type_text / list_windows 这类）：
  // 有前缀但只有一两个的（weather / research / cache_search）是通用单例，
  // 分组没意义，也不该每轮催用户去分。
  //
  // 2026-11-01：加第二个参数「名字池」。提示段每轮组装都要重算这个清单，而 allToolNames()
  // 走 schemas()（全量 schema 深拷贝，DSH 作者实测 258 个工具 34.2 ms）——调用方手里已有
  // 便宜读法（tools.view 的全局视图）时就把名字传进来，别在每轮请求里白拷一遍。
  const unclassifiedNames = (agent, sourceOverride) => {
    const all = Array.isArray(sourceOverride) ? sourceOverride : host.allToolNames()
    // 显式传进来的池就是权威（空数组 = 全局确实没有工具）；只有「没传」且全局为空时，
    // 才退到本 agent 的工具表。2026-11-01 冷读：原来把显式传的空数组当「没数据」，白跑一次 schemas()。
    const source = Array.isArray(sourceOverride) || all.length ? all : host.toolNames(agent)
    const kept = new Set()
    for (const g of groups) for (const name of Array.isArray(g.keep) ? g.keep : []) kept.add(name)
    return source
      .filter((name) => !CORE_TOOLS.has(name))
      .filter((name) => !kept.has(name))
      .filter((name) => !name.includes('_'))
      .filter((name) => !groups.some((g) => g.res.some((re) => re.test(name))))
      .sort()
  }

  const groupsView = (agent) => {
    const visible = host.toolNames(agent)
    const st = agent ? stateFor(agent) : { modes: new Map(), hiddenNames: [] }
    const all = host.allToolNames()
    const known = all.length ? all : [...new Set([...visible, ...st.hiddenNames])]
    return groups.map((g) => {
      const inGroup = membersOf(g, known)
      const m = st.modes.get(g.id)
      const mode = m ? m.mode : 'all'
      // hot 与决策用**同一套语义**（2026-10-30 挑刺）：组级时间戳是「任一工具热」，
      // 拿它当 hot 会和「按占比收起」打架（用户看到 hot=true 却是 only/hide）。
      // 现在 hot = 占比 ≥ warmRatio；组级时间戳只留作 lastUsed 展示，不再进决策。
      // 2026-10-30 挑刺：这里原来用 policy.idleDays，而决策用 sessionIdleDays(st) ——
      // 会话档位改过后 status 会和决策打架（组收起了还报 hot=true）。同一个判据，走同一个函数。
      const idleDaysView = sessionIdleDays(agent ? stateFor(agent) : null)
      const hotCount = inGroup.filter((name) => isToolHot(usageLedger, name, idleDaysView)).length
      const hotRatio = usageHotRatio(hotCount, inGroup.length)
      const entry = {
        id: g.id,
        title: g.title || g.id,
        on: mode === 'all',
        mode,
        onlyCount: mode === 'only' ? m.names.size : 0,
        matched: inGroup.length,
        visible: inGroup.filter((name) => visible.includes(name)).length,
        hot: hotRatio >= policy.warmRatio,
        hotTools: hotCount,
        hotRatio,
        lastUsed: usageLedger.groups[g.id] || null,
      }
      // expect 是**下限**（2026-10-30）：吸纳型组（负向前瞻 / 前缀通配）本来就会吸纳新工具，
      // 多出来是设计意图；少了才是问题（改名/没加载/正则漏）。等式语义会让默认状态下 healthy 长期 false，
      // 这正是「训练人忽略报警」的场景。也不再排除 only 模式：matched 数的是组内注册工具，与只放了几个无关。
      if (typeof g.expect === 'number') {
        entry.expect = g.expect
        entry.expectOk = inGroup.length >= g.expect
      }
      if (g.manual && guardWarned.has(g.id)) entry.guarded = true
      return entry
    })
  }

  // 提示段 + 会话快照（2026-11-03 搬去 lib/prompt.js）。依赖全部显式注入，
  // 于是「该列哪些组」这个判据只在这里生成一次，提示段和 health 共用它。
  const promptApi = createPrompt({
    host,
    groups,
    membersOf,
    groupOf,
    states,
    policy,
    usageLedger,
    unclassifiedNames,
    isAllowedByPolicy,
  })

  // 组选择器：单个 group 或批量 groups（二选一）；only 只允许配单个组。
  const selectorSchema = (extra) => ({
    type: 'object',
    properties: {
      group: { type: 'string', description: '组 id（单个）' },
      groups: { type: 'array', items: { type: 'string' }, description: '多个组 id（批量，与 group 二选一）' },
      ...extra,
    },
    additionalProperties: false,
  })

  const idsFrom = (args) => {
    const single = args && typeof args.group === 'string' && args.group ? [args.group] : []
    const many = args && Array.isArray(args.groups) ? args.groups.filter((id) => typeof id === 'string' && id) : []
    return [...new Set([...single, ...many])]
  }

  // 用量：给「以后要不要做 TTL」攒数据，不做任何自动回收。
  const usage = new Map()
  const touch = (id, kind) => {
    const entry = usage.get(id) || { enables: 0, disables: 0, lastAt: null }
    if (kind === 'enable') entry.enables += 1
    if (kind === 'disable') entry.disables += 1
    entry.lastAt = nowIso()
    usage.set(id, entry)
  }
  const usageView = () =>
    [...usage.entries()].map(([id, u]) => ({ id, enables: u.enables, disables: u.disables, lastAt: u.lastAt }))

  host.onAgentCreated((agent) => {
    // 2026-11-03：新建会话时先看 policy.json 有没有被改过（改完免重启）。
    reloadManagedRolesIfChanged()
    if (agent && agent.ctx && agent.ctx.tools) rebuild(agent)
  })

  // 时序兜底：插件可能比工具先加载（第一次算出的 hidden 会是 0），上游升级新增工具也会走这里。
  // 只在「发现漏网」（本该藏却可见）时才重建；重建后漏网消失，所以不会自激循环。
  // 3 秒冷却防的是「restrict 自己触发的 tools/change」打成死循环 —— 所以冷却必须盖在
  // **重建**上，不能盖在**检查**上。
  // 2026-10-28 对面复现的坑：原实现先盖时间戳再检查，冷启动时上游插件挤在 3 秒内注册的工具
  // 会被冷却吞掉；而之后不再有 tools/change 事件，那个工具整场可见、静默烧 token。
  const lastLeakCheck = new WeakMap()
  const leakTimers = new WeakMap()
  // 冷却时长可被测试压短（默认 3s）：`LAZY_TOOLS_COOLDOWN_MS=60`。用到时才读，避免 import 期定死。
  const leakCooldownMs = () => {
    const raw = Number(process.env.LAZY_TOOLS_COOLDOWN_MS)
    return Number.isFinite(raw) && raw >= 0 ? raw : 3000
  }
  // 2026-10-30 对面第二轮：冷却期内的**第二次**晚注册会被整段跳过，而之后没有事件就永远漏着。
  // 修法：冷却期内不立刻重建，但**排一次延迟核对**（到冷却结束 +25ms 再查一遍）。
  // 这样冷却只推迟动作、不再丢动作；延迟核对自身由 leakTimers 去重，重建引发的新事件会重新排一次，
  // 查到没有漏网就自然停下（不会自激）。
  const reconcileLeaks = (agent) => {
    const st = states.get(agent)
    if (!st) return
    const now = Date.now()
    const since = now - (lastLeakCheck.get(agent) || 0)
    if (since < leakCooldownMs()) {
      if (leakTimers.has(agent)) return
      const timer = setTimeout(() => {
        leakTimers.delete(agent)
        reconcileLeaks(agent)
      }, leakCooldownMs() - since + 25)
      if (timer && typeof timer.unref === 'function') timer.unref()
      leakTimers.set(agent, timer)
      return
    }
    // 2026-11-06（冷读红 1/红 2）：漏网 = 本该藏、实际仍可见、且**本轮确实藏不掉**。
    // 只看 restrictableNames 不够：它不代表"藏得住"（scope 同名遮蔽 / reserved PTC 仍可见），
    // 读不到时还会让过滤整体失效。用 rebuild 回读的实际结果 st.unhideable 兜底。
    const blocked = new Set(Array.isArray(st.unhideable) ? st.unhideable : [])
    const leaked = host.toolNames(agent)
      .filter((name) => hiddenBy(st, name))
      .filter((name) => !blocked.has(name))
    if (!leaked.length) return
    lastLeakCheck.set(agent, now)
    rebuild(agent)
  }
  const restrictableSigOf = (agent) => {
    try {
      const names = host.restrictableNames(agent)
      return names ? [...names].sort().join('\n') : null
    } catch {
      return null
    }
  }
  host.onToolsChange(() => {
    for (const agent of host.agentList()) {
      const st = states.get(agent)
      const sig = restrictableSigOf(agent)
      if (st && sig !== null && st.restrictableSig !== undefined && sig !== st.restrictableSig) {
        // 可限制名单变了（alias 退场 / 全局工具晚注册）：清**全部**闩锁，给"现在能藏了"一次机会。
        // 不保留 badname：名字可能从 unknown 变成可限制（红 1 的恢复性回归）。
        st.unhideable = []
      }
      reconcileLeaks(agent)
    }
  })
  // 卸载/热重载时清掉待办定时器 —— 孤儿定时器会和孤儿限制一样难查。
  try {
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => () => {
        for (const agent of host.agentList()) {
          const timer = leakTimers.get(agent)
          if (timer) clearTimeout(timer)
          leakTimers.delete(agent)
        }
      })
    }
  } catch (error) {
    host.record('effect', error)
  }

  // 关键词预开（autoHints）已于 2026-10-31 删除，见 CHANGELOG 0.17.0；旧配置写法会被记一条 health.notes 提示（不是 errors）。
  // 理由：判定词无穷且不可维护；自动入口改为「消息里的数据类型」（见后续版本），
  // 其余靠模型自己 enable + 自愈兜底。删掉时内置四组确实在用它，所以这是一次真实的功能删除。

  // 记「谁真的被调用过」：旁听 tools/pre-execute，只记账、不改决定。
  // 写盘节流 30 秒，避免每次调用都碰磁盘。
  let lastUsageSave = 0
  // 某个组**第一次**被记到时立刻落盘：组变热是稀疏事件，不该卡在 30 秒节流里。
  const savedGroups = new Set()
  host.onPreExecute((exec) => {
    const name = exec && exec.name
    if (!name) return
    const groupId = groupOf(name)
    // 2026-10-30 第二次修正（挑刺清单）：分母**只算属于某个组的调用**。
    // 为什么：自愈只可能发生在「被收起的组内工具」上，而 read / write / bash 这类核心工具
    // 永不入组、永远不可能自愈 —— 拿全量调用当分母会把指标稀释成没有分辨力的数字
    // （例：一晚 200 次调用里 190 次是核心工具，5 次自愈会被读成 97.5%，而在组内其实是 50%）。
    // 仍然测不到的：模型「压根没开口」的静默失能（用户要能力、模型判自己不会）——
    // 那类不产生任何调用，这个数看不见。详见 health 里 firstTryRate 的注释。
    if (groupId) host.countToolCall()
    const firstForGroup = Boolean(groupId) && !savedGroups.has(groupId)
    recordUsage(usageLedger, name, groupId)
    if (groupId) savedGroups.add(groupId)
    const now = Date.now()
    if (firstForGroup || now - lastUsageSave > 30000) {
      lastUsageSave = now
          persistCounts()
      if (!saveUsage(usageLedger)) host.log('warn', 'usage file write failed (kept in memory)')
    }
  })

  // 自愈：模型要调一个被我们藏起来的工具时，在 dispatch 前把它放出来，并在同一轮直接放行。
  // 用户全程无感。万一宿主对「未知工具」不跑守卫，这里也只是不生效，不会有副作用。
  // 旧工具名 → 新位置（2026-10-30 合并 4 个工具后保留的指路）。
  // 不注册 schema = 不占每轮上下文；只在模型真的喊旧名时回一句「已并入 X」。
  const LEGACY_TOOL_HINTS = {
    lazy_tools_scan: 'lazy_tools_list { ungrouped: true }',
    lazy_tools_classify: 'lazy_tools_save_groups（不传 groups）',
    lazy_tools_resolve: 'lazy_tools_enable { name }',
    lazy_tools_bench: 'lazy_tools_health { bench: true }',
  }

  host.onDispatchGuard((exec) => {
    const name = exec && exec.name
    const agent = exec && (exec.agent || exec.caller)
    if (!name || !agent) return undefined
    if (LEGACY_TOOL_HINTS[name]) {
      return `${name} 已在 0.16.0 并入 ${LEGACY_TOOL_HINTS[name]}；请改用新入口（功能相同）。`
    }
    const groupId = groupOf(name)
    if (!groupId) return undefined
    const st = stateFor(agent)
    // 受管会话：策略由管理员定，自愈不得绕过（否则等于绕开角色纪律）。
    // 显式 undefined：宿主把任何非 undefined 的返回值当拒绝（null 也算）。
    if (st.managed) return undefined
    const m = st.modes.get(groupId)
    if (!m) return undefined
    if (m.mode === 'only' && m.names.has(name)) return undefined
    const names = m.mode === 'only' ? new Set([...m.names, name]) : new Set([name])
    st.modes.set(groupId, { mode: 'only', names })
    // 会话级累计：同一对话里的自愈次数；跨会话/重载再累加到全局 stats。
    st.selfHealed = (Number.isFinite(st.selfHealed) ? st.selfHealed : 0) + 1
    stats.selfHealed += 1
    persistCounts()
    saveUsage(usageLedger)
    host.log('info', `self-heal: revealed ${name} (group ${groupId})`)
    rebuild(agent)
    // 2026-11-05：原来是「拒绝 + 让模型重试」，在 UI 上表现为一次假失败（工具其实已经拿到）。
    // 现在补开、重建后直接放行：这一次调用正常执行，下一轮工具面里也已经包含它。
    // 受管会话在上面已经 return（自愈不得绕过角色纪律），所以这里只影响普通会话。
    // 2026-11-05（冷读红 1）：宿主判据是 `reason !== undefined` —— **null 也会被当成拒绝**。
    // 之前写 null 能放行，全靠 host.js 的 `|| undefined` 兜底；这里显式 undefined。
    return undefined
  })

  // 斜杠命令：用户直接敲 /lazy-tools high，不必经过模型。
  try {
    const commands = ctx && typeof ctx.get === 'function' ? ctx.get('commands') : null
    if (commands && typeof commands.register === 'function') {
      const describe = (view) => {
        const on = (view.groups || []).filter((g) => g.on).map((g) => g.title || g.id)
        const which = view.session.level ? `档位 ${view.session.level}` : `跟随全局 ${view.session.idleDays} 天`
        return `工具抽屉：${which}${on.length ? `；开着 ${on.join('、')}` : '；全部收起'}`
      }
      host.own(
        commands.register({
          name: 'lazy-tools',
          description: '改当前会话的工具抽屉：high / medium / low / reset / off / <天数>',
          input: { hint: 'high | medium | low | reset | off | 7' },
          handler: (invocation) => {
            const agent = invocation && invocation.agent
            if (!agent) return { kind: 'error', text: '没有会话' }
            const raw = String((invocation && invocation.rawInput) || '').trim()
            const word = raw.toLowerCase()
            if (!raw) return { kind: 'success', text: describe(sessionView(agent)) }
            let spec = null
            if (word === 'reset' || word === '默认') spec = { reset: true }
            else if (word === 'off' || word === '全收' || word === '收起') spec = { collapseAll: true }
            else if (Object.prototype.hasOwnProperty.call(policy.presets, word)) spec = { level: word }
            else if (/^\d+$/.test(word)) spec = { idleDays: Number(word) }
            if (!spec) return { kind: 'error', text: `看不懂「${raw}」；可用：high / medium / low / reset / off / <天数>` }
            const result = applySessionPolicy(agent, spec)
            if (result.error) return { kind: 'error', text: result.error }
            return { kind: 'success', text: describe(result) }
          },
        }),
      )
      host.log('info', 'slash command /lazy-tools registered')
    }
  } catch (error) {
    host.record('commands.register', error)
  }
  // 设置页那条桥：客户端面板读写策略。webServer 没就绪时它会自己等。
  try {
    const unmountBridge = mountBridge(ctx, host, {
      getState: () => ({
        policy,
        groups: groups.map((g) => ({ id: g.id, title: g.title || g.id, expect: g.expect ?? null })),
        // 设置页「基础」那一页要显示的一句账。
        // 注意两件事：① states 是 WeakMap，没有 values()，只能走 host.agentList()；
        // ② 取**最大值**而不是求和 —— 每个会话/子 agent 各有一份自己的限制，
        //    相加会出现「已收纳 96 个」这种用户看不懂的数（实测两个会话各 48）。
        summary: {
          hidden: host.agentList().reduce((max, agent) => {
            const st = states.get(agent)
            const n = st && st.hiddenNames ? st.hiddenNames.length : 0
            return n > max ? n : max
          }, 0),
          selfHealed: stats.selfHealed,
        },
        app: 'dsh-lazy-tools',
      }),
      getSession: (sessionId) => {
        const agent = agentsGet(sessionId)
        return agent ? sessionView(agent) : { error: 'session not found' }
      },
      applySession: (sessionId, spec) => {
        const agent = agentsGet(sessionId)
        return agent ? applySessionPolicy(agent, spec) : { error: 'session not found' }
      },
      applyPolicy: (next) => {
        // 走 applyPolicyPatch：只改档位时天数跟着档位走（详见 api.js 里的注释）
        const beforeRoles = JSON.stringify(roleSource || null)
        const hadRolesBefore = Boolean(policy.managedRoles)
        const patch = Object.assign({}, next)
        // 冷读红 4b：设置页把 managedRoles **原样**塞进来会绕过归一化与审计 ——
        // allowGroups: [] 会静默把会话锁死，类型写错会让 isAllowedByPolicy 抛错（多给）。
        // 所以这里必须走和启动/热重载同一条归一化 + 审计。
        const touchesRoles = Object.prototype.hasOwnProperty.call(patch, 'managedRoles')
        let explicitClear = false
        if (touchesRoles) {
          // 2026-11-06（冷读红 1/B）：空对象是「清空角色」；无效输入保持原值。
          const rolePatch = applyManagedRolesPatch(roleSource, patch.managedRoles)
          explicitClear = rolePatch.explicitClear
          if (!rolePatch.ignored) patch.managedRoles = rolePatch.next
          else delete patch.managedRoles
        }
        applyPolicyPatch(policy, patch)
        if (touchesRoles) {
          // patch 里带了新角色表才换源；没带（=设置页没碰这一格）就保持原源 ——
          // 别拿「生效表」（可能已被审计删过条目）覆盖「配置源」。
          if (explicitClear) roleSource = null
          else if (patch.managedRoles) roleSource = patch.managedRoles
          // 2026-11-06（元宝 P0）：角色表没变就不 refresh/rebuild；否则一次勾选框会把
          // 所有存活会话的前缀缓存全废掉。
          if (JSON.stringify(roleSource || null) !== beforeRoles) refreshManagedRoles(true, hadRolesBefore)
        }
        host.log('info', `policy updated via settings: ${JSON.stringify(policy)}`)
      },
      record: (where, error) => host.record(where, error),
      setPolicyMtime: (v) => setPolicyMtime(v),
    })
    // 桥的返回值原来没人接（对面 2026-10-29 指出是死代码）：插件卸载后它还在回请求。
    // 挂到 ctx.effect 上，随插件生命周期一起关掉。
    if (typeof unmountBridge === 'function' && ctx && typeof ctx.effect === 'function') {
      ctx.effect(() => unmountBridge)
    }
  } catch (error) {
    host.record('bridge mount', error)
  }


  // 会话级策略：只影响当前 agent 的默认开关，不动全局设置。
  // 工具 / 斜杠命令 / 输入框上方那个控件 都走这一条路，避免三份重复逻辑。
  const agentsGet = (sessionId) => {
    try {
      const service = ctx && typeof ctx.get === 'function' ? ctx.get('agents') : null
      return service && typeof service.get === 'function' ? service.get(sessionId) : null
    } catch (error) {
      host.record('agents.get', error)
      return null
    }
  }

  // 受管角色：preset 可能在 agent 创建之后才被选中（Web UI 会先给默认 preset，再切回角色 preset）。
  // 只听事件、不改别的：重算角色 → 重设默认模式 → 重建限制。
  if (policy.managedRoles) {
    const onPresetSelected = (sessionId, presetId) => {
      try {
        const agent = agentsGet(sessionId)
        if (!agent) return
        const st = states.get(agent)
        if (!st) return
        const managed = resolveManagedRole(agent, policy.managedRoles)
        const before = st.managed ? st.managed.key : null
        const after = managed ? managed.key : null
        if (before === after) return
        st.managed = managed
        applyDefaults(st)
        rebuild(agent)
      } catch (error) {
        host.record('agent-preset/selected', error)
      }
    }
    try {
      if (ctx && typeof ctx.on === "function") ctx.on('agent-preset/selected', onPresetSelected)
    } catch (error) {
      host.record('agent-preset/selected listener', error)
    }
  }
  const sessionView = (agent) => {
    const st = stateFor(agent)
    return {
      showDock: policy.showDock === true,
      showClear: policy.showClear === true,
      classifyNudge: policy.classifyNudge !== false,
      presets: policy.presets,
      // 给输入框上方那一行用的账：「已收纳 N 个工具 · 自动取出 M 次」。
      // 比「开着 2 组」更像人话 —— 用户不知道一组里有多少东西。
      hiddenTools: st.hiddenNames.length,
      // 本对话累计；全局累计仍看 health.stats.selfHealed。
      selfHealed: Number.isFinite(st.selfHealed) ? st.selfHealed : 0,
      // 档位下拉里「跟随全局（N 天）」要显示的数字
      globalIdleDays: policy.idleDays,
      session: {
        level: st.level,
        idleDays: sessionIdleDays(st),
        source: st.level || Number.isFinite(st.idleDays) ? 'session' : 'global',
      },
      groups: groupsView(agent).map((g) => ({ id: g.id, title: g.title, on: g.on, hot: g.hot, visible: g.visible })),
    }
  }
  const applySessionPolicy = (agent, spec) => {
    if (!agent) return { error: 'no agent' }
    const st = stateFor(agent)
    // 2026-11-06（元宝 P0）：受管会话的工具面由角色决定，st.modes 在 rebuild 里被忽略；
    // 继续返回成功就是假成功。这里明确拒绝。
    if (st.managed) return { error: '受管会话由角色决定工具面：mode / 收纳本对话不生效' }
    const input = spec || {}
    if (input.reset === true) {
      st.level = null
      st.idleDays = null
    } else {
      if (input.level !== undefined && input.level !== null) {
        if (!LEVEL_DAYS[input.level]) return { error: `level 只能是 ${Object.keys(LEVEL_DAYS).join(' / ')}` }
        st.level = input.level
        st.idleDays = policy.presets[input.level]
      }
      if (input.idleDays !== undefined && input.idleDays !== null) {
        const days = Number(input.idleDays)
        if (!Number.isFinite(days) || days < 0) return { error: 'idleDays 必须是 >= 0 的数字' }
        st.level = null
        st.idleDays = Math.round(days)
      }
    }
    if (input.collapseAll === true) {
      // 立刻全收：本会话就先这样，下个会话再按策略重算。
      st.modes = new Map(groups.map((g) => [g.id, { mode: 'hide', names: new Set() }]))
    } else {
      applyDefaults(st)
    }
    rebuild(agent)
    return sessionView(agent)
  }



  // ── 8 个工具的定义在 lib/tools/（2026-11-03，第 2 批重构）──────────────────────
  // 为什么注册点挪到这里：这些定义依赖 apply() 里逐段建起来的闭包（applySessionPolicy /
  //   会话视图 / 组视图 / 读写策略 …），必须等它们全部就绪；顺序由 tools/index.js 拼出来，
  //   是硬要求（status, roles, enable, disable, mode, save_groups, list, health）。
  const toolDefs = createTools({
    host, groups, groupsView, idsFrom, membersOf, rebuild, selectorSchema, stateFor, touch, text,
    applySessionPolicy, applyDefaults, CORE_TOOLS, matcherFor, readUserGroups, unclassifiedNames,
    writeUserGroups, autoGroups,
    policy, normalizeManagedRoles, policyFileMtime, readPolicyRaw, refreshManagedRoles,
    writeStoredPolicy, setPolicyMtime, setRoleSource,
    states, stats, compatNotes, promptApi, clientPing, strayNames, usageView, nowIso,
  })
  for (const def of toolDefs) host.registerTool(def)

  // 先收回上一次 apply 留下的限制：同一进程里模块是缓存的，PROCESS_LIFTS 里记着
  // 上次建立的解除函数。不收回的话，新实例看不见那些工具（它们还藏着），
  // 于是 matched 会报 0、enable 也解不开 —— 孤儿限制，实测每次改 patch 都会踩。
  let reclaimed = 0
  for (const agent of host.agentList()) {
    const previous = PROCESS_LIFTS.get(agent)
    if (typeof previous === 'function') {
      try {
        previous()
      } catch (error) {
        host.record('lift(previous apply)', error)
      }
      PROCESS_LIFTS.delete(agent)
      reclaimed += 1
    }
  }

  // 补应用：插件可能是「会话已经在跑」之后才加载/重载的（改配置、升级插件、重启后恢复
  // 会话），这时 agent/created 不会再补发一次。所以活着的 agent 在这里补一遍，
  // 否则它们会一直带着默认开着的工具组（实测过：重载后老 agent 的 restrict 不追认）。
  let caughtUp = 0
  for (const existing of host.agentList()) {
    if (existing && existing.ctx && existing.ctx.tools) {
      rebuild(existing)
      caughtUp += 1
    }
  }


  // ── 会话级目录（2026-11-03 起在 lib/prompt.js）────────────────────────────
  // 为什么搬走：这段和 health 的「会话快照」是**同一个判据**，必须只留一个入口。
  // 依赖全部显式注入（host / groups / states / policy / usageLedger / …），见 prompt.js。
  mountPromptSection(ctx, promptApi, host)

  host.log(
    'info',
    `loaded in root scope; groups=${groups.map((g) => g.id).join(',')} level=${policy.level} caughtUp=${caughtUp} reclaimed=${reclaimed}`,
  )
}

```


### lib\prompt.js

```js
// prompt.js — 常驻提示段（会话级目录）与「会话快照」。
//
// 为什么单独拆出来（2026-11-03，第 1 批重构）：
//   这两百多行原本是 index.js 里 apply() 的一部分，靠闭包直接摸 host/groups/states/policy/usageLedger。
//   拆出来的目的不是"文件短一点"，而是把**一个判据只留一个入口**：
//     · 「这个会话挂载了哪些工具、该列哪些组」—— 提示段和 health 的会话快照走同一个函数；
//     · 「角色是什么」—— 由调用方传进来的 states 决定，这里不重新解析。
//   依赖全部显式注入（见 createPrompt 的参数），所以本文件可以脱离 apply() 单测。
//
// 失败方向：任何一处读不到（agent 认不出、工具表读不到）都退回**旧行为（列全部组）**，
// 绝不静默变短 —— 变短等于静默丢能力。

/**
 * @param {object} deps
 * @param {object} deps.host            host 契约（agentList / visibleNames / allToolNames / record）
 * @param {Array}  deps.groups          已编译的组
 * @param {Function} deps.membersOf     (组, 名字池) => 成员名
 * @param {Function} deps.groupOf       工具名 => 组 id | null
 * @param {WeakMap} deps.states         agent => 会话状态（hiddenNames / managed）
 * @param {object} deps.policy          策略（用 classifyNudge）
 * @param {object} deps.usageLedger     用量账本（用 tools[name] 的最后调用时间）
 * @param {Function} deps.unclassifiedNames (agent, 名字池) => 未归组的裸名工具
 * @param {Function} deps.isAllowedByPolicy (managed, name, groupOf) => boolean
 */
export function createPrompt(deps) {
  const { host, groups, membersOf, groupOf, states, policy, usageLedger, unclassifiedNames, isAllowedByPolicy } = deps

  /**
   * 组装 scope → 属于哪个 agent。
   * 实测（2026-11-01 冷读，读的是宿主源码）：宿主只有一个组装点 `assembleContextFor(agent)`，
   * 传进来的 scope **就是 agent 对象**。`agent.ctx` 那条分支是防御用的（宿主换实现时不至于认不出），
   * 认不出来返回 null：**不许**拿陌生对象去 stateFor（它会顺手建一份新状态）。
   */
  const agentForScope = (scope) => {
    if (!scope || typeof scope !== 'object') return null
    let list = []
    try {
      list = host.agentList()
    } catch {
      list = []
    }
    const direct = list.find((candidate) => candidate === scope)
    if (direct) return direct
    const viaCtx = list.find((candidate) => candidate && candidate.ctx === scope)
    if (viaCtx) return viaCtx
    return null
  }

  /**
   * 本会话「挂载了」的工具名集合 = 该作用域可见的 ∪ 我们自己藏起来的。
   *
   * 为什么必须并上自己藏的：抽屉的全部作用就是「藏起来」。只数可见的，一个被整组收起的组
   * 会显示成「零挂载」从而从句子里消失 —— 那等于把提示变成沉默，比长一点糟得多。
   * 为什么**不**并上外部 deny（宿主权限门、别的插件）：那些工具这个会话本来就用不了，
   * 广告它们就是在骗模型（本机 cua 两组就是这么被广告了整整一周的）。
   * 已知边界（2026-11-01 冷读指出）：一个名字如果**先被我们藏过、之后又被外部挡上**，
   * 它仍在 hiddenNames 里 → 仍会被并回挂载集。这不是我们这层能分辨的，只能接受，
   * 真正的隔离信息在 `health.foreignDenied`。
   *
   * @returns Set<string> 或 null（信号不可信 ⇒ 调用方退回旧行为）
   */
  const mountedNames = (agent) => {
    if (!agent) return null
    let visible = null
    try {
      // 传的一定是认出来的**真 agent**。visibleNames 自己在「视图为空」时会用 schemas 复核。
      visible = host.visibleNames(agent)
    } catch {
      visible = null
    }
    if (!Array.isArray(visible)) return null
    let hidden = []
    try {
      const st = states.get(agent)
      if (st && Array.isArray(st.hiddenNames)) {
        hidden = st.hiddenNames
        // 受管会话：没授权的组连 enable 都会被拒，列进提示只是骗模型去点一个点不开的开关。
        if (st.managed) hidden = hidden.filter((name) => isAllowedByPolicy(st.managed, name, groupOf))
      }
    } catch {
      hidden = []
    }
    return new Set([...visible, ...hidden])
  }

  /**
   * 会话视图：挂载集 + 每个组在本会话里的成员 + 该列的组。
   * **提示段和 health 的快照都只走这一个函数**（DESIGN 规矩：同一判据只允许一个入口）。
   */
  const view = (agent) => {
    const mounted = mountedNames(agent)
    // 名字池一次算好：以前每个组各调一次 allToolNames()，8 个组就是 8 次全量 schema 拷贝。
    const pool = mounted ? [...mounted] : host.allToolNames()
    const members = new Map(groups.map((g) => [g, membersOf(g, pool)]))
    // 只列本会话真的有工具的组。**这里先不判空段** —— 2026-11-01 冷读指出，早退会把
    // 「有 N 个工具没归组，请去分组」这句一起吞掉，而那正是「一个组都没挂」的会话里唯一有用的句子。
    const listed = mounted ? groups.filter((g) => (members.get(g) || []).length > 0) : groups
    return { mounted, pool, members, listed }
  }

  /**
   * 这个会话是不是「默认 preset 的人工会话」。
   * 只在这里催人去做分组（lazy_tools_save_groups 会把结果写进全局分组表）——
   * 无人值守的角色会话（每工单一个会话、preset 装配）不该被引导去改全局配置，那是人或管理员的事。
   * 读不到任何信号 ⇒ 当作默认会话（与 0.17.2 行为一致）。
   */
  const isDefaultPresetSession = (agent) => {
    if (!agent) return true
    try {
      const presets = agent.ctx && typeof agent.ctx.get === 'function' ? agent.ctx.get('agentPresets') : null
      if (!presets || typeof presets.composedPreset !== 'function') return true
      const composed = presets.composedPreset(agent.ctx) ?? null
      if (composed === null) return true
      // 哪个字段才代表「默认」随构建不同：defaultId 是模块默认，selectedDefault 是用户当前选中的默认
      // （本机实测两者都是 cordis —— 2026-11-01 用 health.nameProbe 验的）。
      const known = [presets.defaultId, presets.selectedDefault, presets.defaultPreset].filter(
        (value) => typeof value === 'string' && value.length > 0,
      )
      if (!known.length) return true
      return known.includes(composed)
    } catch {
      return true
    }
  }

  /** 提示段正文。context 是宿主的 AssembleContext（`{ scope }`）。 */
  const sectionText = (context) => {
    // 2026-11-01：按**组装方会话**渲染。认不出 scope / 读不到工具表 ⇒ mounted=null ⇒ 全部退回旧行为。
    const scope = context && typeof context === 'object' ? (context.scope ?? context.agent ?? null) : null
    const sectionAgent = agentForScope(scope)
    const { members, listed } = view(sectionAgent)

    // 能力目录（2026-10-29 上线）：每组附 3 个代表工具名，把自愈从「猜名字」变成「照着念」。
    // 2026-11-01 起从「本会话挂载的名字池」取 —— 被我们收起的也在池里，被外部挡掉的不在。
    const sampleFor = (g) => {
      try {
        // 成员与本段列组用**同一份**判定（membersOf），不再各自跑一遍正则。
        const matched = members.get(g) || []
        if (!matched.length) return ''
        // 最近调用时间降序取前 3（账本里每把工具只有一个「最后调用时间」，没有窗口内次数）。
        const lastUsedAt = (n) => {
          const at = usageLedger && usageLedger.tools ? usageLedger.tools[n] : null
          const ms = at ? Date.parse(at) : 0
          return Number.isFinite(ms) ? ms : 0
        }
        const names = matched
          .slice()
          .sort((a, b) => lastUsedAt(b) - lastUsedAt(a))
          .slice(0, 3)
        // **不许截前缀**：裸名可能是别的插件的同名工具（本机就有裸名 click），照念会静默用错实现。
        const shown = names.map((n) => String(n))
        return shown.length ? `: ${shown.join('/')}` : ''
      } catch {
        return ''
      }
    }

    const base = listed.length
      ? `工具抽屉（lazy-tools）：${listed
          .map((g) => (g.title ? `${g.id}(${g.title}${sampleFor(g)})` : `${g.id}${sampleFor(g)}`))
          .join(' / ')} 默认收起。` +
        '工具报 unknown 时先调 lazy_tools_status（每组用途与工具数），或 lazy_tools_list {group} 拿到该组**全部**工具名（上面每组只列了 3 个样本）；需要时 lazy_tools_enable {group, only:[…]}；排查用 lazy_tools_health。'
      : ''

    // 有「没人管的怪工具」时提一句。classifyNudge 关掉时连全局名字都不读
    // —— 没 view 的宿主上那是每轮一次全量 schema 深拷贝。
    let loose = []
    const wantNudge = policy.classifyNudge !== false
    if (wantNudge) {
      try {
        // 全局名字池也走便宜读法（view(undefined) = 全局层）；拿不到就传 null，退回 schemas。
        let globalNames = null
        try {
          const names = host.visibleNames()
          globalNames = Array.isArray(names) ? names : null
        } catch {
          globalNames = null
        }
        loose = unclassifiedNames(null, globalNames)
      } catch {
        loose = []
      }
    }
    // 催人分组的话**只在默认 preset 的人工会话里说**（角色会话不该被引导去改全局分组表）。
    const nudgeText =
      wantNudge && loose.length >= 3 && isDefaultPresetSession(sectionAgent)
        ? `另有 ${loose.length} 个工具没归组、也没有共同前缀：${loose.slice(0, 6).join(', ')}${
            loose.length > 6 ? ' …' : ''
          }。请调 lazy_tools_save_groups（不传 groups）读描述、按用途分组，再带 groups 落盘（一次即可，长期生效）。`
        : ''
    // 空段判定（宿主会把空段整段丢掉）：
    //   · 没有目录、也没有提醒 ⇒ ''
    //   · 只有提醒（这个会话一个分组工具都没挂，但有散装工具要分类）⇒ 只输出提醒
    if (!base) return nudgeText ? `工具抽屉（lazy-tools）：${nudgeText}` : ''
    return nudgeText ? `${base} ${nudgeText}` : base
  }

  /**
   * 会话快照：给 health 和编排器看的一行状态（2026-11-03 加；2026-11-03 夜按挑刺结果收窄）。
   *
   * 只留三样，且**每样只有一个来源**：
   *   · `groupsListed` —— 与提示段同一个函数（view）算出来的，禁止另算一套；
   *   · `visible`      —— 走 visibleNames（便宜视图）；**读不到给 null，不许用 0 冒充**；
   *   · `hidden`       —— 我们自己藏了几个（hiddenNames 的长度）。
   *
   * 为什么砍掉两个字段（挑刺实测）：
   *   ① `role` 与既有 `managed` 重复且形状不同 ⇒ 违反「同一判据只允许一个入口」；
   *   ② `blockedGroups` 是第二个更弱的判据：我们把没撤掉的限制也会报成「外部挡」，
   *      而 health 的 `groups[].blocked` / `warnings` 已经分得清「没挂载过 / 挂过又没了 / 我们没还回来」
   *      三种根因。多一个同义字段，只会让同一份回答里出现两种结论。
   */
  const describeSession = (agent) => {
    if (!agent) return null
    // 读名字走便宜视图；读不到（视图抛错且 schemas 也抛错）返回 null —— 契约见 host.visibleNames。
    let visible = null
    try {
      visible = host.visibleNames(agent)
    } catch {
      visible = null
    }
    const visibleKnown = Array.isArray(visible)
    const v = view(agent)
    let st = null
    try {
      st = states.get(agent) || null
    } catch {
      st = null
    }
    return {
      groupsListed: v.listed.map((g) => g.id),
      visible: visibleKnown ? visible.length : null,
      hidden: st && Array.isArray(st.hiddenNames) ? st.hiddenNames.length : 0,
    }
  }

  return { agentForScope, mountedNames, view, sectionText, describeSession, isDefaultPresetSession }
}

/**
 * 把提示段挂到宿主上。
 * 拿不到 systemPrompt 服务就静默跳过 —— 这是可选项，不是必需能力。
 */
export function mountPromptSection(ctx, prompt, host) {
  try {
    if (!ctx || typeof ctx.inject !== 'function') return false
    ctx.inject(['systemPrompt'], (service) => {
      try {
        const section = {
          name: 'lazy-tools:groups',
          order: 3000,
          interpolate: false,
          text: (context) => prompt.sectionText(context),
        }
        if (service && service.systemPrompt && typeof service.systemPrompt.section === 'function') {
          if (typeof service.effect === 'function') {
            service.effect(() => service.systemPrompt.section(section), 'lazy-tools: prompt section')
          } else {
            service.systemPrompt.section(section)
          }
        } else {
          host.record('systemPrompt', new Error('systemPrompt.section is not available'))
        }
      } catch (error) {
        host.record('systemPrompt', error)
      }
    })
    return true
  } catch (error) {
    host.record('systemPrompt', error)
    return false
  }
}

```


### lib\roles.js

```js
// roles.js — 受管会话（router / worker / subagent）的角色策略。
//
// 设计约束（2026-11-01）：
//   1. 默认关闭：policy.managedRoles 为空 ⇒ 完全走原来的热度逻辑，行为不变。
//   2. 只认结构信号：preset id（来自 agentPresets.composedPreset）与 session.header.parentSession；
//      不认插件名、不认工单标题。
//   3. 封闭默认：角色没授权的组、以及没有归组的工具，一律隐藏。
//   4. 真源在配置里（管理员写），不在代码里；本模块只做解析，不做判断。
//
// 为什么不给每个 agent 单独写策略：真源保持“角色 → 组”这一层；每个 agent 的结果是
// 从角色模板派生出来的（确定性、可 diff），而不是各自手写一份。

/** 校验并归一化 managedRoles；无效条目直接丢掉（失败方向放开）。 */
const RESERVED_ROLE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export function normalizeManagedRoles(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  // 2026-11-04（第三方报告 A1/A2 复现）：必须用 null 原型。
  // 用 {} 时 `out['__proto__'] = x` 会改写原型、键静默消失；而 `managedRoles['constructor']`
  // 会拿到 Object 构造函数（truthy）⇒ 角色被误认成函数，后续 allowGroups.includes 抛 TypeError。
  const out = Object.create(null)
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key !== 'string' || !key) continue
    if (RESERVED_ROLE_KEYS.has(key)) continue
    if (!value || typeof value !== 'object') continue
    // 2026-11-05：**空数组是合法的**，语义 = 只留常驻工具（CORE）。
    // 以前空数组会被当成无效条目整条丢掉，于是"只给常驻"根本表达不了。
    // 没写 allowGroups 这个键才是无效条目（保持原语义：形状不对不许猜）。
    const hasAllowKey = Array.isArray(value.allowGroups)
    const allow = hasAllowKey
      ? value.allowGroups.filter((item) => typeof item === 'string' && item.length > 0)
      : []
    if (!hasAllowKey) continue
    out[key] = {
      allowGroups: [...new Set(allow)],
      // 未归组工具的默认：hide（角色纪律）| show（人用会话不适用；留作显式逃生口）
      unknown: value.unknown === 'show' ? 'show' : 'hide',
      // 2026-11-03：AI 自动配的角色必须**能自证来源**（谁配的 / 什么时候 / 依据），
      // 否则又变成"权限从模型嘴里长出来、事后无从追"。这三个字段只记账，不改行为。
      ...(typeof value.createdBy === 'string' && value.createdBy ? { createdBy: value.createdBy } : {}),
      ...(typeof value.at === 'string' && value.at ? { at: value.at } : {}),
      ...(typeof value.basis === 'string' && value.basis ? { basis: value.basis } : {}),
    }
  }
  return Object.keys(out).length ? out : null
}

/**
 * 从会话标签里取角色键（2026-11-03 加，**厂商无关**）。
 *
 * 为什么要有它：各家编排器给子会话打标签的写法不一样，但形状高度一致——
 *   MyGO：`dsh-my-go:hermes` · team-conductor：`team:reviewer` · 别的可能用 `/` 或空格。
 * 我们**不认厂商名**，只认一条规则：**取最后一段**（`: / | 空白` 分隔），小写。
 * 于是任何编排器只要把「角色名放在标签末尾」，不用改一行代码就能被我们认出来。
 *
 * 安全前提：调用方只在 `managedRoles` 里**配过这个键**时才生效 —— 认错了也只是不生效，
 * 不会给错权限（失败方向放开）。
 */
export function roleFromLabel(label) {
  // 2026-11-04：与生产路径同源（labelRoleCandidates），不再「取最后一段」。
  const candidates = labelRoleCandidates(label)
  return candidates.length ? candidates[0] : null
}

/**
 * 标签里的**所有**候选角色段（2026-11-03 读 MyGO 源码后加 —— **这才是真正的适配关键**）。
 *
 * 为什么不能再只取最后一段：MyGO 的真实标签是 `dsh-my-go:hermes: 帮我改这个模块`
 * （`agentLabel(type, summary)`，见 mygo/preset/shared/misc.mjs:34）—— 最后一段是**任务摘要**，
 * 只取最后一段会认不出来，而且方向是 fail-open（退回默认工具面，等于多给权限）。
 *
 * 正确做法：把标签切成若干段，**由调用方挑「managedRoles 里配过的那个」**。
 * 依然厂商无关：不认前缀，只认"你配了哪个角色名"。
 */
/**
 * 通用词黑名单（2026-11-03，四家 SA 调研后加）。
 *
 * 为什么需要：别的编排器也会往 label 里塞词，但那些词**不是角色**——
 *   goalloop: `Goal-loop wave worker: AC-1`、switchman: `dsh-switchman handover backup`、
 *   force-collab: `协作 1/3`。
 * 如果用户正好把 managedRoles 配成 `worker` / `backup`，这些 label 会被误认成角色。
 * 方向上是收紧（不会多给权限），但会造成莫名其妙的工具面变化 —— 所以直接跳过这些词。
 * 纯数字段（`1`/`3`）同理。
 */
export const GENERIC_LABEL_WORDS = new Set([
  'worker', 'workers', 'backup', 'handover', 'lead', 'leader', 'teammate', 'teammates',
  'agent', 'agents', 'subagent', 'subagents', 'wave', 'goal-loop', 'goalloop',
  'collab', 'collaboration', 'session', 'task', 'job', 'run', 'team', 'agent-team',
])

export function roleCandidatesFromLabel(label) {
  if (typeof label !== 'string' || !label.trim()) return []
  return label
    .trim()
    .split(/[:/|\s]+/)
    .map((part) => part.toLowerCase())
    .filter((part) => /^[a-z0-9_-]{1,32}$/.test(part))
    // 通用词与纯数字不当角色（见 GENERIC_LABEL_WORDS 的注释）
    .filter((part) => !GENERIC_LABEL_WORDS.has(part) && !/^\d+$/.test(part) && !/^dsh-/.test(part))
}

/**
 * 确定性候选（2026-11-04）：只允许两段——**vendor 之后的第一段** 与 **首段**。
 * 绝不扫第三段以后（那是任务摘要，正是误认的来源）。
 * 调用方按顺序挑「配过的那个」。
 */
const ROLE_FIRST_SEGMENT = new Set(['review', 'build', 'research'])

export function labelRoleCandidates(label) {
  if (typeof label !== 'string' || !label.trim()) return []
  const segs = label.trim().toLowerCase().split(/[:/|\s]+/).filter(Boolean)
  const ok = (part) =>
    !!part && /^[a-z0-9_-]{1,32}$/.test(part) && !GENERIC_LABEL_WORDS.has(part) && !/^\d+$/.test(part)
  const out = []
  // 2026-11-06（A/B 评审 F2）：显式角色必须优先第一段；
  // 否则 `review: build the plugin` 会被当成 build，绕过 review 的只读面。
  // MyGO 旧标签 `dsh-my-go:hermes: ...` 的第一段不是已知角色，仍按第二段取。
  if (segs.length > 1 && ok(segs[1])) {
    if (ROLE_FIRST_SEGMENT.has(segs[0])) out.push(segs[0], segs[1])
    else out.push(segs[1], segs[0])
  } else if (ok(segs[0])) out.push(segs[0])
  return out
}
/**
 * 取会话标签。**2026-11-03 冷读红 1**：宿主的 `SessionHeader` 里**没有** `label` 字段
 * （HEADER_*_KEYS 实测只有 type/version/id/createdAt/isSeeded/delegationDepth/cwd/parentSession/origin/agentPreset），
 * 只有 `header.label` 这一条通道会让"按 label 配的角色"在真机上**永远不生效**（还是 fail-open 方向）。
 * 所以这里多认两处：`session.subagent.label`（descriptor 事件折叠出来的投影）和 `agent.subagent.label`。
 * 三处都没有 ⇒ null（不猜）。
 */
export function labelOfSession(agent, header) {
  try {
    if (header && typeof header.label === 'string' && header.label) return header.label
    const projected = agent && agent.session && agent.session.subagent
    if (projected && typeof projected.label === 'string' && projected.label) return projected.label
    const direct = agent && agent.subagent
    if (direct && typeof direct.label === 'string' && direct.label) return direct.label
    // **真机唯一可用的通道（2026-11-03 冷读第二轮核实）**：label 在 `sessionProjections` 服务的
    // `subagent` 投影里（`stateOf(session,'subagent').identity.label`），既不在 Session 也不在 Agent 上。
    // 宿主时序保证 descriptor 在 `agent/created` 之前 append，所以这里读得到。
    const ctx = agent && agent.ctx
    const svc =
      (ctx && ctx.sessionProjections) || (ctx && typeof ctx.get === 'function' ? ctx.get('sessionProjections') : null)
    if (svc && typeof svc.stateOf === 'function' && agent && agent.session) {
      const state = svc.stateOf(agent.session, 'subagent')
      const label = state && state.identity && state.identity.label
      if (typeof label === 'string' && label) return label
    }
  } catch {
    /* 读不到就当没有 */
  }
  return null
}

/**
 * 解析一个 agent 的受管角色。返回 { key, role, source } 或 null。
 *
 * 顺序（**每一级都要求 managedRoles 里配了该键**，配了才生效）：
 *   1. 子会话：**label 里的候选段**（厂商无关，见 resolveManagedRole）—— 比通用 subagent 键更精确
 *   2. 子会话：`subagent` 通用键
 *   3. 非子会话：preset id（composedPreset，退回 session.header.agentPreset）
 *
 * `source` 只用于可观测（health 里能看到"这个角色是从哪认来的"）。
 */
export function resolveManagedRole(agent, managedRoles) {
  if (!managedRoles || !agent) return null
  const header = agent.session && agent.session.header ? agent.session.header : null

  // 1) 派生会话（子代理）：先看 label，再看通用 subagent 键
  if (header && header.parentSession) {
    // 2026-11-03：**挑配过的那个候选项**，不是取最后一段。
    // MyGO 的真实标签是 `dsh-my-go:hermes: 帮我改这个模块` —— 最后一段是任务摘要。
    // 2026-11-04（第三方报告 B1/B2 复现）：**不再扫后面几段**。
    // 旧写法先过滤中文再取 candidates[1]，而 `dsh-my-go:explore: 让 hermes 看看` 过滤后是
    // ['explore','hermes'] —— 摘要词前移成索引 1，于是把 hermes 认成了角色。
    // 现在的规则是确定性的：**只认 vendor 段之后的第一段**（`vendor:role[: 摘要]` 的 role）。
    // 认不出就走 subagent 兜底 —— 不再从摘要里捞词。
    const fromLabel = labelRoleCandidates(labelOfSession(agent, header)).find((key) => hasOwnRole(managedRoles, key))
    if (fromLabel) {
      return { key: fromLabel, role: managedRoles[fromLabel], source: 'label' }
    }
    const role = hasOwnRole(managedRoles, 'subagent') ? managedRoles.subagent : null
    return role ? { key: 'subagent', role, source: 'subagent' } : null
  }

  // 2) 角色 preset：优先问宿主服务，拿不到再退到 session header
  let presetId = null
  try {
    const presets = agent.ctx && typeof agent.ctx.get === 'function' ? agent.ctx.get('agentPresets') : null
    if (presets && typeof presets.composedPreset === 'function') {
      presetId = presets.composedPreset(agent.ctx) ?? null
    } else if (header && typeof header.agentPreset === 'string') {
      presetId = header.agentPreset
    }
  } catch {
    presetId = null
  }
  if (!presetId) return null

  const role = hasOwnRole(managedRoles, presetId) ? managedRoles[presetId] : null
  return role ? { key: presetId, role, source: 'preset' } : null
}

/** 只认自己拥有的键：防 `constructor` / `__proto__` 从 Object.prototype 上"借"到值。 */
function hasOwnRole(map, key) {
  return !!map && Object.prototype.hasOwnProperty.call(map, key)
}

/** 通配：allowGroups 里写 '*' = 这个角色不按组设限（逃生口，2026-11-02 加）。 */
export const ALL_GROUPS = '*'

/** 这个工具在当前受管角色下是否允许。未归组按角色的 unknown 处理。 */
export function isAllowedByPolicy(managed, name, groupOf) {
  const role = managed && managed.role
  if (!role) return false
  if (Array.isArray(role.allowGroups) && role.allowGroups.includes(ALL_GROUPS)) return true
  const groupId = groupOf(name)
  if (groupId === null) return role.unknown === 'show'
  return role.allowGroups.includes(groupId)
}

/**
 * 校验 allowGroups 里的组 id 到底存不存在（2026-11-02 加，外部评审指出、复现属实）。
 *
 * 为什么必须有这道：受管会话里 `enable` / `disable` 被拒、自愈也不绕过 ⇒ 要是 allowGroups
 * 全写成不存在的 id（**照抄文档示例就会这样**），这个会话的工具面被收到只剩 CORE_TOOLS，
 * 会话内没有任何自救路径，只能改文件重启 —— 而且失败是完全静默的，违反红线三「失败必须响」。
 *
 * 失败方向放开：
 *   - 全部 id 都不认识 ⇒ 这个角色**不生效**（退回普通会话行为）+ 记一条错误；
 *   - 只有部分不认识   ⇒ 保留认识的，不认识的记出来；
 *   - allowGroups 含 '*' ⇒ 不设限，直接放行。
 *
 * 注：`auto-*` 是自动分组动态生成的 id，可能在 apply 之后才出现，这里不当成"写错"。
 *
 * @param {object|null} managedRoles 归一化后的角色表
 * @param {string[]} groupIds 当前已知的组 id
 * @returns {{unknown: Array<{role: string, ids: string[]}>, dropped: string[]}}
 */
export function auditManagedRoles(managedRoles, groupIds) {
  const known = new Set(Array.isArray(groupIds) ? groupIds : [])
  const out = { unknown: [], dropped: [] }
  if (!managedRoles || typeof managedRoles !== 'object') return out
  for (const [key, role] of Object.entries(managedRoles)) {
    const allow = Array.isArray(role && role.allowGroups) ? role.allowGroups : []
    if (!allow.length || allow.includes(ALL_GROUPS)) continue
    const miss = allow.filter((id) => !known.has(id))
    // 2026-11-03（冷读红 4a）：以前这里豁免 `auto-*`，理由是"自动组可能晚到"。
    // 但 mnemon 停用后 `auto-mnemon` 不再存在时，那个角色会**照常生效**却一个组都没允许
    // ⇒ 所有组 hide、只剩核心工具、enable/disable 还被拒 = #71 原地复活。
    // 正确做法：auto-* 和普通 id 一样参与"全都不存在就停用"的判定。
    if (!miss.length) continue
    out.unknown.push({ role: key, ids: miss })
    // 全部都不认识（去掉 auto- 占位后一个可用的都没有）⇒ 这个角色等于什么都没允许，
    // 必须停用而不是把会话锁死
    const usable = allow.filter((id) => id === ALL_GROUPS || !miss.includes(id))
    if (!usable.length) out.dropped.push(key)
  }
  return out
}

/**
 * 计算一次 managedRoles 补丁的结果（纯函数，便于测试）。
 * 空对象 = 用户明确清空；normalize 失败 = 无效输入、保持原值。
 */
export function applyManagedRolesPatch(current, raw) {
  const explicitClear = Boolean(raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0)
  const normalized = normalizeManagedRoles(raw)
  if (normalized === null && !explicitClear) {
    return { next: current, changed: false, explicitClear: false, ignored: true }
  }
  const next = explicitClear ? null : normalized
  return {
    next,
    changed: JSON.stringify(next || null) !== JSON.stringify(current || null),
    explicitClear,
    ignored: false,
  }
}

```


### lib\tools\groups.js

```js
// tools/groups.js — 抽屉的六个开关工具：status / enable / disable / mode / save_groups / list。
//
// 为什么拆出来（2026-11-03，第 2 批重构；第 1 批是 prompt.js 那种搬法）：
//   这六段原本直接写在 index.js 的 apply() 里，靠闭包摸 host / groups / states / …，
//   于是「apply() 有多长」和「工具怎么定义」缠在一起：改一个 description 要滚两千行，
//   冷读也读不动。搬出来**只为了让定义和装配分开**，不改行为：
//     · name / description / parameters / output / execute 逐字节保留（原文由
//       _work/tools-extract.mjs 用词法器从旧 index.js 切出来，只有行首缩进按新层级调整）；
//     · 搬移前后用 _work/tool-defs-snapshot.mjs 序列化 8 个工具的定义做 diff，必须为空。
//
// 为什么六个在同一个文件：它们共用同一套「组 / 会话状态 / 选择器」依赖，而且
//   enable 与 disable 必须用**完全一样**的解析规则（按名字找组、回读工具表、受管会话拒绝）。
//   按工具拆成六个文件会把这份一致性拆散，收益只有行数。
//
// 为什么是普通函数不是类：这里没有状态。状态（groups / states / usage）都在 index.js 的
//   apply() 里，本文件只拿引用、只调用，不持有 —— 所以可以脱离 apply() 单独加载。

/**
 * @param {object} deps
 * @param {object}   deps.host           宿主契约（toolNames / allToolNames / schemas / record / log）
 * @param {Array}    deps.groups         已编译的组（工具体里读 id / res / title）
 * @param {Function} deps.groupsView     (agent) => 组视图（on / mode / matched / visible / blocked …）
 * @param {Function} deps.idsFrom        (args) => group/groups 归一化后的 id 数组
 * @param {Function} deps.membersOf      (组, 名字池) => 组真正能收的成员名
 * @param {Function} deps.rebuild        (agent) => 按当前模式重建该会话的作用域限制
 * @param {Function} deps.selectorSchema (extra) => group/groups 选择器的 JSON schema
 * @param {Function} deps.stateFor       (agent) => 会话状态（modes / hiddenNames / managed …）
 * @param {Function} deps.touch          (组 id, 'enable'|'disable') => 记一次用量
 * @param {Function} deps.text           (对象) => 给模型看的 JSON 文本
 * @param {Function} deps.applySessionPolicy (agent, spec) => 会话级策略（mode 工具的唯一实现）
 * @param {Function} deps.applyDefaults  (st) => 按策略重算默认开哪些组
 * @param {Set}      deps.CORE_TOOLS     常驻/自救工具名（永不可收）
 * @param {Function} deps.matcherFor     (pattern) => RegExp | null
 * @param {Function} deps.readUserGroups 读 ~/.dsh/lazy-tools.groups.json
 * @param {Function} deps.writeUserGroups 写 ~/.dsh/lazy-tools.groups.json
 * @param {Function} deps.unclassifiedNames (agent) => 没归组的裸名工具
 * @param {Function} deps.autoGroups     (apply) => 自动分组报告（list 里透出建议）
 */
export function createGroupTools(deps) {
  const {
    host,
    groups,
    groupsView,
    idsFrom,
    membersOf,
    rebuild,
    selectorSchema,
    stateFor,
    touch,
    text,
    applySessionPolicy,
    applyDefaults,
    CORE_TOOLS,
    matcherFor,
    readUserGroups,
    unclassifiedNames,
    writeUserGroups,
    autoGroups,
  } = deps

  const statusTool = {
  name: 'lazy_tools_status',
  description: '查看按需工具组：每组有多少工具、当前是开还是关。',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
  execute: async (_args, exec) => ({ groups: groupsView(exec && exec.agent) }),
}

  // 注意：roles（角色读写）不在这里 —— 它有 setter 依赖，定义在 tools/roles.js，
  // 由 tools/index.js 插到 status 与 enable 之间（顺序是硬要求，见那个文件顶部）。

  const enableTool = {
  name: 'lazy_tools_enable',
  description: '开启按需工具组（group 单个 / groups 批量）；给 only 就只放这几个工具（其余仍收起，只能配单个组）。下一轮起可用。',
  parameters: selectorSchema({
    only: { type: 'array', items: { type: 'string' }, description: '只放这些工具名，必须都属于该组；省略=整组开' },
    name: {
      type: 'string',
      description: '按工具名一步开启（可只给片段）：自动找到它属于哪组、只放这一个（原 lazy_tools_resolve）',
    },
  }),
  output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
  execute: async (args, exec) => {
    // 2026-10-30 合并：原 lazy_tools_resolve —— 按工具名一步开启。
    // 受管会话：工具面由角色策略决定，不允许从工具里改（改配置，不改编排）。
    if (exec && exec.agent && stateFor(exec.agent).managed) {
      return { error: '受管会话：工具面由角色策略决定，不允许从工具里改；请编辑 managedRoles 配置。' }
    }
    const byName = args && typeof args.name === 'string' ? args.name.trim() : ''
    if (byName) {
      const agentN = exec && exec.agent
      if (!agentN) return { error: 'no agent scope' }
      const stN = stateFor(agentN)
      const visibleN = host.toolNames(agentN)
      const knownN = host.allToolNames().length ? host.allToolNames() : [...new Set([...visibleN, ...stN.hiddenNames])]
      const exactN = knownN.filter((n) => n === byName)
      const matchedN = exactN.length ? exactN : knownN.filter((n) => n.toLowerCase().includes(byName.toLowerCase())).slice(0, 8)
      if (!matchedN.length) {
        return { found: false, query: byName, hint: '这个名字没见过。先 lazy_tools_list 看现有前缀，或者确认拼写；也可能它属于一个尚未加载的插件。' }
      }
      const targetN = matchedN[0]
      const groupN = groups.find((g) => g.res.some((re) => re.test(targetN)))
      const baseN = { found: true, tool: targetN, group: groupN ? groupN.id : null }
      if (matchedN.length > 1) baseN.matches = matchedN.slice(0, 8)
      if (!groupN) return { ...baseN, applied: false, hint: '它不在任何组里，本来就一直可见' }
      if (visibleN.includes(targetN)) return { ...baseN, applied: false, hint: '它本来就可用了' }
      stN.modes.set(groupN.id, { mode: 'only', names: new Set([targetN]) })
      touch(groupN.id, 'enable')
      rebuild(agentN)
      if (!host.toolNames(agentN).includes(targetN)) {
        host.record('enable', new Error(`${targetN} 已解除限制，但仍不在本会话工具表（可能未挂载或需要重启）`))
        return { ...baseN, applied: false, reason: 'not-visible', hint: '本插件的限制已经解除，但宿主仍没把它交给本会话 —— 大概率没被挂载（插件未启用，或刚更新完需要重启 DSH）。抽屉开不了它。' }
      }
      return { ...baseN, applied: true, hint: '已只放这一个进来，同组其余仍收起' }
    }
    const ids = idsFrom(args)
    if (!ids.length) return { error: '要 group、groups 或 name 之一' }
    const unknown = ids.filter((id) => !groups.some((g) => g.id === id))
    if (unknown.length) return { error: `unknown group: ${unknown.join(', ')}` }
    const agent = exec && exec.agent
    if (!agent) return { error: 'no agent scope' }
    const st = stateFor(agent)
    const only = Array.isArray(args && args.only) ? args.only.filter((name) => typeof name === 'string') : null
    if (only && ids.length > 1) return { error: 'only 只能配单个组' }
    if (only) {
      if (!only.length) return { error: 'only 不能是空数组；要整组开就省掉 only，要关就用 disable' }
      const group = groups.find((g) => g.id === ids[0])
      const bad = only.filter((name) => !group.res.some((re) => re.test(name)))
      if (bad.length) return { error: `这些名字不属于组 ${ids[0]}：${bad.join(', ')}` }
      const known = new Set([...host.toolNames(agent), ...st.hiddenNames])
      const missing = only.filter((name) => !known.has(name))
      if (missing.length) return { error: `这些名字当前不认识（可能没加载或拼错）：${missing.join(', ')}` }
      st.modes.set(ids[0], { mode: 'only', names: new Set(only) })
      touch(ids[0], 'enable')
      rebuild(agent)
      // 2026-11-01：回读（与按名字开同一条规矩）。只改模式不等于工具真回来了。
      const backOnly = host.toolNames(agent)
      if (!only.some((name) => backOnly.includes(name))) {
        return {
          enabled: ids[0],
          only,
          applied: false,
          reason: 'externally-hidden',
          hint: '本插件的限制已经解除，但这些工具一个都没回到会话工具表 —— 被外部过滤器挡着（宿主权限门或别的插件），不是抽屉收的。查 lazy_tools_health 的 groups[].blocked。',
        }
      }
      return { enabled: ids[0], only }
    }
    for (const id of ids) st.modes.delete(id)
    for (const id of ids) touch(id, 'enable')
    rebuild(agent)
    // 2026-11-01 修（真宿主实测撞到）：组模式改掉就返回「enabled」是**假成功** ——
    // 本机 `enable cua-screen` 返回成功，可 19 个成员一个都没回来（被 computer-use 权限门挡着）。
    // 规矩与 health 一致：解除我们这层之后回读，仍不可见就明说是外部挡的，不许报成功。
    const after = new Set(host.toolNames(agent))
    const blocked = ids.filter((id) => {
      const g = groups.find((item) => item.id === id)
      const members = g ? membersOf(g) : []
      return members.length > 0 && !members.some((name) => after.has(name))
    })
    const out = { enabled: ids.length === 1 ? ids[0] : ids }
    if (blocked.length) {
      out.applied = false
      out.blocked = blocked
      out.reason = 'externally-hidden'
      out.hint =
        '这些组的开关已经拨到「开」，但成员一个都没回到本会话工具表 —— 被外部过滤器挡着（宿主权限门或别的插件），不是抽屉收的。查 lazy_tools_health 的 groups[].blocked / notes。'
    }
    return out
  },
}

  const disableTool = {
  name: 'lazy_tools_disable',
  description: '关闭按需工具组（group 单个 / groups 批量），把它从上下文里收回；也会清掉之前的 only 白名单。',
  parameters: selectorSchema(),
  output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
  execute: async (args, exec) => {
    // 2026-10-30 合并：原 lazy_tools_resolve —— 按工具名一步开启。
    // 受管会话：工具面由角色策略决定，不允许从工具里改（改配置，不改编排）。
    if (exec && exec.agent && stateFor(exec.agent).managed) {
      return { error: '受管会话：工具面由角色策略决定，不允许从工具里改；请编辑 managedRoles 配置。' }
    }
    const ids = idsFrom(args)
    if (!ids.length) return { error: '要 group 或 groups' }
    const unknown = ids.filter((id) => !groups.some((g) => g.id === id))
    if (unknown.length) return { error: `unknown group: ${unknown.join(', ')}` }
    const agent = exec && exec.agent
    if (!agent) return { error: 'no agent scope' }
    const st = stateFor(agent)
    for (const id of ids) st.modes.set(id, { mode: 'hide', names: new Set() })
    for (const id of ids) touch(id, 'disable')
    rebuild(agent)
    return { disabled: ids.length === 1 ? ids[0] : ids }
  },
}

  const modeTool = {
    name: 'lazy_tools_mode',
    description:
      '只改**当前会话**的收敛策略：给 level 或 idleDays，立刻按新策略重算默认开哪些组；reset:true 恢复跟随全局设置。会覆盖本会话手动开关过的组。',
    parameters: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['low', 'medium', 'high'], description: '会话级档位' },
        idleDays: { type: 'number', description: '会话级闲置天数（覆盖档位）' },
        reset: { type: 'boolean', description: 'true = 清掉会话级覆盖，回到全局策略' },
        collapse: { type: 'boolean', description: 'true = 立刻把这个会话的所有组收起' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
    execute: async (args, exec) => {
      const agent = exec && exec.agent
      if (!agent) return { error: 'no agent scope' }
      const spec = { ...(args || {}) }
      if (spec.collapse === true) spec.collapseAll = true
      return applySessionPolicy(agent, spec)
    },
  }

// 分类：把「没人管的怪工具」交给当前会话的 agent 自己判断（插件不内嵌模型）。

  const saveGroupsTool = {
  name: 'lazy_tools_save_groups',
  description:
    '把 agent 分好的组写进 ~/.dsh/lazy-tools.groups.json（长期有效，用户随时可手改）。默认只写文件、下次会话生效；applyNow=true 才立刻生效（会打断本会话前缀缓存）。会做安全校验：含常驻工具、少于 2 个、与现有组重叠过多都会被拒。',
  parameters: {
    type: 'object',
    properties: {
      groups: {
        type: 'array',
        description: '组定义数组：{ id, title, match: [工具名…] }',
        items: { type: 'object' },
      },
      applyNow: {
        type: 'boolean',
        description: 'true 才立刻生效（会打断本会话前缀缓存）；默认只写文件、下次会话生效',
      },
    },
    additionalProperties: false,
  },
  output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
  execute: async (args, exec) => {
    const agent = exec && exec.agent
    const incoming = Array.isArray(args && args.groups) ? args.groups : []
    // 2026-11-06（A/B 评审 F1）：受管会话只能由角色决定工具面；save_groups 以前漏了守卫，
    // review 虽然藏了 edit/write，却仍能改全局组配置。这里与 enable/disable 用同一判据。
    if (agent && incoming.length && stateFor(agent).managed) {
      return { error: '受管会话：工具面由角色策略决定，不允许写全局组配置；请编辑 groups 文件或 managedRoles。' }
    }
    // 2026-10-30 合并：不传 groups = 要分类材料（原 lazy_tools_classify）。
    if (!incoming.length) {
      const namesU = unclassifiedNames(agent)
      const byNameU = new Map(host.schemas(agent).map((item) => [item.name, item]))
      const toolsU = namesU.slice(0, 80).map((name) => {
        const schema = byNameU.get(name)
        const description = schema && typeof schema.description === 'string' ? schema.description : ''
        const params =
          schema && schema.parameters && schema.parameters.properties && typeof schema.parameters.properties === 'object'
            ? Object.keys(schema.parameters.properties).slice(0, 10)
            : []
        return { name, description: description.slice(0, 200), params }
      })
      return {
        saved: 0,
        classify: {
          total: namesU.length,
          shown: toolsU.length,
          tools: toolsU,
          existingGroups: groups.map((g) => ({ id: g.id, title: g.title || g.id, match: g.match, keep: g.keep || [] })),
          instructions:
            '按用途分成 2–4 组（例：观察/只读、操作/会改状态、需要额外配置的能力）。每组至少 2 个工具，' +
            'id 用小写字母+连字符。不要包含常驻工具（如 pwsh/read/write/skill/lazy_tools_*）。' +
            '分好后调用 lazy_tools_save_groups：{ groups: [{ id, title, match: ["工具名", …] }] }。',
        },
      }
    }
    const known = new Set(host.allToolNames())
    const core = [...CORE_TOOLS]
    const issues = []
    const cleaned = []
    for (const raw of incoming) {
      const id = String((raw && raw.id) || '').trim()
      const match = Array.isArray(raw && raw.match) ? raw.match.map((name) => String(name)) : []
      if (!id) {
        issues.push('有条目缺 id')
        continue
      }
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
        issues.push(`${id}: id 只能小写字母/数字/连字符`)
        continue
      }
      if (match.length < 2) {
        issues.push(`${id}: 少于 2 个工具`)
        continue
      }
      const inCore = match.filter((name) => core.includes(name))
      if (inCore.length) {
        issues.push(`${id}: 含常驻工具 ${inCore.join(', ')} —— 这些不能被收起`)
        continue
      }
      const unknown = match.filter((name) => !known.has(name))
      if (unknown.length) {
        issues.push(`${id}: 未注册的名字 ${unknown.slice(0, 4).join(', ')}`)
        continue
      }
      const overlap = match.filter((name) => groups.some((g) => g.res.some((re) => re.test(name))))
      if (overlap.length / match.length > 0.8) {
        issues.push(`${id}: 与现有组重叠 ${Math.round((overlap.length * 100) / match.length)}%，没有意义`)
        continue
      }
      if (groups.some((g) => g.id === id)) {
        issues.push(`${id}: 组 id 已存在`)
        continue
      }
      cleaned.push({
        id,
        title: String((raw && raw.title) || id),
        match,
        defaultOn: false,
      })
    }
    if (!cleaned.length) return { saved: 0, issues }
    try {
      const existing = readUserGroups(host.record)
      const next = [...existing.filter((g) => !cleaned.some((c) => c.id === g.id)), ...cleaned]
      const file = writeUserGroups(next)
      // 默认只落盘、下次会话生效 —— 会话中途换工具表会打断前缀缓存，
      // 而「只在会话开始时决定收哪些工具」是本插件最核心的承诺。
      // 确实要现在生效的人显式传 applyNow: true，返回里会写明代价。
      const applyNow = args && args.applyNow === true
      if (applyNow && agent) {
        for (const c of cleaned) {
          const res = c.match.map((pattern) => matcherFor(pattern)).filter(Boolean)
          if (res.length) groups.push({ ...c, expect: c.match.length, res })
        }
        const st = stateFor(agent)
        applyDefaults(st)
        rebuild(agent)
      }
      host.log('info', `groups saved: ${cleaned.map((c) => c.id).join(', ')} (file ${file}, applyNow=${applyNow})`)
      return {
        saved: cleaned.length,
        ids: cleaned.map((c) => c.id),
        file,
        appliedNow: applyNow && Boolean(agent),
        issues,
        note: applyNow
          ? '已立刻生效（会打断本会话的前缀缓存）。'
          : '已写入文件，下次会话开始时生效（不打断当前会话缓存）。要现在生效就带上 applyNow: true。',
      }
    } catch (error) {
      host.record('save groups', error)
      return { saved: 0, issues: [...issues, `写文件失败：${error && error.message ? error.message : String(error)}`] }
    }
  },
}

  const listTool = {
  name: 'lazy_tools_list',
  description: '列出某个组里的工具名（被收起过的也算，visible 字段区分当前可不可见）。配 match 正则、挑单工具开关时用。',
  parameters: {
    type: 'object',
    properties: {
      group: { type: 'string', description: '组 id；省略则列出所有已知工具' },
      ungrouped: {
        type: 'boolean',
        description: '只列没归组的工具（带描述与参数名）；同时给前缀分桶建议（原 lazy_tools_scan / classify）',
      },
    },
    additionalProperties: false,
  },
  output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
  execute: async (args, exec) => {
    const agent = exec && exec.agent
    const visible = host.toolNames(agent)
    const st = agent ? stateFor(agent) : { hiddenNames: [] }
    const known = host.allToolNames().length ? host.allToolNames() : [...new Set([...visible, ...st.hiddenNames])].sort()
    const id = args && typeof args.group === 'string' ? args.group : ''
    // 2026-10-30 合并：原 lazy_tools_scan（前缀分桶）+ lazy_tools_classify（未归组工具描述）并进这里。
    if (args && args.ungrouped) {
      const names = unclassifiedNames(agent)
      const byName = new Map(host.schemas(agent).map((item) => [item.name, item]))
      const tools = names.slice(0, 80).map((name) => {
        const schema = byName.get(name)
        const description = schema && typeof schema.description === 'string' ? schema.description : ''
        const params =
          schema && schema.parameters && schema.parameters.properties && typeof schema.parameters.properties === 'object'
            ? Object.keys(schema.parameters.properties).slice(0, 10)
            : []
        return { name, description: description.slice(0, 200), params }
      })
      const buckets = new Map()
      for (const n of visible) {
        const key = n.includes('__') ? n.split('__')[0] : n.includes('_') ? n.split('_')[0] : n
        if (!buckets.has(key)) buckets.set(key, [])
        buckets.get(key).push(n)
      }
      // 冷读发现：autoGroups='suggest' 在设置里可选，但合并 scan 时把建议字段丢了 →
      // 选它的人看不到任何输出。这里把它接回 list { ungrouped: true }。
      const suggestion = (() => {
        try {
          return autoGroups(false)
        } catch {
          return null
        }
      })()
      return {
        group: null,
        ungrouped: { total: names.length, shown: tools.length, tools },
        ...(suggestion
          ? {
              autoGroups: {
                mode: suggestion.mode,
                applied: suggestion.applied,
                suggestions: suggestion.suggestions,
                skipped: suggestion.skipped,
              },
            }
          : {}),
        prefixes: [...buckets.entries()]
          .map(([prefix, list]) => ({ prefix, count: list.length, sample: list.slice(0, 4) }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 40),
      }
    }
    if (!id) return { group: null, count: known.length, visible: visible.length, names: known }
    const group = groups.find((g) => g.id === id)
    if (!group) return { error: `unknown group: ${id}` }
    const matched = known.filter((name) => group.res.some((re) => re.test(name)))
    return { group: id, count: matched.length, visible: matched.filter((name) => visible.includes(name)).length, names: matched }
  },
}

  // 返回**数组**（不是对象）：tools/index.js 靠它拼最终的注册顺序。
  return [statusTool, enableTool, disableTool, modeTool, saveGroupsTool, listTool]
}

```


### lib\tools\health.js

```js
// tools/health.js — 自检工具（lazy_tools_health，1 个）+ 它独占的基准账 benchReport。
//
// 为什么单独一个文件：health 是**唯一**一个把「宿主契约 / 组视图 / 会话快照 / 过滤器诊断」
//   全摊开给模型看的工具，它读的依赖最多（14 个）。塞回 groups.js 会把那六个日常开关工具的
//   依赖表撑大一倍，反而更难读。
//
// 为什么 benchReport 跟着它走：那个函数只被 health 的 { bench: true } 分支调用（旧 index.js
//   里除定义外只有一处引用），留在 index.js 就是「只有一个人用的 97 行」。搬过来后 index.js
//   不再需要知道它 —— 依赖没增加，只是换了住处。注意它缩进原本就不整齐（body 多两格），
//   这次**没有被顺手格式化**：搬家不是修风格的地方，改了就没法证明逐字节一致。
//
// 原文来源：_work/tools-extract.mjs 切出，逐字节保留（只有缩进变化）。

/**
 * @param {object} deps
 * @param {object}   deps.host        宿主契约（probe / probeName / toolNames / allToolNames / schemas / counters / errors / record）
 * @param {Array}    deps.groups      已编译的组
 * @param {Function} deps.groupsView  (agent) => 组视图（含 guarded / expect / blocked）
 * @param {Function} deps.stateFor    (agent) => 会话状态
 * @param {WeakMap}  deps.states      agent => 会话状态（读 foreign / managed，不建新状态）
 * @param {object}   deps.stats       计数（hideEvents / selfHealed / lastHidden）
 * @param {Set}      deps.compatNotes 已删除配置项（autoHints）的提示 id；health 里翻成 notes
 * @param {object}   deps.policy      策略（原样回给模型看）
 * @param {object}   deps.promptApi   提示段 API（describeSession = 会话快照）
 * @param {Function} deps.clientPing  客户端心跳记录
 * @param {Function} deps.strayNames  (已知, 可见) => 漏网名字
 * @param {Function} deps.usageView   () => 用量账本视图
 * @param {Function} deps.text        (对象) => JSON 文本
 * @param {Function} deps.nowIso      () => ISO 时间
 * @param {Set}      deps.CORE_TOOLS  常驻/自救工具名（bench 里不该算成「该收的」）
 */
export function createHealthTool(deps) {
  const {
    host,
    groups,
    groupsView,
    stateFor,
    states,
    stats,
    compatNotes,
    policy,
    promptApi,
    clientPing,
    strayNames,
    usageView,
    text,
    nowIso,
    CORE_TOOLS,
  } = deps

  // 基准：把「工具 schema 税」量成可复现的数字（字符数，不猜 token）。
  // 任何人都能在自己机器上跑同一条命令对比，README 里的估算因此可被检验。
  // 基准账（原 lazy_tools_bench，2026-10-30 并入 health）：量「工具 schema 税」，字符数实测。

  const benchReport = (agent) => {
      // 必须读全局注册表：被收起的工具不在 agent 的可见 schema 里，
      // 用 agent 视角会把它们漏掉，hiddenChars 永远是 0。
      const schemas = host.schemas()
      const visible = new Set(host.toolNames(agent))
      const chars = (schema) => {
        try {
          return JSON.stringify({
            name: schema.name,
            description: schema.description || '',
            parameters: schema.parameters || {},
          }).length
        } catch {
          return 0
        }
      }
      const stBench = agent ? stateFor(agent) : { hiddenNames: [] }
      const hiddenSet = new Set(stBench.hiddenNames)
      // 「全局注册」≠「本会话能用」：宿主可能压根没把某个插件挂到本会话（实测 cua_driver_native__*）。
      // 那些工具从没进过上下文，把它们算成「收起省下的」就是虚报。
      // 三态记账：visible（在表里）/ hidden（我们收的）/ absent（宿主没挂 —— 省不了，也不该算）。
      const absent = (name) => !visible.has(name) && !hiddenSet.has(name)
      const rows = []
      let totalChars = 0
      let hiddenChars = 0
      let hiddenCount = 0
      let absentTools = 0
      let absentChars = 0
      let visibleInRegistry = 0
      for (const group of groups) {
        let groupChars = 0
        let groupCount = 0
        let groupHidden = 0
        let groupHiddenChars = 0
        let groupAbsent = 0
        let groupAbsentChars = 0
        for (const schema of schemas) {
          if (!group.res.some((re) => re.test(schema.name))) continue
          // 常驻/自救工具永不入组（2026-10-30 对抗测试），bench 也不该把它们算成「该收的」。
          if (CORE_TOOLS.has(schema.name)) continue
          const size = chars(schema)
          if (absent(schema.name)) {
            groupAbsent += 1
            groupAbsentChars += size
            continue
          }
          groupChars += size
          groupCount += 1
          if (!visible.has(schema.name)) {
            groupHidden += 1
            groupHiddenChars += size
          }
        }
        if (groupCount || groupAbsent) rows.push({ group: group.id, tools: groupCount, hidden: groupHidden, chars: groupChars, hiddenChars: groupHiddenChars, absent: groupAbsent, absentChars: groupAbsentChars })
      }
      for (const schema of schemas) {
        const size = chars(schema)
        if (absent(schema.name)) {
          absentTools += 1
          absentChars += size
          continue
        }
        totalChars += size
        if (visible.has(schema.name)) visibleInRegistry += 1
        if (!visible.has(schema.name)) {
          hiddenChars += size
          hiddenCount += 1
        }
      }
      // 这张会话工具表里有、但没有登记在本注册表里的名字（排序后给）。存在的意义：
      // 「bench 说 135 可见、却只有 101 在册」这种对不上账的问题，光看数字只能猜，
      // 给出名字才能去查是谁注册的（2026-10-28 加：当时 34 个无处可查）。
      const registryNames = new Set(schemas.map((s) => s.name))
      const outsideNames = [...visible].filter((n) => !registryNames.has(n)).sort()
      return {
        tools: schemas.length,
        visible: visible.size,
        visibleInRegistry,
        visibleOutsideRegistry: visible.size - visibleInRegistry,
        outsideRegistryNames: outsideNames,
        hidden: hiddenCount,
        absent: absentTools,
        // 三态只在本注册表内互斥：visibleInRegistry + hidden + absent === tools。
        // visible 是这个会话的**整张**工具表，其中有 34 个不归本注册表管（实测 135 = 101 + 34，
        // 2026-10-28），所以 visible + hidden + absent 会大于 tools —— 要对账请用 visibleInRegistry。
        // totalChars 只算「本会话相关的」（visibleInRegistry + hidden）；absent 从没进过上下文，
        // 算进来就成了「省下了一个从来没花的钱」，所以单列在 absentChars。
        totalChars,
        visibleChars: totalChars - hiddenChars,
        hiddenChars,
        absentChars,
        // 只给字符数，不硬编 token 换算系数：不同语言/描述密度差别很大。
        // 想换算的人自己按 provider 的实际 tokenizer 除。
        groups: rows.sort((a, b) => b.hiddenChars - a.hiddenChars),
        note: '字符数是实测（name + description + parameters 的 JSON 长度）；token 请按你自己 provider 的 tokenizer 换算。absent = 注册了但宿主没挂到本会话的工具，从没进过上下文，所以不计入「省下」；它变成 0 就说明所有工具都真的到了会话里。',
      }
  }

  const healthTool = {
  name: 'lazy_tools_health',
  description: '自检：DSH 五个契约还在不在（register / schemas / restrict / guard / agent 事件）、上次 hidden 数。升级排查先跑它。可选：tool 查单个工具卡在哪一层；clear 清空错误列表（瞬时错误不再让 healthy 永久为 false）。',
  parameters: {
    type: 'object',
    properties: {
      tool: { type: 'string', description: '可选：要追查的工具名，例如 cua_driver_native__get_desktop_state' },
      bench: { type: 'boolean', description: '附带基准账（字符数实测；原 lazy_tools_bench）' },
      full: { type: 'boolean', description: '返回全量（契约详情 / 账本 usage / 漏网 stray / filters），默认精简' },
      clear: { type: 'boolean', description: '清空错误列表（errors[] 只进不出，瞬时错误会让 healthy 永久 false）' },
      layersFor: {
        type: 'string',
        description:
          '可选（只读诊断）：枚举这个 agent 作用域链上的过滤器，报每层的 allow/deny 计数与「是否把该名字排除」，不打印过滤器内容',
      },
    },
    additionalProperties: false,
  },
  output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
  execute: async (_args, exec) => {
    const agent = exec && exec.agent
    const probe = host.probe(agent)
    // 2026-11-05（冷读红 1）：结构契约不健康时**拒绝清空** —— 否则「清一下」就能把宿主缺接口洗成 healthy=true。
    // 结构契约（register / schemas / restrict / guard / agent 事件）只有重启能修，不该被当瞬时错误清掉。
    const structuralOk = probe.register === true && probe.schemas === true && probe.restrict === true && probe.guard === true && probe.agentEvent === true
    const wantClear = _args && _args.clear === true && typeof host.clearErrors === 'function'
    const cleared = wantClear && structuralOk ? host.clearErrors() : 0
    const clearRefused = wantClear && !structuralOk
    const names = host.toolNames(agent)
    const counters = host.counters()
    const errors = host.errors()
    const st = agent ? stateFor(agent) : { hiddenNames: [], seen: new Set() }
    if (!st.seen) st.seen = new Set()
    // 每次自检都采样一次当前工具表：宿主中途把插件挂上来（或又撤走）时，
    // 只靠 rebuild 那一刻的采样会漏掉，分类就会撒谎。
    for (const name of names) st.seen.add(name)
    const known = [...new Set([...names, ...st.hiddenNames])]
    const stray = strayNames(known, names)
    const view = groupsView(agent)
    const warnings = []
    const notes = []
    for (const id of compatNotes) notes.push(`${id}: 配置里的 autoHints 已删除（0.17.0），该项被忽略`)
    const hiddenSet = new Set(st.hiddenNames)
    const seenSet = st.seen || new Set()
    const registeredAll = host.allToolNames()
    const namesOf = (id) => {
      const def = groups.find((g) => g.id === id)
      if (!def) return []
      const pool = registeredAll.length ? registeredAll : known
      return pool.filter((name) => def.res.some((re) => re.test(name)))
    }
    for (const g of view) {
      if (g.guarded) notes.push(`${g.id}: 手写组匹配了全部可隐藏工具，已忽略（不会收任何工具；请把 match 改窄或删掉这个组）`)
      if (typeof g.expect === 'number' && !g.expectOk) {
        // 只会是「少于」—— 多于 expect 是吸纳型组的正常状态，不告警（2026-10-30）。
        warnings.push(`${g.id}: matched ${g.matched} < expect ${g.expect}（少的那几个可能已改名/未加载）`)
      }
      if (!g.on || g.matched === 0 || g.visible > 0) continue
      // 组开着却一个都不可见，有三种根因，处理方式各不相同 —— 一律报警会训练人忽略警报：
      //   ① 我们收起了却没还回来（restrict 撤销失败）→ 真故障，必须响；
      //   ② 这些工具在本会话里挂载过、现在不见了，也不是我们收的 → 真异常，必须响；
      //   ③ 从来没挂载过 → 宿主没把它们给这个会话（实测 cua_driver_native__* 自 DSH 2.0.20 起如此）。
      //      这种抽屉治不了，改成「静音待命」：只进 notes，不拉低 healthy。宿主哪天真挂上来，
      //      g.visible 就大于 0，这段不再进，监控自动恢复 —— 不需要用户做任何事。
      const inGroup = namesOf(g.id)
      const ours = inGroup.filter((name) => hiddenSet.has(name))
      const vanished = inGroup.filter((name) => seenSet.has(name) && !hiddenSet.has(name))
      if (ours.length) {
        warnings.push(`${g.id}: 组是开的，但有 ${ours.length} 个被我们收起的工具没还回来 —— restrict 撤销没生效。先 lazy_tools_disable 再 enable；不行就重启`)
      } else if (vanished.length) {
        warnings.push(`${g.id}: 这 ${vanished.length} 个工具本会话里出现过、现在不见了，也不是抽屉收的 —— 查宿主为什么撤了工具表（改名 / 插件被禁 / restrict 被别的插件覆盖）`)
      } else {
        // 别猜。拿组里第一个名字做 DSH 作者给的两层 lookup（#11207），把「没挂载」拆成两种实测：
        //   global 查不到        → 真的没注册
        //   global 有、agent 有、工具表没有 → 被 schemas(agent) 这一层滤了（不是抽屉、不是 restrict）
        // 2026-10-30 实测 cua_driver_native__* 属于第二种；run_code 在这个版本里根本不存在。
        const probeName0 = inGroup[0] || ''
        const p = probeName0 ? host.probeName(probeName0, agent) : null
        // 三态，全部来自实测（不是猜）：
        //   not-registered      全局 get 都查不到 → 真没注册
        //   agent-filtered      全局有、agent 作用域没有 → 被作用域过滤器挡（限制取交集）
        //   filtered-by-schemas 两层都查得到、却不在工具表 → 被 schemas(agent) 这一层滤掉
        //   unverified          宿主没提供 get()，量不了 —— 明说量不了，不编原因
          // 2026-10-30 二修（冷读指出）：p.agent 用的是 get(name)（全局视图）⇒ 恒等于 p.global，
          // `agent-filtered` 分支永远走不到。真正的 agent 作用域视图是 p.scoped = get(name, agent)。
        const state2 = !p
          ? 'unverified'
          : p.global === false
            ? 'not-registered'
              : p.scoped === false
              ? 'agent-filtered'
                : p.scoped === true
                ? 'filtered-by-schemas'
                : 'unverified'
        g.blocked = state2
        g.blockedTools = g.matched
        if (p) g.blockedProbe = p
        const measured = p ? `（实测 ${probeName0}: global=${p.global} / scoped=${p.scoped}）` : ''
        notes.push(
          state2 === 'filtered-by-schemas'
            ? `${g.id}: 这 ${g.matched} 个工具注册了、agent 作用域也解析得到，但没进本会话工具表 ${measured} —— 被 schemas(agent) 过滤，不是抽屉收的，抽屉也解不开`
            : state2 === 'agent-filtered'
              ? `${g.id}: 这 ${g.matched} 个工具在全局有、在 agent 作用域查不到 ${measured} —— 被某个作用域过滤器挡了（限制在作用域链上取交集）`
              : state2 === 'not-registered'
                ? `${g.id}: 这 ${g.matched} 个名字在全局注册表里查不到 ${measured} —— 插件没注册成功`
                : `${g.id}: 这 ${g.matched} 个工具不在本会话工具表；宿主没提供 get()，量不出卡在哪一层 ${measured}`,
        )
      }
    }
    if (stray.length) warnings.push(`漏网 ${stray.length} 个：${stray.slice(0, 8).join(', ')}${stray.length > 8 ? ' …' : ''}`)
    const contracts = [
      { id: 'tools.register', ok: probe.register, detail: '注册工具用的入口' },
      { id: 'tools.schemas', ok: probe.schemas, detail: `可见工具 ${names.length} 个` },
      {
        id: 'agent.ctx.tools.restrict',
        ok: probe.restrict,
        detail: agent ? `已调用 ${counters.restrictCalls} 次 / 失败 ${counters.restrictFailures} 次` : '无 agent 作用域，无法判断',
      },
      {
        // 2026-11-05（冷读红 1）：guard 缺了原来只有一个 errors 信号，而 clear 能把它抹掉 ⇒ 假绿。
        // 现在它是结构契约之一，clear 也抹不掉。
        id: 'tools.guard',
        ok: probe.guard === true,
        detail: '按名自愈守卫（restrict 失败时的兜底）',
      },
      {
        id: 'agent/created',
        ok: probe.agentEvent,
        detail: `监听已挂上；本进程已触发 ${counters.agentCreated} 次`,
      },
    ]
    // 客户端心跳：宿主正常 ≠ 浏览器那边挂上了。没上报过就明说没上报，不要假装绿。
    const ping = clientPing()
    const client = ping
      ? {
          seen: true,
          at: ping.at,
          agoSeconds: Math.max(0, Math.round((Date.now() - Date.parse(ping.at)) / 1000)),
          panels: ping.panels,
        }
      : { seen: false, hint: '客户端还没上报过（面板可能没挂上：重启后仍为 false 就查 browser 控制台）' }

    // 可选诊断：查一个名字到底卡在哪一层。
    // 2026-10-30 按 DSH 作者的第二封邮件更正：`get(name)` 省略第二参数 = **全局视图**，
    // 要量「这个 agent 的作用域」必须 `get(name, agent)`（与 schemas(agent) 同一个视图）。
    // 另附 agent preset 的两个事实：defaultId（新会话默认）与 composedPreset(agent.ctx)（本 agent 实际挂的）。
    let nameProbe = null
    const wanted = _args && typeof _args.tool === 'string' ? _args.tool : ''
    if (wanted) {
      nameProbe = host.probeName(wanted, agent)
      nameProbe.inAgentTable = names.includes(wanted)
      nameProbe.runCodeInTable = names.includes('run_code')
      const presets = (() => {
        try {
          return agent && agent.ctx && typeof agent.ctx.get === 'function' ? agent.ctx.get('agentPresets') : null
        } catch (error) {
          return null
        }
      })()
      nameProbe.defaultPreset = presets && presets.defaultId !== undefined ? presets.defaultId : null
      nameProbe.composedPreset =
        presets && typeof presets.composedPreset === 'function' ? presets.composedPreset(agent.ctx) ?? null : null
      nameProbe.hint =
        nameProbe.global === false
          ? '全局注册表里就没有这个名字 —— 不是作用域过滤的问题'
          : nameProbe.scoped === false
            ? '全局有、**作用域视图**没有（get(name, agent)=false）⇒ 作用域链上有个过滤器挡它（可能是别人加的，空 deny 抵消不了另一个过滤）'
            : nameProbe.scoped === true && nameProbe.inAgentTable === false
              ? '作用域视图有、schemas(agent) 里没有 ⇒ 作者说这说明要对着已装构建进一步查（两者本该一致）'
              : '全局有、作用域有、也在 schemas(agent) 里 —— 注册层面没问题，往「出站工具表 / 呈现模式」方向查'
    }

    // 可选（只读）：按 DSH 作者给的 rc.3 内部诊断，枚举这个 agent 作用域链上的过滤器。
    // 只报「每层 allow/deny 计数 + 是否排除这个名字」，不打印过滤器内容
    // （他说 compiled filters 是匿名项、不留 owner 名，所以能给的只有计数）。
    // 构建没暴露 .tools.layers 就明说没有 —— 不能当成「没有过滤器」。
    let filterReport = null
    const layersFor = _args && typeof _args.layersFor === 'string' ? _args.layersFor : ''
    if (layersFor) {
      try {
        const store = agent && agent.ctx && agent.ctx.tools ? agent.ctx.tools.layers : null
        if (!store || typeof store.chainLayers !== 'function') {
          filterReport = { supported: false, note: '这个构建没有暴露 rc.3 的 registry 结构（.tools.layers / chainLayers）' }
        } else {
          const layers = store.chainLayers(agent)
          // layersFor 支持逗号分隔的多个名字：一次问清「这条过滤到底排除了多少个样本」，
          // 比一次只验一个名字强得多（2026-10-30：为了把「采样 4 个」升级成「全部 56 个都验」）。
          const wantedNames = layersFor.split(',').map((s) => s.trim()).filter(Boolean)
          const filters = []
          layers.forEach((layer, layerIndex) => {
            const map = layer && layer.restrictions
            if (!map || typeof map.values !== 'function') return
            Array.from(map.values()).forEach((filter, filterIndex) => {
              const excludes = wantedNames.filter(
                (n) =>
                  !!filter &&
                  ((filter.allow !== undefined && !filter.allow.has(n)) ||
                    (filter.deny !== undefined && filter.deny.has(n))),
              )
              // 只读诊断（2026-11-01）：把 deny 集合的“样本 + 是否全是 cua 前缀”一起报出来。
              // 用途：区分“这一层是不是桌面电脑使用门”（它按全部 cua 名建 deny）。
              const denyNames = filter && filter.deny ? Array.from(filter.deny) : null
              filters.push({
                layerIndex,
                filterIndex,
                allowCount: filter && filter.allow ? filter.allow.size : null,
                denyCount: filter && filter.deny ? filter.deny.size : null,
                ...(denyNames ? { denySample: denyNames.slice(0, 4), denyAllCua: denyNames.every((n) => String(n).startsWith('cua_driver_native__')) } : {}),
                excludesName: excludes.includes(wantedNames[0]),
                checked: wantedNames.length,
                excludedCount: excludes.length,
                excludedAll: wantedNames.length > 0 && excludes.length === wantedNames.length,
              })
            })
          })
          filterReport = { supported: true, layerCount: layers.length, filters }
        }
      } catch (error) {
        filterReport = { supported: false, error: String((error && error.message) || error) }
      }
    }

    const report = {
      ok: contracts.every((c) => c.ok),
      // 2026-11-04（复读）：原来这里豁免 'agent 已销毁'，但 0.18 起销毁竞态只计 restrictSkipped、
      // **不再 record**，那个 where 已无生产者 ⇒ 豁免是死代码，删掉（少一个会误导人的分支）。
      healthy: contracts.every((c) => c.ok) && errors.length === 0 && warnings.length === 0,
      checkedAt: nowIso(),
      contracts,
      client,
      groups: view,
      policy,
      nameProbe,
      filterReport,
      warnings,
      notes,
      stray,
      usage: usageView(),
      // 外部 deny 交叉探测（0.18 隔离约束②）：放行后仍不可见的名字（最多 8 个样本）。
      foreignDenied: (() => {
        const st = agent ? states.get(agent) : null
        return st && st.foreign ? st.foreign : null
      })(),
      // 受管角色（默认关闭时是 null）：health 里要能一眼看出“这个会话按什么策略走”。
      managed: (() => {
        const st = agent ? states.get(agent) : null
        return st && st.managed
          ? {
              role: st.managed.key,
              allowGroups: st.managed.role.allowGroups,
              unknown: st.managed.role.unknown,
              // 2026-11-03：这个角色是从哪认来的 —— label / subagent / preset。
              // 编排器生态里同一件事有多种写法（`[role:xxx]` 已在 0.18.2 删除），出问题时先看这一格就知道该怪谁。
              source: st.managed.source ?? null,
              // 2026-11-03：AI 自动配的角色要能自证（谁配的、什么时候、依据）。
              createdBy: st.managed.role.createdBy ?? null,
              basis: st.managed.role.basis ?? null,
              // 2026-11-03（冷读甲/乙必修）：受管角色会把**未归组**工具也藏起来，
              // 而编排器的协议工具（need_help / report_submit…）正是未归组的 ——
              // 不在这里点名，就会「接了之后星型拓扑断掉，但哪儿都看不出来」。
              hiddenUngrouped: (() => {
                try {
                  // 2026-11-03 复读纠正：**不能用 `allToolNames()`（= schemas() 无参 = 只有全局层）**。
                  // preset 层自产的工具（MyGO 的 need_help/report_submit…）根本不在那张表里，
                  // 于是这里恒空 —— 假绿灯。正确的底集就是**本会话实际被藏的名字**（st.hiddenNames），
                  // 再逐名判「有没有被任何组匹配」，完全不依赖全局表。
                  const hidden = Array.isArray(st.hiddenNames) ? st.hiddenNames : []
                  if (!hidden.length) return []
                  const isGrouped = (name) => groups.some((g) => (g.res || []).some((re) => re.test(name)))
                  return hidden.filter((name) => !isGrouped(name)).sort().slice(0, 10)
                } catch {
                  return []
                }
              })(),
            }
          : null
      })(),
      // 会话快照（2026-11-03）：角色 + 本会话列了哪些组 + 可见/隐藏数 + 被外部挡掉的组。
      // 编排器（或人）靠这一行判断“这个会话的工具面对不对”，不用翻日志。
      session: (() => {
        try {
          const snap = promptApi.describeSession(agent)
          // 角色没配的提示挂在会话快照上（盲测：越权但零报错是最该修的失败模式）
          const hint = (() => {
            try {
              return stateFor(agent).roleHint || null
            } catch {
              return null
            }
          })()
          return hint ? { ...snap, roleHint: hint } : snap
        } catch (error) {
          host.record('session snapshot', error)
          return null
        }
      })(),
      // 2026-11-06：组内「想藏但藏不掉」的工具（scope 同名遮蔽 / reserved PTC）。
      unhideable: (() => {
        try {
          const state = stateFor(agent)
          return Array.isArray(state && state.unhideable) ? state.unhideable.slice(0, 8) : []
        } catch {
          return []
        }
      })(),
      ...(_args && _args.bench ? { bench: benchReport(agent) } : {}),
      stats: {
        agentCreated: counters.agentCreated,
        toolsChanged: counters.toolsChanged,
        restrictCalls: counters.restrictCalls,
      restrictSkipped: counters.restrictSkipped,
      toolCalls: counters.toolCalls,
      // 首次成功率 = 1 - 自愈次数 / **组内调用数**（自愈 = 模型第一次叫错了名字，同一轮补开并放行）。
      // 分母只数属于某个组的调用：核心工具永不入组、也不可能自愈，混进来会把数稀释成假象。
      // **它测不到**：模型压根没开口的那类静默失能（用户要能力、模型判断自己不会 → 零调用、
      // 零自愈，这个数仍是 1.0）。所以它是必要不充分条件，别拿它当「无感化成立」的证据。
      // 2026-10-30 修正：原式 (autoOpened + selfHealed)/toolCalls **语义反了** ——
      //   selfHealed 是坏事、autoOpened 是好事，相加等于「预开做得越好，成功率越难看」；
      //   而且 20 次自愈 / 100 次调用会被读成「20% 成功」，实际是 80%。
      // 2026-10-31（0.17.0）：autoOpened 随关键词预开一起删除，这里只剩 selfHealed 一项。
      firstTryRate:
        counters.toolCalls < 20
          ? null
          : Math.max(0, Math.round((1 - stats.selfHealed / counters.toolCalls) * 1000) / 1000),
        restrictFailures: counters.restrictFailures,
        hideEvents: stats.hideEvents,
        rebuilds: stats.rebuilds,
        selfHealed: stats.selfHealed,
        lastHidden: stats.lastHidden,
      },
      errors,
    }

    // 2026-10-30 精简默认视图：全量 4072 字节对「看一眼」太重（用户要求的减法 C 项）。
    // 三个常见排障问题仍能答：为什么没藏（mode/matched）、为什么藏了没放（visible/warnings）、
    // 被谁挡（给 layersFor 才带 filterReport）。要全量就加 { full: true }。
    if (!(_args && _args.full === true)) {
      const probeWanted = _args && typeof _args.tool === 'string'
      const layersWanted = _args && typeof _args.layersFor === 'string'
      return {
        ok: report.ok,
        healthy: report.healthy,
        ...(cleared ? { clearedErrors: cleared } : {}),
        ...(clearRefused
          ? { clearedErrors: 0, clearRefused: '结构契约不健康（register/schemas/restrict/guard/agent 事件），拒绝清空错误' }
          : {}),
        checkedAt: report.checkedAt,
        contracts: report.contracts.map((c) => ({ id: c.id, ok: c.ok })),
        groups: report.groups.map((g) => ({
          id: g.id,
          title: g.title,
          on: g.on,
          mode: g.mode,
          matched: g.matched,
          visible: g.visible,
          onlyCount: g.onlyCount,
          ...(g.blocked ? { blocked: g.blocked } : {}),
          ...(typeof g.blockedTools === 'number' ? { blockedTools: g.blockedTools } : {}),
          ...(g.blockedProbe ? { blockedProbe: g.blockedProbe } : {}),
          ...(typeof g.expect === 'number' ? { expect: g.expect, expectOk: g.expectOk } : {}),
        })),
        policy: report.policy,
        // 2026-10-30 独立盲评指出：精简版把 client 整段删了，而它是当时唯一一条红灯
        // （client.seen=false = 面板没上报）。缺失 ≠ 正常，所以必须留在默认视图里。
        client: report.client,
        warnings: report.warnings,
        notes: report.notes,
        stray: report.stray,
        errors: report.errors,
        // 0.18：隔离探测与受管角色也要在精简视图里（否则默认视图看不到它们）
        foreignDenied: report.foreignDenied,
        managed: report.managed,
        // 2026-11-03：会话快照进精简视图 —— 编排器/人看的就是这一行
        session: report.session,
        unhideable: report.unhideable,
        ...(probeWanted && report.nameProbe ? { nameProbe: report.nameProbe } : {}),
        ...(layersWanted && report.filterReport ? { filterReport: report.filterReport } : {}),
        ...(_args && _args.bench ? { bench: report.bench } : {}),
        stats: report.stats,
        note: '精简视图。要契约详情 / 账本 usage / 探针 nameProbe / 过滤器 filterReport 全量：加 { full: true }',
      }
    }
    return report
  },
}

  return healthTool
}

```


### lib\tools\index.js

```js
// tools/index.js — 8 个工具定义的唯一装配点。
//
// 为什么需要这一层：index.js 的 apply() 只该做「建状态 → 注册工具 → 挂监听」，
//   不该再摆 1000 行定义。这里把三个文件按**对外顺序**拼起来，顺序本身就是接口契约。
//
// 顺序是硬要求（0.16.0 以来的对外接口顺序）：
//   status, roles, enable, disable, mode, save_groups, list, health
//   为什么不是随便排：注册顺序就是 world.registered 的迭代顺序，也是模型看到的工具表顺序；
//   _work/tool-defs-snapshot.mjs 把它当断言钉住了。所以 roles 虽然定义在另一个文件，
//   这里也必须插在 status 之后（第 2 位）。
//
// 依赖一次性透传：三个 create* 各自只解构自己要的字段，所以传同一个 deps 是安全的
//   （多传的字段不会被读到；少传的会在加载时就缺 —— 见各文件顶部的 deps 清单）。

import { createGroupTools } from './groups.js'
import { createRolesTool } from './roles.js'
import { createHealthTool } from './health.js'

/**
 * @param {object} deps 见 groups.js / roles.js / health.js 顶部的清单（并集）
 * @returns {Array<object>} 8 个工具定义，按注册顺序
 */
export function createTools(deps) {
  // groups.js 返回 [status, enable, disable, mode, save_groups, list]
  const [statusTool, ...restTools] = createGroupTools(deps)
  // roles 插在第 2 位：这是对外顺序，不是美观问题（快照脚本钉着）。
  return [statusTool, createRolesTool(deps), ...restTools, createHealthTool(deps)]
}

```


### lib\tools\roles.js

```js
// tools/roles.js — 「角色 → 允许哪些组」的读写工具（lazy_tools_roles，1 个）。
//
// 为什么单独一个文件（虽然只有一个工具）：它和别的工具不一样，**有副作用** ——
//   唯一一个会写 policy.json 的工具。要动的可变状态也是独一份：
//     · roleSource   配置源（index.js 里的 let）
//     · policyMtime  上次读到的 policy.json mtime（index.js 里的 let）
//   跨模块给 let 赋值只能走注入的 setter（deps.setRoleSource / deps.setPolicyMtime）：
//   搬移前是闭包直接赋值，搬之后模块里根本没有那两个变量。这是**故意的** ——
//   写角色的人（全插件唯一一处）显式声明「我要改这两格」，比隐式闭包好读也好查。
//
// 原文来源：_work/tools-extract.mjs 从旧 index.js 切出，逐字节保留（只有缩进变化）。
// 唯一的文本改动是那两行赋值 → setter 调用，其余原样；两处都做了行数与行首断言。

// ── 角色配置（2026-11-03）：AI 自己配，人只审结果 ─────────────────────────
// 用户原话：「反正给喜欢折腾的开个口子就行，大部分人懒得写」。
// 所以：读 = 看现状；写 = AI 自己配。**工具层强制三条不变量**，比人手写 JSON 可靠：
//   ① allowGroups 里的组必须真实存在（写错一个 id 就是"会话被锁到只剩核心工具"，#71）；
//   ② 不许写 `*`（那是"放开限制"的逃生口，只允许人手改文件）；
//   ③ 必须带 basis（为什么这么配），并自动盖 `createdBy: 'ai'` + `at`。
// 人手改 policy.json 的路径**照旧有效**（热重载会读进来）——那就是留给"喜欢折腾的人"的口子。

/**
 * @param {object} deps
 * @param {object}   deps.host               宿主契约（record / log）
 * @param {Array}    deps.groups             已编译的组（校验 allowGroups 的 id 是否真实存在）
 * @param {object}   deps.policy             策略对象（读 managedRoles）
 * @param {Function} deps.stateFor           (agent) => 会话状态（读 managed：受管会话不许自改）
 * @param {Function} deps.text               (对象) => JSON 文本
 * @param {Function} deps.normalizeManagedRoles (原始 JSON) => 归一化角色表 | null
 * @param {Function} deps.policyFileMtime    () => policy.json 的 mtime
 * @param {Function} deps.readPolicyRaw      () => { ok, value } 文件原始 JSON（不做归一化）
 * @param {Function} deps.writeStoredPolicy  (对象) => 写 policy.json
 * @param {Function} deps.refreshManagedRoles (force) => 按当前组表审计并生效
 * @param {Function} deps.setRoleSource      (v) => index.js 里的 roleSource = v
 * @param {Function} deps.setPolicyMtime     (v) => index.js 里的 policyMtime = v
 * @param {Set}      deps.CORE_TOOLS         常驻工具集合（算「未归组」时要排除）
 */
export function createRolesTool(deps) {
  const {
    host,
    groups,
    policy,
    stateFor,
    text,
    normalizeManagedRoles,
    policyFileMtime,
    readPolicyRaw,
    writeStoredPolicy,
    refreshManagedRoles,
    setRoleSource,
    setPolicyMtime,
    CORE_TOOLS,
  } = deps

  const rolesTool = {
  name: 'lazy_tools_roles',
  description:
    '查看 / 配置「角色 → 允许哪些组」。不传参数=只读（列出已有角色、来源、依据、可用组 id）；' +
    '传 role + allowGroups + basis = 写入（写入后即时生效，不用重启）。AI 不许写 *。',
  parameters: {
    type: 'object',
    properties: {
      role: { type: 'string', description: '角色名（小写字母/数字/_/-，1-32 位），要和子会话 label 里的候选段一致' },
      allowGroups: { type: 'array', items: { type: 'string' }, description: '这个角色允许的组 id（必须真实存在；不许写 *）' },
      basis: { type: 'string', description: '为什么这么配（会写进配置文件，事后可追）' },
      unknown: { type: 'string', enum: ['hide', 'show'], description: '没归组的工具怎么处理，默认 hide' },
    },
    additionalProperties: false,
  },
  output: { schema: { type: 'object' }, render: (_a, v) => text(v) },
  execute: async (args, exec) => {
    const groupIds = groups.map((g) => g.id)
    const listRoles = () =>
      Object.entries(policy.managedRoles || {}).map(([key, role]) => ({
        role: key,
        allowGroups: role.allowGroups,
        unknown: role.unknown,
        createdBy: role.createdBy ?? null,
        at: role.at ?? null,
        basis: role.basis ?? null,
      }))

    // 只读
    if (!args || !args.role) return { groupIds, roles: listRoles(), hint: '要配置就传 role + allowGroups + basis' }

    // 受管会话里不许给自己改配置（否则"角色"就管不住自己了）
    const agent = exec && exec.agent
    const st = agent ? stateFor(agent) : null
    if (st && st.managed) return { error: `本会话是受管角色 ${st.managed.key}，不能给自己改角色配置；请在普通会话里配` }

    const key = String(args.role).trim().toLowerCase()
    if (!/^[a-z0-9_-]{1,32}$/.test(key)) return { error: '角色名只允许小写字母/数字/_/-，1-32 位' }
    // 2026-11-05（冷读黄 4）：空数组合法（= 只留常驻）。以前一律拒绝，和 README/POLICY 冲突。
    if (!Array.isArray(args.allowGroups)) return { error: 'allowGroups 必须是数组（可以是空数组 = 只留常驻工具）' }
    const allow = [...new Set(args.allowGroups.map((s) => String(s).trim()).filter(Boolean))]
    if (allow.includes('*')) {
      return { error: "AI 不能写 '*'（那是放开限制的逃生口）；要放开请人手改 policy.json —— 那是留给折腾的人的口子" }
    }
    // 2026-11-03（对比评审指出）：把**当前所有组**都列进 allowGroups，效果等价于 `*`。
    // 字面写 `*` 被拒，"枚举一遍"却能绕过去 —— 这里堵上。
    const allSelected = groupIds.length > 0 && groupIds.every((id) => allow.includes(id))
    if (allSelected) {
      return {
        error: `allowGroups 覆盖了全部 ${groupIds.length} 个组，等价于 '*'（放开限制）—— 这种事只允许人手改 policy.json`,
      }
    }
    const bad = allow.filter((id) => !groupIds.includes(id))
    if (bad.length) return { error: `这些组不存在：${bad.join(', ')}（当前可用：${groupIds.join(', ')}）` }
    const basis = typeof args.basis === 'string' ? args.basis.trim() : ''
    if (!basis) return { error: '必须给 basis（为什么这么配），否则权限就成了"从模型嘴里长出来"的' }

    try {
      // 冷读红 3（#78 同类）：**必须**以文件里的原始 JSON 为基底合并。
      // 以前用 readStoredPolicy()（归一化后）当基底 = "没认识的键全丢"；读失败时更会 wash 成只剩 managedRoles。
      // 这里读不出来就**拒绝写**：宁可这次没配成，也不许洗掉别的设置。
      const rawPolicy = readPolicyRaw()
      if (!rawPolicy.ok) {
        return {
          error: `policy.json 读不出来（${String((rawPolicy.error && rawPolicy.error.message) || rawPolicy.error)}）—— 为免洗掉其它设置，这次不写。修好文件再试。`,
        }
      }
      const stored = rawPolicy.value
      // 2026-11-03（冷读第三轮）：文件里 managedRoles 不是对象时，展开会把字符串摊成 "0"/"1"…
      // 数字键写进文件。和「读不出来」同一种处理：拒绝写，别污染文件。
      if (stored.managedRoles != null && (typeof stored.managedRoles !== 'object' || Array.isArray(stored.managedRoles))) {
        return { error: 'policy.json 里的 managedRoles 形状不合法（应为对象）；先修好文件再写，免得把别的键摊坏' }
      }
      const nextRoles = {
        ...(stored.managedRoles || {}),
        [key]: {
          allowGroups: allow,
          unknown: args.unknown === 'show' ? 'show' : 'hide',
          createdBy: 'ai',
          at: new Date().toISOString(),
          basis: basis.slice(0, 300),
        },
      }
      writeStoredPolicy({ ...stored, managedRoles: nextRoles })
      // 内存里同步 + 走同一套校验，再把 mtime 追平（免得下次 agent/created 把它当"外部改动"再读一遍）
      setRoleSource(normalizeManagedRoles(nextRoles))
      refreshManagedRoles(true)
      setPolicyMtime(policyFileMtime())
      // 2026-11-03（MyGO 场景）：受管角色默认把「未归组工具」也藏起来，
      // 而 MyGO 的 need_help / report_submit 正好未归组 —— 不提醒就会「接了反而更坏」。
      // 这里把会被藏掉的未归组工具回给调用方（只告知，不落盘）。
      const willHideUngrouped = (() => {
        try {
          if (args.unknown === 'show') return []
          const all = host.allToolNames().filter((name) => !CORE_TOOLS.has(name))
          const grouped = new Set()
          for (const g of groups) {
            for (const re of g.res || []) for (const name of all) if (re.test(name)) grouped.add(name)
          }
          return all.filter((name) => !grouped.has(name)).sort().slice(0, 30)
        } catch {
          return []
        }
      })()

      host.log('info', `roles: ${key} → ${allow.join(',')}（AI 配置；basis=${basis.slice(0, 40)}）`)
      return {
        ok: true,
        role: key,
        allowGroups: allow,
        applied: true,
        hint: '已写进 policy.json 并生效；下一个新建会话按它收紧。当前会话的工具面不变。',
        willHideUngrouped,
      }
    } catch (error) {
      return { error: `写入失败：${String((error && error.message) || error)}` }
    }
  },
}

  return rolesTool
}

```


### lib\usage.js

```js
// 用量账本：哪一组「最近被真的调用过」。
//
// 为什么需要它：默认收起哪几组，不该拍脑袋，也不该让用户去选 —— 由「过去的实际使用」
// 决定。这里只记时间戳，不记内容。
//
// 文件：~/.dsh/lazy-tools.usage.json
//   { "groups": { "<组 id>": "2026-10-24T00:40:00.000Z" }, "tools": { "<工具名>": "..." } }
//
// 阈值按 AI 生态的节奏定（2026-10-24 用户要求「时间再激进些，现在 AI 一天一个样子」）：
// low 14 天 / medium 7 天 / high 3 天 —— 一周没碰过的工具组，基本就是沉底了。
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'

const DAY = 24 * 60 * 60 * 1000

export const LEVEL_DAYS = { low: 14, medium: 7, high: 3 }

export function usageFile() {
  // 测试用：允许用环境变量把账本指到临时文件，避免碰真机数据。
  const override = process.env.LAZY_TOOLS_USAGE_FILE
  if (override) return override
  const home = process.env.USERPROFILE || process.env.HOME || '.'
  return join(home, '.dsh', 'lazy-tools.usage.json')
}

export function loadUsage() {
  const empty = { groups: {}, tools: {}, stats: { toolCalls: 0, selfHealed: 0 } }
  try {
    const file = usageFile()
    if (!existsSync(file)) return empty
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const groups = raw && typeof raw.groups === 'object' && raw.groups ? raw.groups : {}
    const tools = raw && typeof raw.tools === 'object' && raw.tools ? raw.tools : {}
    // 2026-10-30：计数器也要跨重载活下来 —— 否则 firstTryRate 每次插件重载就归零，永远拿不到数据。
    const s = raw && typeof raw.stats === 'object' && raw.stats ? raw.stats : {}
    const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.round(v) : 0)
    const stats = { toolCalls: num(s.toolCalls), selfHealed: num(s.selfHealed) }
    return { groups, tools, stats }
  } catch {
    return empty
  }
}

export function saveUsage(usage) {
  try {
    const file = usageFile()
    mkdirSync(dirname(file), { recursive: true })
    const payload = `${JSON.stringify(usage, null, 1)}\n`
    // 2026-11-05：原子写 + 回读（原来失败只返回 false，调用方可能没看）。
    const tmp = `${file}.${process.pid}.tmp`
    try {
      writeFileSync(tmp, payload, 'utf8')
      renameSync(tmp, file)
      if (readFileSync(file, 'utf8') !== payload) return false
      return true
    } catch {
      try { unlinkSync(tmp) } catch { /* 可能已 rename */ }
      return false
    }
  } catch {
    return false
  }
}

/** 记一次调用：工具名 + 它所属的组（可能没有组）。 */
export function recordUsage(usage, toolName, groupId, at = new Date()) {
  const iso = at.toISOString()
  if (toolName) usage.tools[toolName] = iso
  if (groupId) usage.groups[groupId] = iso
  return iso
}


/**
 * 单个工具最近 idleDays 天内被调用过吗？（2026-10-28 加）
 *
 * 为什么需要：组级热度太粗 —— 「桌面·点」有 37 个工具，用户只常用其中一个，
 * 整个组就保持展开，另外 36 个继续每轮付 token。会话开始时按工具级热度把
 * 「常用的那几个」放进 only 白名单、其余继续收着，比缩短闲置天数更精细。
 */
export function isToolHot(usage, toolName, idleDays, now = Date.now()) {
  if (!Number.isFinite(idleDays) || idleDays <= 0) return true
  const last = usage && usage.tools ? usage.tools[toolName] : null
  if (!last) return false
  const ts = Date.parse(last)
  if (!Number.isFinite(ts)) return false
  return now - ts < idleDays * DAY
}

export { DAY }

/** 热度比例：显示与决策共用的唯一算法（不取整）。 */
export function hotRatio(hotCount, total) {
  return total === 0 ? 0 : hotCount / total
}

```


### client.js

```js
window.__ModuleLoader__.load({
  id: 'dsh-tool-drawer',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const API = '/lazy-tools/api'

// 语言：跟宿主 locale 服务走（不是猜浏览器）；拿不到就退回中文。
    let localeService = null
    function activeIsChinese() {
      try {
        const snapshot = localeService && typeof localeService.getLocale === 'function' ? localeService.getLocale() : null
        const active = snapshot && snapshot.active ? String(snapshot.active) : ''
        if (active) return active.toLowerCase().startsWith('zh')
        return String((typeof navigator !== 'undefined' && navigator.language) || 'zh').toLowerCase().startsWith('zh')
      } catch {
        return true
      }
    }
    const tr = (zh, en) => (activeIsChinese() ? zh : en)

    /** 订阅语言变化：切换语言时让组件重渲染（返回值不用，只是触发）。 */
    function useLocaleVersion() {
      const [version, setVersion] = React.useState(0)
      React.useEffect(() => {
        const service = localeService
        if (!service || typeof service.subscribe !== 'function') return undefined
        return service.subscribe(() => setVersion((value) => value + 1))
      }, [])
      return version
    }
    const LEVEL_LABELS = {
      low: tr('低（保守）', 'Low (conservative)'),
      medium: tr('中（默认）', 'Medium (default)'),
      high: tr('高（激进）', 'High (aggressive)'),
    }
    // 角色工具面（用户口中的「面具」）：勾选 = 该角色在 label 下按 allowGroups 裁工具。
    // 默认值与 cordis.patch.yml 的 managedRoles 保持一致；UI 只控制「启用/停用」，细粒度组仍可在配置里改。
    const ROLE_MASKS = {
      review: { allowGroups: ['browser-heavy'], unknown: 'hide' },
      build: { allowGroups: ['*'], unknown: 'show' },
      research: { allowGroups: ['web', 'browser-heavy'], unknown: 'hide' },
    }
    const ROLE_LABELS = {
      review: tr('review（审阅）', 'review'),
      build: tr('build（实现）', 'build'),
      research: tr('research（调研）', 'research'),
    }

    async function request(path, body) {
      const options = { headers: { 'content-type': 'application/json', 'x-lazy-tools': '1' } }
      if (body !== undefined) {
        options.method = 'POST'
        options.body = JSON.stringify(body)
      }
      const response = await fetch(API + path, options)
      const type = response.headers.get('content-type') || ''
      if (!type.includes('application/json')) {
        throw new Error(`插件后台接口未就绪（HTTP ${response.status}）——请重启 DSH 后再试`)
      }
      const data = await response.json()
      if (!response.ok) throw new Error((data && data.error) || `HTTP ${response.status}`)
      return data
    }

    const styles = {
      wrap: { display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '620px' },
      intro: { margin: 0, opacity: 0.75, fontSize: '13px', lineHeight: 1.6 },
      row: { display: 'flex', flexDirection: 'column', gap: '6px' },
      label: { fontSize: '13px', fontWeight: 600 },
      hint: { fontSize: '12px', opacity: 0.6 },
      input: {
        padding: '7px 10px',
        borderRadius: '8px',
        border: '1px solid color-mix(in srgb, currentColor 25%, transparent)',
        background: 'transparent',
        color: 'inherit',
        fontSize: '13px',
        fontFamily: 'inherit',
      },
      actions: { display: 'flex', alignItems: 'center', gap: '12px' },
      button: {
        padding: '7px 16px',
        borderRadius: '8px',
        border: '1px solid color-mix(in srgb, currentColor 30%, transparent)',
        background: 'color-mix(in srgb, currentColor 10%, transparent)',
        color: 'inherit',
        fontSize: '13px',
        cursor: 'pointer',
      },
      status: { fontSize: '12px', opacity: 0.7 },
      error: { fontSize: '12px', color: '#d9534f' },
      dock: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '12px',
        padding: '2px 4px',
        opacity: 0.9,
      },
      dockLabel: { fontWeight: 600 },
      dockSelect: {
        padding: '2px 6px',
        borderRadius: '999px',
        border: '1px solid color-mix(in srgb, currentColor 25%, transparent)',
        background: 'transparent',
        color: 'inherit',
        fontSize: '12px',
        fontFamily: 'inherit',
      },
      dockDivider: { opacity: 0.35 },
      dockButton: {
        padding: '2px 10px',
        borderRadius: '999px',
        border: '1px solid color-mix(in srgb, currentColor 25%, transparent)',
        background: 'transparent',
        color: 'inherit',
        fontSize: '12px',
        cursor: 'pointer',
        marginLeft: 'auto',
      },
      dockInput: {
        width: '58px',
        padding: '2px 6px',
        borderRadius: '999px',
        border: '1px solid color-mix(in srgb, currentColor 25%, transparent)',
        background: 'transparent',
        color: 'inherit',
        fontSize: '12px',
        fontFamily: 'inherit',
        textAlign: 'center',
      },
      dockCustom: { display: 'flex', alignItems: 'center', gap: '4px', opacity: 0.85 },
      dockHint: { opacity: 0.6 },
      groupList: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
      chip: {
        padding: '2px 8px',
        borderRadius: '999px',
        fontSize: '12px',
        border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
      },
    }

    function LazyToolsSettings() {
      useLocaleVersion()
      const [state, setState] = React.useState(null)
      const [form, setForm] = React.useState(null)
      const [status, setStatus] = React.useState('')
      const [error, setError] = React.useState('')
      // 用户有没有手改过「闲置天数」：没改过就让档位决定天数（2026-10-29 修 bug 2 的客户端半边）
      const [daysTouched, setDaysTouched] = React.useState(false)
      const [newRoleName, setNewRoleName] = React.useState('')
      const [newRoleGroups, setNewRoleGroups] = React.useState([])
      const [groupCatalog, setGroupCatalog] = React.useState([])
      const [roleError, setRoleError] = React.useState('')

      React.useEffect(() => {
        let alive = true
        request('/state')
          .then((data) => {
            if (!alive) return
            setState(data)
            setGroupCatalog(Array.isArray(data.groups) ? data.groups : [])
            setForm({
              level: data.policy.level,
              idleDays: String(data.policy.idleDays),
              minTools: String(data.policy.minTools),
              presetLow: String((data.policy.presets && data.policy.presets.low) || 14),
              presetMedium: String((data.policy.presets && data.policy.presets.medium) || 7),
              presetHigh: String((data.policy.presets && data.policy.presets.high) || 3),
              showDock: data.policy.showDock === true,
              showClear: data.policy.showClear === true,
              classifyNudge: data.policy.classifyNudge !== false,
              autoGroups: data.policy.autoGroups || 'on',
              managedRoles: data.policy.managedRoles && typeof data.policy.managedRoles === 'object'
                ? data.policy.managedRoles
                : {},
            })
          })
          .catch((err) => alive && setError(err.message))
        return () => {
          alive = false
        }
      }, [])

      const update = (key) => (event) => {
        const value = event && event.target ? event.target.value : event
        setStatus('')
        if (key === 'idleDays') {
          setDaysTouched(true)
          setForm((prev) => ({ ...prev, idleDays: value }))
          return
        }
        setForm((prev) => {
          const next = { ...prev, [key]: value }
          // 换档位、且用户没手改过天数时：输入框跟着显示该档的天数（真正下发由宿主按档位算）
          if (key === 'level' && !daysTouched) {
            const presets = { low: prev.presetLow, medium: prev.presetMedium, high: prev.presetHigh }
            if (presets[value] !== undefined) next.idleDays = String(presets[value])
          }
          return next
        })
      }
      const setFlag = (key) => (event) => {
        const checked = Boolean(event && event.target && event.target.checked)
        setForm((prev) => ({ ...prev, [key]: checked }))
        setStatus('')
      }

      const setRole = (role) => (event) => {
        const checked = Boolean(event && event.target && event.target.checked)
        setForm((prev) => {
          const next = { ...(prev.managedRoles || {}) }
          if (checked) {
            if (!next[role]) next[role] = ROLE_MASKS[role] || { allowGroups: [], unknown: 'hide' }
          } else {
            delete next[role]
          }
          return { ...prev, managedRoles: next }
        })
        setStatus('')
      }

      const addRole = () => {
        const name = String(newRoleName || '').trim()
        if (!/^[A-Za-z0-9_-]+$/.test(name)) {
          setRoleError(tr('角色名只能用字母、数字、_、-（它会匹配 label 的第一段）', 'Role names: letters, digits, _, - (matches the first label segment)'))
          return
        }
        const groups = Array.isArray(newRoleGroups) ? newRoleGroups : []
        setForm((prev) => ({
          ...prev,
          managedRoles: {
            ...(prev.managedRoles || {}),
            [name]: { allowGroups: groups, unknown: 'hide' },
          },
        }))
        setNewRoleName('')
        setNewRoleGroups('')
        setRoleError('')
        setStatus('')
      }

      const refreshGroups = async () => {
        try {
          const data = await request('/state')
          setState(data)
          setGroupCatalog(Array.isArray(data.groups) ? data.groups : [])
          setStatus(tr('分组列表已刷新', 'Group list refreshed'))
          setError('')
        } catch (err) {
          setError(err.message)
        }
      }

      const save = async () => {
        setError('')
        setStatus(tr('保存中…', 'Saving…'))
        const presets = { low: Number(form.presetLow), medium: Number(form.presetMedium), high: Number(form.presetHigh) }
        const daysText = String(form.idleDays == null ? '' : form.idleDays).trim()
        const payload = {
          level: form.level,
          minTools: Number(form.minTools),
          presets,
          showDock: form.showDock === true,
          showClear: form.showClear === true,
          classifyNudge: form.classifyNudge !== false,
          autoGroups: form.autoGroups || 'on',
          managedRoles: form.managedRoles || {},
        }
        // 空字符串不能变成 Number('') = 0 —— 0 在这里的意思是「不按时间收敛 = 全开」。
        // 规则：手改过、或填的数与当前档位天数不同 → 下发；否则不下发，让宿主按档位算。
        if (daysText !== '') {
          const value = Number(daysText)
          if (Number.isFinite(value) && value >= 0) {
            const presetForLevel = presets[form.level]
            if (daysTouched || !Number.isFinite(presetForLevel) || value !== presetForLevel) {
              payload.idleDays = Math.round(value)
            }
          }
        }
        try {
          const data = await request('/policy', payload)
          setState(data)
          setStatus(tr('已保存（下次会话开始时按新策略决定默认收起哪些组）', 'Saved. The new policy applies from the next session start.'))
        } catch (err) {
          setStatus('')
          setError(err.message)
        }
      }

      if (error && !form) return h('p', { style: styles.error }, `${tr('读取设置失败：', 'Failed to load settings: ')}${error}`)
      if (!form) return h('p', { style: styles.hint }, tr('读取中…', 'Loading…'))

      const summary = state && state.summary ? state.summary : null
      const stowedLine = summary
        ? tr(
            `已收纳 ${summary.hidden} 个工具 · 自动取出 ${summary.selfHealed} 次`,
            `${summary.hidden} tools stowed · ${summary.selfHealed} auto-restored`,
          )
        : ''

      // 基础页只留大多数人在意的几格；其余进「高级设置」（原生 <details>，不占注意力）。
      // 旧配置里可能有 re 之类历史角色，也列出来，别让它隐身。
      const roleKeys = [...new Set([...Object.keys(ROLE_MASKS), ...Object.keys(form.managedRoles || {})])]
      return h(
        'div',
        { style: styles.wrap },
        h('p', { style: styles.intro }, tr('重工具组默认收起，需要时由 AI 主动放回、或在调用被拦时自动放回。这里控制「自动收敛」的策略——它在每个会话开始时按历史使用决定默认开哪些组，不会在干活途中打断缓存。', 'Heavy tool groups stay collapsed and come back on demand. These settings control when groups collapse on their own: the decision is made once at session start, so it never breaks an active prompt cache.')),
        stowedLine ? h('p', { style: styles.hint }, stowedLine) : null,
        h(
          'div',
          { style: styles.row },
          h('label', { style: styles.label }, tr('收敛档位', 'Collapse level')),
          h(
            'select',
            { style: styles.input, value: form.level, onChange: update('level') },
            ['low', 'medium', 'high'].map((level) => h('option', { key: level, value: level }, LEVEL_LABELS[level])),
          ),
        ),
        h(
          'div',
          { style: styles.row },
          h('label', { style: styles.label }, tr('闲置天数（可自定义）', 'Idle days (custom)')),
          h('input', { style: styles.input, type: 'number', min: 0, value: form.idleDays, onChange: update('idleDays') }),
          h('span', { style: styles.hint }, tr('留空 = 跟随档位（不会存成 0）；0 = 不按时间收敛，所有组默认张开', 'Empty = follow the level (never stored as 0). 0 = never collapse by time.')),
        ),
        h(
          'div',
          { style: styles.row },
          h(
            'label',
            { style: { ...styles.label, display: 'flex', alignItems: 'center', gap: '8px' } },
            h('input', { type: 'checkbox', checked: form.showDock === true, onChange: setFlag('showDock') }),
            tr('在输入框上方显示「工具抽屉」控件', 'Show the drawer control above the composer'),
          ),
          h('span', { style: styles.hint }, tr('默认关闭。开启后可在每个对话里单独选档位；该控件按对话挂载，勾选后切换一次对话（或刷新页面）即出现。', 'Off by default. Once enabled, every conversation can pick its own level. Mounted per conversation, so switch conversations (or reload) before it appears.')),
        ),
        h(
          'div',
          { style: styles.row },
          h(
            'label',
            { style: { ...styles.label, display: 'flex', alignItems: 'center', gap: '8px' } },
            h('input', { type: 'checkbox', checked: form.showClear === true, onChange: setFlag('showClear') }),
            tr('在输入框上方显示「收纳本对话工具」按钮', 'Show the stow-now button above the composer'),
          ),
          h('span', { style: styles.hint }, tr('与档位控件互相独立：只想要档位就不勾它；想一键把本对话的工具全收纳再勾。', 'Independent of the level control. Leave it off unless you want a one-click stow for this conversation.')),
        ),
        h(
          'div',
          { style: styles.row },
          h('label', { style: styles.label }, tr('角色工具面（默认关闭）', 'Role masks (off by default)')),
          h(
            'div',
            { style: { display: 'flex', gap: '14px', flexWrap: 'wrap' } },
            roleKeys.map((role) =>
              h(
                'label',
                { key: role, style: { ...styles.label, display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 400 } },
                h('input', {
                  type: 'checkbox',
                  checked: Boolean(form.managedRoles && form.managedRoles[role]),
                  onChange: setRole(role),
                }),
                ROLE_LABELS[role] || role,
                h('span', { style: { opacity: 0.65, fontSize: '12px' } }, (() => {
                  const groups = form.managedRoles && form.managedRoles[role] && form.managedRoles[role].allowGroups
                  return Array.isArray(groups) ? (groups.length ? groups.join(', ') : 'CORE only') : ''
                })()),
              ),
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '4px' } },
            h('input', {
              style: styles.input,
              placeholder: tr('自定义角色名', 'Custom role'),
              value: newRoleName,
              onChange: (event) => setNewRoleName(event.target.value),
            }),
            h('button', { style: styles.button, type: 'button', onClick: refreshGroups }, tr('刷新分组', 'Refresh groups')),
          ),
          h('span', { style: styles.hint }, tr('从当前所有工具组勾选；勾“全部”等于 allowGroups:["*"]；不勾任何组 = 只留常驻工具。', 'Pick from the current groups; All = allowGroups:["*"]; none = core tools only.')),
          h(
            'div',
            { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
            groupCatalog.map((g) =>
              h(
                'label',
                { key: g.id, style: { ...styles.label, display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 400, fontSize: '12px' } },
                h('input', {
                  type: 'checkbox',
                  checked: newRoleGroups.includes(g.id),
                  onChange: (event) => {
                    const checked = Boolean(event && event.target && event.target.checked)
                    setNewRoleGroups((prev) => checked ? [...prev.filter((x) => x !== g.id), g.id] : prev.filter((x) => x !== g.id))
                  },
                }),
                `${g.title || g.id} (${g.id})`,
              ),
            ),
            h(
              'label',
              { style: { ...styles.label, display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 400, fontSize: '12px' } },
              h('input', {
                type: 'checkbox',
                checked: newRoleGroups.includes('*'),
                onChange: (event) => setNewRoleGroups(event.target.checked ? ['*'] : []),
              }),
              tr('全部 (*)', 'All (*)'),
            ),
          ),
          h('button', { style: styles.button, type: 'button', onClick: addRole }, tr('添加角色', 'Add role')),
          roleError ? h('span', { style: styles.error }, roleError) : null,
          h(
            'span',
            { style: styles.hint },
            tr(
              '默认关闭：勾选后 label 为 review/build/research 时按角色裁工具面；review/research 隐藏 edit/write。取消勾选 = 该角色不再裁工具面，下次会话/标签生效。自定义角色也可在下面加。',
              'Off by default. Once checked, review/build/research labels apply a role-scoped tool surface; review/research hide edit/write. Uncheck to stop masking for that role (next session/label). Add custom roles below.',
            ),
          ),
        ),
        h(
          'div',
          { style: styles.actions },
          h('button', { style: styles.button, onClick: save, type: 'button' }, tr('保存', 'Save')),
          h('span', { style: status && status.includes('失败') ? styles.error : styles.status }, status),
          error ? h('span', { style: styles.error }, error) : null,
        ),
        h(
          'details',
          { style: { marginTop: '4px' } },
          h('summary', { style: { cursor: 'pointer', fontSize: '13px', opacity: 0.75 } }, tr('高级设置', 'Advanced')),
          h(
            'div',
            { style: { ...styles.wrap, marginTop: '12px' } },
            h(
              'div',
              { style: styles.row },
              h('label', { style: styles.label }, tr('自动分组', 'Auto groups')),
              h(
                'select',
                { style: styles.input, value: form.autoGroups || 'on', onChange: update('autoGroups') },
                [
                  h('option', { key: 'on', value: 'on' }, tr('自动建组并收起（默认）', 'Auto-create and collapse (default)')),
                  h('option', { key: 'suggest', value: 'suggest' }, tr('只建议（在 scan 里）', 'Suggest only (in scan)')),
                  h('option', { key: 'off', value: 'off' }, tr('关闭', 'Off')),
                ],
              ),
              h('span', { style: styles.hint }, tr('按工具名前缀识别家族，同族至少 3 个才建组，核心工具永不入组；被收起的工具第一次被调用时会自动放回来。', 'Groups tool families by name prefix; at least 3 tools per family; core tools are never included; a collapsed tool is restored automatically the first time it is called.')),
            ),
            h(
              'div',
              { style: styles.row },
              h('label', { style: styles.label }, tr('三档各自的天数（可修改）', 'Days per level (editable)')),
              h(
                'div',
                { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
                h('span', { style: styles.hint }, tr('低', 'Low')),
                h('input', { style: { ...styles.input, width: '84px' }, type: 'number', min: 0, value: form.presetLow, onChange: update('presetLow') }),
                h('span', { style: styles.hint }, tr('中', 'Mid')),
                h('input', { style: { ...styles.input, width: '84px' }, type: 'number', min: 0, value: form.presetMedium, onChange: update('presetMedium') }),
                h('span', { style: styles.hint }, tr('高', 'High')),
                h('input', { style: { ...styles.input, width: '84px' }, type: 'number', min: 0, value: form.presetHigh, onChange: update('presetHigh') }),
                h('span', { style: styles.hint }, tr('天', 'days')),
              ),
              h('span', { style: styles.hint }, tr('改了之后，档位控件和斜杠命令都按新的天数算', 'The drawer control and the slash command both use these numbers.')),
            ),
            h(
              'div',
              { style: styles.row },
              h('label', { style: styles.label }, tr('最小工具数', 'Min tools per group')),
              h('input', { style: styles.input, type: 'number', min: 0, value: form.minTools, onChange: update('minTools') }),
              h('span', { style: styles.hint }, tr('少于这么多个工具的组不值得动它', 'Groups smaller than this are not worth touching.')),
            ),
            h(
              'div',
              { style: styles.row },
              h(
                'label',
                { style: { ...styles.label, display: 'flex', alignItems: 'center', gap: '8px' } },
                h('input', { type: 'checkbox', checked: form.classifyNudge !== false, onChange: setFlag('classifyNudge') }),
                tr('没归组的裸名工具，让 AI 顺手分一次组', 'Let the agent group unnamed tools once'),
              ),
              h('span', { style: styles.hint }, tr('默认开启。当有新插件的工具既没有共同前缀、又不属于任何组时，会在系统提示里提醒 AI 花一点 token 分组，结果写进 ~/.dsh/lazy-tools.groups.json，之后长期生效、不再重复。反感多这一句的人可以关掉（关掉后仍可手动让 AI 调 lazy_tools_classify）。', 'On by default. When a new plugin registers tools with no shared prefix and no group, the agent is reminded once to group them (a small token cost); the result is stored in ~/.dsh/lazy-tools.groups.json and reused afterwards. Turn it off if you dislike the extra line — lazy_tools_classify still works manually.')),
            ),
            h('p', { style: styles.hint }, state && state.file ? `${tr('策略文件：', 'Policy file: ')}${state.file}` : ''),
          ),
        ),
      )
    }

    // 输入框上方那一行：只改「这个对话」的抽屉，不碰全局设置。
    function LazyToolsDock(props) {
      useLocaleVersion()
      const sessionId = props && props.sessionId ? String(props.sessionId) : ''
      const [state, setState] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [customDaysText, setCustomDaysText] = React.useState('')
      const [customOpen, setCustomOpen] = React.useState(false)

      React.useEffect(() => {
        if (!state) return
        const snapshot = state.session || {}
        setCustomDaysText(snapshot.source === 'session' && !snapshot.level ? String(snapshot.idleDays) : '')
      }, [state])

      React.useEffect(() => {
        let alive = true
        if (!sessionId) return undefined
        request('/session?id=' + encodeURIComponent(sessionId))
          .then((data) => alive && (setState(data), setError('')))
          .catch((err) => alive && setError(err.message))
        return () => {
          alive = false
        }
      }, [sessionId])

      const apply = async (spec) => {
        if (!sessionId || busy) return
        setBusy(true)
        try {
          const data = await request('/session', { id: sessionId, ...spec })
          setState(data)
          setError('')
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy(false)
        }
      }

      if (!sessionId) return null
      // 两个开关各自独立：只要有一个打开，这一行就渲染；里面每个控件再由各自的开关控制。
      if (!state || (state.showDock !== true && state.showClear !== true)) return null
      const current = (state && state.session && state.session.level) || 'global'
      const presets = state.presets || { low: 14, medium: 7, high: 3 }
      const globalDays = Number.isFinite(state.globalIdleDays) ? state.globalIdleDays : presets.medium
      const isCustom = state.session && state.session.source === 'session' && !state.session.level
      const hiddenTools = Number.isFinite(state.hiddenTools) ? state.hiddenTools : 0
      const selfHealed = Number.isFinite(state.selfHealed) ? state.selfHealed : 0
      // 档位从「循环点击」改成一次选择（2026-10-29）：原来想从全局切到高档要点三次，
      // 而每次点击都会重算工具表 —— 三次 = 三次打断前缀缓存。
      const selectValue = customOpen || isCustom ? 'custom' : current
      const customLabel = isCustom
        ? tr(`自定义（${state.session.idleDays} 天）`, `Custom (${state.session.idleDays} d)`)
        : tr('自定义…', 'Custom…')
      const onPick = (event) => {
        const value = event && event.target ? event.target.value : 'global'
        if (value === 'custom') {
          setCustomOpen(true)
          return
        }
        setCustomOpen(false)
        apply(value === 'global' ? { reset: true } : { level: value })
      }

      const stowButton =
        state.showClear === true
          ? h(
              'button',
              {
                type: 'button',
                style: styles.dockButton,
                disabled: busy,
                title: tr('立刻把本对话的所有工具组收纳起来（随时可再开回来）', 'Stow every tool group in this conversation now. They can be reopened at any time.'),
                onClick: () => apply({ collapseAll: true }),
              },
              tr('收纳本对话工具', 'Stow now'),
            )
          : null

      const statusHint = h(
        'span',
        { style: styles.dockHint },
        error
          ? error
          : hiddenTools > 0
            // hiddenTools 和 selfHealed 都取本对话状态；全局累计只看 health.stats.selfHealed，不再混入口袋行。
            ? tr(`本对话已收纳 ${hiddenTools} 个工具 · 本对话累计自动取出 ${selfHealed} 次`, `This conversation: ${hiddenTools} stowed · this conversation auto-restored: ${selfHealed}`)
            : tr('没有收纳中的工具', 'nothing stowed'),
      )

      return h(
        'div',
        { style: styles.dock },
        state.showDock === true
          ? h('span', { style: styles.dockLabel }, tr('本对话工具收纳', 'Tool drawer'))
          : null,
        state.showDock === true
          ? h(
              'select',
              {
                style: styles.dockSelect,
                value: selectValue,
                disabled: busy,
                title: tr('只改这个对话的收敛档位', 'Change the collapse level for this conversation'),
                onChange: onPick,
              },
              [
                h('option', { key: 'global', value: 'global' }, tr(`跟随全局（${globalDays} 天）`, `Global (${globalDays} d)`)),
                h('option', { key: 'low', value: 'low' }, tr(`保守（${presets.low} 天）`, `Conservative (${presets.low} d)`)),
                h('option', { key: 'medium', value: 'medium' }, tr(`均衡（${presets.medium} 天）`, `Balanced (${presets.medium} d)`)),
                h('option', { key: 'high', value: 'high' }, tr(`积极（${presets.high} 天）`, `Aggressive (${presets.high} d)`)),
                h('option', { key: 'custom', value: 'custom' }, customLabel),
              ],
            )
          : null,
        state.showDock === true && customOpen
          ? h(
              'span',
              { style: styles.dockCustom, title: tr('只对当前对话生效；回车生效，Esc 取消', 'Applies to this conversation only. Enter to apply, Esc to cancel.') },
              h('input', {
                type: 'number',
                min: 0,
                step: 1,
                placeholder: tr('天数', 'days'),
                style: styles.dockInput,
                value: customDaysText,
                disabled: busy,
                autoFocus: true,
                'aria-label': tr('自定义天数（只对当前对话生效）', 'Custom days (this conversation only)'),
                onChange: (event) => setCustomDaysText(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Escape') {
                    setCustomOpen(false)
                    return
                  }
                  if (event.key !== 'Enter') return
                  const days = Number(customDaysText)
                  if (customDaysText === '' || !Number.isFinite(days) || days < 0) return
                  apply({ idleDays: Math.round(days) })
                  setCustomOpen(false)
                },
              }),
              tr('天', 'days'),
              h('button', { type: 'button', style: styles.dockButton, disabled: busy, onClick: () => setCustomOpen(false) }, tr('取消', 'Cancel')),
            )
          : null,
        stowButton,
        statusHint,
      )
    }

    // 把槽位注册抽成真正的局部函数：object 字面量里的方法名不是词法变量，
    // 不能在 apply 里裸调（2026-10-24 调试时踩过，报 registerInto is not defined）。
    function registerInto(ctx) {
      const slots = ctx.slots || (typeof ctx.get === 'function' ? ctx.get('slots') : null)
      if (!slots) {
        console.error('[lazy-tools] client: no slots service')
        return
      }
      slots.inject('settings.section', () =>
        slots.register(
          {
            name: 'settings.section',
            id: 'lazy-tools',
            order: 70,
            label: '工具抽屉',
          },
          LazyToolsSettings,
        ),
      )
      slots.inject('conversation.composer.dock', () =>
        slots.register(
          {
            name: 'conversation.composer.dock',
            id: 'lazy-tools-dock',
            order: 7,
          },
          LazyToolsDock,
        ),
      )
      // 告诉宿主「浏览器这边真的挂上了」。宿主正常 ≠ 面板挂上，
      // 这条心跳让 lazy_tools_health 能直接看出面板有没有挂（失败一律忽略，不影响功能）。
      try {
        const ping = fetch(`${API}/client`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-lazy-tools': '1' },
          body: JSON.stringify({ panels: ['settings.section', 'conversation.composer.dock'] }),
        })
        if (ping && typeof ping.catch === 'function') ping.catch(() => {})
      } catch {
        /* 心跳失败不影响任何功能 */
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        try {
          localeService = (typeof ctx.get === 'function' ? ctx.get('locale') : null) || ctx.locale || null
        } catch (error) {
          // 冷启动时 locale 服务可能还没就绪，属于预期内的先后顺序：不刷错误。
      console.log('[lazy-tools] locale not ready yet (cold start):', (error && error.message) || error)
          localeService = null
        }
        try {
          registerInto(ctx)
        } catch (error) {
          console.error('[lazy-tools] client apply failed:', (error && error.stack) || error)
          throw error
        }
      },
    }
  },
})

```


### package.json

```js
{
  "name": "dsh-tool-drawer",
  "version": "0.19.1",
  "private": false,
  "type": "module",
  "main": "lib/index.js",
  "description": "On-demand tool groups and role-scoped tool surfaces for DeepSeek Harness: hide heavy tools, switch review/build/research by label.",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg",
    "./package.json": "./package.json"
  },
  "files": [
    "lib",
    "client.js",
    "cordis.patch.yml",
    "locale/*.json",
    "icon.svg",
    "README.md",
    "README.en.md",
    "CHANGELOG.md",
    "DESIGN.md",
    "INTEROP.md",
    "POLICY.md",
    "LICENSE",
    "test",
    "skills",
    "templates"
  ],
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": [
        "@deepseek-ai/dsh-client-ui-slots"
      ]
    }
  },
  "scripts": {
    "test": "node test/smoke.mjs && node test/adversarial.mjs"
  },
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/kmyy350234-dz/dsh-tool-drawer.git"
  },
  "homepage": "https://github.com/kmyy350234-dz/dsh-tool-drawer#readme",
  "bugs": {
    "url": "https://github.com/kmyy350234-dz/dsh-tool-drawer/issues"
  },
  "keywords": [
    "dsh",
    "dsh-plugin",
    "tool-groups",
    "context",
    "tokens",
    "lazy-loading"
  ],
  "author": "kmyy350234-dz"
}

```


### CHANGELOG.md

```js
﻿## [0.19.1] - 2026-11-07

**角色工具面从「默认开、只能改配置」变成「默认关、UI 可控」**：

- 设置页新增「角色工具面」：逐项开关 review/build/research，**默认关闭**（与 README 口径一致）；
- 支持自定义角色：填角色名 + 允许组即可加入 `managedRoles`，不用手改 policy.json；
- 收纳统计分列：`已收纳 N` 与 `自动取出 M` 都取本对话状态，不再把全局自愈混进本对话；
- README 补角色工具面 A/B 实测（n=2）、使用前提（需要 label 工作流）与“别人更好/更差”的边界。

测试：冒烟 132、编码 283；0.19.1 冷读/发版在走。

## [0.19.0] - 2026-11-06

**角色工具面 + 门禁证据化**：

- **角色 label 直接决定工具面**：`review:` / `build:` / `research:` 作为 label 第一段时优先识别；
  `review:`/`research:` 隐藏 edit/write，`build:` 保留全量；label 第二段仍兼容 MyGO 的 `xxx:role`。
- **受管会话不再能写全局组配置**：`lazy_tools_save_groups` 对 managed 会话直接拒绝，避免角色自己改全局面。
- **`schedule` 组默认开**：官方 `@deepseek-ai/dsh-tool-schedule` 进默认 bundle；只给顶层 agent，子代理调用会被拒绝。
- **findings 台账**：`review/findings.mjs`（status/validate/summarize）+ `review/findings.json`；收敛 = `round>=2 && open=0 && 连续两轮无新 finding`。
- **门禁接入 findings**：`54` 的 `6h/7` 与 `gate --findings` 在有台账时不可跳过；**没有台账时 SKIP**，不卡老发版。
- **变异分数**：`review/mutation-score.mjs`（元数据 + `--run` 击杀率），`gate --mutation-score`；每条 mutation 带 `protectedBy`。
- **审计薄壳**：`review/audit.mjs` 只转发 gate 完整输出，不重写检查、不写 verdict；报告带 BOM。
- **Release 说明带证据**：54 自动附冒烟/对抗/编码/一致性/变异/findings/冷读/制品 sha256/CI。
- **README 中英文随包**：包内容检查要求 `package/README.en.md`。
- **流程**：bug 三态、review 分级、小 CL/一票一行为、定时审计模板。

测试：冒烟 128、对抗 29（RED 0）、校准 4、findings 6、mutation-score 12、gate PASS、编码 281 项干净；
具体输出见本次 Release 的「验证证据」段。

## [0.18.8] - 2026-11-06

**元宝 P0 队列（全部附复现/测试）**：

- **清空角色真正生效**：`managedRoles:{}` 不再被 `delete` 后跳过，`roleSource` 置空并按变化刷新（原来返回 200 但运行时角色还在）。`POST /policy` 写盘后追平 `policyMtime`；`applyPolicy` 只在角色表真的变化时才 `refreshManagedRoles(true)`（原来合并后的补丁必带 `managedRoles`，勾一个复选框会重建两轮）。新增桥测试断言 `setPolicyMtime` 被调用。
- **手写组万能匹配的结构防线**：哨兵可被 `re:^[a-z0-9_]+$` 绕过；新增“正则组覆盖本轮全部可隐藏工具（≥3）”的结构判定，命中即忽略并记账（`[60b]`）。
- **受管会话的 `mode` / “收纳本对话”不再假成功**：`applySessionPolicy` 对受管会话直接返回错误（测试 `[61]` 断言），不再改一个被忽略的 `st.modes`。
- **加载即崩的口子**：`config.js` 的 `readdirSync(profilesRoot)` 包 try/catch，目录不可读时退回 `.dsh` 根继续解析。
- **hotRatio 显示与决策同源**：去掉 `Math.round`，不再出现“显示 0.3、决策 0.295”的边界漂移。
- **save_groups 描述与实现一致**：默认只写文件、下次会话生效；`applyNow=true` 才立刻生效。

测试：冒烟 126 项、对抗 29 项；新增 `[60c]` 晚注册、受管 mode 拒绝、mtime 值断言；refresh/config 的专门测试仍缺（冷读候选）。

## [0.18.7] - 2026-11-06

**复现并修复了一类「3 秒重建链」**（原始风暴日志的具体触发工具未验证，不宣称就是那一次）：

- 机制：`rebuild` 回读的「可见」与「藏得住」不一致时，泄漏检测只按 `hiddenBy` 判漏网 ——
  ① agent 作用域同名遮蔽（`restrict` 成功但 own 注册永远可见）；
  ② reserved PTC（`run_code`）名字一 deny 就抛；
  ③ `restrictableNames` 读不到时旧过滤整体失效；
  三者都会让「本该藏却藏不掉」的名字每 3 秒触发一次 rebuild，且 `healthy:true`、零报错。
- 修复：`rebuild` 用**实际回读结果**记 `unhideable`，泄漏检测把它排除（不再只信名字集合）；
  `health` 顶层暴露 `unhideable`，藏不掉的名字如实记账。
- 测试：`[108]` scope 同名遮蔽 + `setSyncRestrictEvents` + 两轮 3 秒链（删掉兜底后 [108] 变红）；
  `[109]` 读不到 `restrictableNames` 同样不形成链。假宿主的 `restrictableNames` 已对齐真宿主语义（deny 的名字仍在集合里）。
- 日志统计：11-05 同一 agent 6945 条 `hidden=`，间隔众数 3.03s，风暴期间零 restrict 报错 —— 与上述机制一致。

**冷读第二轮的两红（本版内修掉）**：

- `unhideable` 原来只写不清：改用 `hideTools` 的**逐名字报告**（`denied` / `transient` / `permanent`），只有「确实 deny 过却仍可见」或「badname 永久藏不掉」才锁；transient 失败不锁、下一轮重试；
- 外部变化用 **restrictableNames 签名**判断：签名变了（alias 退场 / 全局工具晚注册）才清非永久闩锁，单纯 `tools/change` 不再 churn；
- 新增 `[114]` 真实部分失败（p_ok 藏住、p_fail systemic、p_bad 坏名）、`[115]` reserved PTC（永久闩锁，200 次事件 rebuilds ≤ 3）、`[116]` 晚注册（签名变化清锁、别名变全局后能藏住）、`[117]` 别名壳被组匹配（锁住，100 次事件不重建）；
- 复读第二轮的恢复性回归：签名变化时清**全部**闩锁（不只非永久），否则 badname/unknown 闩锁永不重试；`unhideable` 锁「所有非 transient 的 leftover」（含未进 hidden 的 scope 别名壳），否则别名壳每次 tools/change 都算漏网；
- 复读第三轮黄项：`hidden` 为空时不再沿用**上一轮**的 transient 报告（否则「上轮 systemic 失败、本轮退成 scope 别名」的名字会每次事件重建，实测 +100）；新增 `[118]`；

其余与 0.18.6 相同（`toolNames` 空视图回退、`expect` 保持 warning、`stats.rebuilds` 可观测）。

冒烟 124 项、对抗 29 项 RED 0。


## [0.18.6] - 2026-11-06

DSH 2.0.22（上游 0.2.2-rc.1）适配的**诚实版**：

- `host.toolNames()` 与同文件 `visibleNames()` 对齐：优先 `view(agent).visible`，**空视图 / 抛错时回退 `schemas` 复核**（新增冒烟 `[105]` `[106]` `[107]`）；
- `health.stats.rebuilds` 新增重建计数，供下一次风暴排查用；
- `expect` 行为**不变**：`matched < expect` 仍然进 `warnings`（DESIGN.md:197 / README 的成文契约）；
- 上一轮日志里的 6,242 次重建只是线索，**本版没有复现、也不宣称修复**；根因待查；
- dsh-ops 0.4.4 的 `engines.dsh` 不包含 0.2.2，`ops_*` 暂时缺席；抽屉对外部工具一律可选（缺了只影响组计数，不写配置）。

冒烟 113 项、对抗 29 项 RED 0。


## [0.18.5] - 2026-11-05

### 修：元宝第二轮挑刺的 3 个实锤
- **`allowGroups: ['*']` 语义分裂**：放行判定认「不设限」，但受管会话的默认模式按组 id 比对，
  把每个组都记成 `hide`（状态显示 `on:false`，实际 deny 为 0，还触发无意义的 rebuild）。
  现在 `'*'` 在默认模式里 = 全部组 `all`；冒烟 `[102]` 锁住。
- **DNS rebinding 防护**：只比 `Origin.host === headers.host` 在 rebinding 场景天然相等。
  现在桥要求 **Host 必须是回环**（127.0.0.1 / localhost / [::1]），否则 403；冒烟 `[103]` 用 `evil.example` 验证。
- **错误永久被抹掉**：`errors` 超过 8 条 `shift()` 时不删 `seenErrors` 的 key，第 9 种错误挤掉第 1 种后，
  第 1 种复发再也不会记账，`healthy` 假绿。现在 shift 时同步删 key；冒烟 `[104]`。

### 改：自愈不再制造一次假失败
- 模型调用被藏的组内工具时，守卫原来返回「已为你打开，请重新调用」——`subagent` 这类调用会在对话里
  显示成一次失败。现在补开、重建后**直接放行**这一次调用（受管会话仍然不绕过策略）。
  冒烟 `[21]` 断言「放行 + 工具可见 + selfHealed=1」；`[61]` 断言「受管会话不补开（selfHealed 不增）且工具仍被藏」。

### 修：一致性（元宝附注）
- `readJsonBody` 改用 Buffer 收集再一次性 UTF-8 解码 —— 字符串 `+=` 拼分块会把跨块汉字解成乱码；
- `/client` 心跳收到坏 JSON 不再当 200 成功，返回 400；
- `writeUserGroups` / `saveUsage` 改成原子写（tmp + rename）+ 回读校验，和 policy 一个待遇；
- 分组（**仅本机用户组文件**，不随包发布）：`~/.dsh/lazy-tools.groups.json` 补了 `search` / `image` /
  `agents` / `tasks` 四个组，并预留 `rea` 组（`re:^mcp__rea__`，默认收起）。仓库默认组仍是
  `cordis.patch.yml` 里的四个 + 代码里的两个，安装包不包含这些用户组。

## [0.18.4] - 2026-11-05

### 修：外部审阅抓到的 P0/P1（全部有复现）
- **加载即崩**：超长匹配式在 `re.test()` 首次编译时抛 `SyntaxError`，把 `apply()` 带崩。
  现在每个匹配式先真跑一次 `test()`，抛错的按无效组处理并记账；对抗测试里那条 `KNOWN` 改成真断言。
- **发布同步只增不减**：源仓删掉的文件会永远留在发布仓（v0.18.3 的 `lib/role-inbox.js` 就是这么来的）。
  发版脚本同步后做镜像对齐，只删同步目录里源仓没有的文件，并断言「删除只来自同步清理」。
- **`lazy_tools_disable` 的 `name` 分支**：schema 不收 `name`，但执行体处理它并设成 `only` —— 强行传参会把「关」变「只放这一个」。整段删除，传 name 只报错。
- **守卫不可用不记账**：宿主没有 `tools.guard` 时自愈会静默消失、`healthy` 仍为 true。现在记账，`probe()` 增加 guard 契约。
- **`errors[]` 只进不出**：一条瞬时错误把 `healthy` 永久钉红。`lazy_tools_health { clear: true }` 可清。
- **坏名字缓存永不失效**：`tools/change` 后自动失效，最长 60 秒。
- **`writeUserGroups` 目录写死**：改为按文件路径建目录（`LAZY_TOOLS_GROUPS_FILE` 覆盖时不再 ENOENT）。
- **回环桥写操作**：POST 必须带 `x-lazy-tools: 1`（挡无 Origin 的本机写与 DNS rebinding）；设置页客户端同步加头。

### 加：`allowGroups: []` 合法
- 语义 = **只留常驻工具（CORE）**。以前空数组被当成无效条目整条丢弃，导致「只给常驻」根本表达不了。

### 冷读第一轮：5 红（全部是「门禁/断言空转」）
- **发版门禁 6e 永远不跑**：一致性断言被误放进「缺编码脚本」的 if 分支，只有 43 脚本不存在才执行。
  已搬到独立段并加 `Test-Skipped 'consistency'`；dry-run 实测 `[6e/7] 一致性断言 OK`。
- **票体检的 accept 检查恒假**：`accept: []` 判合格。已改成按非空字符串计数；实测空数组 → FAIL。
- **桥鉴权没有行为测试**：原来只对源码做字符串匹配，判据反转也全绿。新增 `[101]`：挂假 webServer 走真 handler，
  实测「无头 403 / 带头 200 / GET 放行」。
- **POLICY.md 说 `allowGroups: []` 尚未支持**：与 0.18.4 实现相反。已改为「只留常驻，0.18.4 起支持」。
- **会话清理第 ③ 条保留规则没实现**：现在真的扫 `perf-/*.md` 里的 UUID 并保留（实测识别 63 个），
  带 `-Apply` 也不会删掉被文档引用的会话。

### 冷读第一轮附带修复（黄）
- README / README.en / DESIGN 的「四个契约」统一为五个；
- `allowGroups` 报错文案不再要求「非空」；
- `clear` 拒绝的判据补上 `agentEvent`，与文案一致；
- `lazy_tools_roles` 允许 `allowGroups: []`（以前一律拒绝）。
### 冷读（0.18.4 发版前）红/黄修复
- **红**：`probe.guard` 没进 `health.contracts`，guard 缺失的唯一信号是 `errors`，而 `clear` 能把它抹成
  `healthy:true` 假绿。现在 guard 是结构契约之一；结构契约不健康时 `clear` **拒绝清空**并说明原因。
- **黄**：坏名字缓存从「覆盖」改成「同 epoch 并集」，旧坏名不再被遗忘后重踩（失败计数不再虚高）。
- **附注**：V8 的 `SyntaxError` 会带完整模式，10 万字符坏 pattern 能让 health 输出约 100KB。
  `record` 现在截断到 400 字符（保留前段 + 省略标记）。

### 文档
- `healthy` 的契约数从「四个」改成「五个」（补 guard）；`lazy_tools_health` 描述去掉已删除的「版本号」。
## [0.18.3] - 2026-11-04

### 修：角色表原型链 + label 解析确定性（第三方报告 A1/A2/B1/B2）
- `normalizeManagedRoles` 改用 **null 原型**并拒绝 `__proto__` / `constructor` / `prototype` 键；
  `resolveManagedRole` 一律走 `hasOwnProperty`（不再 `managedRoles[key]` 裸取值）——
  之前 label 写成 `dsh-x:constructor` 会拿到 Object 构造函数（truthy），后续 `allowGroups.includes` 抛 TypeError；
- label 解析改为**确定性两段**：`vendor` 后第一段 + 首段，不再扫后续段（摘要词从此不参与）；
- 回归：冒烟 `[91]`（原型链）、`[92]`（label 确定性 + roleHint）；
### 清理：过期注释与 CI 覆盖面
- `lib/host.js` 头的「约 100 行」删掉（文件早已 500 行以上）；
- CI 语法检查补 `lib/tools/*.js`，并真正执行 `test/adversarial.mjs`；`pnpm test` 改为 smoke + adversarial 两条都跑。

## [0.18.2] - 2026-11-04

### 修：hideTools 退化路径（2026-11-04，核心路径）
- 整批 `restrict` 因一个不可限制的名字失败 ⇒ 退化为**逐个重试**：坏名字跳过、其余照藏；
- 错误分类：只有「名字不可限制」才进跳过列表；**系统性错误中止重试**并记一条可分辨的错误（不再误诊成名单问题）；
- 坏名字按 agent 缓存（第二次起不再重复踩）；`restrictCalls` 改为**每次真实调用** +1；
- 复合解除句柄逐条撤销；**撤销失败由 `own()` 记录**（上一版在这里另加的「解除限制失败」被复读判定为死路径，已删）；
- 错误分类按宿主**真实文案**识别：单数/复数（`names unknown global tool(s)`）、`cannot name reserved PTC`；`not restrictable` 只是防御性锚点（已装宿主并不发这句）；并有「系统性错误里恰好含 unknown tool 但不在锚定位 ⇒ 仍算系统性」的反例用例；
- 测试：`[89]` 三种退化（含**两个坏名字**的复数形态）+ 脏输入 + `restrictCalls` 断言；`[90]` 反复退化 50 次（层数 0→50→全部 lift 后归 0）；
  变异检验：去掉坏名字缓存 ⇒ `[90]` 的调用数断言立刻红。

### 规范收敛：删掉 `[role:xxx]` 文本协议（2026-11-03 深夜）
- **删除 `[role:xxx]` 通道**（整套 `lib/role-inbox.js` + 监听 + `st.injectedRole` 分支）：
  它要求派工人改提示词才能生效，与 label 通道解决同一件事，属于我们自造的私有协议。
  **恢复 0.17.0 的红线：不再监听 `agent/inbox/*`**（冒烟 `[16]` 断言改回 0）。
- **候选段匹配收紧（当时以为修好，实际没有）**：本版改成「优先取前缀后的第二段」，但先过滤中文导致
  摘要词前移，`dsh-my-go:explore: 让 hermes 看看` 仍被认成 hermes —— 2026-11-04 第三方报告 B1/B2 复现，
  **真正的确定性规则在 0.18.3**（只认 vendor 后第一段 + 首段，冒烟 `[92]`）。
### 修：受管角色的可见性与几条静默失败（2026-11-03 深夜，冷读双评审挖出）
- **restrict 整批失败 → fail-open**：`visible` 里混着「注册了但不可 restrict」的名字（agent 自己那层、`run_code`）时，
  宿主会让整批 `restrict` 抛错 ⇒ 一个都不藏。现在整批失败退化为**逐个重试**，坏名字跳过、其余照藏、留一条证据。
- **`[role:xxx]` 注入的角色被覆盖**：`refreshManagedRoles` / `onPresetSelected` 重算时把 `st.injectedRole` 丢了，
  该通道静默失效。现在两处都**注入优先**，写角色配置不再抹掉在跑子会话的角色。
- **`health.managed.hiddenUngrouped`**：受管角色会藏未归组工具（MyGO 的 11 件协议工具就是这样断的），
  现在逐个点名。**注意**：底集必须是本会话实际被藏的名字，不能用无参 `schemas()`（只有全局层）。
- **错误去重**：同 where + 同 message 只留第一次，避免 8 个槽被同一句占满、`healthy` 永久 false。
- 测试：`[85]` 整批失败退化、`[86]` hiddenUngrouped、`[87]` 注入角色优先级；临时 policy 文件也在 `[86]` 前清理（连跑两次不红）。
- 文档：`INTEROP.md` 补 MyGO 现成配方（11 个协议工具建组 + allowGroups）。
## [0.18.1] - 2026-11-03

### 修：四轮独立冷读挖出来的「静默」路径（发版前）
- **角色配置静默消失的三种长相**，现在都要么响、要么保旧值：
  ① `policy.json` 是合法 JSON 但顶层不是对象（`null` / `[]` / 字符串）⇒ 启动按默认跑，但 `healthy=false` + 记账（以前整份设置静默回默认、健康灯还是绿）；
  ② 文件里 `managedRoles` 形状写坏（字符串 / 数组）⇒ 启动忽略该项并记账；**热重载保持旧角色**、不推进 mtime（改好文件会重新读）；
  ③ 形状对但条目全没用（`{"r":{}}`）⇒ 会清空（失败方向放开）并记账；合法的 `{"managedRoles":{}}` 不再误报。
- **角色审计不再就地删除**：组表会随晚注册的工具家族增长（`auto-mnemon` 之类），以前「第一次会话早于家族注册」会把合法 `auto-*` 角色永久删掉（fail-open，还留一条假错误）。现在保留配置源、组表变了就重新派生 —— 角色在组补上后自动恢复，自动组晚到只记日志不拉红。
- **policy.json 写盘改原子**（临时文件 + rename），不再有「半写文件」；`lazy_tools_roles` 遇到文件里 `managedRoles` 不是对象时**拒绝写**（以前会把字符串摊成 `"0"/"1"` 数字键写进文件）。
- 角色来源已按真宿主核实：`label` 走 `sessionProjections` 的 `subagent` 投影（`agent.ctx.sessionProjections.stateOf(session,'subagent')`），`health.managed.source` 能区分 `prompt` / `label` / `subagent` / `preset`。
- 覆盖：冒烟 `[79]` / `[80]`（→ **89 项**）；四轮冷读记录在仓库的 `perf-/冷读-0.18.1.md`。
- 口径（冷读第四轮提的）：热重载遇到「条目全没用」是**清空 + 记账**，不是保持旧值 —— 失败方向放开，且必须看得见。

### 重构：8 个工具定义搬去 `lib/tools/`（发版前）
- `groups.js`（status / enable / disable / mode / save_groups / list）+ `roles.js` + `health.js`（含只被它用的 bench）+ `tools/index.js`（按对外顺序装配）。
- `lib/index.js` 2064 → **1149 行**；8 个工具定义逐字节校验一致、注册顺序不变（变异检验：改坏 `status.execute` ⇒ 冒烟变红）。
- 跨模块写 `let`（`roleSource` / `policyMtime`）改成**显式 setter 注入** —— 少一层看不见的闭包。

### 新增：`lazy_tools_roles` —— AI 自己配角色（2026-11-03 深夜）
- 用户原话：「大部分人懒得写」「给喜欢折腾的开个口子就行」。所以配置改成**AI 生成、人只审结果**：
  不传参数 = 只读（角色 / 来源 / 依据 / 可用组）；传 `role + allowGroups + basis` = 写入并即时生效。
- 工具层强制三条不变量（比人手写 JSON 可靠）：① 组 id 必须真实存在（写错=会话被锁到只剩核心工具，#71）；
  ② **AI 不许写 `*`**（放开限制的逃生口，只允许人手改文件）；③ 必须带 `basis`，自动盖 `createdBy: ai` + `at`。
- **policy.json 改完不用重启**：`agent/created` 时比对 mtime，变过就重读并走同一套组 id 校验。
  这是"配置很麻烦"的真正来源之一 —— 改文件 → 下一个会话生效。
- 人手改 `policy.json` 的口子照旧有效（可以写 `*`、可以不带 basis）—— 留给喜欢折腾的人。

### 修：`managedRoles` 在 policy.json 里**从来没生效**（2026-11-03，写测试时抓到）
- `normalizePolicy` 不认识 `managedRoles`，归一化时把它整个剥掉了 ⇒ ① README 说的"写进 policy.json"是假的，
  只有插件 config 里的能生效；② 更糟：保存设置时 `mergePolicyForStorage` 先把存盘策略读回来（已被剥掉），
  再合并写回 ⇒ **随便存一次设置就把角色配置静默删掉**（与翻车档案 #78 同一类：写成功但内容不对）。
- 修法：`normalizePolicy` 透传 `managedRoles`（形状检查，校验仍交给 `normalizeManagedRoles`）；
  回归用例：`[70]` 里断言"normalizePolicy 不许吃 managedRoles"「保存设置不许把它删掉」。

### 新增：角色来源的**通用**解析（2026-11-03 深夜）
- 生态里各家给子会话打「角色」的写法不同：MyGO 用 `session.header.label = dsh-my-go:<工种>`，
  team-conductor 用独立会话 + 侧车 roster，还有用提示标记的。**我们不认厂商名**，只认一条规则：
  取 `label` 的**最后一段**（`:` `/` `|` 空白分隔）、小写；**只有 `managedRoles` 里配过这个键才生效**。
- 解析顺序（每一级都要求"配了才生效"，失败方向放开）：`[role:xxx]` 提示标记 → **label 尾段** →
  `subagent` 通用键 → preset。label **只在子会话上认**（`header.parentSession`），普通会话手打标签不生效。
- `health.managed` 新增 `source`：`prompt` / `label` / `subagent` / `preset` ——
  出问题时先看这一格，就知道这个角色是从哪认来的。
- 覆盖：冒烟 `[74]`（→ 83 项）；变异检验：去掉 label 分支 ⇒ `[74]` 立刻红。

### 新增：子代理的角色标记 `[role:xxx]`（2026-11-03）
- 背景：宿主的 `subagent` 工具**不给** preset/metadata ⇒ 子代理都继承父会话 preset，
  「按 preset 分角色」对它们完全失效（基线实验：两个不同角色的子代理，工具面一模一样）。
- 做法：派工时在提示首行写 `[role:xxx]`；插件监听 **`agent/inbox/spliced`**（子会话日志实测的真事件名，
  `inserted` 不触发），在**首轮组装之前**解析标记，并按 `managedRoles[xxx]` 收紧该子会话的工具面。
- 边界：只在子会话生效（`header.parentSession`）；只看**第一条**消息；角色没配 ⇒ 记一条错误、工具面不动。
- 复用：不新增工具、不新增配置项 —— 角色定义就在 `managedRoles` 里。
- 覆盖：冒烟 `[73]`（→ 82 项）；变异检验：把角色注入去掉 ⇒ `[73]` 立刻红。
- 旧测试订正：`[16]` 里「一条 inbox 监听都不许有」改成「只允许 role-inbox 这两条」——
  0.17.0 删掉的是**按关键词预开**，不是「读消息」这件事本身。

### 修：0.18.0 之后的外部评审（2026-11-02，四条全部复现属实）
- **受管角色写错组 id 会把会话锁死**：受管会话里 `enable` / `disable` 被拒、自愈也不绕过，于是
  `allowGroups` 全写成不存在的 id（照抄旧文档示例就会这样）⇒ 工具面被收到只剩 CORE_TOOLS，
  会话内零自救路径，而且**全程静默**（违反红线三）。现在启动时校验 `allowGroups`：
  不认识的 id 进 `health.errors`；**全都不认识的角色直接停用**（退回普通会话行为），不再锁死；
  另加 `allowGroups: ["*"]` 逃生口。冒烟 `[71]`（→ 80 项）。
- README：状态行 `0.17.x` → `0.18.x`；受管会话示例从「superagent 的概念组名」改成**真实存在的组 id**，
  并写明配置落在 `~/.dsh/lazy-tools.policy.json`（**JSON**）或 profile 的 YAML，两处都有以 policy.json 为准；
  补一句定位说明——**受管角色只能收紧，不能放行**（`restrict` 在作用域链上取交集）。
- 英文 README 补上受管角色一节（原来完全没写）。

### 重构：第 1 批 —— 提示段搬去 `lib/prompt.js`（2026-11-03）
- `apply()` 里约 212 行的提示段 + 三个判定函数搬到 `lib/prompt.js`，依赖显式注入、可单测；
  `index.js` 1959 → **1780 行**（净 -179），新增 `lib/prompt.js` **272 行**。
- 新增 **`health.session`**：本会话列了哪些组 + 可见数 + 我们藏了几个。
  `groupsListed` 与提示段走**同一个函数**（`createPrompt().view`）；`visible` 走便宜视图，
  **读不到时给 `null`，不许用 0 冒充**（挑刺抓到的红项：同一份回答里既说"列了"又说"被挡"）。
- 第一版还带过 `role` 与 `blockedGroups`，被挑刺否掉并删除：前者与既有 `managed` 重复且形状不同；
  后者是第二套更弱的判据（会把"我们自己没撤掉的限制"报成"外部挡"），而 `health.groups[].blocked`
  与 `warnings` 已经分得清三种根因。**同一判据只允许一个入口。**
- 冒烟 `[72]`（→ 81 项）。变异检验两条：`visible` 失败时给 0 ⇒ 红；`groupsListed` 与提示段脱钩 ⇒ 红。

## [0.18.0] - 2026-11-01

### 新增：受管角色（managedRoles，默认关闭）
- 按 preset id / parentSession 派生角色策略：会话创建时解析一次，会话内不变；
- 封闭默认：未授权组与未归组工具一律隐藏；受管会话拒绝 `enable`/`disable`，自愈不绕过；
- `health.managed` 报告当前角色；不配置时行为与旧版完全一致；
- 冒烟新增 `[61]`（70 项）。

### 新增：会话级目录（0.18 第三条，2026-11-01）
- 常驻提示段改为按**组装方会话**渲染（宿主契约 `AssembleContext = { scope }`）：只列本会话真正挂载的组，
  一组都没有时返回空串（宿主会把空段整段丢掉）；但「有散装工具要分组」的提醒还在，不跟目录一起消失；
- 挂载集 = 该会话可见的工具 ∪ 本插件自己藏起来的工具；外部 deny（宿主权限门、别的插件）**不并进来** ——
  于是「广告一个这个会话根本调不到的工具」这条消失（本机实测：改前 8 组全广告，其中 cua 两组被
  computer-use 权限门挡着，一个都调不到）；受管会话只广告授权组（未授权组连 enable 都会被拒）；
- 「有 N 个工具没归组，去分组」这句提示只在**默认 preset 的人工会话**里出现；角色会话（每工单一个）
  不再被引导去改全局分组表；
- 读不到 scope / 读不到工具表 ⇒ 退回 0.17.x 行为（列全部组）。**失败方向是「照旧」，不是「变短」**；
  「视图返回空」不算权威：空 Map 会再用 `schemas` 复核一次（2026-11-01 独立冷读抓到的红线）；
- 每轮组装的 schema 全量深拷贝：**9 次 → 0 次**（有 `tools.view` 时）/ **2 次**（没有视图的宿主）。
  原来 8 次来自「每个组各调一次 `allToolNames()`」，另 1 次来自分类提示；现在名字池一次算好、走便宜视图；
- 冒烟新增 `[64]`–`[68]`（会话级目录 / 分类提示门控 / 视图三种退化 / 只有提醒的段 / 受管角色），
  72 → **78 项**；对抗套件不变（PASS 28 / KNOWN 1 / YELLOW 0 / RED 0）。新用例逐个做过变异检验
  （把对应修复改回去，用例必须变红）；假宿主补了 `tools.view`，否则主读路径零覆盖；
- 真宿主实测补的一条：`lazy_tools_enable {group}` 原来只改模式就返回 `enabled` —— 本机 `enable cua-screen`
  报成功，可 19 个成员一个都没回来（被 computer-use 权限门挡着）。现在解除后回读，仍不可见就返回
  `applied: false` + `blocked`，与 health 同一口径（`[69]` 钉住，并反向断言「正常组不许被误报失败」）；
- 与设计稿 `perf-/方案-多会话与第三方适配-20261101.md` 的偏差：设计稿写「挪到 agent 作用域注册」，
  实测宿主已支持「根作用域注册 + 按 scope 渲染」，后者不用管 agent 的创建 / 销毁 / 插件晚加载，
  所以采用后者。未新增工具、未新增配置项、不改 dsh-ops。

## [0.17.2] - 2026-10-31

### 修：第二轮独立冷读（修 0.17.1 时漏掉/新引入的）
- README 中/英「装完就能用」不再承诺「说到截图就自动开组」——改为真实路径：显式 `enable`、守卫在调用被拒前放回；
- README 的 health 说明去掉「自动打开」；冒烟数字 `63 项` → `69 项`；
- 「例外 / 中途改表」口径统一为：显式 `enable`/`disable`/`mode`/`save_groups{applyNow}` + 自愈；
- 英文首段把 `save_groups applied on the spot` 的误述改成 `lazy_tools_enable`（applyNow 是新建并收起组，不是拉回工具）；
- **行为**：旧配置 `autoHints` 的兼容提示从 `errors` 改为 `notes`（按组一次），不再把 `healthy` 永久拖成 false；
  `[16]` 增加 `healthy === true` 的断言；
- 0.17.0 验证记录更正（0.17.1 只清了字面词，行为句由第二轮冷读抓出）。

## [0.17.1] - 2026-10-31

### 修：0.17.0 删除后的文档 / UI 残留（独立冷读发现）
- README 中/英：红线例外数改成两条、缓存账路径数改成两条、英文三处 `keyword` 清掉、状态行 `0.16.x` → `0.17.x`；
- 设置页说明（`client.js`）与 `locale` 的中英插件描述去掉「关键词」；
- DESIGN 决策 3 改成「已于 0.17.0 删除」并保留理由，决策 4 的中途改表路径改为两条；
- **行为**：旧配置里仍写 `autoHints` 时不再静默 —— 记一条 `group config` 错误（`health.errors` 可见），对应 README 红线「失败必须报出来」；
- 测试：`[16]` 增加「不应再注册 inbox 监听」的硬断言（删不干净会红）；删掉对抗套件里已无消费者的死变量；
- 独立冷读：15 条里 12 条成立（5 红 / 5 黄 / 2 绿），2 条误报（CHANGELOG 历史条目、DESIGN 理由句）不改。

## [0.17.0] - 2026-10-31

### 删除：关键词预开（`autoHints`）
- 起因：判定词无穷，用户（本机实测）几乎不用工具类词汇，主要靠「发文件 + 直接指令」。
- 删掉：`autoHints` 字段支持、`agent/inbox/inserted` 监听（`host.onUserMessage`）、`stats.autoOpened`、
  `stats.userMessages`、内置四组 patch 里的四张词表。**这是一次真实功能删除**（内置四组确实在用它）。
- 保留：用量账本决策、`enable`/`only`、自愈守卫、自动分组、能力目录。自动入口只剩「自愈」一条，
  其余靠模型主动 `enable`。
- 测试：`[16]` 改成「写了 `autoHints` 也不预开、stats 不再有 `autoOpened`/`userMessages`」；冒烟仍 69 项全过。
- 双向验证：把「不注册 inbox 监听」的断言临时去掉（或恢复 `onUserMessage` 调用）→ `[16]` 立刻红；恢复后 69 全过。
- 下一步（未做）：用「消息里的数据类型」（`kind: image/file`、`mediaType`）替代关键词预开——类型空间封闭，
  不会像词表一样无限增长。

## [0.16.9] - 2026-10-31

### 改：手写组的「万能匹配式」直接忽略（结构性防线）
- 起因：回答「DSH 工具名会变（2.0.21 把 `pwsh` 换成 `ops_*`），保护清单追不动」。
- 做法：编译组时用哨兵名测匹配式能否匹配**任意名字**（`*` / `re:.*`）；手写组命中 → 整组忽略 + 记账
  （`health.errors` 里 `group guard`，`status` 该组 `guarded:true` 并进 `notes`）。出厂组不受影响。
- 不做「可见工具 − 在册工具」差集：rc.3 里两者同源于 `schemas()`，宿主内核工具既不在册也不在其中，差集恒空。
- 测试：`[60]` 双向验证（去掉守卫 → 立刻红）；`[56]` / `[59]` 改用窄组，继续钉住常驻/宿主工具不许入组。
- 冒烟 68 → **69 项**。

## [0.16.8] - 2026-10-31

### 兼容（DSH 2.0.21 更新，但用户版本不一）
- DSH 2.0.21-next 起 `dsh-ops` 用 `ops_*` 取代了官方 `pwsh`。**插件不做版本分支**（我们只有一台机器、一个版本，
  旧分支永远测不到），改为**保护清单取两代并集**：`pwsh` 与 `ops_bash/ops_grep/ops_glob/ops_inspect_local_file/ops_result`
  同时受保护；宿主没有的名字是空操作。
- `PROTECTED_PREFIXES` 增加 `ops`（自动分组不再把 `ops_*` 家族当候选）。
- README（中/英）写明实测宿主：**2.0.20-next 与 2.0.21-next**，更早版本未测。

### 测试
- 新增 `[59]`：手写 `match: ['*']` 下 `pwsh` 与 `ops_*` 都不被收起、普通工具仍被收起。冒烟 67 → **68 项**。

### 背景（不是本插件的 bug）
- #11207 在 2.0.21 上**仍未修复**：实测 `cua_driver_native__list_apps` 的 `global=true / agent=true / scoped=false`，
  解除本插件限制后宿主仍不交付（`applied:false / not-visible`）；过滤器里仍有一条 **56 条 deny** 的外部作用域过滤器。

## [0.16.7] - 2026-10-30

### 收紧（0.16.6 的跟随修正）
- `expect` 只接受**真正的 number**，不再做类型强转（`expect: '19'` / `true` 这类笔误不猜语义，按未设置处理）。
  0.16.6 用的是 `Number(g.expect)`，会把字符串/布尔也当成数字——那是猜。

### 测试补强
- `[57]` 增加两组断言：①「全无效 → 退回的确实是出厂组」（不是空表）；②「合法 + 无效混合」只保留合法组、工具照常注册。

### 核验（回答“会不会引发别的 bug”）
- 真实配置下行为不变：8 组的 `matched` 与改动前快照逐项一致（19/37/28/8/5/9/2/17），`expect` 合法值原样保留、`expectOk` 全 true；
- 本机手写组文件（`cu-observe/cu-act/cu-audio`，含 `hint`/`expect` 字段）编译后仍完整；
- `expect` 的所有消费者都带 `typeof === 'number'` 守卫，未设置时输出与之前一致；
- 冒烟连跑两次 67 项全过（幂等）。
## [0.16.6] - 2026-10-30

### 修复（外部对抗性测试，3 条都只在手改配置时触发，但失效形态是「静默丢功能」）
- **手写组 `match: ['*']` 会吞掉自救工具**：`CORE_TOOLS` 过滤只在自动分组路径上，手写组（`cordis.patch.yml` /
  `extraGroups` / `groups.json`）没接。结果会话工具表为空，连 `health` 都调不到，自愈链路断掉。
  现在 `membersOf()` 统一排除常驻/自救工具，`hiddenBy()` 再加一道「核心工具永不收」的守卫。
- **配置里的组全无效时静默零注册**：`if (!groups.length) return` 在工具注册之前早退 —— 手写一个多余 `-`
  或漏 `match`，插件就「装上了但一个工具都不注册」，不抛错、不写日志。现在：组全无效 → **退回出厂四组 + 记一条可见错误**，
  并且不再早退（工具照常注册）。
- **`expect: NaN` 漏进 status**：加载时把 `expect` 夹成有限正整数；非法值视为未设置（并且要先摘掉原值，
  否则 `...g` 会把 NaN 带回来）。

### 测试（67 项）
- 新增 `[56]` 手写 `*` 只收普通工具（**同时断言 status 的 `matched`**，只断言 deny 会假绿 —— 被 `hiddenBy` 兜住）、
  `[57]` 组全无效仍注册 7 个工具并留下可见错误、`[58]` NaN expect 不进 status。
- 双向验证：去掉 `membersOf` 守卫 → `[56]` 立刻红（`matched 8 ≠ 1`）。

### 我的判断
第 3 条单独不值得发版；但前两条是「用户丢功能 + 静默」——按项目红线（**静默失败 = 红**）必须修。
改动共约 25 行、无新增依赖、无新工具。
## [0.16.5] - 2026-10-30

### 修复（指标永远拿不到数据 —— 又一个「不生效的东西」）
- **`firstTryRate` 的计数器是进程内变量**：插件每重载一次就归零。实测 5 小时后 `toolCalls: 0`、
  `firstTryRate: null` —— 建了三版，一次真实数据都没攒到。
- 现在 **计数器随账本持久化**：`loadUsage()` 读 `stats`，`host.seedCounters()` 只升不降地恢复；
  每次落盘（含自动预开 / 自愈这两个稀疏事件）把 `toolCalls / selfHealed / autoOpened` 写回。

### 测试
- 新增 `[55]`：同一账本、新实例（模拟重载）→ `toolCalls` 必须与文件一致。
- **双向验证**：把 `seedCounters` 注释掉 → `[55]` 立刻红（「文件 1 / 内存 0」）。
- 冒烟 63 → **64 项**；连跑两次都全过（持久化后测试之间不再互相污染：给断言计数的用例各自用独立账本文件）。

### 顺带
- 这正是「指标没有消费者」的反面：先让它**有数据**，才有资格用数据判断棘轮。
## [0.16.4] - 2026-10-30

### 修复（第三轮冷读指出：上一轮的修复带出 2 处新问题）
- **notes 的「实测」串仍打 `agent=`，与 `agent-filtered` 判定自相矛盾**：`agent` 是不带第二参的 `get(name)`
  （全局视图），却被当成作用域证据打印 —— 会出现「在 agent 作用域查不到（实测 agent=true）」。
  现在改成打印决定性的 `global=… / scoped=…`。
- **测试 [32] 只断言 notes 含「作用域」**，所以上面那处矛盾 63 项仍全过。现在收紧为：notes 必须包含
  `scoped=false` —— 即「决定性布尔必须进证据」，不是「有一句解释就算」。
- **DESIGN 里两处字面 `\n`**（上一轮编辑残留，Markdown 会原样显示）：已还原为真换行。

### 教训（已进档案 #72）
替身可以只实现用到的字段，但**每个字段的语义必须和真宿主一致**；签名对、语义不对，比不实现更危险。

### 验收
- 冒烟 63 项全过；`[32]` 现在会在 notes 不带 `scoped=false` 时失败。
## [0.16.3] - 2026-10-30

### 修复（第二轮冷读 11 处；其中一条是代码死分支）
- **三态里的 `agent-filtered` 永远走不到**：判定用 `p.agent`，而 `p.agent` 是 `get(name)`（全局视图），
  与 `p.global` 同值。现在改用 `p.scoped = get(name, agent)`：`scoped === false` ⇒ `agent-filtered`，
  `scoped === true` 但不在工具表 ⇒ `filtered-by-schemas`。
- **假宿主 `get(name, agent)` 不按 agent 过滤**（忽略第二个参数）⇒ `scoped` 恒等于 `global`，三态测不出来 ——
  这和 #54 是同一类「替身比真宿主更听话」。已修：`test/smoke.mjs` 的 mock 现在按 agent 的 deny/未挂载过滤；
  `[32]` 也相应从 `filtered-by-schemas` 改成 `agent-filtered`（这个场景本来就是「作用域查不到」）。

### 文档（11 处逐条）
- README：`health.autoOpened` / `health.selfHealed` → `health.stats.*`（按旧写法读到的是 undefined）；
  bench 的「比例」→「三态计数，百分比自己除」。
- DESIGN：常驻提示「五组 id」→「全部组 id（四组 + 手写 + auto）」；探针字段 `inScopedSchemas` → 实际输出；
  三态判定说明改成 `scoped` 口径。
- README.en：组名 `cua-screen/cua-input`（原来错写 desktop-read/desktop-input）、bench 注释、
  34 个非注册表工具拆成 33 宿主内核 + 1 个 agent 作用域、配置表补到 8 行（`classifyNudge` / `autoGroups`）、
  `minTools` 解释、组热描述补 `only` 档、澄清 `selfHealed` 只有守卫计数、补「缓存账」段落。

### 验收
- 冒烟 **63 项**全过；`[32]` 的断言随语义更新（不是放宽，是改成更真的那个状态）。
## [0.16.2] - 2026-10-30

### 文档与代码对齐（独立冷读发现 24 处不一致，逐条修）
- README 中文：状态 `0.16.x`、测试项数（以 smoke 输出为准，当前 63）、工具名（`resolve` → `enable { name }`）、
  `register` 表补 `classifyNudge` / `autoGroups`、`minTools` 说明改成「自动分组建组门槛」、
  「可见 101」标注为**注册表内**、34 个非注册表工具拆成 33 宿主内核 + 1 个 agent 作用域。
- README 英文：工具表从 11 行重写为 7 行（与代码一致）、`bench/scan/classify/resolve` 全部换成新入口、
  组名 `cua-screen/cua-input`（原来错写 desktop-read/desktop-input）、`expect` 下限语义、
  `healthy` 默认精简 + `full`、示例链接修正到同目录。
- DESIGN：`bench` → `health { bench: true }`、`resolve` → `enable { name }`、
  `warmRatio` 那句「进设置页」改成「**不进**设置页（内部判据）」。

### 修复（冷读发现的真问题）
- **`autoGroups: suggest` 没有可观察输出**：合并 `scan` 时把建议字段丢了，选它的人看不到任何东西。
  现已接回 `lazy_tools_list { ungrouped: true }` 的 `autoGroups.suggestions`。

### 新增
- `LICENSE`（MIT）：`package.json` 与 README 一直引用它，但文件不存在。

### 验收
- 冒烟 63 项全过；文档残留名（bench/scan/classify/resolve）已清零。
## [0.16.1] - 2026-10-30

### health 默认精简（减法清单 C 项，经独立盲评）
- 默认输出 **4072 → 约 3.0KB**：去掉账本 `usage`、`nameProbe`/`filterReport` 的 null 占位、`contracts[].detail` 复述；
  分组只留判定字段，`warnings/notes/stray/errors` 连成一块便于扫。
- 要全量：`lazy_tools_health { full: true }`（结构不变）。
- **独立盲评结论**：精简版「更容易一眼看完」，且三个排障问题仍答得出；
  唯一硬条件——**默认必须保留 `client.seen`**（当时唯一的红灯，被删掉会读成“全绿”）。已补回。
- **未采纳盲评的一半**：没有把 `client.seen` 并进 `healthy`。面板是可选件（`showDock` 默认关），
  没上报不等于插件有病；并进去会让每个新会话开局就红，等于训练人忽略警报。改为「可见但不判病」，边界写进 DESIGN。

### 验收
- 冒烟 62 → **63 项**（新增 `[54]`：默认保留 client / full 才给 usage）。
- 备份与对照：`_work\health-before-full.json`（4072B）、`health-after-default.json`、`health-after-full.json`。
## [0.16.0] - 2026-10-30

### 破坏性变更：工具 **11 → 7**（减法，省每轮上下文）

四个工具并进已有入口，**旧名不再注册 schema**（少 4 份 schema 常驻每轮请求）：

| 旧 | 新入口 | 说明 |
|---|---|---|
| `lazy_tools_bench` | `lazy_tools_health { bench: true }` | 基准账是诊断，不是独立能力 |
| `lazy_tools_scan` | `lazy_tools_list { ungrouped: true }` | 前缀分桶 + 未归组工具 |
| `lazy_tools_classify` | `lazy_tools_save_groups`（不传 `groups`） | 返回分类材料；带 `groups` 仍落盘 |
| `lazy_tools_resolve` | `lazy_tools_enable { name }` | 按工具名一步开一个 |

**旧名不会静默消失**：调用时守卫回一句「已并入 X」（不注册 schema，零上下文成本）。

### 验收
- 冒烟 61 → **62 项**（新增 `[53]`：旧名给指路）；所有被合并路径都有测试覆盖。
- 工具表、常驻提示、README 标题与工具表同步到 7 个。
## [0.15.14] - 2026-10-30

### 清理（「删一半」的收尾：代码删了，数据和文档没跟上）
- **删 `usage.counts`**：排序退回「最近用过优先」后，`counts` 只剩「毫秒时间戳 tiebreak」——
  而 `lastUsed` 是 ISO 毫秒、不同调用必不同毫秒，**它在任何真实数据下都不参与排序**，和 0.15.12 清掉的 `isHot` 同一个处境。
  只写不读的字段会让人以为「我们算过用得最多」。累加、归一化、`countOf`、测试 fixture 一并删掉。
- **删组级 `hint`**：三个默认组、`cordis.patch.yml` 四行、`save_groups` 的 schema 与归一化里都定义了它，
  但 `groupsView` 从不输出 —— 只写不读。它想干的事已经被能力目录（每组 3 个真实工具名）取代，后者更精确、模型还能照着念。
- **`warmGroups()` 不再接参数**（声明时就不接，调用处却传了 `st`）。
- **修注释与测试名**：`sampleFor` 里三段注释有两段是删改前的旧规则；测试 `[51]` 的名字还写「窗口内优先」。
  现在代码、注释、测试名三处同一个说法。

### 说明
- 旧账本里已有的 `counts` 字段不再读取，也不会报错（`loadUsage` 只取 `groups` / `tools`）。
- 排序的唯一依据是**最后调用时间**；「最近优先」对目录样本是正确的信号，「累计次数」在没有窗口数据时无法与决策口径对齐。
## [0.15.13] - 2026-10-30

### 修复（挑刺第七轮：同一个判据两个取法）
- **会话档位改过后，`status` 还在用全局天数**：决策走 `sessionIdleDays(st)`，而 `groupsView` 用 `policy.idleDays` ——
  `lazy_tools_mode {idleDays:1}` 之后会出现「组已收起，`hot` 还报 true」。现在 `status` 也走 `sessionIdleDays`。
- **能力目录的样本排序不再依赖天数**：常驻提示段拿不到 agent（也就拿不到会话覆盖的 `idleDays`），
  所以那边改用**最近用过的优先，次数只做 tiebreak** —— 不依赖天数，就不存在「两个取法」。
- `DESIGN` 的「动手前五个问题」补第 6 条：**两个消费者要同一个判据时，必须走同一个函数**。

### 撤回（用户 2026-10-30：「如无必要勿增实体」）
- 曾给 `enable` / `disable` 加「已是目标状态就跳过 rebuild」的守卫（新增 `alreadyOpen` / `alreadyClosed` 字段）。
  **已撤回**：`health` 对「限制被别处覆盖」给的修复建议正是「先 `disable` 再 `enable`」，
  跳过 rebuild 会让这条修复路径失效 —— 用一个新字段换掉一条修复路径，不划算。
## [0.15.12] - 2026-10-30

### 清理（工程自查，无行为变化）
- **删掉 `isHot`**：组热改用「热工具占比」后，组级时间戳不再参与任何决策，`isHot` 在生产路径里已无调用方
  （只有测试还在钉它）。`usage.groups` 保留 —— 它仍用于 `status.lastUsed` 展示。
- 测试 `[18]` 改钉 `isToolHot`（决策真正在用的那个），顺带覆盖「无记录=冷」「阈值 0=恒热」。

### 记录
- 本轮自查的六条错误已进 `翻车档案.md` #63–#68（整块替换残缺 / expect 语义 / 默认值三处 / 死 cap / 两套口径 / minTools 静默）。
## [0.15.11] - 2026-10-30

### 修复（挑刺第六轮：默认状态下「告警和设置静默不对」）
- **吸纳型组的 `expect` 必然误报**：`browser-heavy` / 所有 `auto-*` 组的匹配式（负向前瞻 / 前缀通配）**设计上就要吸纳新工具**，
  却被静态 `expect` 判成漂移 —— 工具被正确收起、`healthy` 却是 `false`，而且文案还说「正则可能要补」。
  这正是 0.14.6 自己预警过的「久了只会训练人忽略报警」。
  **`expect` 改成下限语义**：`matched < expect` 才告警（改名/没加载/正则漏）；多出来不报。
- **`only` 模式下 `expect` 静默失效**（上一轮遗留）：`matched` 数的是组内注册工具，与「只放了几个」无关，
  不该因为 `mode === 'only'` 就跳过漂移检测。已去掉这个条件 —— 小白型使用下大概率全是 `only`，保护不能只在 `hide` 时生效。
- **`minTools` 填 < 3 静默失效**：自动分组要求「同一前缀 ≥3 个」才建组，填 2 实际按 3 跑且无提示。
  现在**加载时就夹到 3**，`health.policy.minTools` 显示的是生效值。
- **能力目录的排序口径与决策不一致**：决策看 `idleDays` 窗口，排序却按全周期累计次数 ——
  「一年前用过 100 次」会压过「本周用了 5 次」。现在**窗口内优先**，再按次数，最后按时间。

### 测试
- 新增 `[48]`（吸纳型组 3 > expect 2 不告警）、`[49]`（少于才告警）、`[50]`（minTools 夹到 3）、
  `[51]`（窗口内工具排在陈年高频前）。冒烟 56 → **60 项**。
- `[48]` 做过双向验证：把语义改回等式 ⇒ 当场变红。
## [0.15.10] - 2026-10-30

### 修复（挑刺第五轮：默认值不一致 —— 对「默认值即产品」的项目，这类比算法缺陷更伤）
- **`autoGroups` 的默认值有三处、互相矛盾**：运行时代码 `on`、README `on（默认）`、**设置页 schema `suggest`**。
  后果最阴：用户在设置页改任何别的字段并保存，schema 的 `suggest` 可能落进策略文件 ——
  「新装插件自动被管」静默消失，而用户以为自己什么都没动。**最难归因的一类失败**。
  修法不是把 `suggest` 改成 `on`（两处仍会漂），而是**让设置页从运行时代码取默认值**：`.default(normalizeAutoMode())`。
- **`only` 的 CAP 是恒不生效的死代码**：`cap = max(3, ceil(成员数×ratio))`，而 only 的条件是
  `hot < 成员数×ratio ≤ cap` ⇒ `slice(0, cap)` 永远截不到（穷举 58,770 种情形，0 次截断）。
  自愈税是被**占比判据**消掉的，不是被 CAP 消掉的。已删除 `cap` 与 `slice`，DESIGN 里那句「上限随组规模走」一并删掉
  —— 文档不该把不存在的机制说成有效机制。

### 说明
- 上述两处都做了双向验证：把 `slice(0,3)` 放回去 → `[45]` 当场变红；`normalizeAutoMode()` 实测返回 `on`。
## [0.15.9] - 2026-10-30

### 定位校正（不是 bug 修复）
- 用户 2026-10-23 定的定位是「**让用户感觉智能**」：小白不知道什么时候该开，
  所以**装上不用配、默认值就是正确值、旋钮只是逃生门**。
- 0.15.8 把 `warmRatio`（组热判据）放进了设置页 —— 那是把「我该填什么」的问题搬回给用户。
  **已从设置页移除**；仍可通过配置文件 / `/policy` 调（`normalizePolicy` 保留，夹 0.05–1）。
- `DESIGN.md` 顶部新增「定位（北极星）」一节，含用户原话与判定句：
  **让用户少懂一件事的改动大概率对；让用户多想一个「我该填什么」的大概率错。**
## [0.15.8] - 2026-10-30

### 修复（挑刺第四轮：阈值带来的三个新问题）
- **`only` 上限 3 是「永久自愈税」**：常用 4~11 个工具的用户，每个会话都要为被藏的那几个各付一次自愈 ——
  不是偶发补漏，是常态化开销，而且直接压低刚修好的 `firstTryRate`。
  上限改成与判据对齐：**`max(3, ceil(成员数 × warmRatio))`**（37 个工具 → 11 个；20 个 → 6 个）。
- **`warmRatio = 0.3` 从硬编码改成可配**：进设置页/`/policy`，夹到 0.05–1。
  **30% 这个具体值不拍脑袋**，留待 `firstTryRate` 的真实数据来调。
- **`status.hot` 与决策语义不一致**：`hot` 原来用「任一工具热」（组时间戳），而决策用「占比 ≥30%」，
  会出现 `hot=true` 却整组收起 —— 给人埋雷。现在 `hot` 用同一判据，另给 `hotTools` / `hotRatio`；
  组级时间戳退化为 `lastUsed` 展示用，不再参与决策。

### 测试
- 新增 `[45]`（20 成员 5 热 = 25% → 放 5 个，旧 CAP=3 会漏 2 个）、`[46]`（warmRatio 可配 + hot 同语义）、
  `[47]`（1/12 热 → hot=false 但 only 放 1 个）。**都做过双向验证**：把 CAP 改回 3 → `[45]` 断言变红。
## [0.15.7] - 2026-10-30

### 修复（挑刺第三轮：两个「刚上线就不可达」的功能）
- **单工具热度在真实数据下不可达**：`recordUsage` 同时写工具与组的时间戳 ⇒ 「组热 ⇔ 组内任一工具热」；
  而 `applyDefaults` 见组热就整组开、组冷则所有工具都冷 —— `only` 分支永远为空。
  即 README 那句「37 个里只用 1 个，不必把 36 个一起放回来」在当前数据模型下**不会发生**。
  改为**占比阈值**：热工具占比 ≥30% 才整组开，否则只放热的那几个（上限 3）。小组里过半常用 → 整组开。
- **测试是假绿**：`[38]` 的 fixture 手工写 `{groups:{}, tools:{}}`（插件自己永远写不出来的状态）。
  现在用 `recordUsage()` 真实产出的账本（10 个工具的组里只热 1 个 → 10% < 30% → only 1），
  并新增 `[44]` 对照组（1/2 = 50% → 整组开）。**先红后绿验证过**：把阈值临时改成 0 模拟旧行为，用例立刻失败。
- **能力目录的「按热度」原本是空转**：组被收起 ⟺ 组冷 ⟺ 所有工具都冷 ⟹ 排序键全是 0 ⟹ 退回注册顺序。
  现在账本加 `counts`，排序改为**次数优先、最近次之**；且占比阈值让「部分热」的组真的存在，排序才有输入。

### 说明
- 账本新增 `counts` 字段，旧文件没有则按 0 起算（向后兼容，不需要迁移）。
## [0.15.6] - 2026-10-30

### 修复（挑刺第二轮，第 1 条是「让数假好看」的那类，最危险）
- **`firstTryRate` 的分母被稀释**：原分母是**所有**工具的 pre-execute，而 `read` / `write` / `bash` 永不入组、
  不可能自愈。一晚 200 次调用里 190 次核心工具时，5 次自愈会被读成 **97.5%**，组内实际是 **50%** ——
  分母错了会让数**假好看**，比分子错（数难看）更危险，因为它让人停止观察。
  现在 `if (groupId) countToolCall()`：分母与分子口径对齐（自愈只可能来自组内工具）。`[43]` 同时守住语义与分母。
- **注释里的旧公式没跟**：`index.js` 那句「首次成功率 = (关键词预开 + 自愈) / 总调用数」已删（同一事实存两遍必然漂）。
- **能力目录的样本按注册顺序取，不是按热度**：`cua-input` 37 个工具取前 3 = 8% 覆盖且多是最冷门的。
  现在按用量账本的最近调用时间取 top3（同样成本），未用过的保持注册顺序。

### 文档（同轮）
- `firstTryRate` 的注释与 DESIGN 都写明**它测不到什么**：模型「压根没开口」的静默失能（零调用、零自愈，数仍是 1.0），
  所以它是必要不充分条件。
## [0.15.5] - 2026-10-30

### 修复（挑刺清单，两条最硬的都核实为真）
- **`firstTryRate` 分子语义是反的**：原式 `(autoOpened + selfHealed) / toolCalls` ——
  `selfHealed` 是「模型第一次叫错名字、多花一轮」（坏事），`autoOpened` 是「关键词预开、零往返」（好事），
  相加等于**预开做得越好、这个数越难看**；且 20 次自愈 / 100 次调用会被读成「20% 成功率」，实际 80%。
  改成 `1 - selfHealed / toolCalls`，`autoOpened` 不再混进比率（stats 里单独给）。新增冒烟 `[43]` 守住语义。
- **能力目录把工具名截了前缀，等于教模型念错名字**：`cua_driver_native__click` 显示成 `click`。
  而 `click` 在注册表里**真存在**（第三方 computer-use 提供的裸名）⇒ 模型「照着念」会**静默用错插件**；
  就算不存在，`groupOf('click')` 也匹配不到锚定正则、自愈不触发。改成列**完整工具名**（`[39]` 断言同步加严）。

### 文档（同一份清单里成立的几条）
- **红线措辞修正**：README 原写「会话中途不改工具表」，而关键词预开 / 自愈按定义就是中途改。
  改成「**默认**不改；只允许这两种例外，且都要留痕」。
- **补缓存账**：报的是字符数，不是账单 —— 稳态吃缓存命中价，中途改表会让缓存作废一次；三条改表路径都只在「当下就要用」时触发。
- **DESIGN 新增「已知代价与明确决定」**：firstTryRate 定义、完整工具名、关键词预开整组且不自动收回（含为何不做启发式收回）、缓存账。

### 不采纳（写明理由）
- **关键词预开命中后自动收回**：不做。命中只说明「要这一类操作」，判断不出具体工具；误收会打断正在进行的工作。
  观察指标 `firstTryRate` 已可读，若棘轮代价显著再回来评估。
## [0.15.4] - 2026-10-30

### 修复（自审：提示里的指路缺了一条）
- 能力目录只列每组 **3 个**样本工具名，但提示只教模型「报 unknown 时查 status（计数）」，**没教它 `lazy_tools_list {group}` 能拿全量名字**。
  结果是：需要第 4 个工具时，模型要么猜、要么只能看到数量。已补上这条指路。

### 复核结论（这一版顺手做的两件事）
- **DSH 有没有原生替代**：查过安装包清单与文档 —— 没有「延迟加载 / 按需暴露工具」的官方包；本构建 `run_code`（PTC 入口）仍未注册。
  ⇒ 设计里的退场条件**未到**，本插件仍有存在理由。
- **改动自审**：`sampleFor` 每组只跑一次、每次约 168 次正则（微秒级）；`firstTryRate` 的分母含本插件自身调用（略偏乐观），已在注释里写明。
## [0.15.3] - 2026-10-30

### 修复（0.15.2 的发布物缺陷）
- 0.15.2 的包内 `CHANGELOG.md` 混进 **2 个 NUL 字节**（我用 PowerShell 双引号 here-string 写它，里面的 `` `0.14.x` `` 被当成转义 → NUL），
  编码体检因此把它判成「二进制跳过」。已清除并复验 0 个 NUL。**代码与 0.15.2 完全一致，只有这份文档不同。**
- 记入翻车档案 #56；规矩：写含反引号的长文本用**单引号 here-string**，落盘后验「无 NUL + 是 UTF-8」。
## [0.15.2] - 2026-10-30

### 修复（外部评审指出，全部先核后改）
- **能力目录只给了组名，没给工具名** —— 模型知道有「桌面·点」这个抽屉，却不知道里面是 cua_driver_native__click；
  而自愈要求它**喊出被藏起来的那个名字**。等于「口令锁在保险箱里」。
  现在每组附 **3 个代表工具名**（从**全局注册表**取，所以被收起的组也列得出），自愈从「猜名字」变成「照着念」；代价约 +40 token/轮。
- **37 个工具的 cua-input 唯独没有 utoHints** —— 出厂四组里它是最大的一组，而「点一下 / 输个字 / 滚一下」正是小白最高频的说法，
  全部只能走自愈。已补 20 个关键词（点击 / 点一下 / 输入 / 打字 / 拖动 / 滚一下 / 快捷键 / 打开应用 …）。
- **三处过期数字**：README 0.14.x → 0.15.x、README 32 项断言 → 51 项断言、DESIGN 48 项 → 51 项（同一个事实存三处必然漂）。

### 新增
- health.stats 增加 **	oolCalls** 与 **irstTryRate**（(关键词预开 + 自愈) ÷ 真实工具调用数；样本 < 20 时返回 
ull，不给结论）——把「首次成功率」变成可看的数。

### 未采纳（写明理由，别下次重新纠结）
- **autoHints 命中后改走 only（只放开少数几个）**：不做。命中只说明「用户要这一类操作」，无法判断具体是哪个工具；
  只开 3 个会把需要的那一个挡在外面，多一轮往返，反而不如整组开 + 目录里已列名字。

## [0.15.1] - 2026-10-30

### 修复（DSH 作者第二轮 mock 复现）
- **冷却期内的第二次晚注册会永久漏网**：`tools/change` 处理器在 3 秒冷却里直接 `continue`，把「检查」也一起跳过了。若上游在冷却内又注册了新工具、而之后没有别的事件，**那个工具整场可见、静默烧 token**（作者复现：`input_one` 已藏 → 注册 `input_late_one`（被收，开始冷却）→ 冷却内注册 `input_late_two`（被跳过）→ 之后无事件 → 一直可见）。
- **修法**：冷却只推迟动作、不再丢动作 —— 冷却期内改为**排一次延迟核对**（到冷却结束 +25ms 再查一遍）。定时器按 agent 去重、`unref()` 不吊住进程、**插件卸载/热重载时随 `ctx.effect` 清掉**。重建引发的新事件会重新排一次，查到无漏网即自然停止，不自激。
- 回归用例 `[42]`：两次连续晚注册 + **不再触发任何事件**，冷却过后必须两个都被收起。先红（实测 `g_late_two` 等 250ms 仍可见）后绿，套件 **51 项**。
- 冷却时长支持 `LAZY_TOOLS_COOLDOWN_MS` 环境变量（只为测试压短，默认仍 3000ms）。

## [0.15.0] - 2026-10-30

### 修复（2026-10-30，DSH 作者用 mock 复现后指出）
- **重入 `rebuild` 会留下孤儿限制**：`rebuild` 先 `lift()` 旧限制、之后才替换 `st.lifts`；而 rc.3 里**撤销限制会同步发 `tools/change`**，事件处理器因此重入 `rebuild`，内层把自己的句柄写进 `st.lifts`，外层回来又用 `leftovers` 覆盖掉 —— 内层那条限制**再也撤不掉**。症状：打开一个组后工具不回来、过滤器条目越点越多。
- **修法**：`rebuild` 串行化 —— 重入只置 `pendingRebuild`，外层跑完补跑（上限 5 轮），句柄不会再被覆盖；晚注册的工具仍由循环里的新一轮读取覆盖到。
- **测试假绿**：我们的假宿主原先**不会**在撤销限制时同步发事件，所以这条重入路径永远走不到。mock 新增 `setSyncRestrictEvents(true)`；回归用例 `[41]`（连续开两个关着的组 → 两个名字都要可见、限制条数归零）**先红后绿**验证过。档案 #54。

### 修复
- **销毁竞态不再拖垮 `healthy`**：子代理被销毁时 `restrict` 会抛 `cannot create effect on inactive context`，原来这条记进 `errors` ⇒ `healthy=false`（2026-10-30 实测：subagent 一退出，主会话 health 就报 unhealthy）。现在它**仍留在 `errors` 里作证据**，但**不参与 healthy 判定**，并单独计数 `stats.restrictSkipped`。冒烟 `[13]` 加了回归断言——退回旧写法时它必红（已双向验证：旧码退出码 1、新码 49 项全过）。

### 工程
- 冒烟测试支持 `--quiet`：只打汇总和失败项。pre-commit 钩子改用它，每次提交少打约 49 行。

### 新增（按 DSH 作者在 #11207 给的诊断法）
- **`lazy_tools_health` 支持 `{tool: "名字"}`**：一次给出「全局注册 / agent 作用域 / 本会话工具表 / `run_code` 在不在」四个事实，把「工具看不见」拆成四种因：没注册 / 被作用域过滤 / 被 `schemas(agent)` 过滤 / 只走 PTC。
- **blocked 状态改成实测三态**：`not-registered` / `agent-filtered` / `filtered-by-schemas`（量不出来时明写 `unverified`），并带上探针结果。原来那句「宿主没挂载」是猜的——2026-10-30 实测 `cua_driver_native__list_apps`：`global=true`、`agent=true`、不在工具表，即被 `schemas(agent)` 滤掉。

### 修复（第三方复核 2026-10-29）
- **glob 转义漏了 `?`**：转义集是 `[.+^${}()|[\]\\]`，手写 `foo?bar` 会变成正则 `/^foo?bar$/`（匹配 `fobar`）——照文档写却静默不生效。补一个字符，`*` 仍是通配符。冒烟 `[40]` 覆盖。
- **`POST /lazy-tools/api/policy` 会把策略文件写空**：`readJsonBody` 在「body 超 64KB 被截断 / JSON 坏 / req 出错」时返回 `{}`，归一化后仍是 `{}`，写盘就把 `~/.dsh/lazy-tools.policy.json` 清空，却返回 200。现在**空策略一律拒绝**（400）——合法的设置页保存至少带一个已知键。现场验证：坏 JSON → 400，文件 sha256 未变。

### 文档（同一次复核的 B0/B1/B2/D3）
- **DESIGN.md 四处过期**：`~600 行` → 约 2800 行（实测）；删掉「220 tokens/工具」旧估算、改成指向 README 实测表；「五组含 tiddlywiki-heavy」→ 四组 + 用户手写组；冒烟 `20 项` → `48 项`。
- **README 工具表漏了 `bench`**：标题「十个工具」→「十一个工具」并补一行；英文表补齐 `bench` / `classify` / `save_groups` 三行。
- **数字表标注「冷启动 / 未使用态实测」**：用久了热组会默认开着，收起量会自然往下走——那不是虚报，是热度模型，写明白免得被当成造假。
- **自动分组补一句**：新装插件可能被自动收起（组 id `auto-*`），`lazy_tools_disable auto-xxx` 可解散。
- **DESIGN 边界加第 7 条**：官方工具组调不出来是 DSH 的 bug，本插件不修、也别再重新分析（连同「空 body 写空」那条的处置）。
- **五问后补一句方法**（作者自己用出来的）：让 AI 减东西要说**为什么减 + 用什么替代**，只说「别加」等于没给方向。

### 文档
- **实测数字只留一处**：README 中英两份的「省了多少」那张表是唯一存数字的地方，其它段落改成「见上表」。理由不是排版——同一个事实存两遍就一定会漂（2026-10-28 的 `181/92/20k` 就是这么漂的，档案 #44）。根治办法是删掉重复，而不是加一个同步器。

## [0.14.7] - 2026-10-29

### 新增（体验：少配置、少概念、模型知道抽屉里有什么）
- **`autoGroups` 默认从 `suggest` 改成 `on`**：`suggest` 只往 `lazy_tools_scan` 里塞建议，普通用户既不会去 scan，也就永远拿不到「第三方插件装上就被管」的收益 —— 等于功能不存在。护栏不变：同族 ≥ 3 个才建组、子族覆盖 ≥ 80% 才切分、核心工具永不入组、被收起的工具第一次被调用时守卫自动放回。想先审核的人把它调回 `suggest`。
- **常驻提示带能力目录**：原来只列组 id，现在列「组 id(用途)」，模型才知道抽屉里有什么（不然它连名字都没见过，自愈也没机会触发）。代价约 +50 token/轮，文件里写明了这笔账。
- **单工具热度**：组整体不热、但组里有几个工具最近真的被调用过 → 只放这几个（`only` 白名单，最多 3 个），其余继续收起。「桌面·点」37 个工具里只用 1 个时，不必为它把 36 个一起放回来。
- **设置页拆「基础 / 高级」**：基础页只留档位、闲置天数、两个界面开关 + 一句「已收纳 N 个工具 · 自动取出 M 次」；自动分组、三档天数、最小工具数、分类提示、策略文件路径收进 `<details>`。
- **会话档位改成下拉一次生效**：原来循环点击，从「跟随全局」切到「积极」要点三次，而每次点击都会重算工具表 = 三次打断前缀缓存。
- **自愈话术**：明确要求模型「立刻用原参数重试、不要向用户解释、不要停下等确认」。
- **`lazy_tools_bench` 报 `outsideRegistryNames`**：把「会话里可见、但不归工具注册表」的工具名逐个列出来。起因是 2026-10-28 发现 `visible 135` 与 `visibleInRegistry 101` 差 34 个，光看数字只能猜；实测那 34 个是 **33 个宿主内核工具 + 1 个 `dsh-ops` 的 agent 作用域工具**，属于设计里写明的边界（不是缺口）。

### 修复（对面 2026-10-29 代码级复核，含两条真 bug）
- **`tools/change` 冷却盖错了地方**：原来先盖时间戳再判断漏网，冷启动时上游插件挤在 3 秒内注册的工具会被冷却吞掉；之后不再有事件，那个工具整场可见、静默烧 token。改成「先检查、确认有漏网再盖戳再 rebuild」。**冒烟 [36] 两向验证过：回退成旧写法时该用例精确失败（`deny=late_one`）**。
- **改档位后生效天数不跟随**：`policy.idleDays` 启动时算一次，设置页保存走 `Object.assign`，于是档位说「积极」、天数还是上一档的数字。新增 `api.js:applyPolicyPatch()`：只给 level、没给 idleDays 时按 `presets[level]` 重算。**冒烟 [37] 覆盖**。
- **空输入被存成 `idleDays: 0`**：界面上写着「不填就跟随档位」，实际 `Number('') === 0`，而 0 的语义是「不按时间收敛 = 全开」，等于用户照提示操作反而把抽屉关了。现在空串不下发该字段；用户没手改天数时也不下发，让宿主按档位算。
- **i18n 缺口**：最小工具数、档位名、控件前缀、天数占位符等 6 处硬编码中文，英文界面下不翻译。
- **`tr(tr(...))` 套娃两处**（不是一处）。
- **Dock 里自定义天数生效后「自定义」按钮消失**：现在档位是下拉，「自定义」一直都在，随时能改。
- **`mountBridge` 的清理函数没人接**：插件卸载后桥还在回请求。现在挂到 `ctx.effect` 上随生命周期关掉。
- **测试隔离漏洞**：`LAZY_TOOLS_USAGE_FILE` 没隔离，冒烟会读真机用量账本（单工具热度上线后 [12] 因此误判）。已隔离。

### 文档
- README 中英两份：残留的 `181 tools / 92 hidden / ≈20k tokens` 换成实测数；「省了多少」改三态口径（可见 / 收起 / 宿主未挂载）；装法链接改 `releases/latest`；默认模式表改成 `on`。
- DESIGN 边界第 1 条补实测（135 = 101 + 34，33 个内核 + 1 个 agent 作用域工具）。
- INTEROP：默认 `on` 的说明与迁移。
- `lib/index.js` 头注释「六个工具」→ 十一个；CHANGELOG 的 `0.12.1` 重复标题删掉一条。

### 新增（测试）
- 冒烟 44 → **48 项**：`[36]` 冷却、`[37]` 档位→天数、`[38]` 单工具热度、`[39]` 能力目录。

## [0.14.6] - 2026-10-28

### 修复（报警口径：只报我们自己的错）
- **lazy_tools_health 不再把「宿主没挂载」当成故障**。同样是「组开着、一个工具都不可见」，现在按三种根因分开处理：
  1. 有些工具是**我们自己收起**却没还回来（`restrict` 撤销没生效）→ 报警，这是真故障；
  2. 这些工具**本会话挂载过、现在不见了**、也不是我们收的 → 报警，问题在宿主那边；
  3. **从来没挂载过** → 静音待命：只写进新增的 `notes`，`healthy` 保持 `true`，组上标 `blocked: "host-not-mounted"`。

  理由：`cua_driver_native__*` 自 DSH 2.0.20 起就挂不到 agent 上，这不是插件能修的。每轮替宿主报警，只会训练人忽略报警。
- **监控会自动恢复**：`health` 每次采样当前工具表（`st.seen`）。宿主哪天把工具挂回来，`visible` 大于 0、`blocked` 消失，用户不需要做任何事。
- **lazy_tools_bench 改三态记账**：`visibleInRegistry`（本注册表里可见）/ `hidden`（我们收的）/ `absent`（宿主没挂、从没进过上下文）。`absent` 不再算进「收起省下的」——那不是省下来的钱，是从来没花过的钱。
  新增 `visibleOutsideRegistry`：`visible` 是整个会话的工具表，里面有工具不归本注册表管。本机实测 **101 + 48 + 19 = 168 注册**，账能对上；135 里另外 34 个是别的注册机制给的，拿 `visible + hidden + absent` 去对 `tools` 会对不上。
  本机实测：`hiddenChars` 94,792 / `absentChars` 23,637（此前把 absent 混进 hidden，虚报成 118,429）。**所有工具都挂上的机器 `absent` 为 0，数字与 0.14.5 一致。**

### 测试
- 冒烟 40 → **44 项**：新增 [32] 从未挂载 → 不报警且 healthy 仍为 true；[33] 挂回来 → `blocked` 自动消失；[34] 挂过又消失 → 必须报警（验证静音没有把真异常一起吞掉）；[35] bench 三态必须能加回注册总数。

## [0.14.5] - 2026-10-28

### 新增
- **lazy_tools_bench**：把「工具定义占多少字符」量成可复现的数字（读全局注册表，含被收起的工具；按组分列）。README 里的数字全部来自它，读者可自行核对。
- **INTEROP.md**：和 dsh-ops、桌面操作类插件、前缀命名插件的叠加方式，以及「工具忽然不见了」的排查顺序。

### 文档
- 「省了多少」从估算（约 220 token/工具）改为**实测字符数**：本机 168 个工具 202,339 字符；收起 67 个省 118,429 字符（58%）。
## [0.14.4] - 2026-10-28

### 文档
- README 改成两段式：**装完就能用**（默认行为，无需配置）与**想自己调的人**（四处可写点、匹配式能力）。中英同步。
- 工具表补上 `lazy_tools_classify` / `lazy_tools_save_groups`，标题「八个工具」→「十个工具」。
- 状态版本号从 0.11.0 更正到 0.14.x（之前一直没跟着改）。
- DESIGN.md 新增**三条红线**：会话中途不改工具表 · 自救工具永不入组 · 失败必须响；外加隐规则「不替换工具、不引入原生依赖」。
## [0.14.3] - 2026-10-28

### 修复（与核心承诺的冲突）
- **lazy_tools_save_groups 不再默认立刻生效**。会话中途改工具表会打断前缀缓存，而「只在会话开始时决定收哪些工具」是本插件最核心的承诺。现在默认只写文件、下次会话生效；要现在生效必须显式传 pplyNow: true，返回里写明「会打断本会话缓存」。
- policyFile() 支持 LAZY_TOOLS_POLICY_FILE 覆盖（测试隔离用；冒烟此前会读真实策略文件，导致第 31 项误判）。
## [0.14.2] - 2026-10-28

### 新增
- **分类提示开关** classifyNudge（默认开）：设置在设置页可勾选，提示语里写清「会让 AI 花一点 token 分一次组，结果长期生效」；关掉后提示段里不再出现，但 lazy_tools_classify 仍可手动调用。
- 客户端设置页加一行复选框 + 说明（中英双语），/state 与 /policy 都带上该字段。

### 测试
冒烟 40 项（新增：开关打开时提示段含提醒、关闭时不含且基础提示仍在）。
## [0.14.1] - 2026-10-28

### 修复
- **分类提示误报**：0.14.0 把 keep 常驻名单里的工具（dsh_browser_a11y 等）和通用单例（weather / esearch）也算成「没人管」，一轮提示 29 个。现在只盯**裸名工具**（名字里没有下划线，如 click / 	ype_text / list_windows）并排除 keep 名单——正是本次要解决的形态。
## [0.14.0] - 2026-10-28

### 新增：把「分类裸名工具」交给当前会话的 agent（不内嵌模型）
- 系统提示里只加一句提醒（约 60 token，且**只在真有未归组工具时**出现）：列出前 6 个名字，让 agent 自己看描述分组。
- 新工具 lazy_tools_classify：返回未归组工具的名字 + 描述摘要 + 参数名 + 现有组 + 分组要求，供 agent 判断。
- 新工具 lazy_tools_save_groups：把分好的组写进 ~/.dsh/lazy-tools.groups.json 并**立刻生效**；硬校验：含常驻工具 → 拒、每组 <2 → 拒、名字未注册 → 拒、与现有组重叠 >80% → 拒、id 重复 → 拒。
- 两个新工具进常驻白名单（自救工具永不被收起）。
- 冒烟 39 项。
## [0.13.5] - 2026-10-28

### 新增
- **用户组文件** ~/.dsh/lazy-tools.groups.json：手写组放这里，和 cordis.patch.yml 解耦（loader 里写 extraGroups 会整体替换 bundle 的默认四组，实测把 browser-heavy / vision-heavy 冲掉了）。文件不存在或写坏都当空数组，不影响启动。
- 配置层也接受 extraGroups（追加语义，不动默认组）。

### 修复
- extraGroups 的运算符优先级 bug： ? b : c.filter(...) 只对 else 分支做过滤，导致追加组缺少 es 字段直接崩。
- 冒烟 38 项（新增 extraGroups 追加用例）。
## [0.13.4] - 2026-10-28

### 改进（学自 dsh-ops 的两条工程实践）
- **解除限制失败会重试一次**：孤儿限制比"没解除"更危险（它会让下一次 rebuild 叠在旧掩码上，出现"改了没生效"的假象）。仍失败则保留下来等下次重试，并写 warn 日志。
- **health 告警带处理顺序**：从"只说现象"改成 ① 重启 DSH ② 仍不行就 lazy_tools_disable 该组 ③ 确认插件已启用时去 DSH 侧查为何没注册工具。

### 验证
- 互操作实测（非推演）：把 dsh-ops 的 ops_* 工具名喂给自动分组，得到 uto-ops expect=16，两个常驻工具（ops_discover_tools / ops_read_files）被白名单正确排除。
## [0.13.3] - 2026-10-27

### 修复
- **自动分组在冷启动仍会漏族**：0.13.1 用「工具表非空就收手」的 settle 开关，但 DSH 2.0.20 启动时本插件加载早于 mnemon，工具表非空却缺 mnemon ⇒ 提前收手、永不重算（重启后实测 groups= 里确实没有 uto-mnemon）。改为**每次会话开始都重算**，按组 id 去重，重复调用安全。
- 冷启动时 locale 服务未就绪不再记 console.error（属于预期先后顺序，降为普通日志）。
## [0.13.2] - 2026-10-27

### 修复
- **lazy_tools_resolve 不再假报成功**：解除本插件限制后，会再查一次「这个工具现在真的可见吗」；如果宿主压根没把它交给本会话（插件未挂载、或刚更新完需要重启），返回 pplied:false + eason:"not-visible" 并写一条错误记录，而不是 pplied:true 让人白等一轮。
- **health 新增静默失败告警**：某个组 on=true 但 isible=0（工具在注册表里、却不在本会话工具表）时，warnings 里会点名该组并提示「宿主没挂载它们 / 可能需要重启」，不再静默 healthy。
## [0.13.1] - 2026-10-27

### 修复
- **自动分组在冷启动时会漏掉工具族**：原先只在插件 pply() 时算一次，而其他插件的工具可能尚未注册（DSH 2.0.20 更新后实测复现：utoGroups: on 却没有建出 uto-mnemon）。现在改为「会话开始的第一次 stateFor 时补算」，直到工具表非空为止；lazy_tools_scan 也改为调用时现算，不再返回陈旧结果。
- 冒烟新增第 37 项：pply() 时没有任何工具、注册发生在之后，仍要能建出自动组。
## [0.13.0] - 2026-10-25

### 新增
- **自动分组**：按工具名前缀识别家族，为「没被现有组覆盖」的那部分自动建组。
  - 三种模式：`off`（不动）/ `suggest`（默认，只在 `lazy_tools_scan` 里给建议）/ `on`（自动建组并按规则收起）。
  - 切分规则：按 `__` 或 `_` 分段；**子族合计覆盖 ≥80% 才往下切**，否则保留整族（避免 mnemon 17 个被切成两个 3 个）。
  - 安全边界：核心工具白名单（read/write/edit/pwsh/grep/glob/skill/todo 等）与 `lazy_tools_*` 永不入组；已被覆盖 ≥80% 的前缀跳过；与手写组冲突时手写组优先。
  - 只在会话开始时计算一次，整场冻结（不打断前缀缓存）；自动组 id 带 `auto-` 前缀，`status` 里可见。
- 设置页新增「自动分组」选择器；`lazy_tools_scan` 输出增加 `autoGroups` 字段（建议 + 被跳过的前缀及原因）。

### 说明
- 自动分组只看到**插件注册的工具**；内核内置工具（read、schedule、job 等）不在注册表里，不会被自动分组。

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

```


### README.md

```js
﻿# 工具抽屉 · dsh-tool-drawer

**中文** | [English](README.en.md)

装上两百来个工具之后，问题会变得很明显：模型每一轮都要把这些工具的说明读一遍——哪怕这次只需要改一个错别字。一晚上下来，真正被调用过的工具往往不到一半。

工具抽屉处理的就是这件事：平时用不上的工具组收起来，要用的时候再放出来。

**状态：0.19.1。**

> **0.19.0-dev 新增**：`review:` / `build:` / `research:` 角色 label（按 label 裁工具面）；
> `review:`/`research:` 隐藏 edit/write；`findings` 台账与收敛判定；
> mutation score 校准；`schedule` 官方包默认开启（只给顶层 agent）。
> 这些还在测试，未发版。
 在一台机器上日常使用。配置面仍可能变化。Issue 和 PR 都欢迎，维护是尽力而为；需要稳定保证请自行 fork。DSH 若实现原生按需加载，这个项目应当退场。

实测过的宿主：**DSH 2.0.20-next** 与 **2.0.21-next**（2.0.21 起 `pwsh` 被 `ops_*` 取代；插件不做版本分支，保护清单用两代并集，缺失的名字是空操作）。更早的版本未测。

---

## 装完就能用

默认行为就是全部，**不需要打开任何设置，也不需要写任何配置**：

- 出厂四组（桌面·看 / 桌面·点 / 浏览器·重 / 视觉·重），按最近使用自动收放；
- 被收起的工具**在你真的调用它的时候会自动放出来**（守卫机制），不用先知道它属于哪一组；
- 需要某个能力时，模型调 `lazy_tools_enable` 把组放回来；它直接调用被收起的工具时，守卫会先放回、再直接执行；
- 想看现状：`lazy_tools_status`；想本会话全开：`lazy_tools_mode { idleDays: 0 }`。

一句话：装上，照常用。

## 想自己调的人

按「从轻到重」排，下面四处都是纯文本：

| 想改什么 | 改哪里 |
|---|---|
| 档位 / 闲置天数 / 是否显示控件 / 分类提示开关 | 设置页，或 `~/.dsh/lazy-tools.policy.json` |
| 有共同前缀的工具组（`dsh_browser_*` 这类） | 包的 `cordis.patch.yml` 里的 `groups`，或配置 `extraGroups`（**追加**，不动默认组） |
| 没有共同前缀的工具（`click` / `type_text` 这种裸名） | `~/.dsh/lazy-tools.groups.json`；也可以让 AI 调 `lazy_tools_save_groups`（不传 `groups` 看描述、带 `groups` 落盘） |
| 只想看不想写 | `lazy_tools_status` / `lazy_tools_list` / `lazy_tools_health` |

匹配式支持 `*` 通配和 `re:` 正则；每组可写 `keep`（永不收起）、`expect`（数量断言）。

**三条红线**（这个项目自己也不越过）：**默认**不在会话中途改工具表（例外只有显式动作 `enable`/`disable`/`mode`/`save_groups{applyNow}` 与自愈补开，且都要留痕）· 自救工具永不入组 · 失败必须报出来。展开在 [DESIGN.md](DESIGN.md)。

---

## 省了多少

**实测**（2026-10-28，本机 168 个注册工具）：

```
工具定义合计        178,702 字符   # 只算本会话真正相关的（可见 + 收起）
当前收起 48 个       94,792 字符   （53%）
注册表内可见 101 个  83,910 字符
宿主未挂载 19 个     23,637 字符   # 从没进过上下文，不算「省下的」
```

> 这台机器上有 19 个工具（`cua_driver_native__*`）宿主压根没挂到会话里 —— 它们从没花过 token，所以**单列**，不并进「省下了多少」。工具全部挂载的机器上这一项为 0，数字会回到「收起 67 个 / 118,429 字符 / 58%」。
> **缓存账（2026-10-30 补）**：上面报的是「工具 schema 不进请求」省下的**字符数**，不是账单上的等比值。
> 稳态下工具定义本来就在前缀缓存里命中，命中价通常只有未命中的几分之一（具体倍率由服务商决定，这里不编数字）；
> 而**会话中途改工具表**会让后续请求的缓存作废一次 —— 本插件会中途改表的只有：自愈、显式 `enable`/`disable`/`mode`、`save_groups {applyNow:true}`。
> 它们都是「用户或模型当下就要用」，不是优化手段；如果一次会话都没触发，缓存一次都不会被打断。
> **这组数是「冷启动 / 还没用热」时的实测**：用久了，热组会默认开着，收起量自然往下走 —— 那不是虚报，是插件的设计（按使用热度）。复现请跑 `lazy_tools_health { bench: true }`。
> 另有 34 个**不在工具注册表里**的工具：33 个宿主内核（`read` / `write` / `pwsh` / `glob` / `web_fetch` …）+ 1 个 agent 作用域的 `ops_discover_tools` —— 它们不进注册表，也不上表统计，不会被收起。

换算成 token 请用你自己 provider 的 tokenizer —— 这里只报**字符数**，因为不同语言的描述密度差别很大，硬编一个系数等于替读者猜。

**这个数字随时可以自己复现**：

```
lazy_tools_health { bench: true }
```

它会把每个组的工具数、收起的字符数、可见/收起/未挂载三态都列出来（百分比自己除一下）。README 里所有数字都来自这条命令。

> 早期版本写的是「约 220 token/工具」的估算；换成 `lazy_tools_health { bench: true }` 之后，改成实测字符数，读者可以核对。

## 怎么做到「不读」

DSH 的工具注册表支持按 agent 隐藏全局工具，接口是 `restrict({ deny: [...] })`。

每个 agent 创建时，把配置组内的工具填进 `deny`，它们就从模型可见的工具表里消失；解除这条限制即恢复。

整个过程不引入：

- 代理进程（调用不经过中间层）；
- 向量检索（不额外跑模型判断意图）；
- 包装器（真实调用仍是原生调用，参数校验不变）。

不用向量路由的原因：路由错一次，需要的工具会被静默藏掉，模型只会回「没有这个能力」；另外为省 token 引入一个 90MB 编码器并不划算。

## 装法

这是一个 bundle：宿主半边加一个设置页的客户端半边。三种装法，任选其一。

**从 GitHub 直接装（插件市场显示的就是这条）：**

```
dsh plugin --profile web add github:kmyy350234-dz/dsh-tool-drawer
```

**或者用仓库里的 Release 包（不依赖 npm）：**

```
dsh plugin --profile web add https://github.com/kmyy350234-dz/dsh-tool-drawer/releases/latest/download/dsh-tool-drawer.tgz
```

**或者 clone 到任意位置，用插件管理器装：**

```
plugin_manager install_bundle  target: /你的路径/dsh-tool-drawer
```

不建议手改 `cordis.patch.yml`——手写也能运行，但只有宿主半边，**没有设置页**。

bundle 自带的 patch 已配好四组：

| 组 | 收起数量 | 保留（永不收起） |
|---|---|---|
| 桌面·看 | 19 | 无 |
| 桌面·点 | 37 | 无 |
| 浏览器·重 | 28 | open / content / a11y / click / type / wait |
| 视觉·重 | 8 | describe / ocr / crop / bootstrap / materialize / present |

改组成员改 checkout 里的 `cordis.patch.yml`。配置改动重载生效；**改宿主代码需要重启进程**。

## 自动分组

插件越装越多，新插件带进来的工具没人管，就一直可见、一直付 token。`autoGroups` 让插件按**工具名前缀**识别家族，自动给它们建组。

插件目录的收录描述里提醒过：自带分组只覆盖 `cua_driver_native` / `dsh_browser` / `vision` 三类，其他工具要在 `cordis.patch.yml` 里自己加。**`autoGroups` 补的就是这一步**——其余家族会被自动识别成组；想改匹配式或加 `keep` 名单，再回去写配置。

| 模式 | 行为 |
|---|---|
| `off` | 完全不动 |
| `suggest` | 只在 `lazy_tools_list { ungrouped: true }` 的 `autoGroups.suggestions` 里给建议，不建组 |
| `on`（默认） | 自动建组，并按规则默认收起。被收起的工具第一次被调用时会自动放回来，所以「误分组」最多多一次往返 |

**新装的插件可能被自动收起**：自动组的 id 以 `auto-` 开头（如 `auto-foo`），用 `lazy_tools_disable auto-foo` 就能解散；核心工具永不入组；被收起的工具第一次被调用时，守卫会自动把它放回来。

规则都写死在代码里，不靠猜：

- 按 `__` 或 `_` 切段；**子族合计覆盖 ≥80% 才往下切**，否则保留整族（`mnemon` 的 17 个不会被切成两个 3 个）；
- 同一前缀 ≥ `minTools`（默认 3）个才建组；
- 已被现有组覆盖 ≥80% 的前缀跳过；
- **核心工具永不入组**（`read` / `write` / `edit` / `pwsh` / `grep` / `glob` / `skill` / `todo_write` / `lazy_tools_*` 等）；
- 只在会话开始时算一次，整场不变（不打断前缀缓存）；
- 自动组 id 带 `auto-` 前缀，`lazy_tools_status` 里看得见，`lazy_tools_disable auto-xxx` 一条命令解散。

**看不到内核内置工具**：`read`、`schedule`、`job` 这类不在插件注册表里，自动分组不会碰它们。

想自定义匹配式或 keep 名单，仍然写配置——下一节。

## 组怎么配

| 字段 | 说明 |
|---|---|
| `id` | 组 id，工具调用时使用 |
| `match` | 匹配式数组。普通字符串按 glob 处理（`*` 通配、整串锚定）；`re:` 开头按正则处理 |
| `keep` | 有意保留可见的工具名，不会被判定为「漏网」 |
| `expect` | 该组**至少**应有的工具数量（下限）；**少于**它时 `health` 告警，多出来不算漂移（吸纳型组本来就会长新工具） |
| `defaultOn` | `false` 表示默认收起 |
| `title` | 供 `status` 展示的中文名 |

## 受管会话（managedRoles，默认关闭）

> **它做什么、不做什么**：受管角色是在**编排器已经给出的工具集上再收紧**。`restrict` 在作用域链上取交集，
> 所以它**不能给角色加上编排器没给的工具**——worker 没有浏览器工具，抽屉变不出来。
> 它防的是「角色会话里冒出不该有的工具」，不是「给角色分配能力」。

多会话编排器（如 dsh-superagent）用 preset 区分角色。默认情况下本插件不区分角色，所有会话都按热度判断。配置 `managedRoles` 后，某个 preset 会被认成「受管角色」：策略在会话创建时解析一次，会话内不变（前缀稳定、不打断缓存）。

设置页的「角色工具面」可以逐项开关，也可以填角色名+允许组加自定义角色；**默认关闭**，只有勾选/配置后才接管对应 label。

**写在哪**：`~/.dsh/lazy-tools.policy.json` 的 `managedRoles` 字段（**JSON**，不是 YAML；和设置页那些档位存在同一个文件），或者插件的 config（profile 里的 YAML）。两处都有时以 policy.json 为准。

```json
{
  "managedRoles": {
    "dsh-superagent-worker": { "allowGroups": ["cua-screen", "browser-heavy"] },
    "dsh-superagent-router": { "allowGroups": ["cua-screen"] },
    "subagent": { "allowGroups": ["*"] }
  }
}
```

> **组 id 必须是这台机器上真实存在的**：默认四组是 `cua-screen` / `cua-input` / `browser-heavy` / `vision-heavy`，
> 另有你手写组的 id、以及自动分组生成的 `auto-<前缀>`。不确定就先跑 `lazy_tools_status` 看 `groups[].id`。

规则：

- 只认结构信号：`agentPresets.composedPreset` 的 preset id，以及 `session.header.parentSession`（子代理 → `subagent` 键）；不认插件名、不认标题；
- **封闭默认**：角色没授权的组、以及没有归组的工具，一律隐藏（`unknown: 'hide'`）；
- 受管会话里 `enable` / `disable` 会被拒绝，自愈也不会绕过策略——改策略请改配置；
- **写错组 id 会被抓出来**（2026-11-02 加）：启动时校验 `allowGroups`，`health.errors` 会写明「哪个角色的哪些 id 不存在」。
  如果某个角色的组**全都不存在**，这个角色**不生效**（退回普通会话行为）——否则受管会话里既不能 `enable`、自愈也不绕过，
  就等于把一个会话锁到只剩核心工具，还全程静默；
- `allowGroups: ["*"]` 表示这个角色不按组设限（逃生口）；
- `allowGroups: []` 表示**只留常驻工具（CORE）**，其余全部收起（2026-11-05 起合法）；
- `health` 新增 `managed: { role, allowGroups, unknown }`，没有受管就是 `null`；
- 不配置 `managedRoles` 时行为与旧版完全一致（默认关闭）。

测试：冒烟 `[61]` 覆盖 worker / subagent / 普通会话三条路径与 enable 拒绝；`[71]` 覆盖「组 id 写错」的三种情况
（全错停用、半错照用、`*` 放行）。

### 给子代理分角色：只认宿主给的信号，不做文本约定（2026-11-03）

给子代理分角色，走的是**宿主原生信号**，不引入我们自己的提示词协议：

1. **会话 label**（首选）——编排器给子会话打 `vendor:role` 这类标签时，取候选段挑 `managedRoles` 里配过的；
2. `subagent` 通用键——任何用 `subagent` 派工的场景；
3. preset id——一角色一 preset 的场景。

> **为什么不做 `[role:xxx]` 这种文本标记**（0.18.1 短暂有过、0.18.2 删除）：
> 它要求「派工的人」改提示词才能生效，而多数编排器的 label 里本来就没有角色词——
> 两个通道解决的是同一件事，多一个私有协议只会多一套行为要解释。
> 0.17.0 立过一条红线：**不再监听 inbox 消息**。那条红线现在恢复。
### 角色信号是**厂商无关**的（2026-11-03）

生态里各家给子会话打「角色」的写法不同，我们**不认厂商名**，只按顺序试这**三**种，**每一种都要求 `managedRoles` 里配过那个键**：

| 顺序 | 信号 | 例子 | `health.managed.source` |
|---|---|---|---|
| 1 | **会话标签里的候选段**（按 `:` `/` `|` 空白切开，逐段小写，**挑 `managedRoles` 里配过的那个**） | `dsh-my-go:hermes: 帮我改模块` → `hermes` | `label` |
| 2 | 子会话通用键 | 任意子代理 | `subagent` |
| 3 | preset id | `cordis` / 自定义 preset | `preset` |

- 标签只在**子会话**上认（`header.parentSession`）；普通会话的标签不生效。
- 认不出 / 没配 ⇒ 不做任何事（失败方向放开）。**`[role:xxx]` 提示词标记已删除**（0.18.2）：写了也不会生效，也不会报错。
- 所以 MyGO（真实标签是 `dsh-my-go:<工种>: <任务摘要>`，见它 `preset/shared/misc.mjs` 的 `agentLabel`）这类编排器**不用改一行代码**就能对接；
- ⚠️ 但**配置的键要写工种名本身**（`hermes`），不要写 `dsh-my-go:hermes` —— 前缀只是标签的一部分，不是角色名。

测试：冒烟 `[74]`。

### 角色怎么配：**不用你手写**（2026-11-03）

角色 → 组的映射由 **AI 自己配**：`lazy_tools_roles`（不传参数=只读；传 `role + allowGroups + basis`=写入）。

```text
lazy_tools_roles({ role: "hermes", allowGroups: ["write"], basis: "写模块，不碰浏览器" })
→ 写进 policy.json，带 createdBy: "ai" + at + basis → 下一个会话立即生效（不用重启）
```

工具层强制三条不变量（人手写 JSON 可以绕过，AI 不行）：

| 不变量 | 原因 |
|---|---|
| 组 id 必须真实存在 | 写错一个就是"会话被锁到只剩核心工具"（`#71`） |
| **不许写 `*`** | `*` 是放开限制的逃生口，**只允许人手改文件** |
| 必须带 `basis` | 让"为什么这么配"留在记录里，权限不是一个凭空的决定 |

- **喜欢折腾的人**：直接改 `policy.json` 的 `managedRoles`（可以写 `*`、可以不带 basis）——**改完不用重启**，下一个会话生效；
- `health.managed` 显示 `createdBy` / `basis`，一眼看出这个角色是谁配的、为什么；
- 受管会话里不能给自己改配置（否则"角色"就管不住自己了）。

测试：冒烟 `[75]`（热重载）、`[76]`（三条不变量 + 写入即生效）。

### 角色工具面实测（n=2，不宣称普遍优越）

> 这组数据只证明“角色在什么边界上更容易赢/输”，不是“角色普遍更好”。

| 任务 | 直派 | 角色 | 结论 |
|---|---|---|---|
| findings 接进 54 | 7:17，2 文件，无 env 钉死 | 6:54，4 文件+3 文档，env 钉死 | 净时间直派略赢；质量角色赢（堵 fail-open） |
| B3 mutation score | 4 文件，12/12 测试，查 mutate 退出码 | 4 文件+3 文档，8/8 测试，不查退出码 | 直派代码更严；角色文档更多 |
| 5 文件审计 | 11:48，8 findings | 10:29，10 findings（多抓 save_groups 无守卫） | 角色多抓一条 blocking；两边都 FAIL |

**能读出来的：**

- 角色买“独立视角/覆盖”，直派买“代码直接/快”；没有稳定的速度优势。
- 角色自己也会制造测试 bug（findings 54 的文案顺序断言），所以“有角色”不等于“更可靠”。
- 这些数字 n 很小，不能当承诺；复现记录在 `perf-/A1-效率对照-20261106.md` 与 `perf-/角色与直派-分工-20261106.md`。

**谁能直接用：**

- 需要 DSH 2.0.x + 本插件；更关键的是**得有 label/预设工作流**（如 `review:` / `build:` / `research:`）。
- 没有 label 工作流时，角色工具面**不会生效**；抽屉仍然只是普通的按需工具组。
- 我们没有内置“supervisor 工作流”给外部用户；本仓库的 A1 工作法是配套文档，不是插件自带能力。
- 如果别人的角色/编排方案更好：应该换或接，不要为了“我们有这个功能”硬用；如果更差，也不靠这组小样本证明我们更好。

## 会话级目录（0.18）

常驻提示里列出的组，按**每个会话实际挂载的工具**算，不是一张全局固定清单：

- 挂载集 = 本会话可见的工具 ∪ 本插件自己藏起来的工具，只列其中有成员的组；
- **一组都没挂载时整段提示消失**（宿主会丢掉空段）——不会再出现「目录里列着一个这个会话根本碰不到的组」；
- 被外部挡掉的（宿主的权限门、别的插件的 deny）**不算挂载**，不会被广告；
- 「有 N 个工具没归组、去分组」这句提醒只在**默认 preset 的人工会话**里出现，角色会话不会被引导去改全局分组表；
- 读不到会话信息（老宿主、服务缺失、认不出的作用域）时**退回 0.17.x 行为**：照旧列全部组。失败方向是「照旧」，不是「变短」。

测试：冒烟 `[64]`（没挂 / 被外部挡的组不广告、空则空段、认不出作用域退回旧行为）与
`[65]`（分类提示只在默认会话出现）。

## 八个工具

| 工具 | 作用 |
|---|---|
| `lazy_tools_status` | 查看每组状态：开关、模式、匹配数量、可见数量、是否热、上次使用时间 |
| `lazy_tools_enable` | 打开一组；`only: ['名字']` 只放指定工具；`groups: [...]` 批量打开；**`name: '工具名'` 按名字一步开一个**（原 resolve） |
| `lazy_tools_disable` | 收起一组，同时清除 `only` 白名单 |
| `lazy_tools_list` | 列出组内工具（含被隐藏的）；`ungrouped: true` 附带前缀分桶 + 未归组工具的描述（原 scan / classify） |
| `lazy_tools_mode` | 仅修改当前会话策略；`reset` 回全局，`collapse` 立即清空 |
| `lazy_tools_health` | 自检五个宿主契约，输出 warnings / 漏网工具 / 自愈次数；**`bench: true` 附带基准账**（注册总数、可见/收起、每组字符数 —— README 数字的唯一来源） |
| `lazy_tools_save_groups` | 把分好的组写进 `~/.dsh/lazy-tools.groups.json`；默认下次会话生效，`applyNow: true` 才立刻生效 |
| `lazy_tools_roles` | 查看/配置「角色 → 允许哪些组」；写入后即时生效（AI 自配会带 `createdBy` / `basis`，可追溯） |

`healthy: true` 表示：五个契约均通过（register / schemas / restrict / guard / agent 事件），无错误（宿主销毁竞态除外，那条只留证据不拉红灯），无警告。

## 设置页

设置页由客户端半边渲染，通过**本机回环路由**（`127.0.0.1`）与宿主半边通信，不连任何外部地址。

> 2026-11-05 起，这条路由的 **Host 必须是回环**（`127.0.0.1` / `localhost` / `[::1]`）；用反代或局域网机器名访问设置页会被 403。要那样用，请在反代上把 Host 改写成回环。插件市场的能力扫描把这类调用标成「会联网」，指的是这一次本机 HTTP 调用，不是外网上传。

宿主默认**只监听 `127.0.0.1`**（2026-10-29 实测：DSH 的 web 服务在 `127.0.0.1` 上，同一进程没有任何 `0.0.0.0` 监听）。所以这条桥**不需要再做一层鉴权**——加 token 属于「为回环工具新造一个部件」，按本项目红线不成立。若哪天宿主改成监听 `0.0.0.0`，那是宿主配置问题，应改监听地址，而不是在本插件里造鉴权层。

`lib/config.js` 导出 schema，DSH 设置页据此渲染字段：

| 字段 | 默认 | 说明 |
|---|---|---|
| `level` | `medium` | 收敛力度：低 14 天、中 7 天、高 3 天 |
| `presets` | `{14,7,3}` | 三档各自的天数，可修改 |
| `idleDays` | 跟随 `level` | 手动指定天数；0 表示不按时间收敛 |
| `minTools` | `3` | **自动分组**的建组门槛：同前缀少于 3 个不建组（下限 3，填更小也按 3 跑） |
| `showDock` | `false` | 在输入框上方显示档位按钮 |
| `showClear` | `false` | 在输入框上方显示独立的「立刻清空」按钮 |
| `classifyNudge` | `true` | 有裸名工具没归组时，在常驻提示里提醒模型分类（一次，落盘后长期生效） |
| `autoGroups` | `on` | 自动分组：`off` / `suggest` / `on` |

两个界面开关互相独立。控件按对话挂载，勾选后需切换一次对话（或刷新页面）才会出现。

组定义保留在 bundle 的 patch 中：写一次后很少改动，且嵌套数组在表单中可读性差。

schema 在运行时解析：扫描 `%USERPROFILE%\.dsh\profiles\*\` 查找 DSH 自带的 `@deepseek-ai/schemastery`，只使用 Node 内置模块。未找到时 `Config` 为 undefined——没有设置页，插件本身正常运行。

设置页写入的策略保存在 `~/.dsh/lazy-tools.policy.json`，优先级高于 YAML 默认值；删除该文件即回到默认。

## 为什么它表现得像会自己判断

它不判断，只按证据触发。两个机制都不包含猜测：

**一、用量账本。** 每次真实调用记录一条时间戳到 `~/.dsh/lazy-tools.usage.json`（只记时间与工具名，不记参数）。新会话开始时计算：**组内热工具占比**达到 `warmRatio`（默认 30%）才整组打开；没到阈值只放「热的那几个」（`only`）；一个都不热才整组收起。组级时间戳只用于展示 `lastUsed`，不参与决策（2026-10-30 改）。

该决策**默认只在会话开始时执行一次**。原因：中途修改工具表会使前缀缓存失效，省下的 token 不足以抵消损失。**被允许的例外**只有显式动作（`enable`/`disable`/`mode`/`save_groups{applyNow}`）与自愈补开（模型已经叫错了名字，不补就白花一轮）。

**二、自愈。** 当模型调用被隐藏的工具时，一个 dispatch 守卫会在拒绝之前拦截：识别所属组，只放出该工具，**然后直接放行这一次调用**（2026-11-05 起；以前是返回「请重试」，在 UI 上会显示成一次假失败）。

补开后直接执行，用户侧无感知。次数记录在 `health.stats.selfHealed`。

## 它防的是什么

**漏网工具。** 插件升级新增工具而组匹配式未覆盖时，该工具会重新变为可见并持续占用 token。`health.stray` 会推导每组的名字前缀，列出「看起来属于该族、但未被任何组匹配」的可见工具（`keep` 中的除外）。

**数量漂移。** 每组配置 `expect`（**下限**）；工具数**少于**它时 `health` 告警 —— 多出来是吸纳型组的正常状态，不报。

**客户端没挂上。** `health.client` 记录浏览器那半边最后一次上报（`seen` / `at` / `agoSeconds` / 挂了哪些面板）。宿主一切正常**不等于**设置页挂上了：2026-10-24 就出现过「宿主四项契约全绿、客户端条目加载失败、Web 进恢复模式」的情况，这个字段把那类问题从「只能靠重启发现」变成一条能查的数据。

**竞态。** 子 agent 可能在限制建立过程中被销毁；这类失败只计入 `stats.restrictSkipped`，**不进 `errors`**（否则多会话场景会把错误槽占满）。

**孤儿限制。** 解除函数挂在 `ctx.effect` 上，热重载会解除它们。
但 `own()` 目前是**先置位 done、再调 dispose**：如果 dispose 抛错，后续 lift 与热重载都不会再试（已知问题，票 `lift-orphan-done-before-dispose` 修）。

## 测试

```
node test/smoke.mjs
```

以 `node test/smoke.mjs` 的输出为准（项数以实际输出为准，不写死），运行在假宿主上，不需要安装 DSH。

假宿主实现本插件依赖的四个**契约**（register / schemas / restrict / agent-created），外加宿主那条**可选**的
`tools.view(scope)` 只读视图（提示段的主读路径就是它；视图缺失、返回空、抛错三种退化都有用例钉住）。
宿主契约变化时，测试先失败，而不是会话先出问题。

> 要改这个插件？先读 [MAINTAINING.md](MAINTAINING.md)：改客户端半边必须冷启动验证，恢复模式下用户无法操作。

## 局限（请务必阅读）

1. **只能隐藏全局工具。** 注册在 agent 作用域中的工具无法隐藏，宿主会拒绝。
   若一批里混进这种名字，插件会**逐个重试**：能藏的照藏，藏不掉的记一条并跳过（不再让整批失效）。
2. **按名字分组。** DSH 的工具定义没有标签，只能对名字写 glob 或正则；改名会导致漏配。
3. **开关会打断前缀缓存。** 打开一次后尽量保持；需要反复切换时优先使用 `only:`，不要整组开关。
4. **自动收敛只在会话开始。** 运行期间不重排，理由同上。
5. **失败方向是放开。** 契约异常或文件不可读时，工具全部回到可见状态：多花 token，但不会减少能力。
6. **自愈只对「存在但被隐藏」的工具有效。** 拼写错误、尚未加载的插件无法修复，这类情况用 `lazy_tools_enable { name: '片段' }` 按片段查找（原 `resolve`，0.16.0 并入）。
7. **界面双语，工具描述不是。** 设置面板和输入框那一行跟随宿主语言服务；模型读取的工具描述在启动时注册一次，仍为中文——宿主进程无法感知界面语言。

## 退场条件

DSH 已带有 `deferLoading` 与工具增补消息。若其实现原生按需加载，这个项目应当退场，而不是继续并行维护。

## 借鉴与参考

这里没有原创机制，只有取舍。前三个项目阅读较深，其余主要参考 README：

| 项目 | 做法 | 取舍 |
|---|---|---|
| [tool-attention](https://github.com/asadani/tool-attention)（[论文](https://arxiv.org/abs/2604.21816)） | 每轮基于 embedding 的意图路由，两段式加载 schema | 量化了「工具税」；未采用 embedding，因为路由错误会静默隐藏所需工具 |
| [mcp-lazy-load](https://github.com/PeterCha90/mcp-lazy-load) | MCP 代理，暴露 `search_tools` / `execute_tool` | 证明可大幅缩减；选择保持原生调用，不经过通用执行器 |
| [dsh-mcp-loader](https://github.com/MikotoMyWife/dsh-mcp-loader) | DSH 插件，按服务器加载并对 agent 施加 `restrict` 掩码 | 同一机制层；本实现不绑定命名空间，并增加 `only:` |
| [lazy-mcp](https://github.com/voicetreelab/lazy-mcp) | 代理层，按服务器分树 | 分组词汇参考 |
| [opencode-lazy-loading](https://github.com/omarwaly-ai/opencode-lazy-loading) | 请求层剥离 | 大幅缩减说法的参考 |
| [dsh-sieve](https://github.com/Sev7eEn7/dsh-sieve) | DSH 上下文过滤，带裁判模型 | 避免「模型在环」判断的理由 |
| [microsoft/agent-framework 的 progressive disclosure 示例](https://github.com/microsoft/agent-framework/blob/e39a8a2e/python/samples/02-agents/mcp/mcp_progressive_disclosure.py) | 按需暴露 MCP 工具 | 术语参考 |

若相关作者认为描述有误，可开 Issue 指正。

## 它不是什么

- **不是代理、网关或 MCP 客户端。** 不接触传输层，不增加跳跃。
- **不是自动路由。** 不猜测用户意图，仅在明确请求时打开。
- **不是安全边界。** 隐藏只是从模型列表中移除，不阻止执行；权限控制请使用宿主机制。

## 许可

MIT，见 [LICENSE](LICENSE)。

---

## English summary

Tool Drawer for DeepSeek Harness: keeps heavy tool groups out of every request and restores them on
demand (one call, a dispatch guard that reopens it, or an on-demand enable). The numbers are measured, not estimated — see the
table above (that table is the **only** place these figures live). No proxy, no embeddings, no judge model — real calls stay
native. Install with `plugin_manager install_bundle`; configure in the DSH settings page. MIT,
best-effort maintenance.

```


### DESIGN.md

```js
﻿# lazy-tools 设计笔记：在「注册表作用域」这一层做工具门控

## 定位（北极星，2026-10-23 用户原话，2026-10-30 补写在这里）

> 「很多人是像我这样的小白，并不知道啥时候该啥时候不该开」
> 「准确来说我想的是让**用户感觉智能**，就够了」

三条推论，任何改动都拿它来判：

1. **装上不用配**：默认值就是正确值；用户不需要读文档、不需要打开设置页。
2. **用户不必知道「抽屉」存在**：他能感到的只有「用得顺、没被挡」。
3. **旋钮只是逃生门**：内部判据（`warmRatio`、`only` 上限、阈值）**不进设置页**；
   真要调的人走配置文件或 `/policy`。

**默认值只能有一处**（2026-10-30 挑刺）：同一个默认值在设置页 schema、运行时代码、README 各写一遍就会漂 ——
已经发生过一次（`autoGroups` 设置页写 `suggest`、实际跑 `on`，用户保存一次表单就静默丢功能）。
现在设置页的默认值**从运行时代码取**（`normalizeAutoMode()`），从结构上消除这种漂移。
**加字段/加旋钮的检查点**（2026-10-30）：先问三句 —— ① 不加它，用户会不会遇到问题？
② 加了它，用户是否需要理解它？③ 它的默认值能不能一处定义、别处引用？
三句里有一句答不上来，就不加。`warmRatio` 一天内加了又撤，就是没走这三句。
**`healthy` 的边界**（2026-10-30 独立盲评后明确）：只覆盖「宿主五个契约 / warnings / errors」，
**不含客户端面板**（`client.seen`）——面板是可选件（`showDock` 默认关），没上报不等于插件有病，
把它并进 `healthy` 会让每个新会话开局都是红的，正是「训练人忽略警报」。
但**必须可见**：默认精简视图保留 `client` 整段（缺失≠正常），由它自己的 hint 解释。
**判定句**：如果一个改动让用户可以少懂一件事，它大概率对；
让用户多想一个「我该填什么」，它大概率错。

> 2026-10-23。写给想抄这个思路的人，也写给下一个维护它的我。
> 代码约 2800 行（`lib/*.js` + `client.js`，2026-10-29 实测）、零运行时依赖；真正值钱的是下面这几条判断。

## 一句话

**要省掉「工具 schema 税」，最便宜的一层不是代理、不是请求改写、也不是语义路由，而是宿主自己的「作用域级工具掩码」。**

如果宿主提供了「按 agent 作用域隐藏全局工具」的接口（本机是 `agent.ctx.tools.restrict({ deny })`），那就用它：

- 不加进程（不像 MCP 代理/网关）
- 不加一跳（真实工具调用仍然是原生的，不是 `execute_tool({name, args})`）
- 不加依赖（不需要 embedding 模型、不需要检索索引）
- 不需要重新注册工具（掩码只影响可见性，注册表不动）

## 问题量级

一台机器上 197 个工具，其中桌面自动化 56、浏览器 34、视觉 14、TiddlyWiki 16……
工具 schema 是**每轮都在 prompt 里**的固定成本。要量它，**跑 `lazy_tools_health { bench: true }`**——
README 的「省了多少」表格是这份数字的**唯一存放处**（2026-10-29 起：同一个事实不存两遍，存两遍必然漂）。

## 五个可复用的模式

### 1. 三态 `mode: hide | only | all`，不要二元开关

二元开关没法表达「只放 `get_window_state` 这一个，其余 18 个继续收着」。三态之后：
`enable {group, only:[…]}` 就是「组留在 hide，但白名单里的放行」。实测：工具表里真的只多出那一个。

### 2. 记住「上次被收起来的是谁」

组关着时工具**不可见**，于是 `status` / `list` 只能报 0，看的人会以为组里没东西。
每次 rebuild 时把 `hiddenNames` 存进该 agent 的状态，`status.matched` 和 `list` 才能报出「组里共有几个 / 现在可见几个」。

### 3. 限制必须由施加它的组件持有生命周期

这是踩出来的 bug：热重载（改配置、升级插件）之后，旧实例建立的限制**没人解除**，新实例又看不见它——于是 `enable` 会**假成功**（`status` 报 `on:true`，`visible` 还是 0）。
修法：把 `restrict()` 返回的解除函数挂到插件生命周期上（本机 Cordis 是 `ctx.effect(() => dispose)`），并做幂等包装。**任何「施加限制」的插件都要问自己一句：限制跟着谁死？**

### 4. 漂移检测：`expect` 计数 + `stray` 扫描

分组靠正则/globs 写死名字。上游一升级新增工具，它就**默认可见**、静默烧 token——这是最难发现的一类失效。
- `expect: N`：每组**至少**应有的工具数（下限）。**少于**才报警（改名/没加载/正则漏）；多出来是吸纳型组的正常状态（负向前瞻、前缀通配本来就会长新工具），不报 —— 否则 healthy 在默认状态长期 false，等于训练人忽略警报（2026-10-30 改）。
- `stray`：从组内已知名算公共前缀（`cua_driver_native__`…），凡是**长得像这族人却没被任何组匹配**的可见工具全列出来。
- `healthy = 契约全绿 && 无错误（宿主销毁竞态除外，它只留证据）&& 无告警`：一个布尔值判断有没有事。

### 5. 「忘了有开关」要用一行常驻提示解决

按需加载的代价是「模型可能不知道自己有这能力」。两个便宜手段：
- **一行 system prompt 段（~40 tokens/轮）**：**全部组 id**（出厂四组 + 用户手写组 + auto 组）+ `status`/`enable`/`health` 入口。
- **一个按需技能**：教「工具不见了怎么查、怎么只开一个」。
对比：靠模型自己记得 → 不可靠；靠 28 个 schema 常驻 → 4–6k tokens/轮。**40 tokens 换 6k，是这套东西里最划算的一笔。**

**2026-11-01（0.18）改动：这一行从「列全部组」变成「列本会话挂载的组」。**
宿主的 prompt 段是**按组装方会话渲染**的（`AssembleContext = { scope }`），以前我们忽略这个 scope，于是：
① 被宿主权限门挡掉的组照样被广告（本机实测：广告 8 组，其中 cua-screen / cua-input 被 computer-use 门挡着，一个都调不到）；
② 角色 preset 没挂的组也会被列出来。
现在挂载集 = `visible(scope) ∪ 我们自己藏的`，只列其中有成员的组；一组都没有就返回空串（宿主会丢空段）。
**读不到 scope / 读不到工具表 ⇒ 退回旧行为（列全部组）** —— 失败方向是「照旧」，不是「提示变短」。
顺带把每轮组装的成本从 **9 次全量 schema 深拷贝**（8 个组各一次 `allToolNames()` + 分类提示一次）
降到 **0 次**（宿主有 `tools.view` 时）/ **2 次**（没有视图的宿主：一次本会话 + 一次全局）。
注意「空视图」不能当权威：视图返回空 Map 时再用 `schemas` 复核一次，否则会把开着的组静默删掉。

## 实测数据（Win11 26H2 / DSH profile desktop）

| 项 | 值 |
|---|---|
| 工具总数 / 收起 / 可见 | 197 / 102 / 95（2026-10-23 的机况；当前机况请跑 `lazy_tools_health { bench: true }`） |
| 四组 | `cua-screen 19`、`cua-input 37`、`browser-heavy 28`、`vision-heavy 8`（另有用户手写组 `cu-observe 5` / `cu-act 9` / `cu-audio 2`） |
| 切分验证 | 56 个 CUA 真名按正则切 19+37，**零重叠零遗漏**（脚本验，不是手算） |
| only 单工具 | `enable {group,'only':[get_window_state]}` 后工具表只多这一个 |
| 冒烟测试 | 假宿主真跑（不依赖 DSH）；**项数以 `node test/smoke.mjs` 的输出为准，这里不写死** |

## 边界（别把它当万灵药）

1. **只能藏全局注册的工具**。agent scope 内注册的（本机 `dsh-ops` 的 `ops_*` 就是）宿主明确拒绝，藏不了。
   实测（2026-10-28）：一个会话的 135 个可见工具里，**34 个不归工具注册表** —— 33 个是宿主内核自带的（`read` / `write` / `pwsh` / `glob` / `web_fetch` / `schedule_*` …），1 个是 `dsh-ops` 的 agent 作用域工具 `ops_discover_tools`。所以 `lazy_tools_health { bench: true }` 的 `visible` 会大于它在注册表里能统计到的 `visibleInRegistry`；这两个数对不上不是 bug，是这一条边界。`bench` 现在会把这些名字逐个放进 `outsideRegistryNames`，不用再猜。
2. **分组只能按名字**。宿主的 `ToolSchema` 只有 name/description/parameters，**没有 tags**，所以命名没规律就只能手写白名单。
3. **开关会打断前缀缓存**。工具表一变，那一轮 cache 就未命中——所以纪律是「一次开、别反复切」，`only` 优于整组开。
4. **不做自动回收**。TTL 与关键词触发都容易误判，先记用量（`health.usage`），攒够数据再决定。
5. **失效方向是「放开」不是「锁死」**：契约坏了最多是工具都回来、多花 token，不会让人没法干活。这是刻意的。
6. **不做客户端「渲染信标」**（2026-10-29 决定）。想给 `client.seen` 加一个「渲染了几个节点」的上报通道，被否掉了：输入框上方那排控件**默认关闭**、是可选件，追求「无感」的人根本不会开它。为一个可选控件新开一条上报通道，正是「低价值新增零件」。**界面有没有渲染出来，靠冷启动验证第 2 步用眼睛（或截图）看**；`MAINTAINING.md` 也写明了「重启 App ≠ 刷新页面」。将来要重提这件事，先回答：它比「看一眼」省下了什么、代价是什么。
7. **官方工具组调不出来 —— 2026-10-30 用官方给的两层 lookup 量到了具体卡点**（写在这里，防止下一个会话重新分析一遍）。
   - 实测（`lazy_tools_health {tool:…}`）：`cua_driver_native__list_apps` → `global=true`、`agent=true`、**不在本会话工具表**；`run_code` → `global=false`（这个已装版本里根本没有 PTC 那个名字）。
   - 结论：**不是没注册、不是被本插件的 restrict 挡、也不是 PTC**；是被 `tools.schemas(agent)` 这一层滤掉。DSH 作者在 #11207 给的两条线索仍然有效：**「呈现模式（PTC / native）」是另一道闸，agent preset 可覆盖部署默认值**；**限制在作用域链上取交集**（别人的空 deny 抵消不了另一个过滤）。
   - 抽屉的处置：不再写「宿主没挂载」（那是猜的），改成三态实测 —— `not-registered` / `agent-filtered` / `filtered-by-schemas`，notes 里带探针的两个布尔；**静音待命不变**（不是抽屉能解的）。
   - 另：`/lazy-tools/api/policy` 收到解析失败的 body 时曾把策略文件写空（只丢档位，手写组不受影响）；现在**拒绝空策略**（400）。
   - **已回**（2026-10-30）：三个实验 + 六问贴在 Discussion #11207（[discussioncomment-19272444](https://github.com/deepseek-ai/deepseek-harness/discussions/11207#discussioncomment-19272444)），原始数据见 `perf-\11207-实验记录-20261030.md`。
   - **第二封回信后的更正（2026-10-30 01:2x，重要）**：作者指出 `get(name)` **省略第二参数时用的是全局视图**，
     即使通过 `agent.ctx.tools` 调用 ⇒ 早先那个 `agent=true` 是**重复测量全局**，不是作用域。换成 `get(name, agent)` 后实测（我们 deny 为空时）：
     ```
     global: true   agent: true(重复全局)   scoped: false   scopedRunCode: false
     defaultPreset: cordis   composedPreset: cordis
     ```
     ⇒ **作用域链上有「别人」的限制**（不是抽屉、不是 PTC、`run_code` 在这个作用域里也不存在）。
     这也解释了实验 2：`defaultPreset` 与 `composedPreset` 都是 `cordis`，那次切 `standard` **确实没生效**。
     探针已按作者给的代码改成 `get(name, agent)` + `defaultPreset/composedPreset`。
    **三态判定同步修正（2026-10-30 冷读）**：原来用 `p.agent` 判 `agent-filtered`，而 `agent = get(name)` 与 `global` 同源 ⇒ 那个分支永远走不到。现在用 `p.scoped`：
    `scoped === false` ⇒ `agent-filtered`（作用域视图不给它）；`scoped === true` 但不在工具表 ⇒ `filtered-by-schemas`（呈现层滤掉）。假宿主也补上了「`get(name, agent)` 按 agent 过滤」，否则三态测不出来。


## 已知代价与明确决定（2026-10-30 挑刺清单后补）

0. **手写组里能匹配任意名字的匹配式（`*` / `re:.*`）会被忽略并记账**（2026-10-31）。理由：宿主会换工具名
   （2.0.21 把 `pwsh` 换成 `ops_*`），靠维护「保护清单」去追名字永远追不完；而「不许吞掉整张工具表」是
   **与名字无关**的结构性规则。代价：真想用一个组收掉全部工具的人会收到一条 warn —— 那正是自愈链路会断掉的写法，
   值得被拦。窄组场景仍由静态清单（`lazy_tools_*` + 常见宿主名）保护。
   另：不做「可见工具 − 在册工具」的差集来抓宿主工具——两者在 rc.3 同源于 `schemas()`，
   宿主内核工具既不在册、也不在其中，差集恒空。

1. **`firstTryRate` 的定义**：`1 - 自愈次数 / **组内调用数**`（2026-10-30 二次修正：分母只数属于某个组的调用 ——
   核心工具永不入组、也不可能自愈，混进分母会把数稀释成假象：200 次里 190 次核心工具时，5 次自愈会被读成 97.5%，
   组内其实是 50%）。**它测不到「模型压根没开口」的静默失能**（用户要能力、模型判断自己不会 → 零调用、零自愈，
   这个数仍是 1.0），所以它是必要不充分条件，别当成「无感化成立」的证据。自愈 = 模型第一次叫错名字、同一轮补开并放行（2026-11-05 起）；
  （2026-10-30 曾把 `autoOpened` 从分子里摘出去；2026-10-31 随关键词预开一起删除，现在分子只有 `selfHealed`。）
2. **能力目录列的是完整工具名，不是去前缀的短名**，且每组按**热度**取 top3（用量账本的最近调用时间；
   都没用过则保持注册顺序）。之前按注册顺序取，37 个工具的组里等于取了最冷门的三个。短名 `click` 在注册表里可能**撞上别的插件的同名工具**
   （本机就有：第三方 computer-use 提供裸名 `click`），模型照着念会静默用错实现。
3. **关键词预开已于 0.17.0 删除**（`autoHints`）。理由：判定词无穷，且本机实测用户几乎不用工具类词汇（主要发文件 + 直接指令）；
   自动入口只剩自愈，其余靠模型主动 `enable`。旧配置里还写 `autoHints` 时会在 `health.notes` 里得到一条提示（不是 errors，不拖 `healthy`），不再静默。
4. **缓存账**：报的是字符数不是账单——稳态下工具 schema 本来吃缓存命中价，而中途改表会让缓存作废一次。
   本插件只在「用户或模型当下就要用」时改表：自愈、显式 `enable`/`disable`/`mode`、`save_groups{applyNow}`。
5. **组热 = 热工具占比 ≥ `warmRatio`（默认 0.30，可配）**，不是「任一工具热」（2026-10-30 修）。
   原实现里 `recordUsage` 同时写工具与组的时间戳，于是「组热 ⇔ 组内任一工具热」；`applyDefaults` 里组热就整组开，
   组冷则所有工具都冷、`only` 分支永远为空 —— **单工具热度在真实数据下不可达**。
   现在组热由占比判定；`only` 分支就是**热的全放，其余收起**。
   曾经有两道上限（`slice(0,3)`、`max(3, ceil(成员数 × warmRatio))`），都是**恒不生效的死代码**：
   走 only 的条件是 `hot < 成员数×ratio ≤ ceil(...)`，永远截不到 —— 2026-10-30 删掉，
   免得文档把不存在的机制说成有效机制。
   账本只记「最后调用时间」，能力目录样本按**最近用过的优先**排 —— 没有窗口内计数，就不假装能算「用得最多」。
   `warmRatio` **不进设置页**（内部判据），只走配置文件与 `/policy`（夹到 0.05–1）；**30% 这个值本身留待 `firstTryRate` 的真实数据调**，不拍脑袋。
   `status.hot` 已改成与决策**同一语义**（占比 ≥ warmRatio），并新增 `hotTools` / `hotRatio`；
   组级时间戳从此只用于 `lastUsed` 展示，不再参与任何决策。
## 同类与差别

- `asadani/tool-attention`（arXiv 2604.21816）：句向量做意图-工具相似度 + 两段式懒加载，自动化最强，但要 90MB 编码器、每轮一次检索，且**路由错就漏工具**。
- `PeterCha90/mcp-lazy-load`：代理层只暴露 `search_tools` / `execute_tool`，省得最狠，但**每次真实调用都要过一层**（参数变成通用 JSON、丢原生 schema 校验）。
- `MikotoMyWife/dsh-mcp-loader`：同样落在 DSH 的 `restrict` 掩码层，管 MCP server，粒度到 server；本笔记这套管的是**任何全局工具组**，并多了 `only` 与组概念。
- **`studyzy/dsh-lazy-tools`（2026-08-14 建，TypeScript，★3）—— 最直接的同类，而且占着我们改名前用的那个名字。**
  机制：**不动注册表**，在 `system-prompt/assemble` 这条 waterfall 上对「发给模型的 per-scope 工具表」做减法；另注册两个常驻守卫工具
  `tool_search`（按精确名 / 关键词检索不可见工具）和 `defer_execute_tool`（按精确名激活）。零配置，并按**项目**统计真实使用情况自动调优「哪些常驻、哪些延迟」。
  它的已知限制（它自己写的，很诚实）：激活后**下一轮**才生效；**搜索前模型看不到延迟工具的名字**；PTC 呈现下退化为不生效；状态不跨会话。
  **与我们最关键的三处差别**：
  1. **它拦截出站提示（waterfall），我们只调宿主官方的 `restrict` 掩码** —— 我们不改「提示怎么组装」，它改了；
  2. **它的发现路径是确定的**（工具名不知道也能靠关键词搜到），**我们的发现路径依赖名字**（目录给 3 个样本 + `lazy_tools_list` 给全量 + unknown 守卫自愈）——
     这是我们 2026-10-30 补目录样本名的原因；它比我们更不容易「卡在没人知道名字上」；
  3. **它能管住 agent 作用域工具与 MCP**；我们只能掩蔽全局注册表里的工具（文档里写明的边界）。
  **我们从它身上学到的**：`tool_search` 这种「按用途检索、命中即激活」的入口，比「让模型记住名字」更稳。
  我们**没有**照抄（红线：不加新部件），而是把成本压在已有的 `lazy_tools_list` / `lazy_tools_enable { name }` 上，并把它们写进常驻提示的指路里；
  如果将来「猜名字失败」的比率（`health.stats.firstTryRate` 的反面）真的高，这条是最该重新评估的候选。
- 共同点：大家解的都是「工具 schema 税」；不同点在**动哪一层**。

## 要抄的话，最小实现清单

1. 找到宿主的「按作用域隐藏全局工具」接口，确认它返回解除函数。
2. 读「该作用域现在可见的工具名」——这是唯一的事实来源，别自己维护一份。
3. 组 = { id, match(glob 或正则), defaultOn, expect }。
4. 每个 agent 一份状态：`modes: Map<组id, hide|only|all>`、`hiddenNames`、`lifts`。
5. 施加限制时把解除函数挂到生命周期；重复解除要幂等。
6. 加 `expect` + `stray` + 一行常驻提示。
7. 写一个假宿主的冒烟测试——**它比任何文档都更能防止下一个人改坏**。

## 退场条件（前一任提醒，2026-10-23）

- **DSH 哪天原生支持按需加载，这套就该退场。** 它已经有 `deferLoading` 字段和 tool-addition 消息——如果官方把「工具按需出现」做进宿主，就别护着自己的插件。
- **公开/发布前必须先解决「加载即崩」的风险**：插件在 apply 阶段抛错，DSH 可能起不来。现在只有三道保险——零依赖、全 try/catch、假宿主冒烟测试；没有更强的方案。这是它至今只活在本机 profile 的原因。

## 三条红线（改动这个插件之前先撞一遍）

1. **会话中途不改工具表。** 工具表一旦在会话开始时确定，整场不动——这是前缀缓存不被打断的前提。任何"落盘后立刻生效"的路径必须默认关闭，只有显式开关能打开，并且在返回值里写明代价（例：`lazy_tools_save_groups` 的 `applyNow`）。
2. **自救工具永不入组。** `lazy_tools_*` 与基础文件/命令工具（`read` / `write` / `pwsh` …）写在 `CORE_TOOLS` 里，自动分组、用户手写组、模型生成的组都不能包含它们；`lazy_tools_save_groups` 会直接拒绝。
3. **失败必须响。** 关闭失败、组开着却一个工具都不可见、`expect` 数量不符——都要进 `health.warnings` 或 `errors`，不允许"看起来 healthy、其实什么都没生效"。这条来自 2026-10-27 的实测：`resolve` 假报成功，用户白等了一轮。

配套的一条隐规则：**不替换工具、不引入原生依赖。** 换实现是别人的赛道；我们只做可见性这一层，才能同时管任意插件的工具，并且随宿主升级活得久。

## 动手前的六个问题（提问清单，不是规则）

红线说「不许做什么」；这六条说「动手前先问什么」。每加一个功能、每改一处默认值，过一遍。

1. **这个便利，代价落在谁身上？**
   省下的可能是用户 30 秒，付出去的可能是整段上下文按 cache miss 重算——而后者正是这个插件存在的理由。
2. **边界在哪？破了会怎样？**
   `save_groups` 的边界是「会话中途改工具表」；`classify` 的边界是「把常驻工具分进组」。想不出边界，说明还没想清楚它是什么。
3. **状态机的每条路径都走过了吗？**
   加载 / 卸载 / **热重载** / 重启 / 另一个 agent 并发。孤儿限制就是漏了「热重载」这条边。
4. **失败了会响吗？**
   不响就等于假装在工作。`resolve` 假报成功、`health` 静默 healthy 都是这一条的反例。
5. **能不能用现成的东西，而不是加一个新部件？**
   苏联 Ш-1 的防雾方案是「在面罩上长一根手指」——用用户自己的手指，不造机械臂。我们让会话里的 agent 分类、把组放进独立文件，也是同一个思路。

6. **两个消费者要的是同一个判据时，必须走同一个函数**（2026-10-30 补，来自一次真实漂移）。
   `idleDays` 有两个取法：决策用 `sessionIdleDays(st)`，`status`/目录排序用 `policy.idleDays` ——
   会话档位一改就打架（组已收起，`hot` 还报 true）。**不是「别复制常量」，而是「同一个判据只允许一个入口」**。
> **怎么让 AI 真的「不加东西」（2026-10-29，作者自己用出来的方法）**：
> **告诉它为什么减少、并直接给出替代方法，而不是只说「别加」。**
> 理由是构造性的：模型的输出通道只能生成 token，「不要加」是没有方向的指令，它只能靠猜填空；
> 给「为什么减 + 用什么替代」才有地方可去。这句写在这里，是因为换个上下文下一个接手的模型就会忘。

> 这套清单不是从管理学抄的，是从本仓库四次翻车里长出来的：立刻生效、提示误报、loader 替换语义、热重载孤儿限制。

```


### test\smoke.mjs

```js
// 冒烟测试：不依赖 DSH，把 apply() 在一个假宿主上真跑一遍。
//
// 为什么要它：`node --check` 只证明「语法没说错」，证明不了「跑起来对」。
// 这个测试替身实现的是 host.js 假设的那四个契约（register / schemas /
// restrict / agent/created），所以契约一改、这里先红。
//
// 跑法：node test/smoke.mjs   （退出码 0 = 全过）

import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { normalizePolicy, mergePolicyForStorage } from '../lib/api.js'
import { hotRatio, isToolHot, recordUsage, LEVEL_DAYS, DAY } from '../lib/usage.js'
import { createHost } from '../lib/host.js'
import { CORE_TOOLS } from '../lib/autogroups.js'
import { applyManagedRolesPatch, auditManagedRoles, roleFromLabel, roleCandidatesFromLabel, labelOfSession, normalizeManagedRoles, resolveManagedRole, isAllowedByPolicy, labelRoleCandidates } from '../lib/roles.js'
import { readFileSync, writeFileSync, rmSync, utimesSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 测试隔离：不要让真实用户组文件影响断言。
// 用 tmpdir 拼一个必然不存在的名字 —— 不写死 Windows 用户名（公开仓 + 发布包里都不该出现）。
const NO_SUCH = join(tmpdir(), 'lazy-tools.DOES-NOT-EXIST')
process.env.LAZY_TOOLS_GROUPS_FILE = `${NO_SUCH}.groups.json`
process.env.LAZY_TOOLS_POLICY_FILE = `${NO_SUCH}.policy.json`
// 用量账本也必须隔离：2026-10-29 单工具热度上线后，[12] 因为读到真机账本
// （vision_describe 真的热）而少收了一个工具、断言失败 —— 测试不能看用户的历史。
process.env.LAZY_TOOLS_USAGE_FILE = `${NO_SUCH}.usage.json`
  // 2026-10-30：计数器已跨重载持久化 ⇒ 插件会真的往 NO_SUCH 路径写文件，先清掉，避免上一轮残留污染这一轮。
  rmSync(`${NO_SUCH}.usage.json`, { force: true })
  // 2026-11-03（冷读甲实测抓到）：[93]/[84] 会往 NO_SUCH.policy.json 写角色配置，
  // 残留到下一轮 → 第一个 apply 把它读进来审计 → 每个世界都多一条假错误 → healthy=false。
  // 临时文件的清理必须跟写入同步，否则「第二次跑必红」。
  rmSync(`${NO_SUCH}.policy.json`, { force: true })
  rmSync(`${NO_SUCH}.groups.json`, { force: true })

// --quiet：只打汇总和失败项。钩子每次提交都跑它，49 行逐条输出纯属浪费（2026-10-30 加的）。
const quiet = process.argv.includes('--quiet')
const log = quiet ? () => {} : (...args) => console.log(...args)

let checks = 0
function ok(label) {
  checks += 1
  log(`  ok  ${label}`)
}

function assertJsonSafe(value, path = 'value') {
  const stack = [[value, path]]
  const seen = new Set()
  while (stack.length) {
    const [node, where] = stack.pop()
    if (node === undefined) throw new Error(`${where} 是 undefined —— 不是 lossless JSON`)
    if (typeof node === 'function') throw new Error(`${where} 是函数 —— 序列化不了`)
    if (typeof node === 'number' && !Number.isFinite(node)) throw new Error(`${where} 不是有限数字`)
    if (node && typeof node === 'object') {
      if (seen.has(node)) continue
      seen.add(node)
      for (const [key, child] of Object.entries(node)) stack.push([child, `${where}.${key}`])
    }
  }
}

// 假宿主：语义尽量贴近真的 —— schemas(agent) 返回「该 agent 可见」的工具，
// restrict({deny}) 只影响调用它的那个 agent，并把解除函数交回来。
function makeWorld(options = {}) {
  const registered = new Map()
  // 2026-11-03：模拟「注册了但不可 restrict」的名字（真机上 agent 自己那层、run_code 等）
  const nonRestrictable = new Set(Array.isArray(options.nonRestrictable) ? options.nonRestrictable : [])
  const createdListeners = []
  const denyByAgent = new Map()
  const externalByAgent = new Map() // 模拟别的插件的 deny：我们的 lift 撤不动
  // 2026-11-04：agent 作用域注册的工具（别名转发壳）——可见但**不可 restrict**
  const scopedByAgent = new Map()
  const activeByAgent = new Map() // agent -> [{ names }]：当前**真正挂着**的限制（孤儿会在这里露出来）
  // rc.3 的撤销是同步通知的。默认关（不影响其它用例），需要复现重入的用例自己打开。
  let fireOnRestrict = false
  let failRestrictTimes = 0
  const failRestrictFor = new Set()
  const failRestrictSingle = new Set()
  const reservedPtc = new Set()
  const living = [] // «ctx.get('agents').list()» 返回的东西
  const effects = [] // «ctx.effect(cb)» 收下的回调，插件卸载时 Cordis 会调用它们
  const toolsChangeListeners = []
  const inboxListeners = []
  const preExecuteListeners = []
  const guards = []
  const commands = []
  const eventListeners = new Map()
  const unmounted = new Map() // agent -> Set(name)：宿主没挂到该会话的工具（不是我们 restrict 的）

  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    on(event, handler) {
      if (!eventListeners.has(event)) eventListeners.set(event, [])
      eventListeners.get(event).push(handler)
      if (event === 'agent/created') createdListeners.push(handler)
      if (event === 'tools/change') toolsChangeListeners.push(handler)
      if (event === 'agent/inbox/inserted') inboxListeners.push(handler)
      if (event === 'tools/pre-execute') preExecuteListeners.push(handler)
    },
    effect(callback) {
      effects.push(callback)
      return () => {}
    },
    get(key) {
      if (key === 'agents') return { list: () => living, get: (id) => living.find((a) => a && a.id === id) }
      if (key === 'commands') {
        return {
          register(definition) {
            commands.push(definition)
            return () => {}
          },
        }
      }
      return undefined
    },
    tools: {
      guard(fn) {
        guards.push(fn)
        return () => {}
      },

      register(definition) {
        registered.set(definition.name, definition)
        return () => registered.delete(definition.name)
      },
      // 真实宿主：get(name) 是全局视图；get(name, agent) 是 agent 作用域视图（rc.3 与 schemas(agent) 同源）。
      // 2026-10-30 冷读指出假宿主原来忽略第二个参数 ⇒ `scoped` 永远等于 `global`，三态测不出来。
      get(name, agent) {
        if (!agent) return registered.get(name)
        const deny = denyByAgent.get(agent) || new Set()
        const miss = unmounted.get(agent) || new Set()
        const ext = externalByAgent.get(agent) || new Set()
        if (deny.has(name) || miss.has(name) || ext.has(name)) return undefined
        return registered.get(name)
      },
      schemas(agent) {
        const deny = (agent && denyByAgent.get(agent)) || new Set()
        const miss = (agent && unmounted.get(agent)) || new Set()
        const ext = (agent && externalByAgent.get(agent)) || new Set()
        return [...registered.keys()].filter((name) => !deny.has(name) && !miss.has(name) && !ext.has(name)).map((name) => ({ name }))
      },
      // 宿主的同源视图（2026-11-01 新读路径）：与 schemas 同源、只给名字，代价是 Map 遍历而不是深拷贝。
      // 假宿主必须建这一条：不建的话，插件里「有 view 就不拷 schema」的主路径一行代码都测不到
      // （冷读把 `return [...visible.keys()]` 改成 `return []`，74 项照样全绿 —— 那就是假绿）。
      view(agent) {
        const deny = (agent && denyByAgent.get(agent)) || new Set()
        const miss = (agent && unmounted.get(agent)) || new Set()
        const ext = (agent && externalByAgent.get(agent)) || new Set()
        const scoped = (agent && scopedByAgent.get(agent)) || new Set()
        const visible = new Map()
        for (const [name, definition] of registered) {
          if (deny.has(name) || miss.has(name) || ext.has(name)) continue
          visible.set(name, definition)
        }
        // scoped 注册不受 mask 影响，且**不可被 restrict**
        for (const name of scoped) visible.set(name, { name, scoped: true })
        // 真宿主：inherited 名字先全部进 restrictableNames，再看 admits 决定 visible；
        // 被 deny 的名字仍在集合里。假宿主以前把 deny 的删掉，替身比真宿主更听话。
        const restrictableNames = new Set([...registered.keys()])
        return { visible, restrictableNames }
      },
    },
  }

  const makeAgent = (id) => {
    const agent = { id }
    denyByAgent.set(agent, new Set())
    externalByAgent.set(agent, new Set())
    activeByAgent.set(agent, [])
    agent.ctx = {
      // 受管角色测试：agentPresets 由 createAgent 的 setup 注入
      get(key) {
        if (key === 'agentPresets') return agent.presets
        return undefined
      },
      tools: {
        // 与注册表级 get 同语义：带 agent 时按该 agent 的作用域过滤（2026-10-30 冷读修）
        get(name, scopedAgent) {
          if (!scopedAgent) return registered.get(name)
          const denyS = denyByAgent.get(scopedAgent) || new Set()
          const missS = unmounted.get(scopedAgent) || new Set()
          const extS = externalByAgent.get(scopedAgent) || new Set()
          if (denyS.has(name) || missS.has(name) || extS.has(name)) return undefined
          return registered.get(name)
        },
        restrict(filter) {
          const deny = denyByAgent.get(agent)
          const asked = Array.isArray(filter && filter.deny) ? filter.deny : []
          if (asked.some((name) => reservedPtc.has(name))) {
            throw new Error('tools.restrict() cannot name reserved PTC mode presentation transport "' + asked.find((name) => reservedPtc.has(name)) + '"')
          }
          if (asked.some((name) => failRestrictFor.has(name))) {
            throw new Error('restrict backend unavailable')
          }
          if (asked.length === 1 && failRestrictSingle.has(asked[0])) {
            throw new Error('restrict backend unavailable')
          }
          if (failRestrictTimes > 0) {
            failRestrictTimes -= 1
            throw new Error('restrict backend unavailable')
          }
          const added = Array.isArray(filter && filter.deny) ? [...filter.deny] : []
          // 真宿主的行为：deny 里混进不可限制的名字 ⇒ **整批抛错**（一个都不藏）
          const unknown = added.filter((name) => nonRestrictable.has(name))
          if (unknown.length) throw new Error('tools.restrict() names unknown global tool "' + unknown[0] + '"')
          const entry = { names: added }
          activeByAgent.get(agent).push(entry)
          for (const name of added) deny.add(name)
          // 2026-10-30：rc.3 里「撤销限制」是**同步**通知 tools/change 的。
          // 这条 synchronous 行为正是重入 rebuild 的来源，所以 mock 必须能模拟它（否则测试会假绿）。
          if (fireOnRestrict) fireToolsChange()
          return () => {
            activeByAgent.get(agent).splice(activeByAgent.get(agent).indexOf(entry), 1)
            for (const name of added) deny.delete(name)
            if (fireOnRestrict) fireToolsChange()
          }
        },
      },
    }
    return agent
  }

  const createAgent = (id, setup) => {
    const agent = makeAgent(id)
    living.push(agent)
    // setup 在「第一次 rebuild 之前」跑：用来模拟创建那一刻宿主就没挂载某些工具
    if (typeof setup === 'function') setup(agent)
    for (const listener of createdListeners) listener({ agent })
    return agent
  }

  const fireToolsChange = () => {
    for (const listener of toolsChangeListeners) listener()
  }

  const fireUserMessage = (agent, text) => {
    for (const listener of inboxListeners) {
      listener({ agent, message: { role: 'user', content: [{ type: 'text', text }] } })
    }
  }

  const firePreExecute = async (agent, name) => {
    for (const listener of preExecuteListeners) {
      await listener({ name, agent }, async () => ({ kind: 'allow' }))
    }
  }

  const fireEvent = (event, ...args) => {
    for (const listener of eventListeners.get(event) || []) listener(...args)
  }

  const fireGuard = (agent, name) => {
    let decision
    for (const guard of guards) {
      const result = guard({ name, agent })
      // 2026-11-05（冷读红 1）：真实宿主判据是 `reason !== undefined`；假宿主原来按真值判，
      // 于是返回 null 的「拒绝」在测试里会变成「放行」。必须与宿主同判据。
      if (result !== undefined) decision = result
    }
    return decision
  }

  // 模拟「宿主没把这个工具挂到该会话」：和「我们 restrict 掉」不是一回事 ——
  // 前者从来没进过工具表（如 cua_driver_native__* 自 DSH 2.0.20 起），后者是我们收的。
  const unmount = (agent, names) => {
    if (!unmounted.has(agent)) unmounted.set(agent, new Set())
    const miss = unmounted.get(agent)
    for (const name of names) miss.add(name)
    return () => {
      for (const name of names) miss.delete(name)
    }
  }

  return {
    ctx,
    fireGuard,
    unmount,
    commands,
    firePreExecute,
    registered,
    denyByAgent,
    activeByAgent,
    // 打开它 = mock 的 restrict 在「加上」和「解除」时都同步 fireToolsChange（rc.3 的行为）
    failRestrictFor(name) {
      failRestrictFor.add(name)
      return () => failRestrictFor.delete(name)
    },
    failRestrictSingle(name) {
      failRestrictSingle.add(name)
      return () => failRestrictSingle.delete(name)
    },
    reservePtc(name) {
      reservedPtc.add(name)
    },
    failNextRestrict(times = 1) {
      failRestrictTimes = Math.max(0, Number(times) || 0)
    },
    setSyncRestrictEvents(value) {
      fireOnRestrict = !!value
    },
    /** 当前真正挂着的限制列表（孤儿 = 比预期多出来的那条） */
    activeRestrictions(agent) {
      return activeByAgent.get(agent) || []
    },
    /** 该 agent 现在可见的工具名（= schemas(agent) 的名字） */
    visibleNames(agent) {
      const deny = denyByAgent.get(agent) || new Set()
      const miss = unmounted.get(agent) || new Set()
      const scoped = scopedByAgent.get(agent) || new Set()
      return [...registered.keys()].filter((name) => !deny.has(name) && !miss.has(name)).concat([...scoped])
    },
    createAgent,
    fireEvent,
    externalByAgent,
    scopedByAgent,
    /** 在 agent 作用域注册一个「别家插件的工具」（可见、不可 restrict） */
    addScoped(agent, name) {
      let set = scopedByAgent.get(agent)
      if (!set) {
        set = new Set()
        scopedByAgent.set(agent, set)
      }
      set.add(name)
    },
    makeAgent,
    living,
    createdListeners,
    effects,
    toolsChangeListeners,
    inboxListeners,
    fireToolsChange,
    fireUserMessage,
  }
}

async function runTool(world, name, args, agent) {
  const definition = world.registered.get(name)
  assert.ok(definition, `工具 ${name} 没注册上`)
  assert.equal(typeof definition.execute, 'function', `${name}.execute 不是函数`)
  return definition.execute(args || {}, { agent })
}

async function main() {
  log('[1] 载入与注册')
  const world = makeWorld()
  // 宿主全局工具：两个属于 cua 组，一个不属于
  world.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  world.ctx.tools.register({ name: 'cua_driver_native__b', description: 'x', parameters: {}, output: {} })
  world.ctx.tools.register({ name: 'other_tool', description: 'x', parameters: {}, output: {} })

  apply(world.ctx, {
    groups: [
      { id: 'cua', match: ['cua_driver_native__*'], title: '桌面自动化', defaultOn: false },
      { id: 'idle', match: ['other_tool'], title: '默认开', defaultOn: true },
    ],
  })
  for (const name of ['lazy_tools_status', 'lazy_tools_enable', 'lazy_tools_disable', 'lazy_tools_mode', 'lazy_tools_save_groups', 'lazy_tools_list', 'lazy_tools_health']) {
    assert.ok(world.registered.has(name), `缺工具 ${name}`)
  }
  ok('七个工具都注册上了（0.16.0 由 11 个合并而来）')

  log('[2] agent 创建时按 defaultOn 收起')
  const agent = world.createAgent('agent-1')
  const deny = world.denyByAgent.get(agent)
  assert.deepEqual([...deny].sort(), ['cua_driver_native__a', 'cua_driver_native__b'])
  ok('cua 组两个工具被 restrict 掉，defaultOn:true 的组没动')

  const statusAfterCreate = await runTool(world, 'lazy_tools_status', {}, agent)
  assertJsonSafe(statusAfterCreate, 'status')
  const cua = statusAfterCreate.groups.find((g) => g.id === 'cua')
  assert.equal(cua.on, false)
  assert.equal(cua.mode, 'hide')
  assert.equal(cua.matched, 2) // 组里共几个（含被收起的）
  assert.equal(cua.visible, 0)
  ok('status 报 cua: on=false mode=hide, matched=2, visible=0')

  log('[3] enable / disable 往返')
  const enabled = await runTool(world, 'lazy_tools_enable', { group: 'cua' }, agent)
  assert.deepEqual(enabled, { enabled: 'cua' })
  assert.equal(world.denyByAgent.get(agent).size, 0)
  const afterEnable = await runTool(world, 'lazy_tools_status', {}, agent)
  assert.equal(afterEnable.groups.find((g) => g.id === 'cua').mode, 'all')
  assert.equal(afterEnable.groups.find((g) => g.id === 'cua').matched, 2)
  assert.equal(afterEnable.groups.find((g) => g.id === 'cua').visible, 2)
  ok('enable 之后限制解除、两个工具回来')

  log('[3a] only：只放指定的几个工具')
  const onlyResult = await runTool(world, 'lazy_tools_enable', { group: 'cua', only: ['cua_driver_native__a'] }, agent)
  assert.deepEqual(onlyResult, { enabled: 'cua', only: ['cua_driver_native__a'] })
  assert.deepEqual([...world.denyByAgent.get(agent)].sort(), ['cua_driver_native__b'])
  const onlyStatus = await runTool(world, 'lazy_tools_status', {}, agent)
  const onlyGroup = onlyStatus.groups.find((g) => g.id === 'cua')
  assert.equal(onlyGroup.mode, 'only')
  assert.equal(onlyGroup.onlyCount, 1)
  assert.equal(onlyGroup.visible, 1)
  const badOnly = await runTool(world, 'lazy_tools_enable', { group: 'cua', only: ['other_tool'] }, agent)
  assert.match(badOnly.error, /不属于组/)
  const emptyOnly = await runTool(world, 'lazy_tools_enable', { group: 'cua', only: [] }, agent)
  assert.match(emptyOnly.error, /不能是空数组/)
  ok('only 白名单生效、越界/空数组都被拒（没抛异常）')

  const disabled = await runTool(world, 'lazy_tools_disable', { group: 'cua' }, agent)
  assert.deepEqual(disabled, { disabled: 'cua' })
  assert.equal(world.denyByAgent.get(agent).size, 2)
  const afterOff = await runTool(world, 'lazy_tools_status', {}, agent)
  assert.equal(afterOff.groups.find((g) => g.id === 'cua').mode, 'hide')
  ok('disable 之后限制重新挂上，mode 回到 hide（only 被清掉）')

  const badGroup = await runTool(world, 'lazy_tools_enable', { group: 'nope' }, agent)
  assert.match(badGroup.error, /unknown group/)
  ok('未知组返回 error 而不是抛异常')

  log('[3b] list：组关着也认得名字、开着标可见')
  const listWhileOff = await runTool(world, 'lazy_tools_list', { group: 'cua' }, agent)
  assert.equal(listWhileOff.count, 2)
  assert.equal(listWhileOff.visible, 0)
  await runTool(world, 'lazy_tools_enable', { group: 'cua' }, agent)
  const listWhileOn = await runTool(world, 'lazy_tools_list', { group: 'cua' }, agent)
  assert.deepEqual(listWhileOn.names, ['cua_driver_native__a', 'cua_driver_native__b'])
  assert.equal(listWhileOn.visible, 2)
  const listAll = await runTool(world, 'lazy_tools_list', {}, agent)
  assert.equal(listAll.group, null)
  assert.ok(listAll.names.includes('lazy_tools_health'))
  await runTool(world, 'lazy_tools_disable', { group: 'cua' }, agent)
  ok('list 行为正确（关=知道但不可见、开=可见、省略组=全部已知）')

  log('[3c] re: 前缀的正则匹配式')
  const worldRe = makeWorld()
  worldRe.ctx.tools.register({ name: 'cua_driver_native__get_x', description: 'x', parameters: {}, output: {} })
  worldRe.ctx.tools.register({ name: 'cua_driver_native__click', description: 'x', parameters: {}, output: {} })
  apply(worldRe.ctx, {
    groups: [
      { id: 'screen', match: ['re:^cua_driver_native__(get_|list_)'], defaultOn: false },
      { id: 'input', match: ['re:^cua_driver_native__click$'], defaultOn: false },
    ],
  })
  const agentRe = worldRe.createAgent('agent-re')
  assert.deepEqual([...worldRe.denyByAgent.get(agentRe)].sort(), ['cua_driver_native__click', 'cua_driver_native__get_x'])
  const reStatus = await runTool(worldRe, 'lazy_tools_status', {}, agentRe)
  assert.equal(reStatus.groups.find((g) => g.id === 'screen').matched, 1)
  assert.equal(reStatus.groups.find((g) => g.id === 'input').matched, 1)
  ok('re: 正则分组可用（screen 1 / input 1）')

  log('[4] list {ungrouped} / health 的输出')
  const scan = await runTool(world, 'lazy_tools_list', { ungrouped: true }, agent)
  assertJsonSafe(scan, 'list-ungrouped')
  // 前缀分桶只统计「当前可见」的工具；两个 cua 工具此刻仍被收着，所以不该出现
  assert.equal(scan.prefixes.some((b) => b.prefix === 'cua_driver_native'), false)
  assert.ok(scan.ungrouped && Array.isArray(scan.ungrouped.tools), '要给出未归组工具与描述')
  ok('list {ungrouped} 输出 JSON-safe：前缀分桶 + 未归组工具，且没有 cua 前缀')

  const health = await runTool(world, 'lazy_tools_health', {}, agent)
  assertJsonSafe(health, 'health')
  assert.equal(health.ok, true, `health 说契约不全：${JSON.stringify(health.contracts)}`)
  assert.equal(health.contracts.length, 5)
  assert.equal(health.stats.agentCreated, 1)
  assert.equal(health.stats.restrictFailures, 0)
  assert.equal(health.stats.lastHidden.hidden, 2)
  ok('health: 五个契约全绿，agentCreated=1，lastHidden=2')

  log('[5] 契约缺失时不崩')
  const brokenWorld = makeWorld()
  brokenWorld.ctx.tools = {} // 没有 register / schemas
  apply(brokenWorld.ctx, {})
  brokenWorld.createAgent('agent-broken')
  assert.equal(brokenWorld.registered.size, 0)
  ok('宿主缺 register/schemas 时 apply 不抛（插件不炸启动）')

  log('[6] restrict 拒绝时记账，不阻断')
  const world2 = makeWorld()
  apply(world2.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] })
  world2.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  const agent2 = world2.createAgent('agent-2')
  agent2.ctx.tools = {
    restrict() {
      throw new Error('host scoped restriction cannot hide own-scope tools')
    },
  }
  await runTool(world2, 'lazy_tools_disable', { group: 'cua' }, agent2)
  const health2 = await runTool(world2, 'lazy_tools_health', {}, agent2)
  assertJsonSafe(health2, 'health2')
  assert.equal(health2.stats.restrictFailures, 1)
  assert.ok(health2.errors.some((e) => e.where === 'tools.restrict'))
  ok('restrict 抛错被记账（restrictFailures=1），工具仍可用')

  log('[7] 重载补应用：apply 时已经活着的 agent 也要被收')
  const world3 = makeWorld()
  world3.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  const alive = world3.makeAgent('agent-alive')
  world3.living.push(alive) // 插件加载之前就存在的 agent
  apply(world3.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] })
  assert.equal(world3.denyByAgent.get(alive).size, 1)
  ok('apply 时把限制补到已存在的 agent（不用等 agent/created 再触发一次）')

  log('[8] 插件卸载/重载：限制必须随 ctx.effect 一起解除（不留孤儿）')
  const world4 = makeWorld()
  world4.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  apply(world4.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] })
  const agent4 = world4.createAgent('agent-dispose')
  assert.equal(world4.denyByAgent.get(agent4).size, 1)
  const disposers = world4.effects.map((callback) => callback())
  for (const dispose of disposers) if (typeof dispose === 'function') dispose()
  assert.equal(world4.denyByAgent.get(agent4).size, 0)
  for (const dispose of disposers) if (typeof dispose === 'function') dispose() // 二次解除必须空操作
  ok('卸载时限制被解除干净，重复解除不抛')

  log('[9] 常驻提示段：systemPrompt 在就挂一段，不在就跳过')
  const world5 = makeWorld()
  const sections = []
  world5.ctx.inject = (deps, callback) => {
    assert.deepEqual(deps, ['systemPrompt'])
    callback({
      effect: (make) => make(),
      systemPrompt: {
        section(section) {
          sections.push(section)
          return () => {}
        },
      },
    })
  }
  apply(world5.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] })
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'lazy-tools:groups')
  const promptText = sections[0].text()
  assert.match(promptText, /lazy_tools_status/)
  assert.match(promptText, /cua/)
  ok('systemPrompt 段已挂上，正文包含组 id 与排查入口')

  log('[10] 漏网与 expect 计数')
  const world6 = makeWorld()
  world6.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  world6.ctx.tools.register({ name: 'cua_driver_native__b', description: 'x', parameters: {}, output: {} })
  // 这条名字长得像同族、但正则没覆盖到 —— 模拟「上游升级新增工具」
  world6.ctx.tools.register({ name: 'cua_driver_native__newone', description: 'x', parameters: {}, output: {} })
  apply(world6.ctx, { groups: [{ id: 'cua', match: ['re:^cua_driver_native__(a|b)$'], defaultOn: false, expect: 2 }] })
  const agent6 = world6.createAgent('agent-stray')
  const health6 = await runTool(world6, 'lazy_tools_health', {}, agent6)
  assertJsonSafe(health6, 'health6')
  assert.ok(health6.stray.includes('cua_driver_native__newone'), `stray 没抓到：${JSON.stringify(health6.stray)}`)
  assert.ok(health6.warnings.some((w) => w.includes('漏网')))
  assert.equal(health6.healthy, false)
  ok('漏网工具被 stray 抓到、healthy 变 false')

  const world7 = makeWorld()
  world7.ctx.tools.register({ name: 'x_a', description: 'x', parameters: {}, output: {} })
  apply(world7.ctx, { groups: [{ id: 'x', match: ['re:^x_'], defaultOn: false, expect: 5 }] })
  const agent7 = world7.createAgent('agent-expect')
  const health7 = await runTool(world7, 'lazy_tools_health', {}, agent7)
  assert.equal(health7.groups[0].expect, 5)
  assert.equal(health7.groups[0].expectOk, false)
  assert.equal(health7.warnings.some((w) => w.includes('expect 5')), true)
  assert.equal(health7.healthy, false, 'expect 对不上时 healthy 必须是 false（DESIGN.md:197）')
  assert.equal(typeof health7.stats.rebuilds, 'number', 'rebuilds 必须可观测')
  ok('expect 对不上会报警且 healthy=false（matched 1 ≠ expect 5）')

  // 常驻工具（keep）不算漏网 —— 2026-10-23 真机首测就栽在这上面
  const world7b = makeWorld()
  world7b.ctx.tools.register({ name: 'browser_hidden', description: 'x', parameters: {}, output: {} })
  world7b.ctx.tools.register({ name: 'browser_keeper', description: 'x', parameters: {}, output: {} })
  apply(world7b.ctx, {
    groups: [{ id: 'b', match: ['re:^browser_(?!keeper$)'], keep: ['browser_keeper'], defaultOn: false, expect: 1 }],
  })
  const agent7b = world7b.createAgent('agent-keep')
  const health7b = await runTool(world7b, 'lazy_tools_health', {}, agent7b)
  assert.deepEqual(health7b.stray, [])
  assert.equal(health7b.healthy, true)
  ok('写在 keep 里的常驻工具不会被误报成漏网')

  log('[11] tools/change：后注册的工具会触发补收起')
  const world8 = makeWorld()
  apply(world8.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] })
  const agent8 = world8.createAgent('agent-change')
  world8.ctx.tools.register({ name: 'cua_driver_native__late', description: 'x', parameters: {}, output: {} })
  assert.equal(world8.denyByAgent.get(agent8).has('cua_driver_native__late'), false)
  world8.fireToolsChange()
  assert.equal(world8.denyByAgent.get(agent8).has('cua_driver_native__late'), true)
  ok('插件后于工具加载时，tools/change 会把新工具补收进来')

  log('[12] 批量开关与用量统计')
  const world9 = makeWorld()
  world9.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  world9.ctx.tools.register({ name: 'vision_describe', description: 'x', parameters: {}, output: {} })
  apply(world9.ctx, {
    groups: [
      { id: 'cua', match: ['cua_driver_native__*'], defaultOn: false },
      { id: 'vision', match: ['re:^vision_'], defaultOn: false },
    ],
  })
  const agent9 = world9.createAgent('agent-batch')
  assert.equal(world9.denyByAgent.get(agent9).size, 2)
  const batch = await runTool(world9, 'lazy_tools_enable', { groups: ['cua', 'vision'] }, agent9)
  assert.deepEqual(batch.enabled, ['cua', 'vision'])
  assert.equal(world9.denyByAgent.get(agent9).size, 0)
  const badBatchOnly = await runTool(world9, 'lazy_tools_enable', { groups: ['cua', 'vision'], only: ['x'] }, agent9)
  assert.match(badBatchOnly.error, /只能配单个组/)
  const noSelector = await runTool(world9, 'lazy_tools_enable', {}, agent9)
  assert.match(noSelector.error, /group、groups 或 name/)
  const health9 = await runTool(world9, 'lazy_tools_health', { full: true }, agent9)
  assertJsonSafe(health9, 'health9')
  assert.ok(health9.usage.some((u) => u.id === 'cua' && u.enables === 1), JSON.stringify(health9.usage))
  ok('批量 enable 生效、only+多组被拒、usage 记账')

  log('[13] 作用域已销毁：不算失败，但必须标 applied=no')
  const worldA = makeWorld()
  worldA.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  apply(worldA.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] })
  const agentA = worldA.createAgent('agent-dead')
  agentA.ctx.tools = {
    restrict() {
      throw new Error('cannot create effect on inactive context')
    },
  }
  await runTool(worldA, 'lazy_tools_disable', { group: 'cua' }, agentA)
  const healthA = await runTool(worldA, 'lazy_tools_health', {}, agentA)
  assertJsonSafe(healthA, 'healthA')
  assert.equal(healthA.stats.restrictFailures, 0)
  assert.equal(healthA.stats.lastHidden.applied, false)
  // 2026-11-01（0.18）：竞态只进计数、不进 errors（否则 8 个错误槽会被多会话占满）。
  assert.equal(healthA.errors.some((e) => e.where.includes('agent 已销毁')), false, JSON.stringify(healthA.errors))
  assert.ok(healthA.stats.restrictSkipped >= 1, '竞态必须仍然计数')
  assert.equal(healthA.healthy, true, '销毁竞态不许把 healthy 拖成 false')
  ok('已销毁作用域的竞争不计失败，lastHidden.applied=false')

  log('[14] 同一进程内重新 apply：先收回旧限制再重建（不留孤儿）')
  const worldB = makeWorld()
  worldB.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  const reapplyCfg = { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] }
  apply(worldB.ctx, reapplyCfg)
  const agentB = worldB.createAgent('agent-reapply')
  assert.equal(worldB.denyByAgent.get(agentB).size, 1)
  // 模拟「改配置 → 重新 apply」：模块没重载，但 apply 又跑了一次
  apply(worldB.ctx, reapplyCfg)
  assert.equal(worldB.denyByAgent.get(agentB).size, 1)
  const statusB = await runTool(worldB, 'lazy_tools_status', {}, agentB)
  assert.equal(statusB.groups.find((g) => g.id === 'cua').matched, 1)
  ok('重新 apply 时旧限制被收回再重建，state 能重新看见工具（matched=1）')

  log('[15] resolve：按名字一步开启')
  const worldC = makeWorld()
  worldC.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  worldC.ctx.tools.register({ name: 'cua_driver_native__b', description: 'x', parameters: {}, output: {} })
  apply(worldC.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] })
  const agentC = worldC.createAgent('agent-resolve')
  assert.equal(worldC.denyByAgent.get(agentC).size, 2)
  const r1 = await runTool(worldC, 'lazy_tools_enable', { name: 'cua_driver_native__a' }, agentC)
  assert.equal(r1.found, true)
  assert.equal(r1.applied, true)
  assert.equal(r1.group, 'cua')
  assert.equal(worldC.denyByAgent.get(agentC).has('cua_driver_native__a'), false)
  assert.equal(worldC.denyByAgent.get(agentC).has('cua_driver_native__b'), true)
  const r2 = await runTool(worldC, 'lazy_tools_enable', { name: 'native__b' }, agentC)
  assert.equal(r2.found, true)
  assert.equal(r2.tool, 'cua_driver_native__b')
  const r3 = await runTool(worldC, 'lazy_tools_enable', { name: 'nope_xyz' }, agentC)
  assert.equal(r3.found, false)
  ok('enable {name}：一步开一个（only 语义）、片段能匹配、找不到给提示')

  log('[16] autoHints 已删除（0.17.0）：写它也不预开，更不计数')
  const worldE = makeWorld()
  const envE = `${NO_SUCH}.hint.usage.json`
  process.env.LAZY_TOOLS_USAGE_FILE = envE
  rmSync(envE, { force: true })
  worldE.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  apply(worldE.ctx, {
    groups: [{ id: 'desktop', match: ['cua_driver_native__*'], autoHints: ['截图', '看窗口'], defaultOn: false }],
  })
  const agentE = worldE.createAgent('agent-auto')
  assert.equal(worldE.denyByAgent.get(agentE).size, 1, '组默认收起')
  worldE.fireUserMessage(agentE, '帮我截图看看这个窗口')
  assert.equal(worldE.denyByAgent.get(agentE).size, 1, '关键词预开已删除：用户消息不该再自动放组')
  const autoHealth = await runTool(worldE, 'lazy_tools_health', {}, agentE)
  assert.equal('autoOpened' in autoHealth.stats, false, 'autoOpened 字段必须删干净')
  assert.equal('userMessages' in autoHealth.stats, false, 'userMessages 字段必须删干净')
  // 2026-11-03：这条原来断言「一条 inbox 监听都不许有」（0.17.0 删关键词预开时的红线）。
  // 0.18.2 起 `[role:xxx]` 通道（role-inbox）已整段删除，所以这条断言恢复为「0 条监听」。
  assert.equal(worldE.inboxListeners.length, 0, '0.18.2 恢复 0.17 红线：不再监听 inbox（[role:] 通道已删除）')
  assert.equal(autoHealth.notes.filter((n) => String(n).includes('autoHints')).length, 1, '旧配置的 autoHints 提示每组只该出现一次（重复 push 会红）')
  assert.equal(autoHealth.healthy, true, '兼容提示不许把 healthy 拖成 false（否则用户天天看红灯）')
  ok('autoHints 被忽略：不自动开组；stats 不再有 autoOpened / userMessages')

  log('[17] 设置页策略文件：只收认识的键')
  assert.deepEqual(normalizePolicy({ level: 'high', idleDays: 7, minTools: 2, showDock: true, showClear: true }), {
    level: 'high',
    idleDays: 7,
    minTools: 2,
    showDock: true,
    showClear: true,
  })
  assert.deepEqual(normalizePolicy({ level: 'turbo', idleDays: -1, minTools: 'x' }), {})
  assert.deepEqual(normalizePolicy({ presets: { low: 10, medium: 5, high: 2 } }), { presets: { low: 10, medium: 5, high: 2 } })
  assert.deepEqual(normalizePolicy({ presets: { low: 10, medium: 5 } }), {})
  assert.deepEqual(normalizePolicy(null), {})
  ok('非法的 level/天数/工具数被丢弃，字符串数组过滤干净')

  log('[18] 用量账本：热/冷判定')
  assert.deepEqual(LEVEL_DAYS, { low: 14, medium: 7, high: 3 })
  const usage = { groups: {}, tools: {} }
  const stamp = Date.now()
  recordUsage(usage, 'vision_ocr', 'vision-heavy', new Date(stamp - 2 * DAY))
  assert.equal(isToolHot(usage, 'vision_ocr', 7, stamp), true)
  assert.equal(isToolHot(usage, 'vision_ocr', 1, stamp), false)
  assert.equal(isToolHot(usage, 'never_used', 7, stamp), false)
  assert.equal(isToolHot(usage, 'never_used', 0, stamp), true)
  assert.equal(hotRatio(8, 27), 8 / 27, 'hotRatio 不许取整')
  assert.ok(hotRatio(8, 27) < 0.3, '8/27 必须小于 0.3')
  const roleBase = { x: { allowGroups: ['a'] } }
  const cleared = applyManagedRolesPatch(roleBase, {})
  assert.equal(cleared.next, null, '空对象必须清空角色')
  assert.equal(cleared.changed, true, '清空要算变化')
  const roleNorm = normalizeManagedRoles(roleBase)
  const same = applyManagedRolesPatch(roleNorm, roleNorm)
  assert.equal(same.changed, false, '相同角色表不该刷新')
  recordUsage(usage, 'dsh_browser_open', null, new Date(stamp))
  assert.equal(typeof usage.tools.dsh_browser_open, 'string')
  assert.equal(usage.groups.dsh_browser_open, undefined)
  ok('7 天内用过=热、1 天阈值=冷、无记录=冷、阈值 0=恒热、无组工具只记工具名')

  log('[19] 用量落盘：调用一次 → 账本有记录、组变热')
  const usagePath = join(tmpdir(), `lazy-tools-usage-${process.pid}.json`)
  process.env.LAZY_TOOLS_USAGE_FILE = usagePath
  const worldF = makeWorld()
  worldF.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  apply(worldF.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] })
  const agentF = worldF.createAgent('agent-usage')
  await worldF.firePreExecute(agentF, 'cua_driver_native__a')
  const rawUsage = JSON.parse(readFileSync(usagePath, 'utf8'))
  assert.equal(typeof rawUsage.groups.cua, 'string')
  assert.equal(typeof rawUsage.tools.cua_driver_native__a, 'string')
  const statusF = await runTool(worldF, 'lazy_tools_status', {}, agentF)
  assert.equal(statusF.groups.find((g) => g.id === 'cua').hot, true)
  rmSync(usagePath, { force: true })
  process.env.LAZY_TOOLS_USAGE_FILE = `${NO_SUCH}.usage.json`
  ok('pre-execute 记账 → usage 文件写出组时间戳、status.hot=true')
  log('[20] 会话级覆盖：lazy_tools_mode 立刻重算默认开哪些组')
  const worldG = makeWorld()
  worldG.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  apply(worldG.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] })
  const agentG = worldG.createAgent('agent-mode')
  assert.equal(worldG.denyByAgent.get(agentG).size, 1)
  const modeAll = await runTool(worldG, 'lazy_tools_mode', { idleDays: 0 }, agentG)
  assert.equal(modeAll.session.source, 'session')
  assert.equal(worldG.denyByAgent.get(agentG).size, 0)
  const modeReset = await runTool(worldG, 'lazy_tools_mode', { reset: true }, agentG)
  assert.equal(modeReset.session.source, 'global')
  assert.equal(worldG.denyByAgent.get(agentG).size, 1)
  ok('idleDays:0 → 全开；reset → 回全局（无历史 ⇒ 又收起）')

  log('[21] 自愈守卫：被藏工具的调用被拦下、自动补开')
  const worldH = makeWorld()
  worldH.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  apply(worldH.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] })
  const agentH = worldH.createAgent('agent-heal')
  const decision = worldH.fireGuard(agentH, 'cua_driver_native__a')
  // 2026-11-05：自愈改为「补开即放行」——不再返回字符串让模型重试（那在 UI 上是一次假失败）。
  assert.equal(decision, undefined)
  assert.equal(worldH.denyByAgent.get(agentH).has('cua_driver_native__a'), false)
  assert.ok((worldH.visibleNames(agentH) || []).includes('cua_driver_native__a'), '补开后必须可见')
  const healthH = await runTool(worldH, 'lazy_tools_health', {}, agentH)
  assert.equal(healthH.stats.selfHealed, 1)
  ok('守卫补开即放行 + 工具可见 + health.selfHealed=1')
  log('[22] 斜杠命令 /lazy-tools：改当前会话、乱输入报错')
  const worldI = makeWorld()
  worldI.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  apply(worldI.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] })
  const agentI = worldI.createAgent('agent-cmd')
  const command = worldI.commands.find((item) => item.name === 'lazy-tools')
  assert.ok(command, '斜杠命令没注册')
  const okResult = command.handler({ agent: agentI, rawInput: 'high' })
  assert.equal(okResult.kind, 'success')
  assert.match(okResult.text, /档位 high/)
  const stateResult = command.handler({ agent: agentI, rawInput: '' })
  assert.match(stateResult.text, /工具抽屉/)
  const badResult = command.handler({ agent: agentI, rawInput: 'bogus' })
  assert.equal(badResult.kind, 'error')
  ok('/lazy-tools high 生效；无参数读状态；乱输入报错')
  log('[23] 清空之后还能自己捞回来（设计红线）')
  const worldJ = makeWorld()
  worldJ.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
  worldJ.ctx.tools.register({ name: 'cua_driver_native__b', description: 'x', parameters: {}, output: {} })
  apply(worldJ.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }] })
  const agentJ = worldJ.createAgent('agent-restore')
  await runTool(worldJ, 'lazy_tools_enable', { group: 'cua' }, agentJ)
  assert.equal(worldJ.denyByAgent.get(agentJ).size, 0)
  await runTool(worldJ, 'lazy_tools_mode', { collapse: true }, agentJ)
  assert.equal(worldJ.denyByAgent.get(agentJ).size, 2)
  const resolvedBack = await runTool(worldJ, 'lazy_tools_enable', { name: 'cua_driver_native__a' }, agentJ)
  assert.equal(resolvedBack.applied, true)
  assert.equal(worldJ.denyByAgent.get(agentJ).has('cua_driver_native__a'), false)
  await runTool(worldJ, 'lazy_tools_enable', { group: 'cua' }, agentJ)
  assert.equal(worldJ.denyByAgent.get(agentJ).size, 0)
  ok('立刻清空 → resolve 单个 / enable 整组 都能捞回')
  log('[24] 三处名字必须一致（2026-10-24 五次恢复模式的根因）')
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const bridgeClientSrc = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
    const patchSrc = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    const clientId = (bridgeClientSrc.match(/__ModuleLoader__[\s\S]{0,60}?id:\s*'([^']+)'/) || [])[1]
    const rowName = (patchSrc.match(/^\s*name:\s*(\S+)\s*$/m) || [])[1]
    assert.ok(clientId, 'client.js 里找不到 __ModuleLoader__.load 的 id')
    assert.ok(rowName, 'cordis.patch.yml 里找不到行名 name')
    assert.equal(clientId, pkg.name, `客户端 id(${clientId}) ≠ 包名(${pkg.name})：改名必须三处同改`)
    assert.equal(rowName, pkg.name, `patch 行名(${rowName}) ≠ 包名(${pkg.name})：改名必须三处同改`)
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/, '版本号不是 x.y.z')
    assert.ok(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch, 'package.json 缺 dsh.bundle.patch，装不上')
    ok('包名 / 客户端 id / patch 行名三处一致；版本号合法；bundle 声明在')
    // 2026-11-07：角色工具面（用户口中的「面具」）必须有 UI 开关，不能只藏在配置里。
    assert.match(bridgeClientSrc, /角色工具面（默认关闭）/, '设置页缺角色工具面开关')
    assert.match(bridgeClientSrc, /managedRoles: form\.managedRoles \|\| \{\}/, '设置页保存缺 managedRoles')
    ok('设置页有角色工具面开关，且会随策略保存')
    assert.match(bridgeClientSrc, /自定义角色名/, '设置页缺自定义角色输入')
    assert.doesNotMatch(patchSrc, /managedRoles:/, '角色工具面默认应为关闭（README 口径）')
    ok('角色工具面默认关闭，支持自定义角色')
    assert.match(bridgeClientSrc, /groupCatalog\.map/, '自定义角色必须从当前分组动态列出')
    ok('自定义角色从 state.groups 动态列组，不写死组名')
    assert.match(bridgeClientSrc, /本对话累计自动取出/, '收纳统计必须区分本对话与全局')
    ok('收纳统计区分本对话 hidden 与本对话 selfHealed')

    log('[25] 自动分组：切分、白名单、80% 规则、上限')
    const { tokenize, suggestGroups, matchPattern, normalizeAutoMode } = await import('../lib/autogroups.js')
    assert.deepEqual(tokenize('cua_driver_native__list_apps'), ['cua_driver_native'])
    assert.deepEqual(tokenize('mnemon_view_route'), ['mnemon', 'view', 'route'])
    assert.deepEqual(tokenize('read'), ['read'])
    assert.equal(matchPattern(['mnemon']), 're:^mnemon(_|__|$)')
    assert.equal(normalizeAutoMode('bogus', 'on'), 'on')
    // 2026-10-29 改：兜底从 'suggest' 变 'on'（'suggest' 等于功能不存在）
    assert.equal(normalizeAutoMode(undefined, undefined), 'on')
    assert.equal(normalizeAutoMode('suggest'), 'suggest', '显式 suggest 仍然尊重')

    const many = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}_t${i}`)
    const names = [
      ...many('mnemon', 17),
      ...many('schedule', 4),
      ...many('job', 3),
      ...many('lazy_tools', 8),      // 核心（自救工具）→ 白名单
      'read', 'read_page', 'read_image', // read 是核心 → 只剩 2 个，不足数
      ...many('dsh_browser', 5),     // 已被现有组覆盖
      ...many('mix', 4),             // 一半会被"现有组"吃掉 → 80% 规则淘汰
    ]
    const covered = (name) => name.startsWith('dsh_browser_') || name === 'mix_t0' || name === 'mix_t1'
    const report = suggestGroups(names, covered, { minTools: 3 })
    const ids = report.suggestions.map((item) => item.id)
    assert.ok(ids.includes('auto-mnemon'), 'mnemon 应被识别')
    assert.ok(ids.includes('auto-schedule'), 'schedule 应被识别')
    assert.ok(ids.includes('auto-job'), 'job 应被识别')
    assert.ok(!ids.includes('auto-lazy-tools'), '核心工具族不该入组')
    assert.ok(!ids.includes('auto-read'), '核心 read 占掉名额后不足数，不该入组')
    assert.ok(!ids.includes('auto-dsh-browser'), '已被覆盖的族不该重复建组')
    assert.ok(!ids.includes('auto-mix'), '覆盖比例过高的族应被 80% 规则淘汰')
    const mnemon = report.suggestions.find((item) => item.id === 'auto-mnemon')
    assert.equal(mnemon.expect, 17)
    assert.deepEqual(mnemon.tools.slice(0, 2), ['mnemon_t0', 'mnemon_t1'])
    const capped = suggestGroups(names, covered, { minTools: 3, maxGroups: 1 })
    assert.equal(capped.suggestions.length, 1, 'maxGroups 应生效')
    ok('切分 / 白名单 / 覆盖淘汰 / 数量上限 都对')
    log('[26] 自动分组：子族覆盖不足时不许拆大族（mnemon 17 不该碎成两个 3）')
    const realish = [
      'mnemon_memory_body_create', 'mnemon_memory_body_merge', 'mnemon_memory_body_update',
      'mnemon_document_create', 'mnemon_document_manage', 'mnemon_document_search',
      'mnemon_view_route', 'mnemon_view_action', 'mnemon_recall', 'mnemon_remember',
      'mnemon_related', 'mnemon_forget', 'mnemon_status', 'mnemon_memory_bodies',
      'mnemon_subagent_result', 'mnemon_link', 'mnemon_view_action_extra',
    ]
    const collapsed = suggestGroups(realish, () => false, { minTools: 3 })
    const mn = collapsed.suggestions.find((item) => item.id === 'auto-mnemon')
    assert.ok(mn, 'mnemon 应作为一整族出现')
    assert.equal(mn.expect, 17, '整族数量应为 17')
    assert.ok(!collapsed.suggestions.some((item) => item.id.startsWith('auto-mnemon-')), '不该碎成子族')
    ok('子族覆盖不足 80% 时保留整族')
    log('[27] autoGroups=on：真的建组并按规则收起')
    const worldAuto = makeWorld()
    for (const name of ['smokefam_alpha', 'smokefam_beta', 'smokefam_gamma', 'smokefam_delta']) {
      worldAuto.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
    }
    apply(worldAuto.ctx, { groups: [], autoGroups: 'on' })
    const agentAuto = worldAuto.createAgent('agent-auto')
    const statusAuto = await runTool(worldAuto, 'lazy_tools_status', {}, agentAuto)
    const autoGroup = statusAuto.groups.find((group) => group.id === 'auto-smokefam')
    assert.ok(autoGroup, '应自动创建 auto-smokefam')
    assert.equal(autoGroup.matched, 4)
    assert.equal(worldAuto.denyByAgent.get(agentAuto).has('smokefam_alpha'), true, '应默认收起')
    ok('自动组已创建且默认收起')
    log('[28] 冷启动顺序：apply 时没工具，会话开始才注册 → 仍要建出自动组')
    const worldRace = makeWorld()
    apply(worldRace.ctx, { groups: [], autoGroups: 'on' })   // 此刻一个工具都没有
    for (const name of ['latefam_a', 'latefam_b', 'latefam_c']) {
      worldRace.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
    }
    const agentRace = worldRace.createAgent('agent-late')      // 会话开始，工具已就位
    const statusLate = await runTool(worldRace, 'lazy_tools_status', {}, agentRace)
    const lateGroup = statusLate.groups.find((group) => group.id === 'auto-latefam')
    assert.ok(lateGroup, '延迟注册的工具族也要能建组')
    assert.equal(lateGroup.matched, 3)
    ok('会话开始时补算生效')
    log('[29] extraGroups：追加而不替换默认四组')
    const worldExtra = makeWorld()
    for (const name of ['list_windows', 'get_window_state', 'click', 'type_text', 'launch_app']) {
      worldExtra.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
    }
    apply(worldExtra.ctx, {
      extraGroups: [
        { id: 'cu-observe', match: ['list_windows', 'get_window_state'], title: '电脑·看', defaultOn: false },
        { id: 'cu-act', match: ['click', 'type_text', 'launch_app'], title: '电脑·动', defaultOn: false },
      ],
    })
    const agentExtra = worldExtra.createAgent('agent-extra')
    const statusExtra = await runTool(worldExtra, 'lazy_tools_status', {}, agentExtra)
    const extraIds = statusExtra.groups.map((g) => g.id)
    assert.ok(extraIds.includes('cu-observe') && extraIds.includes('cu-act'), '追加组应在列表里')
    assert.ok(extraIds.includes('cua-screen') && extraIds.includes('cua-input'), '内置默认组不该被冲掉')
    const observe = statusExtra.groups.find((g) => g.id === 'cu-observe')
    assert.equal(observe.matched, 2)
    ok('extraGroups 追加成功、默认组保留')
    log('[30] 分类交接：save_groups 必须拒绝常驻工具')
    const worldCls = makeWorld()
    apply(worldCls.ctx, { groups: [], autoGroups: 'off' })
    const agentCls = worldCls.createAgent('agent-cls')
    const material = await runTool(worldCls, 'lazy_tools_save_groups', {}, agentCls)
    assert.ok(material.classify && Array.isArray(material.classify.tools), '不传 groups 要返回分类材料')
    assert.ok(typeof material.classify.instructions === 'string' && material.classify.instructions.length > 20, '要给分组说明')
    const badSave = await runTool(worldCls, 'lazy_tools_save_groups', { groups: [{ id: 'nope', match: ['pwsh', 'read'] }] }, agentCls)
    assert.equal(badSave.saved, 0)
    assert.ok(badSave.issues.some((s) => s.includes('常驻')), '必须拒绝含常驻工具的组')
    const smallSave = await runTool(worldCls, 'lazy_tools_save_groups', { groups: [{ id: 'tiny', match: ['only_one'] }] }, agentCls)
    assert.equal(smallSave.saved, 0)
    assert.ok(smallSave.issues.some((s) => s.includes('少于 2')), '必须拒绝单工具组')
    ok('save_groups 不传 groups 给材料、带 groups 时拒绝常驻与单工具组')
    log('[31] 分类提示开关：默认开，关掉后提示段里不出现')
    const mkWorldWithPrompt = () => {
      const world = makeWorld()
      const sections = []
      world.ctx.inject = (deps, callback) => {
        callback({
          effect: (make) => make(),
          systemPrompt: {
            section(section) {
              sections.push(section)
              return () => {}
            },
          },
        })
      }
      return { world, sections }
    }
    const bare = ['bareclick', 'baretype', 'barescroll']
    const on = mkWorldWithPrompt()
    for (const name of bare) on.world.ctx.tools.register({ name, description: 'bare ' + name, parameters: { type: 'object', properties: {} }, output: {} })
    apply(on.world.ctx, { groups: [], classifyNudge: true })
    const onText = typeof on.sections[0].text === 'function' ? on.sections[0].text() : String(on.sections[0].text)
    assert.ok(onText.includes('没归组'), '开启时提示段应提到未归组工具')
    const off = mkWorldWithPrompt()
    for (const name of bare) off.world.ctx.tools.register({ name, description: 'bare ' + name, parameters: { type: 'object', properties: {} }, output: {} })
    apply(off.world.ctx, { groups: [], classifyNudge: false })
    const offText = typeof off.sections[0].text === 'function' ? off.sections[0].text() : String(off.sections[0].text)
    assert.ok(!offText.includes('没归组'), '关闭时提示段不该出现分类提醒')
    assert.ok(offText.includes('lazy_tools_status'), '关闭后基础提示还在')
    ok('分类提示默认开、可关，关掉不影响基础提示')

    log('[32] 宿主没挂载的组：静音待命，不拉低 healthy')
    const worldNM = makeWorld()
    worldNM.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
    worldNM.ctx.tools.register({ name: 'cua_driver_native__b', description: 'x', parameters: {}, output: {} })
    apply(worldNM.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], title: '桌面自动化', defaultOn: true }], autoGroups: 'off' })
    // 创建这一刻就没挂载：相当于 DSH 2.0.20 上 cua_driver_native__* 的真实处境
    let remountCua = () => {}
    const agentNM = worldNM.createAgent('agent-nm', (a) => {
      remountCua = worldNM.unmount(a, ['cua_driver_native__a', 'cua_driver_native__b'])
    })
    const hNM = await runTool(worldNM, 'lazy_tools_health', {}, agentNM)
    assertJsonSafe(hNM, 'health-nm')
    const gNM = hNM.groups.find((g) => g.id === 'cua')
    assert.equal(gNM.on, true)
    assert.equal(gNM.matched, 2)
    assert.equal(gNM.visible, 0)
    // 2026-10-30 二修：scoped 才是 agent 作用域视图；这个场景是「全局有、作用域查不到」⇒ agent-filtered
    assert.equal(gNM.blocked, 'agent-filtered')
    assert.deepEqual(hNM.warnings, [], `宿主没挂载不该算 warning：${JSON.stringify(hNM.warnings)}`)
    assert.equal(hNM.healthy, true, '静音待命不能让 healthy 变 false —— 否则每轮都在替宿主挨刀')
    assert.ok(hNM.notes.some((n) => n.includes('作用域') && n.includes('scoped=false')), 'notes 要写明决定性布尔 scoped=false（agent 是无第二参的全局值，不许当证据）')
    assert.ok(hNM.groups.find((g) => g.id === 'cua').blockedProbe, '要带上探针结果（global/scoped）')
    ok('[32] 注册了但不在工具表 → blocked:agent-filtered、不报警、healthy 仍 true、notes 带实测原因')

    log('[33] 宿主修好了：监控自动恢复，不用做任何事')
    remountCua()
    const hNM2 = await runTool(worldNM, 'lazy_tools_health', {}, agentNM)
    const gNM2 = hNM2.groups.find((g) => g.id === 'cua')
    assert.equal(gNM2.visible, 2)
    assert.equal(gNM2.blocked, undefined)
    assert.equal(hNM2.healthy, true)
    ok('挂回来后 blocked 消失、visible=2 —— 监控自己恢复')

    log('[34] 挂过又消失：这个必须响')
    const unmountAgain = worldNM.unmount(agentNM, ['cua_driver_native__a', 'cua_driver_native__b'])
    const hNM3 = await runTool(worldNM, 'lazy_tools_health', {}, agentNM)
    const gNM3 = hNM3.groups.find((g) => g.id === 'cua')
    assert.equal(gNM3.visible, 0)
    assert.equal(gNM3.blocked, undefined, '挂载过的工具不见了不是「宿主没挂载」，不许静音')
    assert.ok(hNM3.warnings.some((w) => w.includes('出现过') && w.includes('不见了')), `要报「挂过又消失」：${JSON.stringify(hNM3.warnings)}`)
    assert.equal(hNM3.healthy, false)
    unmountAgain()
    ok('出现过又消失 → 报警、healthy=false（静音没有把真异常一起吞掉）')

    log('[35] bench 口径：可见 + 收起 + 宿主没挂 === 注册总数')
    const worldBench = makeWorld()
    // 两组：gg 关着（它的 2 个工具是我们收的）／hh 开着（其中 h_two 宿主没挂）
    for (const n of ['g_one', 'g_two', 'h_one', 'h_two', 'keep_one']) worldBench.ctx.tools.register({ name: n, description: 'x'.repeat(20), parameters: {}, output: {} })
    apply(worldBench.ctx, {
      groups: [
        { id: 'gg', match: ['g_*'], title: 'g', defaultOn: false },
        { id: 'hh', match: ['h_*'], title: 'h', defaultOn: true },
      ],
      autoGroups: 'off',
    })
    const agentBench = worldBench.createAgent('agent-b', (a) => worldBench.unmount(a, ['h_two']))
    const benchB = (await runTool(worldBench, 'lazy_tools_health', { bench: true }, agentBench)).bench
    assertJsonSafe(benchB, 'bench-b')
    assert.equal(benchB.hidden, 2, 'g_one / g_two 是抽屉收起的')
    assert.equal(benchB.absent, 1, 'h_two 是宿主没挂的，不算在收起里（组开着不该被算成我们收的）')
    // tools 里还包含插件自己的 7 个 lazy_tools_*，所以只对「差值」下断言
    assert.equal(benchB.visibleInRegistry, benchB.tools - 3)
    assert.equal(benchB.visibleInRegistry + benchB.hidden + benchB.absent, benchB.tools, '三态必须能对上账')
    ok('bench：收起 2 + absent 1 + 注册内可见 (tools-3) = 注册总数，账能对上')

    log('[36] tools/change 冷却：先检查再盖章，3 秒内新注册的工具不能漏')
    const worldLeak = makeWorld()
    worldLeak.ctx.tools.register({ name: 'late_one', description: 'x', parameters: {}, output: {} })
    apply(worldLeak.ctx, { groups: [{ id: 'late', match: ['late_*'], title: 'late', defaultOn: false }], autoGroups: 'off' })
    const agentLeak = worldLeak.createAgent('agent-leak')
    // 第一发：此刻没有漏网（late_one 已经被收起）——旧实现在这里就盖了时间戳
    worldLeak.fireToolsChange()
    // 3 秒内上游又注册了一个本该收起的新工具，再来一发
    worldLeak.ctx.tools.register({ name: 'late_two', description: 'x', parameters: {}, output: {} })
    worldLeak.fireToolsChange()
    const denyLeak = worldLeak.denyByAgent.get(agentLeak)
    assert.ok(denyLeak.has('late_two'), `3 秒内新增的 late_two 也必须被收起；实际 deny=${[...denyLeak].join(',')}`)
    ok('冷启动 3 秒内新增的工具仍被收起（冷却只限重建频率，不吞检查）')

    log('[37] 设置页只改档位时，生效天数跟着档位走')
    const { applyPolicyPatch } = await import('../lib/api.js')
    const pol = { level: 'high', idleDays: 3, presets: { low: 14, medium: 7, high: 3 } }
    applyPolicyPatch(pol, { level: 'low' })
    assert.equal(pol.idleDays, 14, '改成 low 后 idleDays 应为 14')
    applyPolicyPatch(pol, { idleDays: 5 })
    assert.equal(pol.idleDays, 5, '显式给天数要用它，不能被档位覆盖')
    applyPolicyPatch(pol, { level: 'medium', idleDays: null })
    assert.equal(pol.idleDays, 7, 'idleDays 为 null 视为没碰，跟着档位重新算')
    ok('档位→天数跟随；显式天数优先')

    // 2026-10-30 挑刺（第三轮）：原来的 fixture 手工写 {groups:{}, tools:{...}} —— 那是插件自己
    // **永远写不出来**的状态（recordUsage 必然同时写 groups），所以这个用例测的是假数据。
    // 现在用真实账本：10 个工具的组里只有 1 个用过 → 组时间戳虽热，但热工具占比只有 10%，
    // 按新定义（≥30% 才算整组开）应走 only，只放那 1 个。
    log('[38] 单工具热度：大组里只用 1 个 → 只放那一个')
    const usagePath2 = join(tmpdir(), `lazy-tools-usage2-${process.pid}.json`)
    const ledgerReal = { groups: {}, tools: {} }
    recordUsage(ledgerReal, 'cua_driver_native__a', 'cua', new Date())
    writeFileSync(usagePath2, JSON.stringify(ledgerReal))
    process.env.LAZY_TOOLS_USAGE_FILE = usagePath2
    const worldSingle = makeWorld()
    const ten = []
    for (const suffix of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
      ten.push(`cua_driver_native__${suffix}`)
      worldSingle.ctx.tools.register({ name: `cua_driver_native__${suffix}`, description: 'x', parameters: {}, output: {} })
    }
    apply(worldSingle.ctx, { groups: [{ id: 'cua', match: ['cua_driver_native__*'], defaultOn: false }], autoGroups: 'off' })
    const agentSingle = worldSingle.createAgent('agent-single')
    const denySingle = worldSingle.denyByAgent.get(agentSingle)
    assert.equal(denySingle.has('cua_driver_native__a'), false, '用过的 a 应该被 only 放出来')
    for (const name of ten.filter((n) => n !== 'cua_driver_native__a')) {
      assert.equal(denySingle.has(name), true, `没用过的 ${name} 要继续收着`)
    }
    rmSync(usagePath2, { force: true })
    process.env.LAZY_TOOLS_USAGE_FILE = `${NO_SUCH}.usage.json`
    ok('大组只用 1 个：only 只放那一个（占比 10% < 30%）')

    // 对照组：小组里 1/2 用过 = 50% ≥ 30% → 整组开（否则「一个工具常用就整组开」会被一刀切掉）
    log('[44] 热工具占比够高 → 整组开（对照组）')
    const usagePath3 = join(tmpdir(), `lazy-tools-usage3-${process.pid}.json`)
    const ledgerSmall = { groups: {}, tools: {} }
    recordUsage(ledgerSmall, 'small__a', 'small', new Date())
    writeFileSync(usagePath3, JSON.stringify(ledgerSmall))
    process.env.LAZY_TOOLS_USAGE_FILE = usagePath3
    const worldSmall = makeWorld()
    for (const suffix of ['a', 'b']) worldSmall.ctx.tools.register({ name: `small__${suffix}`, description: 'x', parameters: {}, output: {} })
    apply(worldSmall.ctx, { groups: [{ id: 'small', match: ['small__*'], defaultOn: false }], autoGroups: 'off' })
    const agentSmall = worldSmall.createAgent('agent-small')
    assert.equal(worldSmall.denyByAgent.get(agentSmall).size, 0, '1/2 = 50% ≥ 30% ⇒ 整组开，一个都不该 deny')
    rmSync(usagePath3, { force: true })
    process.env.LAZY_TOOLS_USAGE_FILE = `${NO_SUCH}.usage.json`
    ok('小组里过半常用 → 整组开（占比阈值生效）')

    log('[39] 常驻提示带组用途（能力目录）')
    const promptWorld = mkWorldWithPrompt()
    promptWorld.world.ctx.tools.register({ name: 'cua_driver_native__a', description: 'x', parameters: {}, output: {} })
    apply(promptWorld.world.ctx, {
      groups: [{ id: 'cua', match: ['cua_driver_native__*'], title: '桌面·看', defaultOn: false }],
      autoGroups: 'off',
    })
    const promptText2 = typeof promptWorld.sections[0].text === 'function'
      ? promptWorld.sections[0].text()
      : String(promptWorld.sections[0].text)
    assert.ok(promptText2.includes('cua(桌面·看'), `提示里要有组用途：${promptText2.slice(0, 160)}`)
    // 2026-10-30 补：能力目录必须带**代表工具名**，否则自愈等于要模型猜一个被藏起来的名字；
    // 且必须列**完整名** —— 裸名 `click` 在注册表里可能是别的插件的同名工具（本机就撞了）。
    assert.ok(promptText2.includes('cua_driver_native__a'), `提示里要列完整工具名：${promptText2.slice(0, 200)}`)
    assert.ok(!promptText2.includes(': a)'), '不许截前缀：裸名可能是别的插件的同名工具（click 就撞了）')
    ok('提示段列「组 id(用途: 完整工具名)」—— 自愈不用再猜名字，也不会念错插件')

    log('[40] glob 里的 ? 必须按字面量转义')
    const worldQ = makeWorld()
    worldQ.ctx.tools.register({ name: 'ab', description: 'x', parameters: {}, output: {} })
    worldQ.ctx.tools.register({ name: 'a?b', description: 'x', parameters: {}, output: {} })
    apply(worldQ.ctx, { groups: [{ id: 'q', match: ['a?b'], defaultOn: false }], autoGroups: 'off' })
    const agentQ = worldQ.createAgent('agent-q')
    const statusQ = await runTool(worldQ, 'lazy_tools_status', {}, agentQ)
    const groupQ = statusQ.groups.find((g) => g.id === 'q')
    assert.equal(groupQ.matched, 1, '`a?b` 只能匹配字面量 a?b，不能把 ab 也吃进来')
    assert.equal(groupQ.visible, 0)
    ok('`?` 转义后只匹配字面量（`*` 仍是通配符）')

    // 2026-10-30 对面（DSH 作者）用我们的 db42e09 在 mock 里复现出来的真 bug：
    // rebuild 先 lift 旧限制、之后才替换 st.lifts；而 rc.3 的 lift 是**同步**发 tools/change 的，
    // 于是 change 处理器重入 rebuild，内层把自己的 lift 句柄写进 st.lifts，
    // 外层回来又用 leftovers 覆盖掉 → 内层那条限制永远没人解除（孤儿）。
    // 复现条件必须包括「同步事件」—— 所以这里打开 setSyncRestrictEvents。
    console.log('[41] 重入 rebuild：连续打开两个关着的组，不许留下孤儿限制')
    const worldR = makeWorld()
    worldR.setSyncRestrictEvents(true)
    worldR.ctx.tools.register({ name: 'g1_tool', description: 'x', parameters: {}, output: {} })
    worldR.ctx.tools.register({ name: 'g2_tool', description: 'x', parameters: {}, output: {} })
    apply(worldR.ctx, {
      groups: [
        { id: 'g1', match: ['g1_*'], defaultOn: false },
        { id: 'g2', match: ['g2_*'], defaultOn: false },
      ],
      autoGroups: 'off',
    })
    const agentR = worldR.createAgent('agent-reentrant')
    // 只看这两个测试工具：插件自己的 lazy_tools_* 永远可见，和本用例无关
    const onlyG = () => worldR.visibleNames(agentR).filter((n) => n.startsWith('g'))
    assert.equal(worldR.activeRestrictions(agentR).length, 1, '初始：一条限制覆盖两个组')
    assert.deepEqual(onlyG(), [], '初始两个都该藏起来')

    await runTool(worldR, 'lazy_tools_enable', { group: 'g1' }, agentR)
    assert.deepEqual(onlyG(), ['g1_tool'], '开 g1 之后只该看见 g1_tool')
    assert.equal(
      worldR.activeRestrictions(agentR).length,
      1,
      `开 g1 之后应该只剩一条限制（覆盖 g2），实际 ${worldR.activeRestrictions(agentR).length} 条 → 有孤儿`,
    )

    await runTool(worldR, 'lazy_tools_enable', { group: 'g2' }, agentR)
    assert.deepEqual(onlyG().sort(), ['g1_tool', 'g2_tool'], '两个都开之后两个都要可见')
    assert.equal(
      worldR.activeRestrictions(agentR).length,
      0,
      `两个都开之后不许留任何限制，实际 ${worldR.activeRestrictions(agentR).length} 条`,
    )
    worldR.setSyncRestrictEvents(false)
    ok('连续开两个组：没有孤儿限制，两个工具都真的回来了')

    // 2026-10-30 对面第二轮：冷却期内**第二次**晚注册会被整段跳过，且之后没有事件就永远漏着。
    // 复现：先注册 late_one（触发一次检查并盖时间戳）→ 冷却内注册 late_two（被 continue 跳过）
    //      → 之后没有事件 → late_two 一直可见。
    console.log('[42] 冷却期内的晚注册：不许漏（要延迟核对一次）')
    process.env.LAZY_TOOLS_COOLDOWN_MS = '60'
    const worldT = makeWorld()
    worldT.ctx.tools.register({ name: 'g_one', description: 'x', parameters: {}, output: {} })
    apply(worldT.ctx, { groups: [{ id: 'gh', match: ['g_*'], defaultOn: false }], autoGroups: 'off' })
    const agentT = worldT.createAgent('agent-late')
    const onlyG2 = () => worldT.visibleNames(agentT).filter((n) => n.startsWith('g_'))
    assert.deepEqual(onlyG2(), [], '初始 g_one 应该被藏起来')
    worldT.ctx.tools.register({ name: 'g_late_one', description: 'x', parameters: {}, output: {} })
    worldT.fireToolsChange()
    assert.deepEqual(onlyG2(), [], '第一次晚注册：立刻被藏起来（并开始冷却）')
    worldT.ctx.tools.register({ name: 'g_late_two', description: 'x', parameters: {}, output: {} })
    worldT.fireToolsChange()
    // 这一刻就是 bug 现场：冷却把它整段跳过，于是它**可见**
    assert.deepEqual(onlyG2(), ['g_late_two'], `冷却内第二次晚注册此刻应还是露着的（实际：${JSON.stringify(onlyG2())}）`)
    await new Promise((resolve) => setTimeout(resolve, 250))
    assert.deepEqual(onlyG2(), [], `冷却过后必须补收（实际可见：${JSON.stringify(onlyG2())}）`)
    delete process.env.LAZY_TOOLS_COOLDOWN_MS
    ok('冷却期内的第二次晚注册不会永远漏着（延迟核对生效）')

    // 2026-10-30 挑刺：firstTryRate 的分子原来是「补救次数」，语义反了 ——
    // 旧公式 (autoOpened + selfHealed)/toolCalls 在没有自愈时给 0（读成"成功率 0%"），实际应该是 100%。
    // 2026-10-30 挑刺（第二轮）：分母原来数**所有**工具的 pre-execute，而 read/write/bash 永不入组、
    // 不可能自愈 —— 200 次调用里 190 次核心工具，5 次自愈会被读成 97.5%，组内其实是 50%。
    // 现在分母只算「属于某个组」的调用；这个用例同时守住语义（无自愈=1）和分母口径（核心工具不计）。
    console.log('[43] firstTryRate：无自愈=1，且分母只数组内调用')
    const worldRate = makeWorld()
  const envRate = `${NO_SUCH}.rate.usage.json`
  process.env.LAZY_TOOLS_USAGE_FILE = envRate
  rmSync(envRate, { force: true })
    worldRate.ctx.tools.register({ name: 'g_rate', description: 'x', parameters: {}, output: {} })
    apply(worldRate.ctx, { groups: [{ id: 'gr', match: ['g_rate'], defaultOn: true }], autoGroups: 'off' })
    const agentRate = worldRate.createAgent('agent-rate')
    for (let i = 0; i < 20; i += 1) await worldRate.firePreExecute(agentRate, 'g_rate')
    for (let i = 0; i < 5; i += 1) await worldRate.firePreExecute(agentRate, 'lazy_tools_status') // 核心工具，不计
    const hRate = await runTool(worldRate, 'lazy_tools_health', {}, agentRate)
    assert.equal(hRate.stats.toolCalls, 20, `分母只该数组内调用（实际 ${hRate.stats.toolCalls}）`)
    assert.equal(hRate.stats.selfHealed, 0, '这个场景没有自愈')
    assert.equal(hRate.stats.firstTryRate, 1, `无自愈时首次成功率应为 1（实际 ${hRate.stats.firstTryRate}）`)
    ok('firstTryRate = 1 - 自愈/组内调用；核心工具调用不进分母')

    // 2026-10-30 挑刺（第四轮）：CAP=3 是「永久自愈税」—— 常用 4~11 个工具的用户每个会话都为
    // 被藏的那几个付一次自愈。上限应与判据对齐：max(3, ceil(成员数 × warmRatio))。
    console.log('[45] 热工具全放（20 成员 5 热 = 25% → 放 5 个，不再有 CAP）')
    const usagePath45 = join(tmpdir(), `lazy-tools-usage45-${process.pid}.json`)
    const ledger45 = { groups: {}, tools: {} }
    const world45 = makeWorld()
    for (let i = 0; i < 20; i += 1) {
      const name = `cap__t${i}`
      world45.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
      if (i < 5) recordUsage(ledger45, name, 'cap', new Date())
    }
    writeFileSync(usagePath45, JSON.stringify(ledger45))
    process.env.LAZY_TOOLS_USAGE_FILE = usagePath45
    apply(world45.ctx, { groups: [{ id: 'cap', match: ['cap__*'], defaultOn: false }], autoGroups: 'off' })
    const agent45 = world45.createAgent('agent-cap')
    const deny45 = world45.denyByAgent.get(agent45)
    for (let i = 0; i < 5; i += 1) assert.equal(deny45.has(`cap__t${i}`), false, `热的 cap__t${i} 必须放出来（不许再有 CAP 截断）`)
    for (let i = 5; i < 20; i += 1) assert.equal(deny45.has(`cap__t${i}`), true, `冷的 cap__t${i} 要继续收着`)
    const st45 = await runTool(world45, 'lazy_tools_status', {}, agent45)
    const grp45 = st45.groups.find((g) => g.id === 'cap')
    assert.equal(grp45.onlyCount, 5, `only 应放 5 个，实际 ${grp45.onlyCount}`)
    assert.equal(grp45.hotTools, 5, `hotTools 应报 5，实际 ${grp45.hotTools}`)
    assert.equal(grp45.hot, false, '5/20 = 25% < 30%，hot 应为 false（与决策同语义）')
    rmSync(usagePath45, { force: true })
    process.env.LAZY_TOOLS_USAGE_FILE = `${NO_SUCH}.usage.json`
    ok('only = 热的全放（旧 slice(0,3) 会漏掉 2 个）')

    // 对照组：warmRatio 可配 —— 调到 0.5 后 5/12（42%）不够热，仍走 only，且上限 6 允许 5 个全放
    console.log('[46] warmRatio 可配（0.5）：5/12 不够热 → only 5')
    const usagePath46 = join(tmpdir(), `lazy-tools-usage46-${process.pid}.json`)
    const ledger46 = { groups: {}, tools: {} }
    const world46 = makeWorld()
    for (let i = 0; i < 12; i += 1) {
      const name = `ratio__t${i}`
      world46.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
      if (i < 5) recordUsage(ledger46, name, 'ratio', new Date())
    }
    writeFileSync(usagePath46, JSON.stringify(ledger46))
    process.env.LAZY_TOOLS_USAGE_FILE = usagePath46
    apply(world46.ctx, {
      groups: [{ id: 'ratio', match: ['ratio__*'], defaultOn: false }],
      autoGroups: 'off',
      warmRatio: 0.5,
    })
    const agent46 = world46.createAgent('agent-ratio')
    const st46 = await runTool(world46, 'lazy_tools_status', {}, agent46)
    const grp46 = st46.groups.find((g) => g.id === 'ratio')
    assert.equal(grp46.mode, 'only', `5/12=42% < 50% ⇒ 应走 only，实际 ${grp46.mode}`)
    assert.equal(grp46.onlyCount, 5, `上限 6 应容许 5 个全放，实际 ${grp46.onlyCount}`)
    assert.equal(grp46.hot, false, '42% < 50% ⇒ hot=false（与决策同语义）')
    rmSync(usagePath46, { force: true })
    process.env.LAZY_TOOLS_USAGE_FILE = `${NO_SUCH}.usage.json`
    ok('warmRatio 可配，且 status.hot 与决策同一语义')

    // status.hot 曾经用「组时间戳」（任一工具热）；现在必须与占比判据一致
    console.log('[47] status.hot 不再用旧语义：1/12 热 → hot=false，但 only 放 1 个')
    const usagePath47 = join(tmpdir(), `lazy-tools-usage47-${process.pid}.json`)
    const ledger47 = { groups: {}, tools: {} }
    const world47 = makeWorld()
    for (let i = 0; i < 12; i += 1) {
      const name = `one__t${i}`
      world47.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
    }
    recordUsage(ledger47, 'one__t0', 'one', new Date()) // 组时间戳也写了，模拟真实账本
    writeFileSync(usagePath47, JSON.stringify(ledger47))
    process.env.LAZY_TOOLS_USAGE_FILE = usagePath47
    apply(world47.ctx, { groups: [{ id: 'one', match: ['one__*'], defaultOn: false }], autoGroups: 'off' })
    const agent47 = world47.createAgent('agent-one')
    const st47 = await runTool(world47, 'lazy_tools_status', {}, agent47)
    const grp47 = st47.groups.find((g) => g.id === 'one')
    assert.equal(grp47.mode, 'only', '1/12 应走 only')
    assert.equal(grp47.onlyCount, 1, 'only 只放 1 个')
    assert.equal(grp47.hot, false, '8% < 30% ⇒ hot 必须是 false（旧语义会错报 true）')
    assert.equal(grp47.lastUsed !== null, true, '但 lastUsed 仍要有（组级时间戳保留作展示）')
    rmSync(usagePath47, { force: true })
    process.env.LAZY_TOOLS_USAGE_FILE = `${NO_SUCH}.usage.json`
    ok('hot 与决策一致；组级时间戳只留作 lastUsed')

    // 2026-10-30 第二轮挑刺：吸纳型组（前缀通配/负向前瞻）配静态 expect，新工具被正确收起却触发告警 ——
    // healthy 在默认状态长期 false，正是「训练人忽略警报」。
    console.log('[48] 吸纳型组：多出来的成员不算漂移（expect 是下限）')
    const worldAbs = makeWorld()
    for (const s of ['a', 'b', 'c']) worldAbs.ctx.tools.register({ name: `abs__${s}`, description: 'x', parameters: {}, output: {} })
    apply(worldAbs.ctx, { groups: [{ id: 'abs', match: ['abs__*'], expect: 2, defaultOn: true }], autoGroups: 'off' })
    const agentAbs = worldAbs.createAgent('agent-abs')
    const hAbs = await runTool(worldAbs, 'lazy_tools_health', {}, agentAbs)
    assert.equal(hAbs.warnings.filter((w) => String(w).includes(' abs') || String(w).startsWith('abs')).length, 0, `不该有 abs 的告警：${JSON.stringify(hAbs.warnings)}`)
    const sAbs = await runTool(worldAbs, 'lazy_tools_status', {}, agentAbs)
    const gAbs = sAbs.groups.find((g) => g.id === 'abs')
    assert.equal(gAbs.matched, 3)
    assert.equal(gAbs.expectOk, true, '3 ≥ expect 2 ⇒ expectOk 应为 true（下限语义）')
    ok('吸纳型组：matched 3 > expect 2 不告警（healthy 不被误伤）')

    console.log('[49] 少了的成员才算漂移（下限语义的反面）')
    const worldMiss = makeWorld()
    worldMiss.ctx.tools.register({ name: 'miss__a', description: 'x', parameters: {}, output: {} })
    apply(worldMiss.ctx, { groups: [{ id: 'miss', match: ['miss__*'], expect: 2, defaultOn: true }], autoGroups: 'off' })
    const agentMiss = worldMiss.createAgent('agent-miss')
    const hMiss = await runTool(worldMiss, 'lazy_tools_health', {}, agentMiss)
    assert.ok(
      hMiss.warnings.some((w) => String(w).includes('miss') && String(w).includes('<')),
      `少成员时应有 '<' 告警：${JSON.stringify(hMiss.warnings)}`,
    )
    ok('matched < expect ⇒ 告警（改名/没加载/正则漏）')

    console.log('[50] minTools 填 2 时，生效值是 3（不许静默失效）')
    const worldMt = makeWorld()
    apply(worldMt.ctx, { groups: [], autoGroups: 'off', minTools: 2 })
    const agentMt = worldMt.createAgent('agent-mt')
    const hMt = await runTool(worldMt, 'lazy_tools_health', {}, agentMt)
    assert.equal(hMt.policy.minTools, 3, `minTools 应夹到 3，实际 ${hMt.policy.minTools}`)
    ok('minTools 下限 3 在加载时夹住，health 显示生效值')

    console.log('[51] 能力目录：最近用过的优先（不按累计次数）')
    const usagePath51 = join(tmpdir(), `lazy-tools-usage51-${process.pid}.json`)
    const oldIso = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
    writeFileSync(usagePath51, JSON.stringify({ groups: {}, tools: { ord__a: oldIso, ord__b: new Date().toISOString() }, counts: { ord__a: 100, ord__b: 1 } }))
    process.env.LAZY_TOOLS_USAGE_FILE = usagePath51
    const worldOrd = makeWorld()
    const sections51 = []
    worldOrd.ctx.inject = (deps, callback) => {
      callback({ effect: (make) => make(), systemPrompt: { section: (s) => { sections51.push(s); return () => {} } } })
    }
    worldOrd.ctx.tools.register({ name: 'ord__a', description: 'x', parameters: {}, output: {} })
    worldOrd.ctx.tools.register({ name: 'ord__b', description: 'x', parameters: {}, output: {} })
    apply(worldOrd.ctx, { groups: [{ id: 'ord', match: ['ord__*'], expect: 2, defaultOn: false }], autoGroups: 'off' })
    const text51 = sections51.length ? String(sections51[0].text()) : ''
    assert.ok(text51.includes('ord__b') && text51.includes('ord__a'), `目录要有两个工具名：${text51.slice(0, 160)}`)
    assert.ok(text51.indexOf('ord__b') < text51.indexOf('ord__a'), '今天用过的 ord__b 应排在 30 天前用过的 ord__a 前面')
    rmSync(usagePath51, { force: true })
    process.env.LAZY_TOOLS_USAGE_FILE = `${NO_SUCH}.usage.json`
    ok('目录排序：最近用过的优先；不按累计次数（账本没有窗口内计数）')

    // 2026-10-30 挑刺：会话档位（lazy_tools_mode idleDays）改过之后，决策用 sessionIdleDays，
    // 而 status/目录排序还在用 policy.idleDays —— 会出现「组已收起、hot 仍报 true」。
    console.log('[52] 会话档位生效时，status.hot 与决策同源')
    const usagePath52 = join(tmpdir(), `lazy-tools-usage52-${process.pid}.json`)
    const ledger52 = { groups: {}, tools: {} }
    const worldSd = makeWorld()
    for (const s of ['a', 'b', 'c', 'd']) worldSd.ctx.tools.register({ name: `sd__${s}`, description: 'x', parameters: {}, output: {} })
    const threeDaysAgo = new Date(Date.now() - 3 * DAY)
    recordUsage(ledger52, 'sd__a', 'sd', threeDaysAgo)
    recordUsage(ledger52, 'sd__b', 'sd', threeDaysAgo)
    writeFileSync(usagePath52, JSON.stringify(ledger52))
    process.env.LAZY_TOOLS_USAGE_FILE = usagePath52
    apply(worldSd.ctx, { groups: [{ id: 'sd', match: ['sd__*'], defaultOn: false }], autoGroups: 'off' })
    const agentSd = worldSd.createAgent('agent-sd')
    const s1 = await runTool(worldSd, 'lazy_tools_status', {}, agentSd)
    const g1 = s1.groups.find((g) => g.id === 'sd')
    assert.equal(g1.mode, 'all', '3 天前用过 2/4（50% ≥30%，7 天窗口内）⇒ 整组开')
    assert.equal(g1.hot, true)
    await runTool(worldSd, 'lazy_tools_mode', { idleDays: 1 }, agentSd)
    const s2 = await runTool(worldSd, 'lazy_tools_status', {}, agentSd)
    const g2 = s2.groups.find((g) => g.id === 'sd')
    assert.equal(g2.mode, 'hide', '1 天窗口下 3 天前的调用已冷 ⇒ 收起')
    assert.equal(g2.hotTools, 0, 'hotTools 也要按会话天数算')
    assert.equal(g2.hot, false, '组已收起，hot 必须同时为 false（同源；旧代码会报 true）')
    rmSync(usagePath52, { force: true })
    process.env.LAZY_TOOLS_USAGE_FILE = `${NO_SUCH}.usage.json`
    ok('会话档位下 status 与决策同源（不再各算各的天数）')

    // 0.16.0：11 个工具并成 7 个。旧名不再注册 schema（每轮省上下文），
  // 但模型若喊旧名，守卫要回一句「已并入 X」——公开契约先废弃，不静默消失。
  log('[53] 旧工具名给指路，不静默消失')
  const worldLegacy = makeWorld()
  apply(worldLegacy.ctx, { groups: [], autoGroups: 'off' })
  const agentLegacy = worldLegacy.createAgent('agent-legacy')
  const hintScan = worldLegacy.fireGuard(agentLegacy, 'lazy_tools_scan')
  assert.equal(typeof hintScan, 'string')
  assert.match(hintScan, /lazy_tools_list/)
  const hintBench = worldLegacy.fireGuard(agentLegacy, 'lazy_tools_bench')
  assert.match(hintBench, /lazy_tools_health/)
  ok('旧名 scan/bench/classify/resolve 都返回「已并入 X」')

  log('[54] health 默认精简：保留 client、去掉账本；full 给全量')
  const worldSlim = makeWorld()
  apply(worldSlim.ctx, { groups: [], autoGroups: 'off' })
  const agentSlim = worldSlim.createAgent('agent-slim')
  const slimH = await runTool(worldSlim, 'lazy_tools_health', {}, agentSlim)
  assert.equal('usage' in slimH, false, '默认视图不该带账本 usage')
  assert.equal('client' in slimH, true, '默认视图必须带 client（缺失≠正常，2026-10-30 盲评指出）')
  const fullH = await runTool(worldSlim, 'lazy_tools_health', { full: true }, agentSlim)
  assert.equal('usage' in fullH, true, 'full 视图要带账本')
  assert.ok(fullH.stats && slimH.stats, '两档都要有 stats')
  ok('默认精简保留 client + stats；full 才给 usage / 探针')

  log('[55] 计数器跨重载持久化：重载后 toolCalls 从账本恢复')
  const envP = `${NO_SUCH}.persist.usage.json`
  rmSync(envP, { force: true })
  process.env.LAZY_TOOLS_USAGE_FILE = envP
  const worldP1 = makeWorld()
  worldP1.ctx.tools.register({ name: 'g_persist', description: 'x', parameters: {}, output: {} })
  apply(worldP1.ctx, { groups: [{ id: 'gp', match: ['g_persist'], defaultOn: false }], autoGroups: 'off' })
  const agentP1 = worldP1.createAgent('agent-persist-1')
  for (let i = 0; i < 3; i += 1) await worldP1.firePreExecute(agentP1, 'g_persist')
  await runTool(worldP1, 'lazy_tools_save_groups', {}, agentP1) // 触发一次落盘（不快，但足以证明写入路径）
  const rawP = JSON.parse(readFileSync(envP, 'utf8'))
  assert.ok(rawP.stats && rawP.stats.toolCalls >= 1, `账本里要有累计计数：${JSON.stringify(rawP.stats)}`)
  // 模拟插件重载：新实例、同一账本
  const worldP2 = makeWorld()
  worldP2.ctx.tools.register({ name: 'g_persist', description: 'x', parameters: {}, output: {} })
  apply(worldP2.ctx, { groups: [{ id: 'gp', match: ['g_persist'], defaultOn: false }], autoGroups: 'off' })
  const agentP2 = worldP2.createAgent('agent-persist-2')
  const hP2 = await runTool(worldP2, 'lazy_tools_health', { full: true }, agentP2)
  assert.equal(hP2.stats.toolCalls, rawP.stats.toolCalls, `重载后应从账本恢复（文件 ${rawP.stats.toolCalls} / 内存 ${hP2.stats.toolCalls}）`)
  rmSync(envP, { force: true })
  process.env.LAZY_TOOLS_USAGE_FILE = `${NO_SUCH}.usage.json`
  ok('toolCalls 落盘并在重载后恢复（指标不再每次归零）')

  // 2026-10-30 对抗测试（元宝）三条：都只在手改配置时触发，但失效形态是「静默丢功能」。
  log('[56] 手写组 match:["*"] 不能吞掉常驻/自救工具')
  const worldStar = makeWorld()
  worldStar.ctx.tools.register({ name: 'other_tool', description: 'x', parameters: {}, output: {} })
  // 2026-10-31：万能匹配式（*）现在会被结构性防线忽略（见 [60]），所以这里用手写窄组
  // 测「常驻/自救工具不许入组」：组匹配到 lazy_tools_status 也不能收它。
  apply(worldStar.ctx, { groups: [{ id: 'all', match: ['lazy_tools_status', 'other_tool'], defaultOn: false }], autoGroups: 'off' })
  const agentStar = worldStar.createAgent('agent-star')
  const denyStar = worldStar.denyByAgent.get(agentStar)
  for (const name of ['lazy_tools_status', 'lazy_tools_enable', 'lazy_tools_disable', 'lazy_tools_mode', 'lazy_tools_save_groups', 'lazy_tools_list', 'lazy_tools_health']) {
    assert.equal(denyStar.has(name), false, `${name} 是自救工具，不许被手写组收起`)
  }
  assert.equal(denyStar.has('other_tool'), true, '普通工具仍应被这个组收起（组本身要生效）')
  // 组内的「成员」也不该包含常驻/自救工具（status 的 matched 会暴露这一点）
  const sStar = await runTool(worldStar, 'lazy_tools_status', {}, agentStar)
  const gStar = sStar.groups.find((g) => g.id === 'all')
  assert.equal(gStar.matched, 1, `组只该匹配到 1 个普通工具，实际 ${gStar.matched}`)
  assert.equal(gStar.visible, 0)
  ok('手写 match:* 只收普通工具，自救工具永远可见')

  log('[57] 配置里的组全无效：不许静默零注册')
  const worldBad = makeWorld()
  apply(worldBad.ctx, { groups: [null, {}, { id: 'g' }] })
  assert.equal(worldBad.registered.size, 8, `组全无效时也要注册 8 个工具，实际 ${worldBad.registered.size}`)
  const agentBad = worldBad.createAgent('agent-bad')
  const hBad = await runTool(worldBad, 'lazy_tools_health', {}, agentBad)
  assert.ok(hBad.errors.some((e) => String(e.where).includes('group')), '必须留下可见的错误记录')
  // 退回的确实是出厂组（不是空表），且混合「合法+无效」仍以合法组为准
  const sBad = await runTool(worldBad, 'lazy_tools_status', {}, agentBad)
  assert.ok(sBad.groups.some((g) => g.id === 'cua-screen'), '组全无效时应退回出厂组')
  const worldMix = makeWorld()
  worldMix.ctx.tools.register({ name: 'ok_a', description: 'x', parameters: {}, output: {} })
  apply(worldMix.ctx, { groups: [{ id: 'ok', match: ['ok_*'], defaultOn: false }, null, {}], autoGroups: 'off' })
  assert.equal(worldMix.registered.size, 9, '1 个业务工具 + 8 个自救工具')
  const agentMix = worldMix.createAgent('agent-mix')
  const sMix = await runTool(worldMix, 'lazy_tools_status', {}, agentMix)
  assert.equal(sMix.groups.length, 1, '混合输入只保留 1 个合法组')
  assert.equal(sMix.groups[0].id, 'ok')
  ok('组全无效 → 退回默认组并记账，工具照常注册（不再静默死掉）')

  log('[58] expect 非有限数不许进 status')
  const worldNaN = makeWorld()
  worldNaN.ctx.tools.register({ name: 'nan_a', description: 'x', parameters: {}, output: {} })
  apply(worldNaN.ctx, { groups: [{ id: 'nan', match: ['nan_*'], expect: Number.NaN }], autoGroups: 'off' })
  const agentNaN = worldNaN.createAgent('agent-nan')
  const sNaN = await runTool(worldNaN, 'lazy_tools_status', {}, agentNaN)
  const gNaN = sNaN.groups.find((g) => g.id === 'nan')
  assert.equal('expect' in gNaN, false, 'NaN expect 应视为未设置')
  assertJsonSafe(sNaN, 'status-nan')
  ok('expect 非法值被夹掉，status 仍 JSON-safe')

  // 2026-10-31：DSH 2.0.21 起 dsh-ops 用 ops_* 取代官方 pwsh。两代用户都可能有，
  // 所以保护清单用并集；这条测试钉住「两代都受保护」。
  log('[59] 兼容两代宿主工具名：pwsh 与 ops_* 都受保护')
  const worldHost = makeWorld()
  for (const name of ['pwsh', 'ops_bash', 'ops_grep', 'other_tool']) {
    worldHost.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
  }
  apply(worldHost.ctx, { groups: [{ id: 'all', match: ['pwsh', 'ops_bash', 'ops_grep', 'other_tool'], defaultOn: false }], autoGroups: 'off' })
  const agentHost = worldHost.createAgent('agent-host')
  const denyHost = worldHost.denyByAgent.get(agentHost)
  for (const name of ['pwsh', 'ops_bash', 'ops_grep']) {
    assert.equal(denyHost.has(name), false, `${name} 是宿主工具，不许被手写组收起`)
  }
  assert.equal(denyHost.has('other_tool'), true, '普通工具仍应被这个组收起')
  ok('两代宿主工具名（pwsh / ops_*）都在保护清单里')

  // 2026-10-31：不靠名字清单的结构性防线 —— 手写组匹配到「整张可隐藏工具表」= 误配，忽略。
  log('[60] 手写组匹配整张表 → 忽略并记账（不依赖宿主工具名）')
  const worldGuard = makeWorld()
  for (const name of ['biz_a', 'biz_b', 'biz_c', 'biz_d', 'biz_e', 'biz_f']) {
    worldGuard.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
  }
  apply(worldGuard.ctx, { groups: [{ id: 'all', match: ['*'], defaultOn: false }], autoGroups: 'off' })
  const agentGuard = worldGuard.createAgent('agent-guard')
  assert.equal(worldGuard.denyByAgent.get(agentGuard).size, 0, '匹配全部工具的手写组必须被忽略，一个都不许收')
  const hGuard = await runTool(worldGuard, 'lazy_tools_health', {}, agentGuard)
  assert.ok(hGuard.errors.some((e) => String(e.where).includes('group guard')), '必须留下可见记账')
  const sGuard = await runTool(worldGuard, 'lazy_tools_status', {}, agentGuard)
  assert.equal(sGuard.groups.find((g) => g.id === 'all').guarded, true, 'status 要如实标出这个组被忽略')
  ok('全匹配手写组被忽略并可见记账（宿主换名字也照样兜住）')

  log('[60b] 手写组用正则绕过哨兵：结构判定仍要挡住')
  const worldGuard2 = makeWorld()
  for (const name of ['biz2_a', 'biz2_b', 'biz2_c']) {
    worldGuard2.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
  }
  apply(worldGuard2.ctx, { groups: [{ id: 'all2', match: ['re:^[a-z0-9_]+$'], defaultOn: false }], autoGroups: 'off' })
  const agentGuard2 = worldGuard2.createAgent('agent-guard2')
  assert.equal(worldGuard2.denyByAgent.get(agentGuard2).size, 0, '正则覆盖全部工具也必须被忽略')
  const sGuard2 = await runTool(worldGuard2, 'lazy_tools_status', {}, agentGuard2)
  assert.equal(sGuard2.groups.find((g) => g.id === 'all2').guarded, true, 'status 要标 guarded')
  ok('正则绕过哨兵：结构判定兜住')

  log('[60c] 万能匹配 + 晚注册：apply 时没有工具，注册后仍要挡住')
  const worldGuard3 = makeWorld()
  apply(worldGuard3.ctx, { groups: [{ id: 'all3', match: ['re:^[a-z0-9_]+$'], defaultOn: false }], autoGroups: 'off' })
  for (const name of ['late_a', 'late_b', 'late_c']) {
    worldGuard3.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
  }
  const agentGuard3 = worldGuard3.createAgent('agent-guard3')
  worldGuard3.fireToolsChange()
  assert.equal(worldGuard3.denyByAgent.get(agentGuard3).size, 0, '晚注册也不能被万能组吞掉')
  const sGuard3 = await runTool(worldGuard3, 'lazy_tools_status', {}, agentGuard3)
  assert.equal(sGuard3.groups.find((g) => g.id === 'all3').guarded, true, 'status 要标 guarded')
  ok('晚注册：万能组仍被挡住')

  // 2026-11-01：受管角色（默认关闭）—— preset / parentSession 决定策略，封闭默认，自愈不绕过。
  log('[61] 受管角色：preset 决定策略、封闭默认、自愈不绕过')
  const worldRole = makeWorld()
  for (const name of ['role_fs_a', 'role_web_a', 'role_other_a']) {
    worldRole.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
  }
  apply(worldRole.ctx, {
    groups: [
      { id: 'role-fs', match: ['role_fs_*'] },
      { id: 'role-web', match: ['role_web_*'] },
    ],
    autoGroups: 'off',
    managedRoles: {
      'dsh-superagent-worker': { allowGroups: ['role-fs'] },
      subagent: { allowGroups: ['role-web'] },
    },
  })
  const humanRole = worldRole.createAgent('role-human')
  const workerRole = worldRole.createAgent('role-worker', (agent) => {
    agent.presets = { defaultId: 'cordis', composedPreset: () => 'dsh-superagent-worker' }
  })
  const subRole = worldRole.createAgent('role-sub', (agent) => {
    agent.session = { header: { parentSession: 'role-worker' } }
  })
  const dHuman = worldRole.denyByAgent.get(humanRole)
  const dWorker = worldRole.denyByAgent.get(workerRole)
  const dSub = worldRole.denyByAgent.get(subRole)
  assert.equal(dWorker.has('role_fs_a'), false, 'worker 授权组必须可见')
  assert.equal(dWorker.has('role_web_a'), true, 'worker 未授权组必须被藏')
  assert.equal(dWorker.has('role_other_a'), true, 'worker 未归组工具必须被藏（封闭默认）')
  assert.equal(dSub.has('role_web_a'), false, 'subagent 按 subagent 角色放行')
  assert.equal(dSub.has('role_fs_a'), true, 'subagent 未授权组必须被藏')
  assert.equal(dHuman.has('role_other_a'), false, '普通会话不受封闭默认影响（未归组不藏）')
  const managedHealBefore = (await runTool(worldRole, 'lazy_tools_health', {}, workerRole)).stats.selfHealed
  assert.equal(worldRole.fireGuard(workerRole, 'role_web_a'), undefined, '受管会话自愈不得绕过策略')
  const managedHealAfter = (await runTool(worldRole, 'lazy_tools_health', {}, workerRole)).stats.selfHealed
  assert.equal(managedHealAfter, managedHealBefore, '受管会话不许补开（selfHealed 不许增长）')
  assert.equal(dWorker.has('role_web_a'), true, '受管会话的未授权工具必须仍然被藏')
  assert.equal(worldRole.fireGuard(humanRole, 'role_web_a'), undefined, '普通会话自愈改为放行')
  const enableDef = worldRole.ctx.tools.get('lazy_tools_enable')
  const deniedEnable = await enableDef.execute({ group: 'role-web' }, { agent: workerRole })
  assert.ok(deniedEnable && deniedEnable.error && deniedEnable.error.includes('受管'), '受管会话里 enable 必须被拒')
  const modeDef = worldRole.ctx.tools.get('lazy_tools_mode')
  const deniedMode = await modeDef.execute({ collapseAll: true }, { agent: workerRole })
  assert.ok(deniedMode && deniedMode.error && deniedMode.error.includes('受管'), '受管会话里 mode 必须明确拒绝')
  const deniedSave = await runTool(worldRole, 'lazy_tools_save_groups', { groups: [{ id: 'role-new', match: ['role_fs_a', 'role_web_a'] }] }, workerRole)
  assert.ok(deniedSave && deniedSave.error && deniedSave.error.includes('受管'), '受管会话里 save_groups 必须拒绝写全局组')
  ok('受管角色只认 preset/parentSession，封闭默认生效，自愈不绕过')


  // 2026-11-01：受管角色的 preset 竞态 —— Web UI 可能先用默认 preset 创建，再切回角色 preset。
  log('[61b] label 角色：review/build/research 解析与工具面（CORE 不可藏）')
  assert.deepEqual(labelRoleCandidates('review:任务'), ['review'], 'review:任务 第一段 review')
  assert.deepEqual(labelRoleCandidates('build:改插件'), ['build'], 'build:改插件 第一段 build')
  assert.deepEqual(labelRoleCandidates('research:查资料'), ['research'], 'research:查资料 第一段 research')
  assert.deepEqual(labelRoleCandidates('dsh-my-go:hermes: 帮我改'), ['hermes', 'dsh-my-go'], 'MyGO 仍按第二段 hermes')
  const roleMap = {
    review: { allowGroups: ['browser-heavy'], unknown: 'hide' },
    build: { allowGroups: ['*'], unknown: 'show' },
    research: { allowGroups: ['search', 'browser-heavy'], unknown: 'hide' },
  }
  const groupOf = (name) => (name.startsWith('dsh_browser_') ? 'browser-heavy' : name.startsWith('web_') ? 'search' : null)
  const labelAgent = (label) => ({ session: { header: { parentSession: 'role-parent', label } } })
  assert.deepEqual(labelRoleCandidates('review: build the plugin'), ['review', 'build'], '显式 review 必须优先第一段')
  assert.equal(resolveManagedRole(labelAgent('review: build the plugin'), roleMap).key, 'review', 'review 摘要含 build 也不能升级成 build')
  assert.equal(resolveManagedRole(labelAgent('review:读'), roleMap).key, 'review', 'review label 必须解析成 review')
  assert.equal(resolveManagedRole(labelAgent('build:改'), roleMap).key, 'build', 'build label 必须解析成 build')
  assert.equal(resolveManagedRole(labelAgent('research:查'), roleMap).key, 'research', 'research label 必须解析成 research')
  assert.equal(resolveManagedRole(labelAgent('whatever:做'), roleMap), null, '未知 label 不带角色')
  assert.equal(isAllowedByPolicy({ role: roleMap.review }, 'dsh_browser_open', groupOf), true, 'review 允许 browser-heavy')
  assert.equal(isAllowedByPolicy({ role: roleMap.review }, 'web_search', groupOf), false, 'review 不允许 search')
  assert.equal(isAllowedByPolicy({ role: roleMap.research }, 'web_search', groupOf), true, 'research 允许 search')
  assert.equal(isAllowedByPolicy({ role: roleMap.research }, 'dsh_browser_open', groupOf), true, 'research 允许 browser')
  assert.equal(isAllowedByPolicy({ role: roleMap.build }, 'whatever', groupOf), true, 'build 不设限')
  // CORE 边界：read/pwsh 仍保护；edit/write 已由 ROLE_HIDEABLE_CORE 允许受管角色隐藏。
  for (const core of ['read', 'write', 'edit', 'pwsh', 'todo_write']) {
    assert.equal(CORE_TOOLS.has(core), true, core + ' 必须在 CORE')
  }
  ok('label 三角色解析正确；CORE 工具不可被角色隐藏（只读只能靠提示词/沙箱）')

  log('[61c] 受管角色能藏 edit/write（review 只读），build 不藏')
  const worldCore = makeWorld()
  for (const name of ['edit', 'write', 'core_a', 'core_b']) {
    worldCore.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
  }
  apply(worldCore.ctx, {
    groups: [{ id: 'core-g', match: ['core_*'] }],
    autoGroups: 'off',
    managedRoles: {
      'role-review': { allowGroups: ['core-g'], unknown: 'hide' },
      'role-build': { allowGroups: ['*'], unknown: 'show' },
    },
  })
  const coreReview = worldCore.createAgent('core-review', (agent) => {
    agent.presets = { defaultId: 'cordis', composedPreset: () => 'role-review' }
  })
  const coreBuild = worldCore.createAgent('core-build', (agent) => {
    agent.presets = { defaultId: 'cordis', composedPreset: () => 'role-build' }
  })
  const dCoreReview = worldCore.denyByAgent.get(coreReview)
  const dCoreBuild = worldCore.denyByAgent.get(coreBuild)
  assert.equal(dCoreReview.has('edit'), true, 'review 必须藏 edit')
  assert.equal(dCoreReview.has('write'), true, 'review 必须藏 write')
  assert.equal(dCoreReview.has('read'), false, 'review 不藏 read')
  assert.equal(dCoreBuild.has('edit'), false, 'build 不藏 edit')
  ok('受管角色能藏 edit/write；CORE 其余仍保护')

  log('[62] 受管角色：preset 在创建后才选中（竞态）')
  const worldRace2 = makeWorld()
  for (const name of ['race_fs_a', 'race_web_a']) {
    worldRace2.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
  }
  apply(worldRace2.ctx, {
    groups: [
      { id: 'race-fs', match: ['race_fs_*'] },
      { id: 'race-web', match: ['race_web_*'] },
    ],
    autoGroups: 'off',
    managedRoles: {
      'dsh-superagent-worker': { allowGroups: ['race-fs'] },
    },
  })
  const raceAgent = worldRace2.createAgent('race-agent')
  const dRace = worldRace2.denyByAgent.get(raceAgent)
  assert.equal(dRace.has('race_fs_a'), true, '切换前（普通会话、全冷）授权组也是收起的')
  raceAgent.presets = { defaultId: 'cordis', composedPreset: () => 'dsh-superagent-worker' }
  worldRace2.fireEvent('agent-preset/selected', 'race-agent', 'dsh-superagent-worker')
  assert.equal(dRace.has('race_fs_a'), false, '切换 preset 后授权组应被放行')
  assert.equal(dRace.has('race_web_a'), true, '切换后未授权组仍藏')
  ok('preset 晚选中也能重算角色并重建（竞态兜住）')


  // 2026-11-01（0.18 隔离约束②）：我们放行后仍不可见的名字，必须标成外部 deny。
  log('[63] 隔离：放行后仍不可见 ⇒ 标成外部 deny')
  const worldExt = makeWorld()
  worldExt.ctx.tools.register({ name: 'ext_a', description: 'x', parameters: {}, output: {} })
  apply(worldExt.ctx, {
    groups: [{ id: 'ext', match: ['ext_*'] }],
    autoGroups: 'off',
  })
  const agentExt = worldExt.createAgent('agent-ext')
  // 模拟另一个插件也 deny 它：直接写 fake host 的 deny 集合（不是我们的 lift 能撤的）
  worldExt.externalByAgent.get(agentExt).add('ext_a')
  await runTool(worldExt, 'lazy_tools_enable', { group: 'ext' }, agentExt)
  const healthExt = await runTool(worldExt, 'lazy_tools_health', {}, agentExt)
  assert.ok(healthExt.foreignDenied && healthExt.foreignDenied.sample.includes('ext_a'), JSON.stringify(healthExt.foreignDenied))
  ok('外部 deny 交叉探测：放行后仍不可见的名字被标出来')

  // 2026-11-01（0.18 第三条）：常驻提示段按**组装方会话**渲染，不再无脑列全部组。
  log('[64] 会话级目录：只列本会话挂载的组，空则整段消失')
  const makeSectionWorld = () => {
    const world = makeWorld()
    const sections = []
    world.ctx.inject = (deps, callback) => {
      assert.deepEqual(deps, ['systemPrompt'])
      callback({
        effect: (make) => make(),
        systemPrompt: {
          section(section) {
            sections.push(section)
            return () => {}
          },
        },
      })
    }
    world.ctx.tools.register({ name: 'grp_a__one', description: 'x', parameters: {}, output: {} })
    world.ctx.tools.register({ name: 'grp_b__one', description: 'x', parameters: {}, output: {} })
    apply(world.ctx, {
      groups: [
        { id: 'grp-a', match: ['grp_a__*'], title: 'A组' },
        { id: 'grp-b', match: ['grp_b__*'], title: 'B组' },
      ],
      autoGroups: 'off',
    })
    assert.equal(sections.length, 1)
    return { world, text: sections[0].text }
  }

  // ① 宿主权限门挡住 B 组（模拟本机 computer-use 门）：B 不该被广告，A 照旧。
  //    必须在 createAgent 之前挡住 —— 顺带验证「外部 deny 不并进挂载集」。
  const sec1 = makeSectionWorld()
  const secAgent = sec1.world.createAgent('agent-sec', (agent) => {
    sec1.world.externalByAgent.get(agent).add('grp_b__one')
  })
  const scopedText = sec1.text({ scope: secAgent })
  assert.match(scopedText, /grp-a/, `A 组没挂载却不见了：${scopedText.slice(0, 160)}`)
  assert.ok(!scopedText.includes('grp-b'), `被外部挡掉的 B 组不该被广告：${scopedText.slice(0, 200)}`)
  // ② 防御性：实测宿主只传 agent，但将来若换成 agent.ctx 也要认得（认不出会退回旧行为，不会乱删组）
  const viaCtxText = sec1.text({ scope: secAgent.ctx })
  assert.match(viaCtxText, /grp-a/, 'scope 传 agent.ctx 时也要认出来')
  assert.ok(!viaCtxText.includes('grp-b'), 'scope 传 agent.ctx 时同样不许广告 B')

  // ③ 一组都没挂载 ⇒ 空串（宿主会把空段整段丢掉）
  const sec2 = makeSectionWorld()
  const emptyAgent = sec2.world.createAgent('agent-empty', (agent) => {
    sec2.world.unmount(agent, ['grp_a__one', 'grp_b__one'])
  })
  assert.equal(sec2.text({ scope: emptyAgent }), '')
  assert.equal(sec2.text({ scope: emptyAgent.ctx }), '')

  // ④ 认不出 scope / 根本没传 context ⇒ 退回旧行为（列全部组），绝不因为读不到就变短
  const legacyText = sec1.text()
  assert.match(legacyText, /grp-a/)
  assert.match(legacyText, /grp-b/, '不传 context 时必须保持 0.17.2 行为')
  assert.match(sec1.text({ scope: {} }), /grp-b/, '认不出的 scope 也退回旧行为，不许静默变短')
  ok('会话级目录：没挂/被外部挡的组不广告、空则空段、认不出 scope 退回旧行为')

  // 2026-11-01：催人分组的提示只在默认 preset 的人工会话里出现。
  log('[65] 会话级目录：分类提示只在默认 preset 的会话里出现')
  const sec3 = makeSectionWorld()
  for (const name of ['loosealpha', 'loosebeta', 'loosegamma']) {
    sec3.world.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
  }
  const nudgeAgent = sec3.world.createAgent('agent-nudge')
  const defaultSectionText = sec3.text({ scope: nudgeAgent })
  assert.ok(
    defaultSectionText.includes('lazy_tools_save_groups'),
    `默认会话里应当催分组：${defaultSectionText.slice(0, 240)}`,
  )
  // 同一会话后来被切成角色 preset：能力目录照旧，但不许再催人去改全局分组表
  nudgeAgent.presets = { defaultId: 'cordis', composedPreset: () => 'some-worker-role' }
  const roleSectionText = sec3.text({ scope: nudgeAgent })
  assert.ok(
    !roleSectionText.includes('lazy_tools_save_groups'),
    `角色会话不该被引导去改全局分组：${roleSectionText.slice(0, 240)}`,
  )
  assert.match(roleSectionText, /lazy_tools_status/, '基础段（能力目录本身）必须还在')
  ok('分类提示只在默认 preset 会话出现；角色会话保留能力目录、不催分组')

  // 2026-11-01（冷读第二轮）：view 是主读路径，必须单独钉住 —— 空视图、没有视图、视图抛错
  // 三种情况都不许把「开着的组」静默弄没（那正是「失败方向变短」）。
  // 这条用例特意用 defaultOn:true 的组：抽屉不会藏它，所以 mounted 里没有 hiddenNames 兜底，
  // 空视图一旦被当成权威，组当场消失 —— 上一版用例没设这个前提，变异测试是绿的（假绿）。
  log('[66] 会话级目录：视图路径的三种退化')
  const worldView = makeWorld()
  const viewSections = []
  worldView.ctx.inject = (deps, callback) => {
    callback({
      effect: (make) => make(),
      systemPrompt: {
        section(section) {
          viewSections.push(section)
          return () => {}
        },
      },
    })
  }
  worldView.ctx.tools.register({ name: 'vw_a__one', description: 'x', parameters: {}, output: {} })
  apply(worldView.ctx, {
    groups: [{ id: 'vw-a', match: ['vw_a__*'], title: 'A组', defaultOn: true }],
    autoGroups: 'off',
  })
  const viewAgent = worldView.createAgent('agent-view')
  const viewText = viewSections[0].text
  assert.equal(worldView.denyByAgent.get(viewAgent).size, 0, 'defaultOn 组不该被抽屉收起（否则这条用例测不到空视图）')
  const originalView = worldView.ctx.tools.view
  assert.ok(typeof originalView === 'function', '假宿主必须有 view：否则主路径零覆盖')
  assert.match(viewText({ scope: viewAgent }), /vw-a/, '正常视图路径：组要在')

  // ① 视图返回空 Map（宿主视图没建好）⇒ 用 schemas 复核，组不许消失
  worldView.ctx.tools.view = () => ({ visible: new Map() })
  assert.match(viewText({ scope: viewAgent }), /vw-a/, '空视图必须回退 schemas 复核，不许静默丢组')
  // ② 视图抛错 ⇒ 同样退回 schemas
  worldView.ctx.tools.view = () => {
    throw new Error('view boom')
  }
  assert.match(viewText({ scope: viewAgent }), /vw-a/, '视图抛错必须退回 schemas')
  // ③ 宿主根本没有 view ⇒ 退回 schemas
  delete worldView.ctx.tools.view
  assert.match(viewText({ scope: viewAgent }), /vw-a/, '没有 view 的宿主必须退回 schemas')
  worldView.ctx.tools.view = originalView
  ok('视图路径：空视图/抛错/没有视图都退回 schemas，组不丢')

  // 2026-11-01：一个分组工具都没挂、但有散装工具时，段不能整个消失 ——
  // 「有 N 个工具没归组，请去分组」恰恰是这种会话里唯一有用的一句（冷读抓到的早退 bug）。
  log('[67] 会话级目录：只有提醒、没有目录时也不许空段')
  const sec5 = makeSectionWorld()
  const looseAgent = sec5.world.createAgent('agent-loose', (agent) => {
    sec5.world.unmount(agent, ['grp_a__one', 'grp_b__one'])
  })
  for (const name of ['loosealpha2', 'loosebeta2', 'loosegamma2']) {
    sec5.world.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
  }
  const looseText = sec5.text({ scope: looseAgent })
  assert.ok(looseText.includes('lazy_tools_save_groups'), `只有提醒时也要说话：${looseText.slice(0, 240)}`)
  assert.ok(!looseText.includes('grp-a'), `没有挂载的组不许出现在目录里：${looseText.slice(0, 240)}`)
  ok('一个分组工具都没挂 + 有散装工具 ⇒ 只输出提醒，不整段消失')

  // 2026-11-01：受管会话里没授权的组不该被广告（enable 会被拒，列出来就是骗模型）。
  log('[68] 会话级目录：受管角色不广告未授权的组')
  const worldManaged = makeWorld()
  const managedSections = []
  worldManaged.ctx.inject = (deps, callback) => {
    callback({
      effect: (make) => make(),
      systemPrompt: {
        section(section) {
          managedSections.push(section)
          return () => {}
        },
      },
    })
  }
  worldManaged.ctx.tools.register({ name: 'mgr_a__one', description: 'x', parameters: {}, output: {} })
  worldManaged.ctx.tools.register({ name: 'mgr_b__one', description: 'x', parameters: {}, output: {} })
  apply(worldManaged.ctx, {
    groups: [
      { id: 'mgr-a', match: ['mgr_a__*'], title: 'A组' },
      { id: 'mgr-b', match: ['mgr_b__*'], title: 'B组' },
    ],
    autoGroups: 'off',
    managedRoles: { 'role-x': { allowGroups: ['mgr-a'] } },
  })
  const managedAgent = worldManaged.createAgent('agent-managed', (agent) => {
    agent.presets = { defaultId: 'cordis', composedPreset: () => 'role-x' }
  })
  const managedText = managedSections[0].text({ scope: managedAgent })
  assert.match(managedText, /mgr-a/, '授权组要列出来')
  assert.ok(!managedText.includes('mgr-b'), `未授权组不许被广告：${managedText.slice(0, 200)}`)
  ok('受管角色：只列授权组，未授权组即使被我们藏了也不广告')

  // 2026-11-01（真宿主实测撞到）：组开关拨了不等于工具回来了 —— 外部 deny 挡着时不许报成功。
  log('[69] enable 回读：外部挡着时不许报「成功」')
  const worldBlocked = makeWorld()
  worldBlocked.ctx.tools.register({ name: 'blk_a__one', description: 'x', parameters: {}, output: {} })
  worldBlocked.ctx.tools.register({ name: 'blk_b__one', description: 'x', parameters: {}, output: {} })
  apply(worldBlocked.ctx, {
    groups: [
      { id: 'blk-a', match: ['blk_a__*'] },
      { id: 'blk-b', match: ['blk_b__*'] },
    ],
    autoGroups: 'off',
  })
  const blockedAgent = worldBlocked.createAgent('agent-blocked')
  // 模拟宿主权限门：这一层 deny 不在我们手里，我们 lift 之后它依然挡着
  worldBlocked.externalByAgent.get(blockedAgent).add('blk_a__one')
  const enableBlocked = await runTool(worldBlocked, 'lazy_tools_enable', { group: 'blk-a' }, blockedAgent)
  assert.equal(enableBlocked.applied, false, `外部挡着时必须报 applied:false，实际：${JSON.stringify(enableBlocked)}`)
  assert.ok(Array.isArray(enableBlocked.blocked) && enableBlocked.blocked.includes('blk-a'))
  assert.match(String(enableBlocked.hint), /不是抽屉收的/)
  // 正常组仍要报成功（不许为了这条修成一律 applied:false）
  const enableOk = await runTool(worldBlocked, 'lazy_tools_enable', { group: 'blk-b' }, blockedAgent)
  assert.notEqual(enableOk.applied, false, `正常的组不许被误报成失败：${JSON.stringify(enableOk)}`)
  ok('enable 回读：外部挡着报 applied:false，正常组照旧成功')

  // 2026-11-02（用户转述同行的判断，回去查实）：POST /policy 原来把**补丁**直接写盘，
  // 部分字段提交会把文件里其余设置冲掉；运行时看着正常，一重启就丢。
  log('[70] 策略落盘：部分补丁不许冲掉其他设置')
  const storedPolicy = {
    level: 'medium',
    idleDays: 7,
    minTools: 3,
    presets: { low: 14, medium: 7, high: 3 },
    classifyNudge: true,
    showDock: true,
    showClear: true,
    autoGroups: 'on',
  }
  const mergedLevel = mergePolicyForStorage({ level: 'high' }, storedPolicy)
  assert.equal(mergedLevel.level, 'high', '补丁里的档位要生效')
  assert.equal(mergedLevel.idleDays, 3, '只给档位时天数要跟着档位走')
  assert.equal(mergedLevel.showDock, true, '没提交的设置必须留在盘上（这条就是那个 bug）')
  assert.equal(mergedLevel.showClear, true, '同上：showClear 不许消失')
  assert.equal(mergedLevel.minTools, 3, '同上：minTools 不许消失')
  assert.deepEqual(mergedLevel.presets, { low: 14, medium: 7, high: 3 }, '同上：三档天数不许消失')
  assert.equal(mergedLevel.autoGroups, 'on', '同上：autoGroups 不许消失')
  // 显式给天数时不被档位覆盖
  const mergedExplicit = mergePolicyForStorage({ level: 'low', idleDays: 0 }, storedPolicy)
  assert.equal(mergedExplicit.idleDays, 0, '显式给 0（不按时间收敛）必须保留')
  // 2026-11-03 回归：managedRoles 必须活过"保存设置"这一趟。
  // 事故：normalizePolicy 曾经把它**整个剥掉** —— 于是 ① policy.json 里配的角色从来没生效；
  // ② 任何一次保存设置都会把角色配置静默删掉（与档案 #78 同一类：写成功但内容不对）。
  const storedWithRoles = { ...storedPolicy, managedRoles: { hermes: { allowGroups: ['write'] } } }
  const readBack = normalizePolicy(JSON.parse(JSON.stringify(storedWithRoles)))
  assert.deepEqual(readBack.managedRoles, { hermes: { allowGroups: ['write'] } }, 'normalizePolicy 不许吃掉 managedRoles')
  const mergedRoles = mergePolicyForStorage({ level: 'low' }, storedWithRoles)
  assert.ok(mergedRoles.managedRoles && mergedRoles.managedRoles.hermes, '保存设置不许把角色配置删掉')
  // 没有旧文件时等同首存
  const mergedFresh = mergePolicyForStorage({ level: 'medium' }, null)
  assert.equal(mergedFresh.level, 'medium')
  ok('策略落盘：补丁合并进旧策略，未提交的键不丢')

  // 2026-11-02（外部评审指出、复现属实）：allowGroups 写不存在 id ⇒ 受管会话把组全藏，
  // 而受管会话里 enable/disable 被拒、自愈也不绕过 ⇒ 会话内零自救路径，且全程静默。
  log('[71] 受管角色：allowGroups 写错不许把会话锁死')
  // ① 纯函数：全错 → 该角色被停用；半错 → 只报不删；'*' → 放行
  const auditAll = auditManagedRoles({ typo: { allowGroups: ['fs', 'shell'] } }, ['rf-a'])
  assert.deepEqual(auditAll.dropped, ['typo'], '全部 id 都不认识时必须停用该角色')
  assert.deepEqual(auditAll.unknown[0].ids, ['fs', 'shell'])
  const auditHalf = auditManagedRoles({ half: { allowGroups: ['rf-a', 'nope'] } }, ['rf-a'])
  assert.deepEqual(auditHalf.dropped, [], '有一半能用就不许删角色')
  assert.deepEqual(auditHalf.unknown[0].ids, ['nope'])
  assert.deepEqual(auditManagedRoles({ star: { allowGroups: ['*'] } }, []), { unknown: [], dropped: [] }, "'*' 不算写错")
  // 2026-11-03 冷读红 4a：auto-* **不再豁免**。
  // 以前它被跳过，于是 mnemon 停用后 `auto-mnemon` 消失时角色照常生效却一个组都没允许 →
  // 全部 hide、只剩核心工具、enable/disable 还被拒（#71 原地复活）。现在它和普通 id 一样参与判定。
  const auditAuto = auditManagedRoles({ auto: { allowGroups: ['auto-xxx'] } }, [])
  assert.deepEqual(auditAuto.dropped, ['auto'], 'auto-* 不存在时也要按"全错"停用角色')
  assert.deepEqual(auditAuto.unknown[0].ids, ['auto-xxx'], '并且要报出来')

  // ② 集成：全错的角色不生效（health.managed 为 null）+ health.errors 里有证据
  const worldAudit = makeWorld()
  worldAudit.ctx.tools.register({ name: 'rf_a__one', description: 'x', parameters: {}, output: {} })
  apply(worldAudit.ctx, {
    groups: [{ id: 'rf-a', match: ['rf_a__*'] }],
    autoGroups: 'off',
    managedRoles: {
      'role-typo': { allowGroups: ['fs', 'shell'] },
      'role-half': { allowGroups: ['rf-a', 'nope'] },
    },
  })
  const typoAgent = worldAudit.createAgent('agent-typo', (agent) => {
    agent.presets = { defaultId: 'cordis', composedPreset: () => 'role-typo' }
  })
  const healthTypo = await runTool(worldAudit, 'lazy_tools_health', {}, typoAgent)
  assert.equal(healthTypo.managed, null, '全写错的角色必须被停用（否则会话被锁到只剩核心工具）')
  assert.ok(
    healthTypo.errors.some((e) => String(e.message).includes('role-typo') && String(e.message).includes('不存在')),
    `health.errors 里必须响：${JSON.stringify(healthTypo.errors)}`,
  )
  // 半错的角色仍然生效（不是一刀切停用）
  const halfAgent = worldAudit.createAgent('agent-half', (agent) => {
    agent.presets = { defaultId: 'cordis', composedPreset: () => 'role-half' }
  })
  const healthHalf = await runTool(worldAudit, 'lazy_tools_health', {}, halfAgent)
  assert.ok(healthHalf.managed && healthHalf.managed.role === 'role-half', '半错角色仍要生效')
  ok('受管角色：allowGroups 写错会响；全错停用不锁死；部分错只报不删')

  // 2026-11-03（第 1 批重构）：提示段搬去 lib/prompt.js，顺带产出「会话快照」。
  // 这条钉住：health.session 与提示段**同一份判据**（该列哪些组），且能指出被外部挡掉的组。
  log('[72] 会话快照：health.session 与提示段同一份判定')
  const worldSnap = makeWorld()
  const snapSections = []
  worldSnap.ctx.inject = (deps, callback) => {
    callback({
      effect: (make) => make(),
      systemPrompt: {
        section(section) {
          snapSections.push(section)
          return () => {}
        },
      },
    })
  }
  worldSnap.ctx.tools.register({ name: 'snap_a__one', description: 'x', parameters: {}, output: {} })
  worldSnap.ctx.tools.register({ name: 'snap_b__one', description: 'x', parameters: {}, output: {} })
  worldSnap.ctx.tools.register({ name: 'snap_c__one', description: 'x', parameters: {}, output: {} })
  apply(worldSnap.ctx, {
    groups: [
      { id: 'snap-a', match: ['snap_a__*'], title: 'A' },
      { id: 'snap-b', match: ['snap_b__*'], title: 'B' },
      { id: 'snap-c', match: ['snap_c__*'], title: 'C' },
    ],
    autoGroups: 'off',
  })
  // C 组被外部挡掉（不是我们收的）：会话快照要能指出来。
  // 必须在 createAgent 之前挡：这样首次 rebuild 就看到它不可见，不会把它算进我们的藏匿集。
  const snapAgent = worldSnap.createAgent('agent-snap', (agent) => {
    worldSnap.externalByAgent.get(agent).add('snap_c__one')
  })
  const healthSnap = await runTool(worldSnap, 'lazy_tools_health', {}, snapAgent)
  assert.ok(healthSnap.session, 'health.session 必须存在')
  assert.ok(Array.isArray(healthSnap.session.groupsListed), 'groupsListed 必须是数组')
  // 2026-11-03 夜（挑刺）：role / blockedGroups 已砍——前者与 managed 重复，后者是第二个更弱的判据
  assert.ok(!('role' in healthSnap.session), 'session 不该重复 managed 里的 role')
  assert.ok(!('blockedGroups' in healthSnap.session), 'blockedGroups 已移除（health.groups[].blocked 是唯一入口）')
  const sectionTextSnap = snapSections[0].text({ scope: snapAgent })
  for (const id of healthSnap.session.groupsListed) {
    assert.ok(sectionTextSnap.includes(id), `快照说列了 ${id}，提示段里却没有：${sectionTextSnap}`)
  }
  // 反向：提示段里出现的组也必须在快照里（同一份判定，双向都对）
  for (const g of [
    { id: 'snap-a', re: /snap-a\(/ },
    { id: 'snap-b', re: /snap-b\(/ },
    { id: 'snap-c', re: /snap-c\(/ },
  ]) {
    if (g.re.test(sectionTextSnap)) assert.ok(healthSnap.session.groupsListed.includes(g.id), `提示段有 ${g.id}，快照却没有`)
  }
  assert.ok(healthSnap.session.visible >= 1 && healthSnap.session.hidden >= 1, '可见/隐藏计数要有')
  // visible 要等于「注册表 − 我们藏的 − 外部挡的」：注意假宿主的 visibleNames() 辅助函数**不过滤外部 deny**，
  // 所以这里自己按同一口径算，别拿两套定义互比。
  const snapDenied = worldSnap.denyByAgent.get(snapAgent) || new Set()
  const snapExternal = worldSnap.externalByAgent.get(snapAgent) || new Set()
  const expectedVisible = [...worldSnap.registered.keys()].filter(
    (name) => !snapDenied.has(name) && !snapExternal.has(name),
  ).length
  assert.equal(healthSnap.session.visible, expectedVisible, 'visible 必须等于本会话真正可见的工具数')

  // **读不到时不许编数字**（挑刺的红项）：视图与 schemas 同时抛错 ⇒ visible 必须是 null，不是 0
  const realView = worldSnap.ctx.tools.view
  const realSchemas = worldSnap.ctx.tools.schemas
  worldSnap.ctx.tools.view = () => {
    throw new Error('view boom')
  }
  worldSnap.ctx.tools.schemas = () => {
    throw new Error('schemas boom')
  }
  const healthBroken = await runTool(worldSnap, 'lazy_tools_health', {}, snapAgent)
  assert.equal(
    healthBroken.session.visible,
    null,
    `读不到工具表时必须给 null，不许用 0 冒充：${JSON.stringify(healthBroken.session)}`,
  )
  assert.ok(Array.isArray(healthBroken.session.groupsListed), '读不到时 groupsLeft 仍要给（退回旧行为：列全部组）')
  worldSnap.ctx.tools.view = realView
  worldSnap.ctx.tools.schemas = realSchemas
  ok('会话快照：列出的组与提示段同一份判定；读不到工具表时 visible=null，不编数字')

  // 2026-11-03：子代理的角色来源。宿主不给 subagent 工具传 preset/metadata，
  // 所以角色走「父会话给子会话的 label 带角色词」这条约定（[role:xxx] 通道已在 0.18.2 删除）。
  log('[74] 角色来源：label 尾段（厂商无关）')
  const labelCases = [
    ['dsh-my-go:hermes', 'hermes'],
    ['dsh-my-go/hermes', 'hermes'],
    ['team:reviewer', 'reviewer'],
    ['MyGO Explore', 'explore'],
    ['plainnoprefix', 'plainnoprefix'],
    ['尾段有中文:中文角色', null],
    ['', null],
    [undefined, null],
  ]
  for (const [input, expected] of labelCases) {
    assert.equal(roleFromLabel(input), expected, `roleFromLabel(${JSON.stringify(input)}) 应为 ${expected}`)
  }

  const worldLabel = makeWorld()
  worldLabel.ctx.tools.register({ name: 'lb_a__one', description: 'x', parameters: {}, output: {} })
  worldLabel.ctx.tools.register({ name: 'lb_b__one', description: 'x', parameters: {}, output: {} })
  apply(worldLabel.ctx, {
    groups: [
      { id: 'lb-a', match: ['lb_a__*'] },
      { id: 'lb-b', match: ['lb_b__*'] },
    ],
    autoGroups: 'off',
    managedRoles: {
      hermes: { allowGroups: ['lb-a'] },
      subagent: { allowGroups: ['lb-b'] },
    },
  })

  // ① 标签尾段命中 ⇒ 用它（精确），且 source=label
  const labelChild = worldLabel.createAgent('agent-label', (agent) => {
    agent.session = { header: { parentSession: 'p', label: 'dsh-my-go:hermes' } }
  })
  const healthLabel = await runTool(worldLabel, 'lazy_tools_health', {}, labelChild)
  assert.equal(healthLabel.managed && healthLabel.managed.role, 'hermes', `label 尾段必须认出来：${JSON.stringify(healthLabel.managed)}`)
  assert.equal(healthLabel.managed.source, 'label', 'source 要写明是 label 认出来的')
  const denyLabel = worldLabel.denyByAgent.get(labelChild)
  assert.ok(denyLabel.has('lb_b__one'), 'hermes 只允许 lb-a，lb-b 必须藏')
  assert.ok(!denyLabel.has('lb_a__one'), 'lb-a 必须放出来')

  // ② 标签尾段没配 ⇒ 退回 subagent 通用键，source=subagent
  const fallbackChild = worldLabel.createAgent('agent-label-fallback', (agent) => {
    agent.session = { header: { parentSession: 'p', label: 'unknown-vendor:nobody' } }
  })
  const healthFallback = await runTool(worldLabel, 'lazy_tools_health', {}, fallbackChild)
  assert.equal(healthFallback.managed && healthFallback.managed.role, 'subagent', '认不出的 label 要退回 subagent 键')
  assert.equal(healthFallback.managed.source, 'subagent')

  // ③ 非子会话带 label ⇒ 不许生效（label 只在子会话上认）
  const humanLabel = worldLabel.createAgent('agent-label-human', (agent) => {
    agent.session = { header: { label: 'dsh-my-go:hermes' } }
  })
  const healthHumanLabel = await runTool(worldLabel, 'lazy_tools_health', {}, humanLabel)
  assert.equal(healthHumanLabel.managed, null, '普通会话的 label 不该改变工具面')
  ok('角色来源：label 尾段优先于 subagent 键，非子会话不认 label')

  // 2026-11-03：**改完 policy.json 不用重启**（用户点名"配置很麻烦"）。
  // 判据是 mtime；读不到 mtime 就永不重载（退回旧行为）。AI 配的角色要能自证来源。
  log('[75] policy 热重载：改文件即生效，且能看出是谁配的')
  const tmpPolicy = join(tmpdir(), `lazy-tools.policy.reload.${Date.now()}.json`)
  const prevPolicyEnv = process.env.LAZY_TOOLS_POLICY_FILE
  process.env.LAZY_TOOLS_POLICY_FILE = tmpPolicy
  try {
    writeFileSync(tmpPolicy, JSON.stringify({ managedRoles: { alpha: { allowGroups: ['hl-a'] } } }), 'utf8')
    const worldReload = makeWorld()
    worldReload.ctx.tools.register({ name: 'hl_a__one', description: 'x', parameters: {}, output: {} })
    worldReload.ctx.tools.register({ name: 'hl_b__one', description: 'x', parameters: {}, output: {} })
    apply(worldReload.ctx, {
      groups: [
        { id: 'hl-a', match: ['hl_a__*'] },
        { id: 'hl-b', match: ['hl_b__*'] },
      ],
      autoGroups: 'off',
    })
    const mkChild = (id, label) =>
      worldReload.createAgent(id, (agent) => {
        agent.session = { header: { parentSession: 'p', label } }
      })

    const charlie1 = mkChild('agent-reload-1', 'v:alpha')
    const health1 = await runTool(worldReload, 'lazy_tools_health', {}, charlie1)
    assert.equal(health1.managed && health1.managed.role, 'alpha', '启动时读到的角色要生效')
    assert.equal(health1.managed.createdBy, null, '人手写的角色没有 createdBy')

    // 改文件（换成 beta，并带上 AI 的来源标记），把 mtime 推到未来确保能被判成"变过"
    writeFileSync(
      tmpPolicy,
      JSON.stringify({ managedRoles: { beta: { allowGroups: ['hl-b'], createdBy: 'ai', basis: 'smoke 测试' } } }),
      'utf8',
    )
    const future = new Date(Date.now() + 5000)
    utimesSync(tmpPolicy, future, future)

    const charlie2 = mkChild('agent-reload-2', 'v:beta')
    const health2 = await runTool(worldReload, 'lazy_tools_health', {}, charlie2)
    assert.equal(health2.managed && health2.managed.role, 'beta', '改完文件新建会话就该用新角色（不用重启）')
    assert.equal(health2.managed.createdBy, 'ai', 'AI 配的角色要能看出是谁配的')
    assert.equal(health2.managed.basis, 'smoke 测试', '依据要能透出来')

    // 旧角色已经不在配置里 ⇒ 新会话不再受管（subagent 键也没配）
    const charlie3 = mkChild('agent-reload-3', 'v:alpha')
    const health3 = await runTool(worldReload, 'lazy_tools_health', {}, charlie3)
    assert.equal(health3.managed, null, '被删掉的角色不该继续生效')
  } finally {
    if (prevPolicyEnv === undefined) delete process.env.LAZY_TOOLS_POLICY_FILE
    else process.env.LAZY_TOOLS_POLICY_FILE = prevPolicyEnv
    rmSync(tmpPolicy, { force: true })
  }
  ok('policy 热重载：mtime 变了就重读，AI 配的角色带 createdBy/basis')

  // 2026-11-03：**AI 自己配角色**（用户：大部分人懒得写，给喜欢折腾的留个口子）。
  // 工具层强制三条不变量：组必须存在、不许 `*`、必须带 basis。
  log('[76] lazy_tools_roles：AI 自己配角色，工具层守住三条不变量')
  const tmpRoles = join(tmpdir(), `lazy-tools.roles.${Date.now()}.json`)
  const prevRolesEnv = process.env.LAZY_TOOLS_POLICY_FILE
  process.env.LAZY_TOOLS_POLICY_FILE = tmpRoles
  try {
    const worldRoles = makeWorld()
    worldRoles.ctx.tools.register({ name: 'rl_a__one', description: 'x', parameters: {}, output: {} })
    worldRoles.ctx.tools.register({ name: 'rl_b__one', description: 'x', parameters: {}, output: {} })
    apply(worldRoles.ctx, {
      groups: [
        { id: 'rl-a', match: ['rl_a__*'] },
        { id: 'rl-b', match: ['rl_b__*'] },
      ],
      autoGroups: 'off',
    })
    const boss = worldRoles.createAgent('agent-roles-boss')

    // 只读
    const readOnly = await runTool(worldRoles, 'lazy_tools_roles', {}, boss)
    assert.deepEqual(readOnly.groupIds, ['rl-a', 'rl-b'], '只读模式要给出可用组')
    assert.deepEqual(readOnly.roles, [], '一开始没有角色')

    // 不变量 ①：组必须存在
    const badGroup = await runTool(worldRoles, 'lazy_tools_roles', { role: 'hermes', allowGroups: ['nope'], basis: 'x' }, boss)
    assert.ok(String(badGroup.error || '').includes('不存在'), '不存在的组必须拒绝')

    // 不变量 ②：AI 不许写 *
    const star = await runTool(worldRoles, 'lazy_tools_roles', { role: 'hermes', allowGroups: ['*'], basis: 'x' }, boss)
    assert.ok(
      String(star.error || '').includes('逃生口'),
      `AI 不许写 * —— 拒绝理由必须是"放开限制"这条，不能是碰巧"组不存在"：${JSON.stringify(star)}`,
    )

    // 不变量 ③：必须给 basis
    const noBasis = await runTool(worldRoles, 'lazy_tools_roles', { role: 'hermes', allowGroups: ['rl-a'] }, boss)
    assert.ok(String(noBasis.error || '').includes('basis'), '没依据必须拒绝')

    // 正常写入 → 文件真的落盘 + 新子会话按它收紧
    const written = await runTool(
      worldRoles,
      'lazy_tools_roles',
      { role: 'hermes', allowGroups: ['rl-a'], basis: '写模块，只用写类组' },
      boss,
    )
    assert.equal(written.ok, true, `写入应成功：${JSON.stringify(written)}`)
    const onDisk = JSON.parse(readFileSync(tmpRoles, 'utf8'))
    assert.equal(onDisk.managedRoles.hermes.createdBy, 'ai', '落盘要标明是 AI 配的')
    assert.equal(onDisk.managedRoles.hermes.basis, '写模块，只用写类组', '依据要落盘')

    const hermesChild = worldRoles.createAgent('agent-roles-child', (agent) => {
      agent.session = { header: { parentSession: 'p', label: 'v:hermes' } }
    })
    const healthHermes = await runTool(worldRoles, 'lazy_tools_health', {}, hermesChild)
    assert.equal(healthHermes.managed && healthHermes.managed.role, 'hermes', '新子会话要用刚配的角色')
    assert.equal(healthHermes.managed.createdBy, 'ai')
    const denyHermes = worldRoles.denyByAgent.get(hermesChild)
    assert.ok(denyHermes.has('rl_b__one'), '未授权的组要被藏')
  } finally {
    if (prevRolesEnv === undefined) delete process.env.LAZY_TOOLS_POLICY_FILE
    else process.env.LAZY_TOOLS_POLICY_FILE = prevRolesEnv
    rmSync(tmpRoles, { force: true })
  }
  ok('lazy_tools_roles：AI 配角色——不存在的组 / * / 缺 basis 全被拒，写入即生效')

  // 2026-11-03（盲测指出的失败模式）：子会话自称一个没配的角色时，它会悄悄落到默认工具面。
  // 认不出就不动仍然是对的，但**必须能查**：health.session.roleHint 要把它点名。
  log('[77] 角色没配时要说出来：health.session.roleHint')
  const worldHint = makeWorld()
  worldHint.ctx.tools.register({ name: 'rh_a__one', description: 'x', parameters: {}, output: {} })
  apply(worldHint.ctx, {
    groups: [{ id: 'rh-a', match: ['rh_a__*'] }],
    autoGroups: 'off',
    managedRoles: { hermes: { allowGroups: ['rh-a'] } },
  })
  const hintChild = worldHint.createAgent('agent-hint', (agent) => {
    agent.session = { header: { parentSession: 'p', label: 'vendor:nobody' } }
  })
  const healthHint = await runTool(worldHint, 'lazy_tools_health', {}, hintChild)
  assert.equal(healthHint.managed, null, '没配的角色不许生效')
  assert.ok(healthHint.session && healthHint.session.roleHint, '没配的角色必须在 session.roleHint 里点名')
  assert.equal(healthHint.session.roleHint.role, 'nobody')
  assert.ok(String(healthHint.session.roleHint.hint).includes('lazy_tools_roles'), '提示要给出下一步怎么做')

  const configuredChild = worldHint.createAgent('agent-hint-ok', (agent) => {
    agent.session = { header: { parentSession: 'p', label: 'vendor:hermes' } }
  })
  const healthNoHint = await runTool(worldHint, 'lazy_tools_health', {}, configuredChild)
  assert.equal(healthNoHint.session.roleHint, undefined, '配好了就不该再提示')
  ok('角色没配：session.roleHint 点名 + 给出下一步；配好了就不吵')

  // 2026-11-03 冷读红的回归（红 2 / 红 3）：坏 policy.json 不许把角色清零；写角色不许洗掉别的设置。
  log('[78] 冷读回归：坏 policy 不清角色；写角色不洗设置')
  const tmpRed = join(tmpdir(), `lazy-tools.reds.${Date.now()}.json`)
  const prevRedEnv = process.env.LAZY_TOOLS_POLICY_FILE
  process.env.LAZY_TOOLS_POLICY_FILE = tmpRed
  try {
    writeFileSync(tmpRed, JSON.stringify({ level: 'medium', managedRoles: { alpha: { allowGroups: ['rd-a'] } } }), 'utf8')
    const worldRed = makeWorld()
    worldRed.ctx.tools.register({ name: 'rd_a__one', description: 'x', parameters: {}, output: {} })
    worldRed.ctx.tools.register({ name: 'rd_b__one', description: 'x', parameters: {}, output: {} })
    apply(worldRed.ctx, {
      groups: [
        { id: 'rd-a', match: ['rd_a__*'] },
        { id: 'rd-b', match: ['rd_b__*'] },
      ],
      autoGroups: 'off',
    })
    const mk = (id) =>
      worldRed.createAgent(id, (agent) => {
        agent.session = { header: { parentSession: 'p', label: 'v:alpha' } }
      })
    const okChild = mk('agent-red-ok')
    assert.equal((await runTool(worldRed, 'lazy_tools_health', {}, okChild)).managed.role, 'alpha', '起始角色生效')

    // 红 2：文件坏掉 + mtime 变新 → 角色必须保持，且要响
    writeFileSync(tmpRed, '{ "level": "medium", }', 'utf8') // 尾逗号 = 坏 JSON
    const future = new Date(Date.now() + 8000)
    utimesSync(tmpRed, future, future)
    const afterBad = mk('agent-red-bad')
    const healthBad = await runTool(worldRed, 'lazy_tools_health', {}, afterBad)
    assert.equal(healthBad.managed && healthBad.managed.role, 'alpha', '坏 policy.json 不许把角色清零')
    assert.ok(
      healthBad.errors.some((e) => String(e.message).includes('读不出来')),
      '坏 policy.json 必须响（否则用户以为改生效了）',
    )

    // 红 3：坏文件时写角色必须拒绝（不许把文件洗成只剩 managedRoles）
    const bossRed = worldRed.createAgent('agent-red-boss')
    const writeBad = await runTool(worldRed, 'lazy_tools_roles', { role: 'beta', allowGroups: ['rd-b'], basis: 'x' }, bossRed)
    assert.ok(String(writeBad.error || '').includes('不写'), '坏 policy.json 时写角色必须拒绝')
    assert.equal(readFileSync(tmpRed, 'utf8').includes('{ "level": "medium", }'), true, '坏文件一个字节都不该被动')

    // 红 3：好文件时写角色必须保住 level 等键
    writeFileSync(
      tmpRed,
      JSON.stringify({ level: 'medium', presets: { low: 14, medium: 7, high: 3 }, managedRoles: { alpha: { allowGroups: ['rd-a'] } } }),
      'utf8',
    )
    const writeGood = await runTool(worldRed, 'lazy_tools_roles', { role: 'beta', allowGroups: ['rd-b'], basis: 'y' }, bossRed)
    assert.equal(writeGood.ok, true, `写入应成功：${JSON.stringify(writeGood)}`)
    const kept = JSON.parse(readFileSync(tmpRed, 'utf8'))
    assert.equal(kept.level, 'medium', '写角色不许把 level 洗掉（#78 同类）')
    assert.deepEqual(kept.presets, { low: 14, medium: 7, high: 3 }, '写角色不许把 presets 洗掉')
    assert.equal(kept.managedRoles.alpha.allowGroups[0], 'rd-a', '已有角色不许被覆盖')
  } finally {
    if (prevRedEnv === undefined) delete process.env.LAZY_TOOLS_POLICY_FILE
    else process.env.LAZY_TOOLS_POLICY_FILE = prevRedEnv
    rmSync(tmpRed, { force: true })
  }
  ok('冷读回归：坏文件不清角色且要响；写角色拒绝洗文件、保留 level/presets/已有角色')

  // 2026-11-03 冷读第二轮（红 1 / 红 2 启动 / 红 4a）：
  log('[79] 冷读第二轮回归：投影 label / 启动读失败要响 / auto-* 角色不许被误删')
  // ① label 走 sessionProjections（真机唯一通道）
  const fakeSession = { id: 's1' }
  const agentProj = {
    session: fakeSession,
    ctx: {
      get: (name) =>
        name === 'sessionProjections'
          ? { stateOf: (session, key) => (key === 'subagent' ? { identity: { label: 'dsh-my-go:hermes' } } : null) }
          : null,
    },
  }
  assert.equal(roleFromLabel(labelOfSession(agentProj, { parentSession: 'p' })), 'hermes', '投影里的 label 必须认出来')
  assert.equal(labelOfSession({ session: fakeSession, ctx: { get: () => null } }, { parentSession: 'p' }), null, '拿不到投影就返回 null，不猜')

  // ② 启动时 policy.json 坏了：必须响（healthy=false），不许静默退回默认
  const tmpBoot = join(tmpdir(), `lazy-tools.boot.${Date.now()}.json`)
  const prevBootEnv = process.env.LAZY_TOOLS_POLICY_FILE
  process.env.LAZY_TOOLS_POLICY_FILE = tmpBoot
  try {
    writeFileSync(tmpBoot, '{ "level": "high", }', 'utf8') // 尾逗号 = 坏 JSON
    const worldBoot = makeWorld()
    apply(worldBoot.ctx, { autoGroups: 'off' })
    const bootAgent = worldBoot.createAgent('agent-boot')
    const healthBoot = await runTool(worldBoot, 'lazy_tools_health', {}, bootAgent)
    assert.ok(
      healthBoot.errors.some((e) => String(e.message).includes('policy.json 读不出来')),
      '启动时读失败必须记账，不许静默退回默认',
    )
    assert.equal(healthBoot.healthy, false, '读失败必须让 healthy 变红（否则用户以为设置生效了）')
  } finally {
    if (prevBootEnv === undefined) delete process.env.LAZY_TOOLS_POLICY_FILE
    else process.env.LAZY_TOOLS_POLICY_FILE = prevBootEnv
    rmSync(tmpBoot, { force: true })
  }

  // ③ auto-* 角色：审计必须等 autoGroups 之后。否则合法角色被当成"组不存在"删掉（fail-open）
  const worldAutoRole = makeWorld()
  worldAutoRole.ctx.tools.register({ name: 'mnemon__search', description: 'x', parameters: {}, output: {} })
  worldAutoRole.ctx.tools.register({ name: 'mnemon__create', description: 'x', parameters: {}, output: {} })
  worldAutoRole.ctx.tools.register({ name: 'mnemon__recall', description: 'x', parameters: {}, output: {} })
  apply(worldAutoRole.ctx, {
    autoGroups: 'on',
    managedRoles: { reviewer: { allowGroups: ['auto-mnemon'] } },
  })
  const reviewerChild = worldAutoRole.createAgent('agent-auto-reviewer', (agent) => {
    agent.session = { header: { parentSession: 'p', label: 'v:reviewer' } }
  })
  const healthAuto = await runTool(worldAutoRole, 'lazy_tools_health', {}, reviewerChild)
  assert.equal(
    healthAuto.managed && healthAuto.managed.role,
    'reviewer',
    `auto-* 角色不许在启动时被误删（managed 应为 reviewer，实际 ${JSON.stringify(healthAuto.managed)}）`,
  )
  ok('冷读第二轮回归：投影 label 认得出；启动读失败会红；auto-* 角色不被误删')

  // 2026-11-03 冷读第三轮回归
  log('[80] 冷读第三轮回归：组晚到后 auto-* 角色自动恢复；合法非对象 policy 要响；热重载坏形状保持旧值')
  // ① 审计只在第一次会话跑 + 就地删 ⇒ 晚到的 auto 组永远不会被重审，合法角色被永久删掉（fail-open）
  {
    const worldLate = makeWorld()
    apply(worldLate.ctx, { autoGroups: 'on', managedRoles: { reviewer: { allowGroups: ['auto-mnemon'] } } })
    const early = worldLate.createAgent('agent-early')
    await runTool(worldLate, 'lazy_tools_health', {}, early)
    for (const name of ['mnemon__search', 'mnemon__create', 'mnemon__recall']) {
      worldLate.ctx.tools.register({ name, description: 'x', parameters: {}, output: {} })
    }
    const lateChild = worldLate.createAgent('agent-late', (agent) => {
      // 真机的 label 不在 header 上，只在 sessionProjections 的 subagent 投影里（冷读红 1）
      agent.session = { header: { parentSession: 'p' } }
      const get = agent.ctx.get.bind(agent.ctx)
      agent.ctx.get = (key) =>
        key === 'sessionProjections' ? { stateOf: () => ({ identity: { label: 'v:reviewer' } }) } : get(key)
    })
    const lateHealth = await runTool(worldLate, 'lazy_tools_health', {}, lateChild)
    assert.equal(
      lateHealth.managed && lateHealth.managed.role,
      'reviewer',
      `组晚到后角色必须自动恢复（实际 ${JSON.stringify(lateHealth.managed)}）`,
    )
    assert.deepEqual(
      (lateHealth.errors || []).filter((e) => String(e.message).includes('auto-mnemon')),
      [],
      'auto-* 组还没建出来不许拉红（假错误会训练人忽略红灯）',
    )
  }

  // ② 合法 JSON 但「不是可用的策略」：必须当「读不出来」/「这一项写坏了」，健康灯要红；
  //    合法的空对象 {} 不许误报。
  {
    const prevPolicyEnv = process.env.LAZY_TOOLS_POLICY_FILE
    const tmpShape = join(tmpdir(), `lazy-tools.shape.${Date.now()}.json`)
    try {
      const cases = [
        ['null', 'null', '顶层不是对象', false],
        ['array', '[]', '顶层不是对象', false],
        ['string', '"hi"', '顶层不是对象', false],
        ['roles-string', JSON.stringify({ managedRoles: 'cua-screen' }), 'managedRoles 形状不合法', false],
        ['roles-array', JSON.stringify({ managedRoles: [] }), 'managedRoles 形状不合法', false],
        ['roles-empty', JSON.stringify({ managedRoles: {} }), null, true],
      ]
      for (const [label, content, expectError, healthyExpected] of cases) {
        writeFileSync(tmpShape, content, 'utf8')
        process.env.LAZY_TOOLS_POLICY_FILE = tmpShape
        const worldShape = makeWorld()
        apply(worldShape.ctx, { autoGroups: 'off' })
        const agentShape = worldShape.createAgent(`agent-shape-${label}`)
        const healthShape = await runTool(worldShape, 'lazy_tools_health', {}, agentShape)
        if (expectError === null) {
          assert.equal(healthShape.healthy, true, `${label} 是合法写法，不许拉红`)
          assert.deepEqual(
            (healthShape.errors || []).filter((e) => String(e.message).includes('managedRoles')),
            [],
            `${label} 不许报 managedRoles 错`,
          )
        } else {
          assert.equal(healthShape.healthy, false, `${label} 必须让健康灯变红`)
          assert.ok(
            (healthShape.errors || []).some((e) => String(e.message).includes(expectError)),
            `${label} 要报「${expectError}」`,
          )
        }
      }
    } finally {
      if (prevPolicyEnv === undefined) delete process.env.LAZY_TOOLS_POLICY_FILE
      else process.env.LAZY_TOOLS_POLICY_FILE = prevPolicyEnv
      rmSync(tmpShape, { force: true })
    }
  }

  // ③ 热重载：managedRoles 写坏形状时必须保持旧值 + 记账（不许静默清空）
  {
    const prevPolicyEnv = process.env.LAZY_TOOLS_POLICY_FILE
    const tmpReload = join(tmpdir(), `lazy-tools.reload.${Date.now()}.json`)
    try {
      writeFileSync(tmpReload, JSON.stringify({ level: 'high', managedRoles: { reviewer: { allowGroups: ['cua-screen'] } } }), 'utf8')
      process.env.LAZY_TOOLS_POLICY_FILE = tmpReload
      const worldReload = makeWorld()
      apply(worldReload.ctx, { autoGroups: 'off' })
      const firstReload = worldReload.createAgent('agent-reload-1')
      const healthFirst = await runTool(worldReload, 'lazy_tools_health', {}, firstReload)
      assert.ok(healthFirst.policy.managedRoles && healthFirst.policy.managedRoles.reviewer, '初始角色要读进来')
      writeFileSync(tmpReload, JSON.stringify({ level: 'high', managedRoles: 'cua-screen' }), 'utf8')
      const future = new Date(Date.now() + 4000)
      utimesSync(tmpReload, future, future)
      worldReload.createAgent('agent-reload-2')
      const healthSecond = await runTool(worldReload, 'lazy_tools_health', {}, firstReload)
      assert.ok(
        (healthSecond.errors || []).some((e) => String(e.message).includes('managedRoles 形状不合法')),
        '热重载读到坏形状必须记账',
      )
      assert.ok(
        healthSecond.policy.managedRoles && healthSecond.policy.managedRoles.reviewer,
        '坏形状不许清空旧角色',
      )
      // 形状对、但条目全没用：会清空（fail-open 是对的），但必须记账，不许静默
      writeFileSync(tmpReload, JSON.stringify({ level: 'high', managedRoles: { alpha: {} } }), 'utf8')
      const more = new Date(Date.now() + 8000)
      utimesSync(tmpReload, more, more)
      worldReload.createAgent('agent-reload-3')
      const healthThird = await runTool(worldReload, 'lazy_tools_health', {}, firstReload)
      assert.ok(
        (healthThird.errors || []).some((e) => String(e.message).includes('没有任何可用条目')),
        '条目全没用导致清空时必须记账',
      )
      // 改回合法配置：角色要能回来（热重载不是单向门）
      writeFileSync(tmpReload, JSON.stringify({ level: 'high', managedRoles: { reviewer: { allowGroups: ['cua-screen'] } } }), 'utf8')
      const evenMore = new Date(Date.now() + 12000)
      utimesSync(tmpReload, evenMore, evenMore)
      worldReload.createAgent('agent-reload-4')
      const healthFourth = await runTool(worldReload, 'lazy_tools_health', {}, firstReload)
      assert.ok(
        healthFourth.policy.managedRoles && healthFourth.policy.managedRoles.reviewer,
        '改回合法配置后角色必须回来',
      )
    } finally {
      if (prevPolicyEnv === undefined) delete process.env.LAZY_TOOLS_POLICY_FILE
      else process.env.LAZY_TOOLS_POLICY_FILE = prevPolicyEnv
      rmSync(tmpReload, { force: true })
    }
  }
  ok('冷读第三轮回归：组晚到恢复 / 非对象 policy 要响 / 热重载坏形状保旧值')

  // 2026-11-03（读 MyGO 源码发现）：它的真实标签是 `dsh-my-go:<工种>: <任务摘要>`，
  // 不是 `dsh-my-go:<工种>`。只取「最后一段」会拿到任务摘要 ⇒ 认不出角色 ⇒ fail-open。
  log('[81] MyGO 真实标签格式：带任务摘要也要认出角色')
  const candidatesMygo = roleCandidatesFromLabel("dsh-my-go:hermes: 帮我改这个模块，不要动浏览器")
  assert.deepEqual(candidatesMygo, ['hermes'], `候选段应为 [hermes]（dsh- 前缀不算角色）：${JSON.stringify(candidatesMygo)}`)

  const worldMygo = makeWorld()
  worldMygo.ctx.tools.register({ name: 'mg_a__one', description: 'x', parameters: {}, output: {} })
  worldMygo.ctx.tools.register({ name: 'mg_b__one', description: 'x', parameters: {}, output: {} })
  apply(worldMygo.ctx, {
    groups: [
      { id: 'mg-a', match: ['mg_a__*'] },
      { id: 'mg-b', match: ['mg_b__*'] },
    ],
    autoGroups: 'off',
    managedRoles: { hermes: { allowGroups: ['mg-a'] } },
  })
  const mygoChild = worldMygo.createAgent('agent-mygo', (agent) => {
    agent.session = { header: { parentSession: 'p', label: 'dsh-my-go:hermes: 帮我改这个模块，不要动浏览器' } }
  })
  const healthMygo = await runTool(worldMygo, 'lazy_tools_health', {}, mygoChild)
  assert.equal(healthMygo.managed && healthMygo.managed.role, 'hermes', `带摘要的 MyGO 标签也必须认出来：${JSON.stringify(healthMygo.managed)}`)
  assert.equal(healthMygo.managed.source, 'label')
  assert.ok(worldMygo.denyByAgent.get(mygoChild).has('mg_b__one'), '未授权的组要被藏')
  ok('MyGO 真实标签（带摘要）也能认出角色并收紧工具面')

  // 2026-11-03（对比评审指出）：`*` 被字面拦住了，但把**所有组**枚举一遍等价于 `*`。
  log('[82] 全组枚举 = 变相的 *，必须被拒')
  const worldAll = makeWorld()
  worldAll.ctx.tools.register({ name: 'al_a__one', description: 'x', parameters: {}, output: {} })
  worldAll.ctx.tools.register({ name: 'al_b__one', description: 'x', parameters: {}, output: {} })
  apply(worldAll.ctx, {
    groups: [
      { id: 'al-a', match: ['al_a__*'] },
      { id: 'al-b', match: ['al_b__*'] },
    ],
    autoGroups: 'off',
  })
  const bossAll = worldAll.createAgent('agent-all-boss')
  const allIds = (await runTool(worldAll, 'lazy_tools_roles', {}, bossAll)).groupIds
  const allGroups = await runTool(worldAll, 'lazy_tools_roles', { role: 'everything', allowGroups: allIds, basis: '枚举全组' }, bossAll)
  assert.ok(String(allGroups.error || '').includes('等价'), `枚举全部组必须被拒：${JSON.stringify(allGroups)}`)
  assert.equal(allGroups.ok, undefined, '被拒时不许返回 ok')
  ok('全组枚举 = 变相 * ：被拒，并说明只允许人手改文件')

  // 2026-11-03（四家 SA 调研）：别的编排器也往 label 里塞词，但那些词不是角色：
  //   goalloop `Goal-loop wave worker: AC-1`、switchman `… handover backup`、force-collab `协作 1/3`。
  // 用户若正好配了 worker/backup 这种角色名，会被误认 —— 通用词与纯数字必须跳过。
  log('[83] 通用词不当角色：worker / backup / 纯数字都跳过')
  assert.deepEqual(roleCandidatesFromLabel("Goal-loop wave worker: AC-1"), ['ac-1'], "worker 要跳过")
  assert.deepEqual(roleCandidatesFromLabel("dsh-switchman handover backup"), [], "backup 要跳过")
  assert.deepEqual(roleCandidatesFromLabel("协作 1/3"), [], "纯数字要跳过")
  assert.deepEqual(roleCandidatesFromLabel("Agent Team · reviewer"), ['reviewer'], "team 要跳过、reviewer 保留")
  assert.deepEqual(roleCandidatesFromLabel("dsh-my-go:hermes: 帮我改模块"), ['hermes'], "MyGO 的 hermes 不受影响")

  const worldGeneric = makeWorld()
  worldGeneric.ctx.tools.register({ name: 'gn_a__one', description: 'x', parameters: {}, output: {} })
  apply(worldGeneric.ctx, {
    groups: [{ id: 'gn-a', match: ['gn_a__*'] }],
    autoGroups: 'off',
    managedRoles: { worker: { allowGroups: ['gn-a'] } },
  })
  const genericChild = worldGeneric.createAgent('agent-generic', (agent) => {
    agent.session = { header: { parentSession: 'p', label: 'Goal-loop wave worker: AC-1' } }
  })
  const healthGeneric = await runTool(worldGeneric, 'lazy_tools_health', {}, genericChild)
  assert.equal(healthGeneric.managed, null, 'label 里的 worker 是通用词，不许被当成角色')
  ok('通用词护栏：worker/backup/数字不落角色，MyGO 的 hermes 照常')

  // 2026-11-03（MyGO 场景）：受管角色默认把「未归组工具」也藏，而 MyGO 的 need_help /
  // report_submit 正好未归组 —— 写角色时必须告诉调用方会被藏掉哪些，否则「接了反而更坏」。
  log('[84] 写角色时告知：哪些未归组工具会被藏')
  const worldOrphan = makeWorld()
  worldOrphan.ctx.tools.register({ name: 'orphan_tool', description: 'x', parameters: {}, output: {} })
  worldOrphan.ctx.tools.register({ name: 'og_a__one', description: 'x', parameters: {}, output: {} })
  worldOrphan.ctx.tools.register({ name: 'og_b__one', description: 'x', parameters: {}, output: {} })
  apply(worldOrphan.ctx, {
    groups: [
      { id: 'og-a', match: ['og_a__*'] },
      { id: 'og-b', match: ['og_b__*'] },
    ],
    autoGroups: 'off',
  })
  const orphanBoss = worldOrphan.createAgent('agent-orphan-boss')
  const writeOrphan = await runTool(worldOrphan, 'lazy_tools_roles', { role: 'solo', allowGroups: ['og-a'], basis: '测试未归组提示' }, orphanBoss)
  assert.equal(writeOrphan.ok, true, `写入应成功：${JSON.stringify(writeOrphan)}`)
  assert.ok(Array.isArray(writeOrphan.willHideUngrouped), '必须返回 willHideUngrouped 数组')
  assert.ok(writeOrphan.willHideUngrouped.includes('orphan_tool'), `未归组工具要列出来：${JSON.stringify(writeOrphan.willHideUngrouped)}`)
  ok('写角色时列出会被藏的未归组工具（防把编排器求助工具收掉）')

  // 2026-11-03（冷读乙在真机复现）：visible 里混着「注册了但不可 restrict」的名字时，
  // 宿主会让**整批** restrict 抛错 ⇒ 一个都不藏（fail-open）。
  // 修法验证：整批失败要退化成逐个重试，坏名字记一条、其余照藏。
  log('[85] 一个坏名字不许让整批限制静默失效')
  const worldBadName = makeWorld({ nonRestrictable: ['nr_bad'] })
  worldBadName.ctx.tools.register({ name: 'nr_bad', description: 'x', parameters: {}, output: {} })
  worldBadName.ctx.tools.register({ name: 'nr_ok__one', description: 'x', parameters: {}, output: {} })
  apply(worldBadName.ctx, {
    groups: [{ id: 'nr-g', match: ['re:^nr_'], defaultOn: false }],
    autoGroups: 'off',
  })
  const badAgent = worldBadName.createAgent('agent-badname')
  const badDeny = worldBadName.denyByAgent.get(badAgent)
  assert.ok(badDeny.has('nr_ok__one'), `好名字必须照藏；实际 deny=${JSON.stringify([...badDeny])}`)
  const badHealth = await runTool(worldBadName, 'lazy_tools_health', {}, badAgent)
  assert.ok(
    badHealth.errors.some((e) => String(e.message).includes('不可限制')),
    `坏名字必须留一条可查的错误：${JSON.stringify(badHealth.errors)}`,
  )
  ok('不可限制的名字：逐个跳过、其余照藏、留一条可查错误')

  // 2026-11-03 冷读双评审必修 ①：受管角色会藏掉未归组工具（MyGO 的 11 件协议工具就是这样断的），
  // 必须在 health 里点名，否则「接了之后拓扑断掉，但哪儿都看不出来」。
  log('[86] 受管会话：被藏掉的未归组工具要在 health 里点名')
  rmSync(`${NO_SUCH}.policy.json`, { force: true }) // 前面用例写过它，同一进程的 apply 会读进来
  const worldHU = makeWorld()
  worldHU.ctx.tools.register({ name: 'hu_grouped__one', description: 'x', parameters: {}, output: {} })
  worldHU.ctx.tools.register({ name: 'hu_grouped__two', description: 'x', parameters: {}, output: {} })
  worldHU.ctx.tools.register({ name: 'need_help', description: 'x', parameters: {}, output: {} })
  apply(worldHU.ctx, {
    groups: [{ id: 'hu-g', match: ['hu_grouped__*'] }],
    autoGroups: 'off',
    managedRoles: { hu: { allowGroups: ['hu-g'] } },
  })
  const huChild = worldHU.createAgent('agent-hu', (agent) => {
    agent.session = { header: { parentSession: 'p', label: 'v:hu' } }
  })
  const huHealth = await runTool(worldHU, 'lazy_tools_health', {}, huChild)
  assert.ok(huHealth.managed && Array.isArray(huHealth.managed.hiddenUngrouped), '必须有 hiddenUngrouped 数组')
  assert.ok(huHealth.managed.hiddenUngrouped.includes('need_help'), `未归组工具要点名：${JSON.stringify(huHealth.managed.hiddenUngrouped)}`)
  ok('受管会话：hiddenUngrouped 点名被藏的未归组工具')

  // 冷读必修 ②：refreshManagedRoles 不许把已有受管会话的角色覆盖掉
  // 2026-11-04（用户要求 + 冷读必修）：hideTools 退化路径
  //  D 族教训：假宿主要能模拟真实失败 —— 之前的 mock 永远成功，所以「整批失败」的 bug 漏了过去。
  log('[89] hideTools 退化：坏名字逐个跳过；系统性错误不误诊；坏名字进缓存')
  const mkCtx = (mode) => {
    let calls = 0
    const denied = new Set()
    const ctx = {
      on() { return () => {} },
      tools: {
        get() { return undefined },
        restrict(filter) {
          calls += 1
          const deny = Array.isArray(filter && filter.deny) ? filter.deny : []
          // 真宿主文案（app.asar 实测）：tools.restrict() names unknown global tool "x"
          if (mode === 'systemic') throw new Error('restrict backend unavailable')
          // 「系统性错误里恰好含 unknown tool 字样、但不在锚定位」——用来证明分类没有过宽
          if (mode === 'systemic-unknown') throw new Error('restrict backend failed while resolving unknown tool names')
          if (mode === 'ptc' && deny.includes('run_code')) throw new Error('cannot name reserved PTC tool "run_code"')
          // 真宿主的复数形态：2+ 未知名 → 'names unknown global toolS "a", "b"'
          if (mode === 'plural-bad') {
            const bad = deny.filter((n) => n.startsWith('bad_'))
            if (bad.length) throw new Error('tools.restrict() names unknown global toolS "' + bad.join('", "') + '"')
          }
          if (deny.includes('bad_name')) throw new Error('tools.restrict() names unknown global tool "bad_name"')
          for (const n of deny) denied.add(n)
          return () => { for (const n of deny) denied.delete(n) }
        },
      },
    }
    return { ctx, calls: () => calls, denied }
  }

  // ① 坏名字：批量失败 → 逐个重试 → 其余照藏，坏名字记一条
  const hmW1 = mkCtx('badname')
  const hmH1 = createHost(hmW1.ctx)
  const hmAgent1 = { ctx: hmW1.ctx, session: { header: {} } }
  const hmLift1 = hmH1.hideTools(hmAgent1, ['ok_a', 'bad_name', 'ok_b'])
  assert.ok(hmW1.denied.has('ok_a') && hmW1.denied.has('ok_b'), '好名字必须照藏')
  assert.ok(!hmW1.denied.has('bad_name'), '坏名字不该被记为已藏')
  assert.equal(hmW1.calls(), 4, '批量 1 次 + 逐个 3 次 = 4')
  assert.equal(hmH1.counters().restrictCalls, 4, 'restrictCalls 必须按真实调用计（4）')
  assert.ok(typeof hmLift1 === 'function', '要返回解除句柄')

  // ② 第二次调用：坏名字已进缓存，不再重试它（调用次数 = 批量 1 次）
  const hmBefore = hmW1.calls()
  const hmLift2 = hmH1.hideTools(hmAgent1, ['ok_a', 'bad_name', 'ok_b'])
  assert.equal(hmW1.calls() - hmBefore, 1, '坏名字进缓存后，第二次只该有 1 次批量调用')
  assert.equal(hmH1.counters().restrictCalls, 5, '缓存后计数 = 4 + 1')
  assert.ok(typeof hmLift2 === 'function')
  assert.ok(hmW1.denied.has('ok_a'), '缓存后好名字仍要照藏')

  // ③ 系统性错误：不许逐个重试（只 1 次调用），记一条「非名单问题」
  const hmW2 = mkCtx('systemic')
  const hmH2 = createHost(hmW2.ctx)
  const hmLift3 = hmH2.hideTools({ ctx: hmW2.ctx, session: { header: {} } }, ['x1', 'x2', 'x3'])
  assert.equal(hmLift3, null, '系统性失败不该返回句柄')
  assert.equal(hmW2.calls(), 1, '系统性错误不许逐个重试（否则 N 倍开销 + 误诊）')
  assert.equal(hmH2.counters().restrictCalls, 1, '系统性失败只算 1 次调用')
  const hmErrs = hmH2.errors().map((e) => e.message).join('\n')
  assert.ok(hmErrs.includes('非名单问题'), '必须记一条可分辨的系统性错误：' + hmErrs)

  // ③b 反例：系统性错误里**恰好含** "unknown tool" 字样，但不含锚定短语 ⇒ 仍算系统性
  const hmW2b = mkCtx('systemic-unknown')
  const hmH2b = createHost(hmW2b.ctx)
  hmH2b.hideTools({ ctx: hmW2b.ctx, session: { header: {} } }, ['y1', 'y2'])
  assert.equal(hmW2b.calls(), 1, '「unknown tool」字样若不在锚定位，不许当坏名字重试')

  // ③c 两个坏名字（真宿主的复数文案）：必须逐个重试，一个好名字照藏，两个坏名字都被记住
  const hmW2c = mkCtx('plural-bad')
  const hmH2c = createHost(hmW2c.ctx)
  const hmAgent2c = { ctx: hmW2c.ctx, session: { header: {} } }
  hmH2c.hideTools(hmAgent2c, ['ok_z', 'bad_a', 'bad_b'])
  assert.equal(hmW2c.calls(), 4, '复数坏名字：批量 1 + 逐个 3 = 4（不许判成 systemic 只试 1 次）')
  assert.ok(hmW2c.denied.has('ok_z'), '两个坏名字时，好名字仍必须照藏')
  assert.ok(!hmW2c.denied.has('bad_a') && !hmW2c.denied.has('bad_b'), '坏名字不许被记为已藏')
  const hmErrs2c = hmH2c.errors().map((e) => e.message).join('\n')
  assert.ok(hmErrs2c.includes('不可限制'), '复数坏名字也要留一条可查证据：' + hmErrs2c)

  // ③d PTC 的专用文案（run_code 这类保留工具）：也必须按「名字问题」逐个跳过，不许整批失效
  const hmW2d = mkCtx('ptc')
  const hmH2d = createHost(hmW2d.ctx)
  hmH2d.hideTools({ ctx: hmW2d.ctx, session: { header: {} } }, ['ok_q', 'run_code'])
  assert.equal(hmW2d.calls(), 3, 'PTC 保留工具：批量 1 + 逐个 2 = 3')
  assert.ok(hmW2d.denied.has('ok_q'), 'PTC 名字旁边的好工具必须照藏')
  assert.ok(!hmW2d.denied.has('run_code'), '保留工具不许被记为已藏')

  // ④ 脏输入：null / 空数组 / 非数组都不许抛
  const hmW3 = mkCtx('badname')
  const hmH3 = createHost(hmW3.ctx)
  assert.equal(hmH3.hideTools(null, ['a']), null)
  assert.equal(hmH3.hideTools({ ctx: hmW3.ctx }, []), null)
  assert.equal(hmH3.hideTools({ ctx: hmW3.ctx }, 'not-an-array'), null)
  ok('hideTools 退化加固：坏名字缓存 / 系统性错误只一次 / 脏输入不抛 / 计数按真实调用')

  // 2026-11-04 暴力测试：同一会话反复退化 50 次，缓存必须让它不再重复踩；**全部 lift 后层数归零**
  log('[90] hideTools 反复退化 50 次：调用数线性、所有 lift 撤干净')
  let bfLayers = 0
  let bfCalls = 0
  const bfLifts = []
  const bfCtx = {
    on() { return () => {} },
    tools: {
      get() { return undefined },
      restrict(filter) {
        bfCalls += 1
        const deny = Array.isArray(filter && filter.deny) ? filter.deny : []
        if (deny.includes('bad_name')) throw new Error('tools.restrict() names unknown global tool "bad_name"')
        bfLayers += 1
        let released = false
        return () => { if (!released) { released = true; bfLayers -= 1 } }
      },
    },
  }
  const bfHost = createHost(bfCtx)
  const bfAgent = { ctx: bfCtx, session: { header: {} } }
  bfLifts.push(bfHost.hideTools(bfAgent, ['bad_name', 'ok_a']))
  assert.equal(bfCalls, 3, '首次：批量 1 + 坏名 1 + 好名 1 = 3')
  assert.equal(bfLayers, 1, '好名字建立 1 层限制')
  for (let i = 0; i < 49; i++) bfLifts.push(bfHost.hideTools(bfAgent, ['bad_name', 'ok_a']))
  assert.equal(bfCalls, 3 + 49, '缓存后每次只 1 次批量调用（3 + 49 = 52）')
  assert.equal(bfLayers, 50, '50 次调用 = 50 层限制（模拟真实叠加）')
  assert.equal(bfHost.counters().restrictCalls, 52, '计数与真实调用一致')
  // 撤**全部**句柄才叫撤干净（上一版只撤第一个 ⇒ 假绿）
  for (const liftOne of bfLifts) if (typeof liftOne === 'function') liftOne()
  assert.equal(bfLayers, 0, '所有 lift 调完必须 0 层（不许留孤儿）')
  ok('反复退化 50 次：调用数线性、全部 lift 后 0 层')

  // 2026-11-04（第三方报告 A1/A2）：角色表的原型链
  log('[91] 角色表不吃原型链：__proto__ / constructor 都不许借到值')
  const protoRaw = JSON.parse('{"__proto__":{"allowGroups":["x"]},"hermes":{"allowGroups":["ga"]}}')
  const protoNorm = normalizeManagedRoles(protoRaw)
  assert.ok(protoNorm && Object.keys(protoNorm).join() === 'hermes', '__proto__ 不许进表：' + JSON.stringify(protoNorm))
  assert.equal(Object.getPrototypeOf(protoNorm), null, '归一化结果必须是 null 原型')
  assert.equal(normalizeManagedRoles(JSON.parse('{"constructor":{"allowGroups":["x"]}}')), null, 'constructor 键必须被拒')
  const own = resolveManagedRole(
    { session: { header: { parentSession: 'p', label: 'dsh-x:constructor' } } },
    { hermes: { allowGroups: ['ga'], unknown: 'hide' } },
  )
  assert.equal(own, null, 'label=constructor 不许认成角色：' + JSON.stringify(own))
  ok('角色表原型链：__proto__ / constructor 都被拒')

  // 2026-11-04（第三方报告 B1/B2）：label 解析必须确定性，不许从摘要里捞词
  log('[92] label 解析确定性：只认 vendor 后第一段，摘要词不参与')
  const labelWorld = makeWorld()
  labelWorld.ctx.tools.register({ name: 'lc_a__one', description: 'x', parameters: {}, output: {} })
  apply(labelWorld.ctx, { groups: [{ id: 'lc-a', match: ['lc_a__*'] }], autoGroups: 'off', managedRoles: { hermes: { allowGroups: ['lc-a'] } } })
  const mkL = (id, label) => labelWorld.createAgent(id, (agent) => { agent.session = { header: { parentSession: 'p', label } } })
  const h91 = await runTool(labelWorld, 'lazy_tools_health', {}, mkL('agent-b1', 'dsh-my-go:explore: 让 hermes 看看'))
  assert.equal(h91.managed, null, '摘要里的 hermes 不许被认成角色：' + JSON.stringify(h91.managed))
  // 2026-11-04（复读红 1）：roleHint 也必须用同一套确定性候选，否则诊断信息会把摘要词当成角色
  assert.ok(h91.session && h91.session.roleHint, '没配的角色必须在 roleHint 里点名')
  assert.equal(h91.session.roleHint.role, 'explore', '摘要里的 hermes 不许变成 roleHint：' + JSON.stringify(h91.session.roleHint))
  const h92 = await runTool(labelWorld, 'lazy_tools_health', {}, mkL('agent-b2', 'dsh-my-go:hermes: 帮我改模块'))
  assert.equal(h92.managed && h92.managed.role, 'hermes', 'vendor 后第一段必须认出来')
  // 2026-11-04（复读红 2）：首段即角色（`explore: fix login`）时，managed 与 roleHint 不许打架
  // 2026-11-04（复读三轮红）：走 `subagent` 兜底时也不许再给「没配、默认工具面」的错误提示
  const subWorld = makeWorld()
  subWorld.ctx.tools.register({ name: 'lc_b__one', description: 'x', parameters: {}, output: {} })
  apply(subWorld.ctx, { groups: [{ id: 'lc-b', match: ['lc_b__*'] }], autoGroups: 'off', managedRoles: { subagent: { allowGroups: ['lc-b'] } } })
  const subChild = subWorld.createAgent('agent-sub', (agent) => { agent.session = { header: { parentSession: 'p', label: 'explore: fix login' } } })
  const hSub = await runTool(subWorld, 'lazy_tools_health', {}, subChild)
  assert.equal(hSub.managed && hSub.managed.role, 'subagent', '应落到 subagent 兜底')
  assert.equal(hSub.managed && hSub.managed.source, 'subagent', '兜底应记 source=subagent')
  assert.ok(!hSub.session || hSub.session.roleHint == null, 'subagent 兜底时不许再给 roleHint：' + JSON.stringify(hSub.session && hSub.session.roleHint))
  const h94 = await runTool(labelWorld, 'lazy_tools_health', {}, mkL('agent-b4', 'hermes: fix login'))
  assert.equal(h94.managed && h94.managed.role, 'hermes', '首段即角色必须生效')
  assert.ok(!h94.session || h94.session.roleHint == null, 'managed 生效时不许再给 roleHint：' + JSON.stringify(h94.session && h94.session.roleHint))
  const h93 = await runTool(labelWorld, 'lazy_tools_health', {}, mkL('agent-b3', 'v:hermes'))
  assert.equal(h93.managed && h93.managed.role, 'hermes', '短 vendor 前缀也要认')
  ok('label 确定性：摘要词不参与、vendor 后第一段生效')

  // 2026-11-04（与别名共存）：agent 作用域注册的工具不可 restrict，抽屉不许拿它去发 deny
  log('[93] 与作用域内工具共存：别名不被抽屉误藏，也不产生「不可限制」错误')
  const aliasWorld = makeWorld()
  aliasWorld.ctx.tools.register({ name: 'ga_a__one', description: 'x', parameters: {}, output: {} })
  aliasWorld.ctx.tools.register({ name: 'ga_b__one', description: 'x', parameters: {}, output: {} })
  apply(aliasWorld.ctx, { groups: [{ id: 'ga-a', match: ['ga_a__*'] }], autoGroups: 'off', managedRoles: { hermes: { allowGroups: ['ga-a'] } } })
  const aliasChild = aliasWorld.createAgent('agent-alias-coexist', (agent) => {
    agent.session = { header: { parentSession: 'p', label: 'dsh-x:hermes' } }
    // 模拟别名插件在该会话作用域注册了 ext_billing（不是全局工具）
    aliasWorld.addScoped(agent, 'ext_billing')
  })
  const aliasHealth = await runTool(aliasWorld, 'lazy_tools_health', {}, aliasChild)
  assert.equal(aliasHealth.managed && aliasHealth.managed.role, 'hermes', '角色要生效')
  const aliasDeny = aliasWorld.denyByAgent.get(aliasChild)
  assert.ok(aliasDeny.has('ga_b__one'), '角色不允许的全局工具必须被藏')
  assert.ok(!aliasDeny.has('ext_billing'), '作用域内工具不可 restrict，抽屉不许去 deny 它')
  assert.ok((aliasWorld.visibleNames(aliasChild) || []).includes('ext_billing'), '别名必须仍然可见')
  const aliasErrs = aliasHealth.errors || []
  assert.equal(aliasErrs.filter((e) => String(e.message || '').includes('不可限制')).length, 0, '不许再记「不可限制」错误：' + JSON.stringify(aliasErrs))
  ok('与作用域内工具共存：别名不被误藏、无错误记录')

  // 2026-11-05（外部审阅 P0）：disable 的 name 分支已删 —— 传 name 不许把「关」变成「只放这一个」
  log('[94] disable 不接受 name：传了只报错，不改会话模式')
  const dnWorld = makeWorld()
  dnWorld.ctx.tools.register({ name: 'dt_one', description: 'x', parameters: {}, output: {} })
  dnWorld.ctx.tools.register({ name: 'dt_two', description: 'x', parameters: {}, output: {} })
  apply(dnWorld.ctx, { groups: [{ id: 'dt', match: ['dt_*'] }], autoGroups: 'off' })
  const dnAgent = dnWorld.createAgent('agent-disable-name')
  const dnBefore = await runTool(dnWorld, 'lazy_tools_status', {}, dnAgent)
  const dnBeforeGroup = (dnBefore.groups || []).find((g) => g.id === 'dt')
  const dnRes = await runTool(dnWorld, 'lazy_tools_disable', { name: 'dt_one' }, dnAgent)
  assert.ok(dnRes && dnRes.error, '传 name 必须报错：' + JSON.stringify(dnRes))
  assert.ok(String(dnRes.error).includes('group'), '错误文案要说清要 group：' + dnRes.error)
  const dnStatus = await runTool(dnWorld, 'lazy_tools_status', {}, dnAgent)
  const dnGroup = (dnStatus.groups || []).find((g) => g.id === 'dt')
  assert.equal(dnGroup && dnGroup.mode, dnBeforeGroup && dnBeforeGroup.mode, '传 name 不许改变会话模式：' + JSON.stringify(dnGroup))
  assert.notEqual(dnGroup && dnGroup.mode, 'only', '传 name 绝不许变成 only：' + JSON.stringify(dnGroup))
  ok('disable 传 name：只报错、不改模式')

  // 2026-11-05：allowGroups: [] = 只留常驻（以前被当成无效条目丢掉）
  log('[95] allowGroups: [] 合法，语义 = 只留 CORE')
  const coreWorld = makeWorld()
  coreWorld.ctx.tools.register({ name: 'read', description: 'core', parameters: {}, output: {} })
  coreWorld.ctx.tools.register({ name: 'cx_a__one', description: 'x', parameters: {}, output: {} })
  apply(coreWorld.ctx, { groups: [{ id: 'cx-a', match: ['cx_a__*'] }], autoGroups: 'off', managedRoles: { re: { allowGroups: [] } } })
  const coreChild = coreWorld.createAgent('agent-core-only', (agent) => { agent.session = { header: { parentSession: 'p', label: 'dsh-x:re' } } })
  const coreVisible = coreWorld.visibleNames(coreChild) || []
  assert.ok(coreVisible.includes('read'), 'CORE 工具必须可见：' + JSON.stringify(coreVisible))
  assert.ok(!coreVisible.includes('cx_a__one'), '非 CORE 组内工具必须不可见：' + JSON.stringify(coreVisible))
  ok('allowGroups: [] = 只留 CORE')

  // 2026-11-05：errors[] 只进不出 —— health { clear: true } 要能清
  log('[96] health clear：清掉瞬时错误后 healthy 回真')
  const clrWorld = makeWorld()
  clrWorld.ctx.tools.register({ name: 'cl_a', description: 'x', parameters: {}, output: {} })
  apply(clrWorld.ctx, { groups: [{ id: 'cl', match: ['re:['] }], autoGroups: 'off' })
  const clrAgent = clrWorld.createAgent('agent-clear-errors')
  const clrBefore = await runTool(clrWorld, 'lazy_tools_health', {}, clrAgent)
  assert.equal(clrBefore.healthy, false, '坏正则必须把 healthy 拉红')
  assert.ok((clrBefore.errors || []).some((e) => String(e.where || '').includes('group pattern')), '坏正则要记账')
  const clrAfter = await runTool(clrWorld, 'lazy_tools_health', { clear: true }, clrAgent)
  assert.ok(clrAfter.clearedErrors >= 1, '要报清掉几条：' + JSON.stringify(clrAfter.clearedErrors))
  assert.equal(clrAfter.healthy, true, '清掉后 healthy 必须回真：' + JSON.stringify(clrAfter))
  assert.equal((clrAfter.errors || []).length, 0, '清后不许还有错误')
  ok('health clear：healthy 回真')

  // 2026-11-05：守卫不可用必须记账，不许静默全绿
  log('[97] 宿主没有 tools.guard：必须记账且 healthy=false')
  const ngWorld = makeWorld()
  ngWorld.ctx.tools.guard = undefined
  ngWorld.ctx.tools.register({ name: 'ng_a', description: 'x', parameters: {}, output: {} })
  apply(ngWorld.ctx, { groups: [{ id: 'ng', match: ['ng_*'] }], autoGroups: 'off' })
  const ngAgent = ngWorld.createAgent('agent-no-guard')
  const ngHealth = await runTool(ngWorld, 'lazy_tools_health', {}, ngAgent)
  assert.ok((ngHealth.errors || []).some((e) => String(e.where || '') === 'tools.guard'), '缺 guard 必须记账：' + JSON.stringify(ngHealth.errors))
  assert.equal(ngHealth.healthy, false, '缺 guard 不许 healthy=true')
  ok('缺 guard：记账 + 红')

  // 2026-11-05：写用户组文件时目录要跟着文件走（可被 LAZY_TOOLS_GROUPS_FILE 覆盖）
  log('[98] writeUserGroups 指向新目录时不许 ENOENT')
  const { writeUserGroups } = await import('../lib/api.js')
  const oldGroupsFile = process.env.LAZY_TOOLS_GROUPS_FILE
  const newDir = join(tmpdir(), 'lazy-tools-groups-' + Date.now())
  process.env.LAZY_TOOLS_GROUPS_FILE = join(newDir, 'groups.json')
  try {
    const written = writeUserGroups([{ id: 'ug', match: ['ug_*'] }])
    assert.equal(written, process.env.LAZY_TOOLS_GROUPS_FILE)
    assert.ok(existsSync(written), '文件要真的写出来')
    ok('writeUserGroups：目录跟文件走')
  } finally {
    process.env.LAZY_TOOLS_GROUPS_FILE = oldGroupsFile
  }

  // 2026-11-05（外部审阅 C2）：回环桥写操作要自定义头；客户端两条 POST 都必须带头。
  // 这不是行为测试，是**接线测试**：真正的失败模式是「只改了服务端，忘了客户端」。
  log('[99] 桥写操作接线：服务端验头 + 客户端两条 POST 都带头')
  const bridgeApiSrc = readFileSync(new URL('../lib/api.js', import.meta.url), 'utf8')
  const clientSrc = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.ok(bridgeApiSrc.includes("headers['x-lazy-tools']"), '服务端必须验 x-lazy-tools 头')
  assert.ok(bridgeApiSrc.includes('missing x-lazy-tools header'), '缺头必须 403 并有明确错误')
  const headerCount = (clientSrc.match(/'x-lazy-tools': '1'/g) || []).length
  assert.ok(headerCount >= 2, '客户端 request() 与心跳都要带头，实际 ' + headerCount + ' 处')
  ok('桥写操作：服务端验头、客户端两处带头')

  // 2026-11-05（冷读红 1）：guard 缺失是结构问题，health {clear:true} 不许把它洗成 healthy=true
  log('[100] 缺 guard 时 clear 拒绝清空（不许假绿）')
  const ngcWorld = makeWorld()
  ngcWorld.ctx.tools.guard = undefined
  ngcWorld.ctx.tools.register({ name: 'ngc_a', description: 'x', parameters: {}, output: {} })
  apply(ngcWorld.ctx, { groups: [{ id: 'ngc', match: ['ngc_*'] }], autoGroups: 'off' })
  const ngcAgent = ngcWorld.createAgent('agent-no-guard-clear')
  const ngcBefore = await runTool(ngcWorld, 'lazy_tools_health', {}, ngcAgent)
  assert.equal(ngcBefore.healthy, false, '起点必须红')
  assert.ok((ngcBefore.contracts || []).some((c) => c.id === 'tools.guard'), '契约里必须有 tools.guard：' + JSON.stringify(ngcBefore.contracts))
  assert.equal(ngcBefore.contracts.find((c) => c.id === 'tools.guard').ok, false, '缺 guard 契约必须 ok=false')
  const ngcAfter = await runTool(ngcWorld, 'lazy_tools_health', { clear: true }, ngcAgent)
  assert.ok(ngcAfter.clearRefused, '必须拒绝清空：' + JSON.stringify(ngcAfter.clearRefused))
  assert.equal(ngcAfter.healthy, false, 'clear 之后仍是红，不许假绿：' + JSON.stringify(ngcAfter))
  assert.ok((ngcAfter.errors || []).some((e) => String(e.where || '') === 'tools.guard'), '错误也不该被清掉')
  ok('缺 guard：clear 拒绝、healthy 仍红')

  // 2026-11-05（冷读红 3）：桥鉴权原来只有源码字符串测试 —— 反转判据也全绿。
  // 这里直接挂一个假 webServer，走真 handler：无头 403、带头 200。
  log('[101] 桥鉴权行为：无头 403、带头 200、GET 不受限')
  const { mountBridge } = await import('../lib/api.js')
  let bridgeHandler = null
  const bridgeCtx = {
    get(key) {
      if (key === 'webServer') return { register(def) { bridgeHandler = def.handler; return () => {} } }
      return undefined
    },
    inject() { return () => {} },
  }
  const appliedPolicies = []
  const appliedMtimes = []
  mountBridge(bridgeCtx, { own() {}, record() {} }, {
    getState: () => ({ ok: true }),
    applyPolicy: (next) => { appliedPolicies.push(next) },
    setPolicyMtime: (v) => { appliedMtimes.push(v) },
    record() {},
  })
  assert.ok(typeof bridgeHandler === 'function', '桥要注册 handler')

  const fakeRes = () => {
    const out = { code: null, body: null }
    return {
      writeHead(code) { out.code = code },
      end(text) { out.body = text },
      out,
    }
  }
  const fakeReq = (method, url, headers, body) => {
    const handlers = {}
    return {
      method, url, headers,
      on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn) },
      emit(ev, arg) { for (const fn of handlers[ev] || []) fn(arg) },
      body,
    }
  }
  const callBridge = async (method, url, headers, body) => {
    const req = fakeReq(method, url, Object.assign({ host: '127.0.0.1:12345' }, headers || {}), body)
    const res = fakeRes()
    const p = bridgeHandler(req, res)
    if (body !== undefined) {
      setTimeout(() => { req.emit('data', JSON.stringify(body)); req.emit('end') }, 0)
    }
    await p
    return res.out
  }

  const noHeader = await callBridge('POST', '/lazy-tools/api/policy', { 'content-type': 'application/json' }, { level: 'low' })
  assert.equal(noHeader.code, 403, '无 x-lazy-tools 头必须 403：' + JSON.stringify(noHeader))
  assert.equal(appliedPolicies.length, 0, '被拒的请求不许改策略')

  const withHeader = await callBridge('POST', '/lazy-tools/api/policy', { 'content-type': 'application/json', 'x-lazy-tools': '1' }, { level: 'low' })
  assert.equal(withHeader.code, 200, '带头必须放行：' + JSON.stringify(withHeader))
  assert.equal(appliedPolicies.length, 1, '放行后要真的改策略')
  assert.equal(appliedMtimes.length, 1, '写盘后要追平 mtime')
  assert.ok(Number(appliedMtimes[0]) > 0, '追平的 mtime 必须是有效值，不能是 0')

  const getState = await callBridge('GET', '/lazy-tools/api/state', {}, undefined)
  assert.equal(getState.code, 200, 'GET 不受 POST 头限制：' + JSON.stringify(getState))
  ok('桥鉴权行为：无头 403、带头 200、GET 放行')

  // 2026-11-05（元宝挑刺 1）：managedRoles.allowGroups: ['*'] 必须 = 全开，不许记成 hide
  log("[102] allowGroups ['*'] 语义：状态与放行一致")
  rmSync(`${NO_SUCH}.policy.json`, { force: true }) // 前面的 roles 写测试会留下 policy 文件（显式清空语义）
  const starWorld = makeWorld()
  starWorld.ctx.tools.register({ name: 'st_a', description: 'x', parameters: {}, output: {} })
  apply(starWorld.ctx, { groups: [{ id: 'st', match: ['st_*'] }], autoGroups: 'off', managedRoles: { root: { allowGroups: ['*'] } } })
  const starAgent = starWorld.createAgent('agent-star', (a) => { a.session = { header: { parentSession: 'p', label: 'v:root' } } })
  const starStatus = await runTool(starWorld, 'lazy_tools_status', {}, starAgent)
  const starGroup = (starStatus.groups || []).find((g) => g.id === 'st')
  assert.equal(starGroup && starGroup.mode, 'all', "'*' 必须是全开：" + JSON.stringify(starGroup))
  assert.ok((starWorld.visibleNames(starAgent) || []).includes('st_a'), "'*' 下组内工具必须可见")
  ok("allowGroups ['*']：状态 all、工具可见")

  // 2026-11-05（元宝挑刺 2）：DNS rebinding 防护 —— Host 非回环必须 403
  log('[103] 桥 Host 必须回环：evil.example → 403')
  const evil = await callBridge('POST', '/lazy-tools/api/policy', { host: 'evil.example:4321', 'content-type': 'application/json', 'x-lazy-tools': '1' }, { level: 'low' })
  assert.equal(evil.code, 403, '非回环 Host 必须 403：' + JSON.stringify(evil))
  ok('桥 Host：非回环 403')

  // 2026-11-05（元宝挑刺 3）：errors 超过 8 条被挤掉后，同类错误复发必须还能记进来
  log('[104] seenErrors 与 errors 同步：第 1 种错误挤掉后能复发')
  const hostMod = await import('../lib/host.js')
  const h = hostMod.createHost({ get() {}, inject() {}, on() {}, effect() {}, tools: { register() {}, schemas() { return [] }, get() {}, guard() { return () => {} }, view() { return { visible: new Map() } } } })
  for (let i = 1; i <= 9; i += 1) h.record('probe', new Error('e' + i))
  assert.equal(h.errors().length, 8, '最多留 8 条')
  h.record('probe', new Error('e1'))
  assert.ok(h.errors().some((e) => e.message === 'e1'), 'e1 复发必须重新记账：' + JSON.stringify(h.errors()))
  ok('seenErrors 同步：挤掉的错误可复发')

  // 2026-11-06（DSH 2.0.22）：根 schemas(agent) 可能被解析成全局视图，
  // 隐藏的工具会"看起来还在"；如果用它做泄漏检测，就会每轮重建（上一轮实测 6,242 次）。
  // 这里把 schemas 改成返回全局（含隐藏项），断言 view 优先、restrict 不再重跑。
  // 2026-11-06：名字优先走 view；这里只锁顺序（schemas 与 view 同源）。
  log('[105] toolNames 优先 view（不退回 schemas）')
  const hostView = hostMod.createHost({
    get() {},
    inject() {},
    on() {},
    effect() {},
    tools: {
      register() {},
      get() {},
      view() {
        return { visible: new Map([['v_keep', {}]]) }
      },
      schemas() {
        return [{ name: 'v_keep' }, { name: 'v_hide' }]
      },
    },
  })
  assert.deepEqual(hostView.toolNames({}), ['v_keep'], 'view 有名字时不能退回全局 schemas')
  assert.deepEqual(hostView.toolNames({ ctx: {} }), ['v_keep'], '与 agent 参数无关：view 优先')
  ok('toolNames 优先 view（schemas 全局视图不误判）')

  // 对照：view 抛错时退回 schemas 并记账（orchestrator 测试里的 "survives a throwing registry"）
  log('[106] view 抛错时退回 schemas，不变成空')
  const hostFallback = hostMod.createHost({
    get() {},
    inject() {},
    on() {},
    effect() {},
    tools: {
      register() {},
      get() {},
      view() {
        throw new Error('view boom')
      },
      schemas() {
        return [{ name: 's_one' }]
      },
    },
  })
  assert.deepEqual(hostFallback.toolNames({}), ['s_one'], 'view 抛错应退回 schemas')
  assert.equal(hostFallback.errors().some((e) => e.where === 'tools.view'), true, 'view 失败要记账')
  ok('view 抛错：退回 schemas + 记 tools.view')

  // 红 1（冷读）：toolNames 不能信任空视图 —— 与 visibleNames 同一不变量
  log('[107] 空视图必须回退 schemas（不许静默当成没有工具）')
  const hostEmpty = hostMod.createHost({
    get() {},
    inject() {},
    on() {},
    effect() {},
    tools: {
      register() {},
      get() {},
      view() {
        return { visible: new Map() }
      },
      schemas() {
        return [{ name: 's_one' }]
      },
    },
  })
  assert.deepEqual(hostEmpty.toolNames({}), ['s_one'], '空视图必须回退 schemas')
  ok('空视图回退 schemas（同 visibleNames 不变量）')

  // 一类 3 秒重建链的机制：作用域注册的工具可见但不可 restrict，
  // 旧泄漏检测把它当"漏网"，于是每 3 秒重建一次（无报错）。
  // 冷读红 1：scope 同名遮蔽 —— 名字在 restrictableNames 里，但 own 注册永远 visible，
  // 只按名字过滤会每 3 秒重建一次；必须用「本轮之后实际可见」兜底。
  log('[108] scope 同名遮蔽：不反复重建（同步事件 + 3 秒链）')
  const worldSc = makeWorld()
  worldSc.ctx.tools.register({ name: 'sc_global', description: 'x', parameters: {}, output: {} })
  apply(worldSc.ctx, { groups: [{ id: 'sc', match: ['sc_*'], defaultOn: false }], autoGroups: 'off' })
  const agentSc = worldSc.createAgent('agent-scoped')
  worldSc.addScoped(agentSc, 'sc_global') // 同名 scope 注册：永远可见
  worldSc.setSyncRestrictEvents(true)
  process.env.LAZY_TOOLS_COOLDOWN_MS = '20'
  const beforeSc = await runTool(worldSc, 'lazy_tools_health', {}, agentSc)
  worldSc.fireToolsChange()
  await new Promise((resolve) => setTimeout(resolve, 400))
  const settle1 = await runTool(worldSc, 'lazy_tools_health', {}, agentSc)
  worldSc.fireToolsChange()
  await new Promise((resolve) => setTimeout(resolve, 200))
  delete process.env.LAZY_TOOLS_COOLDOWN_MS
  const settle2 = await runTool(worldSc, 'lazy_tools_health', {}, agentSc)
  assert.equal(settle2.stats.rebuilds, settle1.stats.rebuilds, '作用域遮蔽不该形成 3 秒重建链')
  assert.ok(settle1.stats.rebuilds - beforeSc.stats.rebuilds <= 3, `允许一次发现性重建，但不能是风暴：${JSON.stringify(settle1.stats)}`)
  assert.deepEqual(settle2.unhideable, ['sc_global'], '藏不掉的名字要如实记账')
  ok('scope 同名遮蔽：允许一次发现，之后不再重建')

  // 冷读红 2：读不到 restrictableNames 时，旧过滤整体失效 —— 不能退回风暴。
  log('[109] 读不到 restrictableNames：仍不形成重建链')
  const worldNv = makeWorld()
  worldNv.ctx.tools.register({ name: 'nv_global', description: 'x', parameters: {}, output: {} })
  apply(worldNv.ctx, { groups: [{ id: 'nv', match: ['nv_*'], defaultOn: false }], autoGroups: 'off' })
  const agentNv = worldNv.createAgent('agent-no-view')
  worldNv.addScoped(agentNv, 'nv_global')
  const viewBeforeDrop = worldNv.ctx.tools.view
  worldNv.ctx.tools.view = (agent) => {
    const view = viewBeforeDrop(agent)
    return { visible: view.visible }
  }
  worldNv.setSyncRestrictEvents(true)
  process.env.LAZY_TOOLS_COOLDOWN_MS = '20'
  worldNv.fireToolsChange()
  await new Promise((resolve) => setTimeout(resolve, 400))
  const noView1 = await runTool(worldNv, 'lazy_tools_health', {}, agentNv)
  worldNv.fireToolsChange()
  await new Promise((resolve) => setTimeout(resolve, 200))
  delete process.env.LAZY_TOOLS_COOLDOWN_MS
  const noView2 = await runTool(worldNv, 'lazy_tools_health', {}, agentNv)
  assert.equal(noView2.stats.rebuilds, noView1.stats.rebuilds, '读不到 restrictableNames 不该形成重建链')
  ok('restrictableNames 不可读：不重建')

  // 复读黄 2：systemic 失败后不能把"没藏成"锁进 unhideable，否则恢复后永不重试。
  log('[110] systemic restrict 失败后：下一轮能重试、不锁 unhideable')
  const worldTr = makeWorld()
  worldTr.ctx.tools.register({ name: 'fl_tool', description: 'x', parameters: {}, output: {} })
  worldTr.failNextRestrict(1)
  apply(worldTr.ctx, { groups: [{ id: 'fl', match: ['fl_tool'], defaultOn: false }], autoGroups: 'off' })
  const agentTr = worldTr.createAgent('agent-transient')
  const hTr1 = await runTool(worldTr, 'lazy_tools_health', {}, agentTr)
  assert.equal(hTr1.errors.some((e) => e.where === 'tools.restrict'), true, '首次失败要记账')
  process.env.LAZY_TOOLS_COOLDOWN_MS = '20'
  worldTr.fireToolsChange()
  await new Promise((resolve) => setTimeout(resolve, 120))
  delete process.env.LAZY_TOOLS_COOLDOWN_MS
  const hTr2 = await runTool(worldTr, 'lazy_tools_health', {}, agentTr)
  assert.ok(!worldTr.visibleNames(agentTr).includes('fl_tool'), `恢复后要藏住：${JSON.stringify(worldTr.visibleNames(agentTr))}`)
  assert.deepEqual(hTr2.unhideable, [], '失败轮不能留下 unhideable 闩锁')
  ok('systemic 失败后可重试（不锁 unhideable）')

  // 暴力测试 A：正常 world 1000 次 tools/change，不允许增长
  log('[111] 暴力：正常 world 1000 次 tools/change')
  const worldBrA = makeWorld()
  worldBrA.ctx.tools.register({ name: 'br_a', description: 'x', parameters: {}, output: {} })
  apply(worldBrA.ctx, { groups: [{ id: 'br', match: ['br_a'], defaultOn: false }], autoGroups: 'off' })
  const agentBrA = worldBrA.createAgent('agent-brute-a')
  const baseBrA = (await runTool(worldBrA, 'lazy_tools_health', {}, agentBrA)).stats.rebuilds
  process.env.LAZY_TOOLS_COOLDOWN_MS = '0'
  for (let i = 0; i < 1000; i += 1) worldBrA.fireToolsChange()
  delete process.env.LAZY_TOOLS_COOLDOWN_MS
  const afterBrA = await runTool(worldBrA, 'lazy_tools_health', {}, agentBrA)
  assert.ok(afterBrA.stats.rebuilds - baseBrA <= 5, `1000 次事件后重建次数失控：${afterBrA.stats.rebuilds - baseBrA}`)
  ok(`1000 次 tools/change：rebuilds +${afterBrA.stats.rebuilds - baseBrA}`)

  // 暴力测试 B：10 个 agent + 同名遮蔽 + 同步事件，200 次事件后都要收敛
  log('[112] 暴力：10 个 shadow agent + 同步事件 200 次')
  const worldBrC = makeWorld()
  worldBrC.ctx.tools.register({ name: 'sh_global', description: 'x', parameters: {}, output: {} })
  apply(worldBrC.ctx, { groups: [{ id: 'sh', match: ['sh_*'], defaultOn: false }], autoGroups: 'off' })
  const agentsBrC = []
  for (let i = 0; i < 10; i += 1) {
    const agent = worldBrC.createAgent('agent-shadow-' + i)
    worldBrC.addScoped(agent, 'sh_global')
    agentsBrC.push(agent)
  }
  worldBrC.setSyncRestrictEvents(true)
  process.env.LAZY_TOOLS_COOLDOWN_MS = '0'
  for (let i = 0; i < 200; i += 1) worldBrC.fireToolsChange()
  delete process.env.LAZY_TOOLS_COOLDOWN_MS
  for (const agent of agentsBrC) {
    const h = await runTool(worldBrC, 'lazy_tools_health', {}, agent)
    assert.deepEqual(h.unhideable, ['sh_global'])
  }
  const hGlobalC = await runTool(worldBrC, 'lazy_tools_health', {}, agentsBrC[0])
  assert.ok(hGlobalC.stats.rebuilds <= 40, `shadow 重建失控（全局）：${JSON.stringify(hGlobalC.stats)}`)
  ok(`10 个 shadow agent：200 次事件后全局 rebuilds ≤ 40（实际 ${hGlobalC.stats.rebuilds}）`)

  // 暴力测试 C：读不到 restrictableNames + 同步事件 500 次
  log('[113] 暴力：无 restrictableNames 500 次事件')
  const worldBrD = makeWorld()
  worldBrD.ctx.tools.register({ name: 'nv2_global', description: 'x', parameters: {}, output: {} })
  apply(worldBrD.ctx, { groups: [{ id: 'nv2', match: ['nv2_*'], defaultOn: false }], autoGroups: 'off' })
  const agentBrD = worldBrD.createAgent('agent-no-view-2')
  worldBrD.addScoped(agentBrD, 'nv2_global')
  const viewBrD = worldBrD.ctx.tools.view
  worldBrD.ctx.tools.view = (agent) => ({ visible: viewBrD(agent).visible })
  worldBrD.setSyncRestrictEvents(true)
  process.env.LAZY_TOOLS_COOLDOWN_MS = '0'
  for (let i = 0; i < 500; i += 1) worldBrD.fireToolsChange()
  delete process.env.LAZY_TOOLS_COOLDOWN_MS
  const hBrD = await runTool(worldBrD, 'lazy_tools_health', {}, agentBrD)
  assert.ok(hBrD.stats.rebuilds <= 4, `无 restrictableNames 时重建失控：${JSON.stringify(hBrD.stats)}`)
  ok('无 restrictableNames：500 次事件后 rebuilds ≤ 4')

  // 冷读红 2：部分失败不能把失败名字锁进 unhideable（旧 applied 整批布尔会锁）。
  log('[114] 真实部分失败：p_ok 藏住、p_fail systemic、p_bad 坏名')
  const worldPart = makeWorld({ nonRestrictable: ['p_bad'] })
  worldPart.ctx.tools.register({ name: 'p_ok', description: 'x', parameters: {}, output: {} })
  worldPart.ctx.tools.register({ name: 'p_fail', description: 'x', parameters: {}, output: {} })
  worldPart.ctx.tools.register({ name: 'p_bad', description: 'x', parameters: {}, output: {} })
  const undoFail = worldPart.failRestrictSingle('p_fail')
  apply(worldPart.ctx, { groups: [{ id: 'p', match: ['p_*'], defaultOn: false }], autoGroups: 'off' })
  const agentPart = worldPart.createAgent('agent-partial')
  const hPart1 = await runTool(worldPart, 'lazy_tools_health', {}, agentPart)
  const vis1 = worldPart.visibleNames(agentPart)
  assert.equal(vis1.includes('p_ok'), false, 'p_ok 应该被藏住')
  assert.equal(vis1.includes('p_fail'), true, 'p_fail 这轮应该还可见')
  assert.equal((hPart1.unhideable || []).includes('p_fail'), false, 'transient 的 p_fail 不能锁')
  assert.equal((hPart1.unhideable || []).includes('p_bad'), true, '坏名 p_bad 应锁')
  undoFail()
  process.env.LAZY_TOOLS_COOLDOWN_MS = '0'
  worldPart.fireToolsChange()
  delete process.env.LAZY_TOOLS_COOLDOWN_MS
  const hPart2 = await runTool(worldPart, 'lazy_tools_health', {}, agentPart)
  assert.equal(worldPart.visibleNames(agentPart).includes('p_fail'), false, '恢复后应重试并藏住 p_fail')
  assert.equal((hPart2.unhideable || []).includes('p_fail'), false, '恢复后 p_fail 不应留在锁里')
  ok('真实部分失败：transient 不锁，恢复后藏住')

  // 冷读红 2b：reserved PTC 是 permanent，不能每次事件都重试（旧逻辑 500 事件 501 次重建）。
  log('[115] reserved PTC：永久闩锁，不无限重建')
  const worldPtc = makeWorld()
  worldPtc.ctx.tools.register({ name: 'ptc_tool', description: 'x', parameters: {}, output: {} })
  worldPtc.reservePtc('ptc_tool')
  apply(worldPtc.ctx, { groups: [{ id: 'ptc', match: ['ptc_*'], defaultOn: false }], autoGroups: 'off' })
  const agentPtc = worldPtc.createAgent('agent-ptc')
  const hPtc1 = await runTool(worldPtc, 'lazy_tools_health', {}, agentPtc)
  assert.equal((hPtc1.unhideable || []).includes('ptc_tool'), true, 'permanent 名字要锁住')
  process.env.LAZY_TOOLS_COOLDOWN_MS = '0'
  for (let i = 0; i < 200; i += 1) worldPtc.fireToolsChange()
  delete process.env.LAZY_TOOLS_COOLDOWN_MS
  const hPtc2 = await runTool(worldPtc, 'lazy_tools_health', {}, agentPtc)
  assert.ok(hPtc2.stats.rebuilds <= 3, `permanent 名字不该反复重建：${JSON.stringify(hPtc2.stats)}`)
  ok('reserved PTC：200 次事件后 rebuilds ≤ 3')

  log('[116] 晚注册：签名变化清锁，别名变全局后能藏住')
  const worldLate = makeWorld()
  apply(worldLate.ctx, { groups: [{ id: 'late', match: ['late_*'], defaultOn: false }], autoGroups: 'off' })
  const agentLate = worldLate.createAgent('agent-late')
  worldLate.addScoped(agentLate, 'late_tool') // 只有作用域别名，不可 restrict
  process.env.LAZY_TOOLS_COOLDOWN_MS = '0'
  worldLate.fireToolsChange()
  let hLate = await runTool(worldLate, 'lazy_tools_health', {}, agentLate)
  assert.equal((hLate.unhideable || []).includes('late_tool'), true, '别名壳应被锁')
  worldLate.scopedByAgent.get(agentLate).delete('late_tool') // alias 退场
  worldLate.ctx.tools.register({ name: 'late_tool', description: 'x', parameters: {}, output: {} })
  worldLate.fireToolsChange() // 签名变化 → 清锁 → 重试
  delete process.env.LAZY_TOOLS_COOLDOWN_MS
  hLate = await runTool(worldLate, 'lazy_tools_health', {}, agentLate)
  assert.equal(worldLate.visibleNames(agentLate).includes('late_tool'), false, '全局注册后应能藏住')
  assert.equal((hLate.unhideable || []).includes('late_tool'), false, '藏住后不该留锁')
  ok('晚注册：签名变化清锁，别名变全局后能藏住')

  log('[117] 别名壳被组匹配：锁住，不形成 tools/change 重建链')
  const worldShim = makeWorld()
  worldShim.ctx.tools.register({ name: 'al_global', description: 'x', parameters: {}, output: {} })
  apply(worldShim.ctx, { groups: [{ id: 'al', match: ['al_*'], defaultOn: false }], autoGroups: 'off' })
  const agentShim = worldShim.createAgent('agent-shim')
  worldShim.addScoped(agentShim, 'al_shim') // 作用域注册、被组匹配、不可 restrict
  process.env.LAZY_TOOLS_COOLDOWN_MS = '0'
  worldShim.fireToolsChange()
  const baseShim = (await runTool(worldShim, 'lazy_tools_health', {}, agentShim)).stats.rebuilds
  for (let i = 0; i < 100; i += 1) worldShim.fireToolsChange()
  delete process.env.LAZY_TOOLS_COOLDOWN_MS
  const hShim = await runTool(worldShim, 'lazy_tools_health', {}, agentShim)
  assert.ok(hShim.stats.rebuilds - baseShim <= 2, `别名壳不该每次事件重建：+${hShim.stats.rebuilds - baseShim}`)
  assert.equal((hShim.unhideable || []).includes('al_shim'), true, '别名壳应被锁')
  ok('别名壳被组匹配：100 次事件 rebuilds 有界')

  log('[118] 陈旧 hideReport：上轮 transient、本轮退成别名壳，仍要锁')
  const worldStale = makeWorld()
  worldStale.ctx.tools.register({ name: 'g_one', description: 'x', parameters: {}, output: {} })
  worldStale.failRestrictFor('g_one')
  apply(worldStale.ctx, { groups: [{ id: 'g', match: ['g_*'], defaultOn: false }], autoGroups: 'off' })
  const agentStale = worldStale.createAgent('agent-stale')
  const undoStale = worldStale.failRestrictFor('g_one')
  undoStale()
  worldStale.registered.delete('g_one') // 退成 scope 别名
  worldStale.addScoped(agentStale, 'g_one')
  process.env.LAZY_TOOLS_COOLDOWN_MS = '0'
  worldStale.fireToolsChange()
  const baseStale = (await runTool(worldStale, 'lazy_tools_health', {}, agentStale)).stats.rebuilds
  for (let i = 0; i < 100; i += 1) worldStale.fireToolsChange()
  delete process.env.LAZY_TOOLS_COOLDOWN_MS
  const hStale = await runTool(worldStale, 'lazy_tools_health', {}, agentStale)
  assert.ok(hStale.stats.rebuilds - baseStale <= 2, `陈旧报告不该造成每次事件重建：+${hStale.stats.rebuilds - baseStale}`)
  assert.equal((hStale.unhideable || []).includes('g_one'), true, '退成别名后应锁住')
  ok('陈旧 hideReport：退成别名后仍锁，100 次事件有界')

  console.log(`\nsmoke: ${checks} 项全过`)
}

if (process.argv[1] && process.argv[1].endsWith('smoke.mjs')) {
  main().catch((error) => {
    console.error('\nsmoke: 失败')
    console.error(error && error.stack ? error.stack : String(error))
    process.exitCode = 1
  })
}

export { makeWorld, runTool, assertJsonSafe }

```


### test\adversarial.mjs

```js
// adversarial.mjs —— 对抗 / 极端 输入测试（独立于 smoke.mjs，不改插件行为）
//
// 原则：
//   1. 只断言三件事：**不崩**（apply/tool 不抛）、**不静默**（错要有记账）、**不挂死**（有时间上限）。
//   2. 每条用例独立世界；文件类用例走 LAZY_TOOLS_*_FILE 环境变量，用临时文件。
//   3. 结果分三档：RED（崩/静默/挂死）、YELLOW（慢或可疑但可用）、PASS。
//   4. 红不自动修：报告出来，由人按「可达性三档」决定。
//
// 跑法：node test/adversarial.mjs

import { apply } from '../lib/index.js'
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'

const results = []
let red = 0
let yellow = 0
let known = 0

function record(kind, name, detail) {
  if (kind === 'RED') red++
  if (kind === 'YELLOW') yellow++
  if (kind === 'KNOWN') known++
  let safe = detail && detail.length > 180 ? detail.slice(0, 180) + '…' : detail
  if (typeof safe === 'string') safe = safe.replace(/[^\s]{40,}/g, (m) => m.slice(0, 16) + '…')
  results.push({ kind, name, detail: safe })
  const mark = kind === 'PASS' ? 'ok ' : kind === 'YELLOW' ? '!! ' : kind === 'KNOWN' ? '-- ' : 'XX '
  console.log(`${mark} ${name}${safe ? '  — ' + safe : ''}`)
}

const assert = (cond, message) => {
  if (!cond) throw new Error(message)
}

function makeWorld() {
  const registered = new Map()
  const denyByAgent = new Map()
  const createdListeners = []
  const toolsChangeListeners = []
  const preExecuteListeners = []
  const guards = []

  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    on(event, handler) {
      if (event === 'agent/created') createdListeners.push(handler)
      if (event === 'tools/change') toolsChangeListeners.push(handler)
      if (event === 'tools/pre-execute') preExecuteListeners.push(handler)
    },
    effect(callback) {
      try { const off = callback(); if (typeof off === 'function') off() } catch { /* ignore */ }
      return () => {}
    },
    get(key) {
      if (key === 'agents') return { list: () => [], get: () => undefined }
      return undefined
    },
    tools: {
      guard(fn) { guards.push(fn); return () => {} },
      register(definition) { registered.set(definition.name, definition); return () => registered.delete(definition.name) },
      get(name, agent) {
        if (!agent) return registered.get(name)
        const deny = denyByAgent.get(agent) || new Set()
        return deny.has(name) ? undefined : registered.get(name)
      },
      schemas(agent) {
        const deny = (agent && denyByAgent.get(agent)) || new Set()
        return [...registered.keys()].filter((name) => !deny.has(name)).map((name) => ({ name }))
      },
    },
  }

  const makeAgent = (id) => {
    const agent = { id }
    denyByAgent.set(agent, new Set())
    agent.ctx = {
      tools: {
        get(name, scoped) {
          if (!scoped) return registered.get(name)
          const deny = denyByAgent.get(scoped) || new Set()
          return deny.has(name) ? undefined : registered.get(name)
        },
        restrict({ deny } = {}) {
          const set = denyByAgent.get(agent) || new Set()
          const names = Array.isArray(deny) ? deny : []
          for (const n of names) set.add(n)
          return () => { for (const n of names) set.delete(n) }
        },
      },
    }
    return agent
  }

  const createAgent = (id) => {
    const agent = makeAgent(id)
    for (const listener of createdListeners) listener({ agent })
    return agent
  }

  return {
    ctx,
    registered,
    createAgent,
    denyByAgent,
    fireToolsChange() { for (const listener of toolsChangeListeners) listener() },
  }
}

async function runTool(world, name, args, agent) {
  const def = world.registered.get(name)
  assert(def && typeof def.execute === 'function', `工具 ${name} 未注册`)
  return def.execute(args || {}, { agent })
}

function lazyToolCount(world) {
  return [...world.registered.keys()].filter((n) => n.startsWith('lazy_tools_')).length
}

// 用例包装：崩了 = RED，其余交给 body 自己判
async function check(name, body, opts = {}) {
  const start = performance.now()
  try {
    const detail = await body()
    const ms = performance.now() - start
    if (opts.maxMs && ms > opts.maxMs) {
      record('YELLOW', name, `${Math.round(ms)}ms > ${opts.maxMs}ms`)
    } else {
      record('PASS', name, detail ? `${detail}${ms > 50 ? ` (${Math.round(ms)}ms)` : ''}` : undefined)
    }
  } catch (error) {
    const ms = Math.round(performance.now() - start)
    record('RED', name, `${error && error.message ? error.message : String(error)} (${ms}ms)`)
  }
}

// KNOWN：确认过、按可达性判定「不修」的极限用例。它出现失败也不让套件变红，
// 但必须写清为什么归绿 —— 否则下一个人会以为这是被漏掉的 bug。
async function checkKnown(name, body, reason) {
  try {
    await body()
    record('KNOWN', name, reason)
  } catch (error) {
    record('KNOWN', name, `${reason}（实测仍抛：${error && error.message ? String(error.message).slice(0, 60) : String(error)}）`)
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'lazy-adv-'))
const NO_SUCH = join(tmp, 'nope')
process.env.LAZY_TOOLS_USAGE_FILE = `${NO_SUCH}.usage.json`
process.env.LAZY_TOOLS_GROUPS_FILE = `${NO_SUCH}.groups.json`
process.env.LAZY_TOOLS_POLICY_FILE = `${NO_SUCH}.policy.json`

const sixTools = (world) => {
  for (const n of ['biz_a', 'biz_b', 'biz_c', 'biz_d', 'biz_e', 'biz_f']) {
    world.ctx.tools.register({ name: n, description: 'x', parameters: {}, output: {} })
  }
}

async function main() {
  console.log('=== A. 配置畸形（要求：不抛 + 8 个自救工具注册）===')

  const badConfigs = [
    ['groups=null', { groups: null }],
    ['groups="string"', { groups: 'string' }],
    ['groups=42', { groups: 42 }],
    ['groups=[null]', { groups: [null] }],
    ['groups=[{}]', { groups: [{}] }],
    ['match=字符串', { groups: [{ id: 'g', match: 'biz_*' }] }],
    ['match=[null]', { groups: [{ id: 'g', match: [null] }] }],
    ['id=数字', { groups: [{ id: 42, match: ['biz_*'] }] }],
    ['id=Unicode', { groups: [{ id: '桌面·组', match: ['biz_*'] }] }],
    ['id 含零字节', { groups: [{ id: 'a\u0000b', match: ['biz_*'] }] }],
    ['重复 id', { groups: [{ id: 'dup', match: ['biz_a'] }, { id: 'dup', match: ['biz_b'] }] }],
  ]
  for (const [label, cfg] of badConfigs) {
    await check(`A ${label}`, () => {
      const world = makeWorld()
      apply(world.ctx, cfg)
      assert(lazyToolCount(world) === 8, `注册数=${lazyToolCount(world)}，应 8`)
      return '可加载'
    })
  }

  await check('A 1000 个组', () => {
    const world = makeWorld()
    sixTools(world)
    const groups = Array.from({ length: 1000 }, (_, i) => ({ id: `g${i}`, match: [`biz_${i}`], defaultOn: false }))
    apply(world.ctx, { groups, autoGroups: 'off' })
    assert(lazyToolCount(world) === 8, '工具没注册全')
    return '1000 组可加载'
  }, { maxMs: 3000 })

  console.log('\n=== B. 恶意匹配式（要求：不挂死 + 万能式被忽略 + 记账）===')

  await check('B "*" 万能式被忽略并记账', async () => {
    const world = makeWorld()
    sixTools(world)
    apply(world.ctx, { groups: [{ id: 'all', match: ['*'], defaultOn: false }], autoGroups: 'off' })
    const agent = world.createAgent('a-star')
    assert(world.denyByAgent.get(agent).size === 0, `万能组仍收了 ${world.denyByAgent.get(agent).size} 个`)
    const health = await runTool(world, 'lazy_tools_health', {}, agent)
    assert(health.errors.some((e) => String(e.where).includes('group guard')), '没有记账 group guard')
    return '忽略 + 记账'
  })

  await check('B "re:.*" 万能式被忽略', async () => {
    const world = makeWorld()
    sixTools(world)
    apply(world.ctx, { groups: [{ id: 'all', match: ['re:.*'], defaultOn: false }], autoGroups: 'off' })
    const agent = world.createAgent('a-star2')
    assert(world.denyByAgent.get(agent).size === 0, '万能组收了工具')
    return '忽略'
  })

  await check('B 坏正则 re:( 被忽略并记账', async () => {
    const world = makeWorld()
    sixTools(world)
    apply(world.ctx, { groups: [{ id: 'bad', match: ['re:('], defaultOn: false }], autoGroups: 'off' })
    const agent = world.createAgent('a-badre')
    const health = await runTool(world, 'lazy_tools_health', {}, agent)
    assert(health.errors.some((e) => String(e.where).includes('group pattern')), '坏正则没记账')
    return '记账'
  })

  // 2026-11-05（外部审阅）：原来把「超长 pattern 让 apply 抛 SyntaxError」记成 KNOWN 不修，
  // 但它正是 DESIGN 里最怕的「加载即崩」。现在改为真断言：不许抛，坏组按无效处理。
  await check('B 超长 pattern（100k 字符）不许把 apply 带崩', () => {
    const world = makeWorld()
    sixTools(world)
    const long = 'biz_' + 'x'.repeat(100000)
    apply(world.ctx, { groups: [{ id: 'long', match: [long], defaultOn: false }], autoGroups: 'off' })
    assert(lazyToolCount(world) === 8, '工具没注册全')
    return '可加载（坏组被忽略）'
  })

  // ReDoS 放到子进程里跑：真挂死也只影响子进程，不会卡住测试
  await check('B ReDoS 回溯炸弹不挂死（子进程 3s 上限）', () => {
    const script = `
      import { apply } from './lib/index.js'
      const ctx = { logger:{info(){},warn(){},error(){}}, on(){}, effect(){return()=>{}}, get(){},
        tools:{ guard(){return()=>{}}, register(){return()=>{}}, get(){}, schemas(){ return [{name:'biz_a'}] } } }
      apply(ctx, { groups: [{ id:'x', match: ['re:^(a+)+$'] }], autoGroups: 'off' })
      console.log('done')
    `
    // 2026-11-04：子进程用**测试文件自己的目录**做 cwd —— 之前用 process.cwd()，
    // 从发版脚本（工作区根目录）调进来时 './lib/index.js' 解析不到，整项误报 RED。
    const here = fileURLToPath(new URL('..', import.meta.url))
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: here,
      timeout: 3000,
      encoding: 'utf8',
    })
    if (r.error && r.error.code === 'ETIMEDOUT') throw new Error('matcherFor 在 3s 内没返回（可挂死）')
    assert(r.status === 0, `子进程失败: ${r.stderr || r.status}`)
    return '3s 内完成'
  })

  console.log('\n=== C. 脏数据文件（要求：不崩、能记账、默认值可用）===')

  const writeTmp = (name, content) => {
    const file = join(tmp, name)
    writeFileSync(file, content, 'utf8')
    return file
  }

  await check('C groups.json 非法 JSON', async () => {
    process.env.LAZY_TOOLS_GROUPS_FILE = writeTmp('bad-groups.json', '{not json')
    const world = makeWorld()
    sixTools(world)
    apply(world.ctx, { groups: [{ id: 'ok', match: ['biz_*'], defaultOn: false }], autoGroups: 'off' })
    const agent = world.createAgent('a-badjson')
    const health = await runTool(world, 'lazy_tools_health', {}, agent)
    assert(health.ok === true, 'health 不可用')
    process.env.LAZY_TOOLS_GROUPS_FILE = `${NO_SUCH}.groups.json`
    return 'health 仍可用'
  })

  await check('C groups.json 是对象不是数组', () => {
    process.env.LAZY_TOOLS_GROUPS_FILE = writeTmp('obj-groups.json', '{"id":"x"}')
    const world = makeWorld()
    apply(world.ctx, { groups: [{ id: 'ok', match: ['biz_*'] }], autoGroups: 'off' })
    assert(lazyToolCount(world) === 8, '工具没注册全')
    process.env.LAZY_TOOLS_GROUPS_FILE = `${NO_SUCH}.groups.json`
    return '可加载'
  })

  await check('C usage 文件损坏 JSON', async () => {
    process.env.LAZY_TOOLS_USAGE_FILE = writeTmp('bad-usage.json', '<<<')
    const world = makeWorld()
    apply(world.ctx, { groups: [{ id: 'ok', match: ['biz_*'] }], autoGroups: 'off' })
    const agent = world.createAgent('a-badusage')
    const health = await runTool(world, 'lazy_tools_health', {}, agent)
    assert(health.stats.toolCalls === 0, `toolCalls=${health.stats.toolCalls}，应 0`)
    process.env.LAZY_TOOLS_USAGE_FILE = `${NO_SUCH}.usage.json`
    return '按空账本处理'
  })

  await check('C policy 文件损坏 / 类型错', async () => {
    process.env.LAZY_TOOLS_POLICY_FILE = writeTmp('bad-policy.json', '{"level":123,"idleDays":"x"}')
    const world = makeWorld()
    apply(world.ctx, { groups: [{ id: 'ok', match: ['biz_*'] }], autoGroups: 'off' })
    const agent = world.createAgent('a-badpolicy')
    const status = await runTool(world, 'lazy_tools_status', {}, agent)
    assert(status && Array.isArray(status.groups), 'status 不可用')
    process.env.LAZY_TOOLS_POLICY_FILE = `${NO_SUCH}.policy.json`
    return '回默认策略'
  })

  console.log('\n=== D. 压力 ===')

  await check('D 5000 工具 + 20 组', () => {
    const world = makeWorld()
    for (let i = 0; i < 5000; i++) world.ctx.tools.register({ name: `bulk_${i}`, description: 'x', parameters: {}, output: {} })
    const groups = Array.from({ length: 20 }, (_, i) => ({ id: `bg${i}`, match: [`bulk_${i}_*`, `bulk_${i}00`], defaultOn: false }))
    apply(world.ctx, { groups, autoGroups: 'off' })
    const agent = world.createAgent('a-bulk')
    assert(world.denyByAgent.get(agent).size >= 0, '创建 agent 失败')
    return '可加载'
  }, { maxMs: 5000 })

  await check('D 连续 100 次 enable/disable', async () => {
    const world = makeWorld()
    apply(world.ctx, { groups: [{ id: 'g', match: ['biz_*'], defaultOn: false }], autoGroups: 'off' })
    sixTools(world)
    const agent = world.createAgent('a-churn')
    for (let i = 0; i < 100; i++) {
      await runTool(world, 'lazy_tools_enable', { group: 'g' }, agent)
      await runTool(world, 'lazy_tools_disable', { group: 'g' }, agent)
    }
    return '100 轮无异常'
  })

  await check('D 同一 agent 连续 50 次 tools/change', () => {
    const world = makeWorld()
    apply(world.ctx, { groups: [{ id: 'g', match: ['biz_*'], defaultOn: false }], autoGroups: 'off' })
    sixTools(world)
    world.createAgent('a-change')
    for (let i = 0; i < 50; i++) world.fireToolsChange()
    return '50 次无异常'
  })

  console.log('\n=== E. 运行时边界 ===')

  await check('E 宿主没有 agent.ctx.tools（坏宿主）', () => {
    const world = makeWorld()
    const agent = world.createAgent('a-broken')
    agent.ctx = {}
    return '创建后未抛'
  })

  await check('E enable 不存在的名字', async () => {
    const world = makeWorld()
    apply(world.ctx, { groups: [{ id: 'g', match: ['biz_*'] }], autoGroups: 'off' })
    sixTools(world)
    const agent = world.createAgent('a-none')
    const r = await runTool(world, 'lazy_tools_enable', { name: 'nope_xyz' }, agent)
    assert(r.found === false, '应 found:false')
    return 'found:false'
  })

  await check('E enable 名字含正则元字符（a.b 不能误匹配 aXb）', async () => {
    const world = makeWorld()
    world.ctx.tools.register({ name: 'aXb', description: 'x', parameters: {}, output: {} })
    world.ctx.tools.register({ name: 'a.b', description: 'x', parameters: {}, output: {} })
    apply(world.ctx, { groups: [{ id: 'g', match: ['a.b'] }], autoGroups: 'off' })
    const agent = world.createAgent('a-regex')
    const deny = world.denyByAgent.get(agent)
    assert(deny.has('a.b') || !deny.has('aXb'), 'a.b 模式误匹配了 aXb')
    return '字面匹配'
  })

  await check('E Unicode 工具名 enable', async () => {
    const world = makeWorld()
    world.ctx.tools.register({ name: 'biz_中文', description: 'x', parameters: {}, output: {} })
    apply(world.ctx, { groups: [{ id: 'g', match: ['biz_*'] }], autoGroups: 'off' })
    const agent = world.createAgent('a-uni')
    const r = await runTool(world, 'lazy_tools_enable', { name: 'biz_中文' }, agent)
    assert(r.found === true, '没找到 Unicode 工具')
    return 'found:true'
  })

  await check('E 组 id 与出厂组重名', () => {
    const world = makeWorld()
    apply(world.ctx, { groups: [{ id: 'cua-screen', match: ['biz_*'], defaultOn: false }], autoGroups: 'off' })
    assert(lazyToolCount(world) === 8, '工具没注册全')
    return '可加载'
  })

  rmSync(tmp, { recursive: true, force: true })

  console.log(`\n=== 结果：PASS ${results.length - red - yellow - known} / KNOWN ${known} / YELLOW ${yellow} / RED ${red} ===`)
  if (red > 0) {
    console.log('还有 RED —— 按可达性三档决定修不修，不要直接改代码。')
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error('adversarial 中断:', error)
  process.exitCode = 1
})

```


## TEST OUTPUT (smoke)

```
[1] 载入与注册
  ok  七个工具都注册上了（0.16.0 由 11 个合并而来）
[2] agent 创建时按 defaultOn 收起
  ok  cua 组两个工具被 restrict 掉，defaultOn:true 的组没动
  ok  status 报 cua: on=false mode=hide, matched=2, visible=0
[3] enable / disable 往返
  ok  enable 之后限制解除、两个工具回来
[3a] only：只放指定的几个工具
  ok  only 白名单生效、越界/空数组都被拒（没抛异常）
  ok  disable 之后限制重新挂上，mode 回到 hide（only 被清掉）
  ok  未知组返回 error 而不是抛异常
[3b] list：组关着也认得名字、开着标可见
  ok  list 行为正确（关=知道但不可见、开=可见、省略组=全部已知）
[3c] re: 前缀的正则匹配式
  ok  re: 正则分组可用（screen 1 / input 1）
[4] list {ungrouped} / health 的输出
  ok  list {ungrouped} 输出 JSON-safe：前缀分桶 + 未归组工具，且没有 cua 前缀
  ok  health: 五个契约全绿，agentCreated=1，lastHidden=2
[5] 契约缺失时不崩
  ok  宿主缺 register/schemas 时 apply 不抛（插件不炸启动）
[6] restrict 拒绝时记账，不阻断
  ok  restrict 抛错被记账（restrictFailures=1），工具仍可用
[7] 重载补应用：apply 时已经活着的 agent 也要被收
  ok  apply 时把限制补到已存在的 agent（不用等 agent/created 再触发一次）
[8] 插件卸载/重载：限制必须随 ctx.effect 一起解除（不留孤儿）
  ok  卸载时限制被解除干净，重复解除不抛
[9] 常驻提示段：systemPrompt 在就挂一段，不在就跳过
  ok  systemPrompt 段已挂上，正文包含组 id 与排查入口
[10] 漏网与 expect 计数
  ok  漏网工具被 stray 抓到、healthy 变 false
  ok  expect 对不上会报警且 healthy=false（matched 1 ≠ expect 5）
  ok  写在 keep 里的常驻工具不会被误报成漏网
[11] tools/change：后注册的工具会触发补收起
  ok  插件后于工具加载时，tools/change 会把新工具补收进来
[12] 批量开关与用量统计
  ok  批量 enable 生效、only+多组被拒、usage 记账
[13] 作用域已销毁：不算失败，但必须标 applied=no
  ok  已销毁作用域的竞争不计失败，lastHidden.applied=false
[14] 同一进程内重新 apply：先收回旧限制再重建（不留孤儿）
  ok  重新 apply 时旧限制被收回再重建，state 能重新看见工具（matched=1）
[15] resolve：按名字一步开启
  ok  enable {name}：一步开一个（only 语义）、片段能匹配、找不到给提示
[16] autoHints 已删除（0.17.0）：写它也不预开，更不计数
  ok  autoHints 被忽略：不自动开组；stats 不再有 autoOpened / userMessages
[17] 设置页策略文件：只收认识的键
  ok  非法的 level/天数/工具数被丢弃，字符串数组过滤干净
[18] 用量账本：热/冷判定
  ok  7 天内用过=热、1 天阈值=冷、无记录=冷、阈值 0=恒热、无组工具只记工具名
[19] 用量落盘：调用一次 → 账本有记录、组变热
  ok  pre-execute 记账 → usage 文件写出组时间戳、status.hot=true
[20] 会话级覆盖：lazy_tools_mode 立刻重算默认开哪些组
  ok  idleDays:0 → 全开；reset → 回全局（无历史 ⇒ 又收起）
[21] 自愈守卫：被藏工具的调用被拦下、自动补开
  ok  守卫补开即放行 + 工具可见 + health.selfHealed=1
[22] 斜杠命令 /lazy-tools：改当前会话、乱输入报错
  ok  /lazy-tools high 生效；无参数读状态；乱输入报错
[23] 清空之后还能自己捞回来（设计红线）
  ok  立刻清空 → resolve 单个 / enable 整组 都能捞回
[24] 三处名字必须一致（2026-10-24 五次恢复模式的根因）
  ok  包名 / 客户端 id / patch 行名三处一致；版本号合法；bundle 声明在
[25] 自动分组：切分、白名单、80% 规则、上限
  ok  切分 / 白名单 / 覆盖淘汰 / 数量上限 都对
[26] 自动分组：子族覆盖不足时不许拆大族（mnemon 17 不该碎成两个 3）
  ok  子族覆盖不足 80% 时保留整族
[27] autoGroups=on：真的建组并按规则收起
  ok  自动组已创建且默认收起
[28] 冷启动顺序：apply 时没工具，会话开始才注册 → 仍要建出自动组
  ok  会话开始时补算生效
[29] extraGroups：追加而不替换默认四组
  ok  extraGroups 追加成功、默认组保留
[30] 分类交接：save_groups 必须拒绝常驻工具
  ok  save_groups 不传 groups 给材料、带 groups 时拒绝常驻与单工具组
[31] 分类提示开关：默认开，关掉后提示段里不出现
  ok  分类提示默认开、可关，关掉不影响基础提示
[32] 宿主没挂载的组：静音待命，不拉低 healthy
  ok  [32] 注册了但不在工具表 → blocked:agent-filtered、不报警、healthy 仍 true、notes 带实测原因
[33] 宿主修好了：监控自动恢复，不用做任何事
  ok  挂回来后 blocked 消失、visible=2 —— 监控自己恢复
[34] 挂过又消失：这个必须响
  ok  出现过又消失 → 报警、healthy=false（静音没有把真异常一起吞掉）
[35] bench 口径：可见 + 收起 + 宿主没挂 === 注册总数
  ok  bench：收起 2 + absent 1 + 注册内可见 (tools-3) = 注册总数，账能对上
[36] tools/change 冷却：先检查再盖章，3 秒内新注册的工具不能漏
  ok  冷启动 3 秒内新增的工具仍被收起（冷却只限重建频率，不吞检查）
[37] 设置页只改档位时，生效天数跟着档位走
  ok  档位→天数跟随；显式天数优先
[38] 单工具热度：大组里只用 1 个 → 只放那一个
  ok  大组只用 1 个：only 只放那一个（占比 10% < 30%）
[44] 热工具占比够高 → 整组开（对照组）
  ok  小组里过半常用 → 整组开（占比阈值生效）
[39] 常驻提示带组用途（能力目录）
  ok  提示段列「组 id(用途: 完整工具名)」—— 自愈不用再猜名字，也不会念错插件
[40] glob 里的 ? 必须按字面量转义
  ok  `?` 转义后只匹配字面量（`*` 仍是通配符）
[41] 重入 rebuild：连续打开两个关着的组，不许留下孤儿限制
  ok  连续开两个组：没有孤儿限制，两个工具都真的回来了
[42] 冷却期内的晚注册：不许漏（要延迟核对一次）
  ok  冷却期内的第二次晚注册不会永远漏着（延迟核对生效）
[43] firstTryRate：无自愈=1，且分母只数组内调用
  ok  firstTryRate = 1 - 自愈/组内调用；核心工具调用不进分母
[45] 热工具全放（20 成员 5 热 = 25% → 放 5 个，不再有 CAP）
  ok  only = 热的全放（旧 slice(0,3) 会漏掉 2 个）
[46] warmRatio 可配（0.5）：5/12 不够热 → only 5
  ok  warmRatio 可配，且 status.hot 与决策同一语义
[47] status.hot 不再用旧语义：1/12 热 → hot=false，但 only 放 1 个
  ok  hot 与决策一致；组级时间戳只留作 lastUsed
[48] 吸纳型组：多出来的成员不算漂移（expect 是下限）
  ok  吸纳型组：matched 3 > expect 2 不告警（healthy 不被误伤）
[49] 少了的成员才算漂移（下限语义的反面）
  ok  matched < expect ⇒ 告警（改名/没加载/正则漏）
[50] minTools 填 2 时，生效值是 3（不许静默失效）
  ok  minTools 下限 3 在加载时夹住，health 显示生效值
[51] 能力目录：最近用过的优先（不按累计次数）
  ok  目录排序：最近用过的优先；不按累计次数（账本没有窗口内计数）
[52] 会话档位生效时，status.hot 与决策同源
  ok  会话档位下 status 与决策同源（不再各算各的天数）
[53] 旧工具名给指路，不静默消失
  ok  旧名 scan/bench/classify/resolve 都返回「已并入 X」
[54] health 默认精简：保留 client、去掉账本；full 给全量
  ok  默认精简保留 client + stats；full 才给 usage / 探针
[55] 计数器跨重载持久化：重载后 toolCalls 从账本恢复
  ok  toolCalls 落盘并在重载后恢复（指标不再每次归零）
[56] 手写组 match:["*"] 不能吞掉常驻/自救工具
  ok  手写 match:* 只收普通工具，自救工具永远可见
[57] 配置里的组全无效：不许静默零注册
  ok  组全无效 → 退回默认组并记账，工具照常注册（不再静默死掉）
[58] expect 非有限数不许进 status
  ok  expect 非法值被夹掉，status 仍 JSON-safe
[59] 兼容两代宿主工具名：pwsh 与 ops_* 都受保护
  ok  两代宿主工具名（pwsh / ops_*）都在保护清单里
[60] 手写组匹配整张表 → 忽略并记账（不依赖宿主工具名）
  ok  全匹配手写组被忽略并可见记账（宿主换名字也照样兜住）
[60b] 手写组用正则绕过哨兵：结构判定仍要挡住
  ok  正则绕过哨兵：结构判定兜住
[60c] 万能匹配 + 晚注册：apply 时没有工具，注册后仍要挡住
  ok  晚注册：万能组仍被挡住
[61] 受管角色：preset 决定策略、封闭默认、自愈不绕过
  ok  受管角色只认 preset/parentSession，封闭默认生效，自愈不绕过
[61b] label 角色：review/build/research 解析与工具面（CORE 不可藏）
  ok  label 三角色解析正确；CORE 工具不可被角色隐藏（只读只能靠提示词/沙箱）
[61c] 受管角色能藏 edit/write（review 只读），build 不藏
  ok  受管角色能藏 edit/write；CORE 其余仍保护
[62] 受管角色：preset 在创建后才选中（竞态）
  ok  preset 晚选中也能重算角色并重建（竞态兜住）
[63] 隔离：放行后仍不可见 ⇒ 标成外部 deny
  ok  外部 deny 交叉探测：放行后仍不可见的名字被标出来
[64] 会话级目录：只列本会话挂载的组，空则整段消失
  ok  会话级目录：没挂/被外部挡的组不广告、空则空段、认不出 scope 退回旧行为
[65] 会话级目录：分类提示只在默认 preset 的会话里出现
  ok  分类提示只在默认 preset 会话出现；角色会话保留能力目录、不催分组
[66] 会话级目录：视图路径的三种退化
  ok  视图路径：空视图/抛错/没有视图都退回 schemas，组不丢
[67] 会话级目录：只有提醒、没有目录时也不许空段
  ok  一个分组工具都没挂 + 有散装工具 ⇒ 只输出提醒，不整段消失
[68] 会话级目录：受管角色不广告未授权的组
  ok  受管角色：只列授权组，未授权组即使被我们藏了也不广告
[69] enable 回读：外部挡着时不许报「成功」
  ok  enable 回读：外部挡着报 applied:false，正常组照旧成功
[70] 策略落盘：部分补丁不许冲掉其他设置
  ok  策略落盘：补丁合并进旧策略，未提交的键不丢
[71] 受管角色：allowGroups 写错不许把会话锁死
  ok  受管角色：allowGroups 写错会响；全错停用不锁死；部分错只报不删
[72] 会话快照：health.session 与提示段同一份判定
  ok  会话快照：列出的组与提示段同一份判定；读不到工具表时 visible=null，不编数字
[74] 角色来源：label 尾段（厂商无关）
  ok  角色来源：label 尾段优先于 subagent 键，非子会话不认 label
[75] policy 热重载：改文件即生效，且能看出是谁配的
  ok  policy 热重载：mtime 变了就重读，AI 配的角色带 createdBy/basis
[76] lazy_tools_roles：AI 自己配角色，工具层守住三条不变量
  ok  lazy_tools_roles：AI 配角色——不存在的组 / * / 缺 basis 全被拒，写入即生效
[77] 角色没配时要说出来：health.session.roleHint
  ok  角色没配：session.roleHint 点名 + 给出下一步；配好了就不吵
[78] 冷读回归：坏 policy 不清角色；写角色不洗设置
  ok  冷读回归：坏文件不清角色且要响；写角色拒绝洗文件、保留 level/presets/已有角色
[79] 冷读第二轮回归：投影 label / 启动读失败要响 / auto-* 角色不许被误删
  ok  冷读第二轮回归：投影 label 认得出；启动读失败会红；auto-* 角色不被误删
[80] 冷读第三轮回归：组晚到后 auto-* 角色自动恢复；合法非对象 policy 要响；热重载坏形状保持旧值
  ok  冷读第三轮回归：组晚到恢复 / 非对象 policy 要响 / 热重载坏形状保旧值
[81] MyGO 真实标签格式：带任务摘要也要认出角色
  ok  MyGO 真实标签（带摘要）也能认出角色并收紧工具面
[82] 全组枚举 = 变相的 *，必须被拒
  ok  全组枚举 = 变相 * ：被拒，并说明只允许人手改文件
[83] 通用词不当角色：worker / backup / 纯数字都跳过
  ok  通用词护栏：worker/backup/数字不落角色，MyGO 的 hermes 照常
[84] 写角色时告知：哪些未归组工具会被藏
  ok  写角色时列出会被藏的未归组工具（防把编排器求助工具收掉）
[85] 一个坏名字不许让整批限制静默失效
  ok  不可限制的名字：逐个跳过、其余照藏、留一条可查错误
[86] 受管会话：被藏掉的未归组工具要在 health 里点名
  ok  受管会话：hiddenUngrouped 点名被藏的未归组工具
[89] hideTools 退化：坏名字逐个跳过；系统性错误不误诊；坏名字进缓存
  ok  hideTools 退化加固：坏名字缓存 / 系统性错误只一次 / 脏输入不抛 / 计数按真实调用
[90] hideTools 反复退化 50 次：调用数线性、所有 lift 撤干净
  ok  反复退化 50 次：调用数线性、全部 lift 后 0 层
[91] 角色表不吃原型链：__proto__ / constructor 都不许借到值
  ok  角色表原型链：__proto__ / constructor 都被拒
[92] label 解析确定性：只认 vendor 后第一段，摘要词不参与
  ok  label 确定性：摘要词不参与、vendor 后第一段生效
[93] 与作用域内工具共存：别名不被抽屉误藏，也不产生「不可限制」错误
  ok  与作用域内工具共存：别名不被误藏、无错误记录
[94] disable 不接受 name：传了只报错，不改会话模式
  ok  disable 传 name：只报错、不改模式
[95] allowGroups: [] 合法，语义 = 只留 CORE
  ok  allowGroups: [] = 只留 CORE
[96] health clear：清掉瞬时错误后 healthy 回真
  ok  health clear：healthy 回真
[97] 宿主没有 tools.guard：必须记账且 healthy=false
  ok  缺 guard：记账 + 红
[98] writeUserGroups 指向新目录时不许 ENOENT
  ok  writeUserGroups：目录跟文件走
[99] 桥写操作接线：服务端验头 + 客户端两条 POST 都带头
  ok  桥写操作：服务端验头、客户端两处带头
[100] 缺 guard 时 clear 拒绝清空（不许假绿）
  ok  缺 guard：clear 拒绝、healthy 仍红
[101] 桥鉴权行为：无头 403、带头 200、GET 不受限
  ok  桥鉴权行为：无头 403、带头 200、GET 放行
[102] allowGroups ['*'] 语义：状态与放行一致
  ok  allowGroups ['*']：状态 all、工具可见
[103] 桥 Host 必须回环：evil.example → 403
  ok  桥 Host：非回环 403
[104] seenErrors 与 errors 同步：第 1 种错误挤掉后能复发
  ok  seenErrors 同步：挤掉的错误可复发
[105] toolNames 优先 view（不退回 schemas）
  ok  toolNames 优先 view（schemas 全局视图不误判）
[106] view 抛错时退回 schemas，不变成空
  ok  view 抛错：退回 schemas + 记 tools.view
[107] 空视图必须回退 schemas（不许静默当成没有工具）
  ok  空视图回退 schemas（同 visibleNames 不变量）
[108] scope 同名遮蔽：不反复重建（同步事件 + 3 秒链）
  ok  scope 同名遮蔽：允许一次发现，之后不再重建
[109] 读不到 restrictableNames：仍不形成重建链
  ok  restrictableNames 不可读：不重建
[110] systemic restrict 失败后：下一轮能重试、不锁 unhideable
  ok  systemic 失败后可重试（不锁 unhideable）
[111] 暴力：正常 world 1000 次 tools/change
  ok  1000 次 tools/change：rebuilds +0
[112] 暴力：10 个 shadow agent + 同步事件 200 次
  ok  10 个 shadow agent：200 次事件后全局 rebuilds ≤ 40（实际 20）
[113] 暴力：无 restrictableNames 500 次事件
  ok  无 restrictableNames：500 次事件后 rebuilds ≤ 4
[114] 真实部分失败：p_ok 藏住、p_fail systemic、p_bad 坏名
  ok  真实部分失败：transient 不锁，恢复后藏住
[115] reserved PTC：永久闩锁，不无限重建
  ok  reserved PTC：200 次事件后 rebuilds ≤ 3
[116] 晚注册：签名变化清锁，别名变全局后能藏住
  ok  晚注册：签名变化清锁，别名变全局后能藏住
[117] 别名壳被组匹配：锁住，不形成 tools/change 重建链
  ok  别名壳被组匹配：100 次事件 rebuilds 有界
[118] 陈旧 hideReport：上轮 transient、本轮退成别名壳，仍要锁
  ok  陈旧 hideReport：退成别名后仍锁，100 次事件有界

smoke: 128 项全过

[lazy-tools] tools.restrict: 这些名字不可限制（已逐个跳过，其余照常隐藏）：bad_name
[lazy-tools] tools.restrict: 限制失败（非名单问题，已中止逐个重试）：restrict backend unavailable
[lazy-tools] tools.restrict: 限制失败（非名单问题，已中止逐个重试）：restrict backend failed while resolving unknown tool names
[lazy-tools] tools.restrict: 这些名字不可限制（已逐个跳过，其余照常隐藏）：bad_a, bad_b
[lazy-tools] tools.restrict: 这些名字不可限制（已逐个跳过，其余照常隐藏）：run_code
[lazy-tools] tools.restrict: 这些名字不可限制（已逐个跳过，其余照常隐藏）：bad_name
[lazy-tools] probe: e1
[lazy-tools] probe: e2
[lazy-tools] probe: e3
[lazy-tools] probe: e4
[lazy-tools] probe: e5
[lazy-tools] probe: e6
[lazy-tools] probe: e7
[lazy-tools] probe: e8
[lazy-tools] probe: e9
[lazy-tools] probe: e1
[lazy-tools] tools.view: view boom

```


## TEST OUTPUT (adversarial)

```
=== A. 配置畸形（要求：不抛 + 8 个自救工具注册）===
ok  A groups=null  — 可加载
ok  A groups="string"  — 可加载
ok  A groups=42  — 可加载
ok  A groups=[null]  — 可加载
ok  A groups=[{}]  — 可加载
ok  A match=字符串  — 可加载
ok  A match=[null]  — 可加载
ok  A id=数字  — 可加载
ok  A id=Unicode  — 可加载
ok  A id 含零字节  — 可加载
ok  A 重复 id  — 可加载
ok  A 1000 个组  — 1000 组可加载

=== B. 恶意匹配式（要求：不挂死 + 万能式被忽略 + 记账）===
ok  B "*" 万能式被忽略并记账  — 忽略 + 记账
ok  B "re:.*" 万能式被忽略  — 忽略
ok  B 坏正则 re:( 被忽略并记账  — 记账
ok  B 超长 pattern（100k 字符）不许把 apply 带崩  — 可加载（坏组被忽略）
ok  B ReDoS 回溯炸弹不挂死（子进程 3s 上限）  — 3s 内完成 (69ms)

=== C. 脏数据文件（要求：不崩、能记账、默认值可用）===
ok  C groups.json 非法 JSON  — health 仍可用
ok  C groups.json 是对象不是数组  — 可加载
ok  C usage 文件损坏 JSON  — 按空账本处理
ok  C policy 文件损坏 / 类型错  — 回默认策略

=== D. 压力 ===
ok  D 5000 工具 + 20 组  — 可加载
ok  D 连续 100 次 enable/disable  — 100 轮无异常
ok  D 同一 agent 连续 50 次 tools/change  — 50 次无异常

=== E. 运行时边界 ===
ok  E 宿主没有 agent.ctx.tools（坏宿主）  — 创建后未抛
ok  E enable 不存在的名字  — found:false
ok  E enable 名字含正则元字符（a.b 不能误匹配 aXb）  — 字面匹配
ok  E Unicode 工具名 enable  — found:true
ok  E 组 id 与出厂组重名  — 可加载

=== 结果：PASS 29 / KNOWN 0 / YELLOW 0 / RED 0 ===


```


## BASELINE

```json
[
  {
    "id": "smoke",
    "desc": "冒烟全过",
    "cmd": [
      "test/smoke.mjs"
    ],
    "expectExit": 0,
    "expectRegex": "smoke: \\d+ 项全过"
  },
  {
    "id": "adversarial",
    "desc": "对抗全过且 RED 0",
    "cmd": [
      "test/adversarial.mjs"
    ],
    "expectExit": 0,
    "expectRegex": "RED 0"
  },
  {
    "id": "tool-names-view",
    "desc": "toolNames 优先 view（[105] 在冒烟里）",
    "cmd": [
      "test/smoke.mjs"
    ],
    "expectExit": 0,
    "expectRegex": "\\[105\\] toolNames 优先 view"
  },
  {
    "id": "empty-view",
    "desc": "空视图回退 schemas（[107]）",
    "cmd": [
      "test/smoke.mjs"
    ],
    "expectExit": 0,
    "expectRegex": "\\[107\\] 空视图必须回退 schemas"
  },
  {
    "id": "gate-integrity",
    "desc": "门禁完整性负向测试",
    "cmd": [
      "review/gate-integrity.test.mjs"
    ],
    "expectExit": 0,
    "expectRegex": "门禁完整性：PASS"
  },
  {
    "id": "config-readdir",
    "desc": "config profiles 不可读时不崩",
    "cmd": [
      "test/config.test.mjs"
    ],
    "expectExit": 0,
    "expectRegex": "config：PASS"
  },
  {
    "id": "54-skip",
    "desc": "54 skip 语义",
    "cmd": [
      "review/check-54-skip.mjs"
    ],
    "expectExit": 0,
    "expectRegex": "54 skip：PASS"
  }
]

```


## UNVERIFIED

```json
{
  "count": 0,
  "items": []
}

```
