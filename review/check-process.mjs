// 流程一致性检查：只查可证伪的冲突，不查文风。
// 用法：node review/check-process.mjs [--root <工作区>]
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = dirname(here)
const workspace = process.argv[2] || join(repo, '..', '..')
const skill = join(process.env.USERPROFILE || process.env.HOME || '', '.dsh', 'skills', 'dev-ticket-loop', 'SKILL.md')
const incidentSkill = join(process.env.USERPROFILE || process.env.HOME || '', '.dsh', 'skills', 'incident-archive', 'SKILL.md')
const devFlow = join(workspace, 'perf-', '开发流程-20261103.md')
const archive = join(workspace, '翻车档案.md')

const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '')
const problems = []
const check = (name, ok, detail) => {
  if (ok) console.log(`PASS ${name}`)
  else {
    problems.push(`${name}：${detail}`)
    console.log(`FAIL ${name}：${detail}`)
  }
}

const processText = read(join(repo, 'PROCESS.md'))
const devText = read(devFlow)
const skillText = read(skill)
const incidentText = read(incidentSkill)

check('PROCESS.md 存在', processText.length > 0, '缺 PROCESS.md')
check('翻车档案存在', existsSync(archive), archive)
check('翻车档案条数口径=77', /77\s*条/.test(incidentText + read(archive)) || /77/.test(incidentText), '没有 77 条口径')
check(
  '没有 perf-\\翻车档案 错路径',
  !/perf-[\\/]翻车档案/.test(skillText + incidentText + devText),
  '存在 perf-\\翻车档案（实际在根目录）',
)
check(
  '恶性清单不在 -Skip 白名单',
  !/(可跳过|Skip)[^\n]*malignant/i.test(devText),
  '开发流程仍把 malignant 列为可跳过',
)
check(
  '发版是否需人看：只有一种说法',
  !(/发版不加人看一眼|不需要人看/.test(devText) && /发版[^\n]*先给用户过目|公开动作[^\n]*过目/.test(skillText)),
  '开发流程说发版不用人看，技能说公开动作要先过目（PROCESS 已裁决：发版免、其他要）',
)
check(
  '外部审阅时点：不横跳',
  !(/发版后/.test(devText) && /只在发版前|发版前一次/.test(devText)),
  '开发流程同时写"发版前"和"发版后"',
)
const reviewerCounts = new Set()
for (const text of [devText, skillText]) {
  for (const match of text.matchAll(/常设[^。\n]{0,12}?(\d+)\s*个/g)) reviewerCounts.add(match[1])
}
check('常设评审数量只有一个数', reviewerCounts.size <= 1, `出现 ${[...reviewerCounts].join('/')} 个`)
check(
  '不再要求"一条变异"',
  !/一条变异/.test(devText + skillText),
  '仍写"一条变异"（PROCESS 要求每测试一条）',
)
const counts = new Set()
for (const text of [devText, skillText, processText]) {
  for (const match of text.matchAll(/冒烟\s*(\d+)\s*项/g)) counts.add(match[1])
}
check('冒烟数字不写死冲突', counts.size <= 1, `出现 ${[...counts].join('/')} 项`)
check('冷读裁决脚本存在', existsSync(join(here, 'verify-coldread.mjs')), '缺 verify-coldread.mjs')
check('变异清单存在', existsSync(join(here, 'mutations.json')) && existsSync(join(here, 'mutate.mjs')), '缺 mutate')


// ---- 2026-11-06（元宝流程复审）：补 7 条硬约束 ----
let spec = null
try {
  spec = JSON.parse(readFileSync(join(here, 'gate-spec.json'), 'utf8'))
} catch {
  spec = null
}
check('gate-spec.json 存在且可解析', Boolean(spec), '缺 gate-spec.json')
check(
  'spec：恶性清单不可跳过',
  Boolean(spec && spec.notSkippable && spec.notSkippable.includes('malignant')),
  'notSkippable 缺 malignant',
)
check(
  'spec：常设 2 个 / 发版后 1 次',
  Boolean(spec && spec.standingReviewers === 2 && spec.postRelease && spec.postRelease.externalReview === 1),
  'standingReviewers 或 postRelease 不对',
)
check(
  '发版门槛不含外部审阅',
  !/## 5\.[\s\S]*?外部审阅[\s\S]*?## 6\./.test(devText),
  '§5 发版门槛仍列了外部审阅',
)
check(
  'P0 不再要求本轮修完',
  !/P0\s*必须在本轮修完/.test(devText),
  '仍写"P0 必须在本轮修完"',
)
const sixes = (devText.match(/^6\. /gm) || []).length
check('发版清单编号不重复', sixes <= 1, `出现 ${sixes} 个"6."`)
check(
  '不可跳过含恶性清单',
  /不可跳过[^\n]*恶性/.test(devText) && /不可跳过[^\n]*恶性/.test(skillText),
  '开发流程或技能的不跳过清单缺"恶性"',
)
check(
  'CI 跑 gate',
  /review\/gate\.mjs/.test(read(join(repo, '.github', 'workflows', 'test.yml')) || ''),
  'CI 没有 gate 步骤',
)


// ---- 2026-11-06 V4：把"只改一份"和"执行器没接"也变成断言 ----
check(
  '流程：新版本冷读必须新代理',
  /每个新版本[^\n]*新开子代理/.test(processText) && /新版本[^\n]*新子代理/.test(skillText),
  'PROCESS/技能缺"每个新版本新开子代理"',
)
check(
  '流程：同版本复读可复用',
  /同一版本[^\n]*复读/.test(processText) && /同一版本[^\n]*复读/.test(skillText),
  'PROCESS/技能缺"同一版本复读可复用"',
)
check(
  'spec：冷读独立性策略',
  Boolean(spec && /fresh-per-version/.test(spec.coldreadIndependence || '') && /same-version-recheck/.test(spec.coldreadIndependence || '')),
  'gate-spec 缺 coldreadIndependence',
)
check('spec：consistency 不可跳过', Boolean(spec && Array.isArray(spec.skippable) && !spec.skippable.includes('consistency')), 'gate-spec 仍允许跳过 consistency')
check('开发流程 §0 已降级', /不再作为派工硬门槛/.test(devText), '仍把写前查档当硬门槛')
check('技能读 verdict.json', /verdict\.json/.test(skillText), '技能仍以报告末行字符串为准')
check('技能 §13 不重复', (skillText.match(/## 十三、外部审阅/g) || []).length <= 1, '出现多个 §13 外部审阅')
const legacy = /一条变异|常设只保留 5|四个评论员|P0 必须在本轮|6e|11\+1/
check('派生文档无旧词', !legacy.test(devText + skillText), '仍有旧词：一条变异/5 个/四个评论员/P0 本轮/6e/11+1')
check('两份派生文档都指 PROCESS', /PROCESS\.md/.test(devText) && /PROCESS\.md/.test(skillText), '有一份没指向 PROCESS.md')

console.log(`\n流程检查：${problems.length === 0 ? 'PASS' : `FAIL（${problems.length} 项）`}`)
if (problems.length > 0) process.exitCode = 1
