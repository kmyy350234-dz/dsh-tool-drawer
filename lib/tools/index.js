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
