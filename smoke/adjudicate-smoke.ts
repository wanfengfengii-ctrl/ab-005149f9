/**
 * 裁决业务模块冒烟：verify 服务在测试与构建之后执行，
 * 直接对 src/solver.ts 跑一组已知场景并断言关键行为，失败即非零退出。
 */
import { adjudicate, validateInputs } from '../src/solver'
import type { BlockInput, LimitsInput } from '../src/solver'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`SMOKE FAIL: ${msg}`)
    process.exit(1)
  }
}

// 场景一：示例数据应有可行方案，且每个前缀状态都满足载荷与力矩限制
const limits: LimitsInput = { capacity: 1200, torqueMin: -500, torqueMax: 500 }
const blocks: BlockInput[] = [
  { name: '配重1', mass: 300, options: [{ coord: -2, cost: 50 }, { coord: 1.5, cost: 60 }, { coord: 3, cost: 40 }] },
  { name: '配重2', mass: 250, options: [{ coord: -3, cost: 45 }, { coord: 2, cost: 55 }] },
  { name: '配重3', mass: 200, options: [{ coord: -1, cost: 30 }, { coord: 0.5, cost: 35 }, { coord: 2.5, cost: 25 }] },
  { name: '配重4', mass: 150, options: [{ coord: -2.5, cost: 20 }, { coord: 1, cost: 28 }] },
  { name: '配重5', mass: 100, options: [{ coord: -0.5, cost: 10 }, { coord: 0.8, cost: 12 }, { coord: 2, cost: 8 }] },
]

assert(validateInputs(blocks, limits).length === 0, '示例输入应通过校验')
const r1 = adjudicate(blocks, limits)
assert(r1.feasible, '示例场景应存在可行方案')
if (r1.feasible) {
  const p = r1.plan
  assert(p.steps.length === blocks.length, '每块配重应恰好挂装一次')
  assert(new Set(p.steps.map((s) => s.blockIndex)).size === blocks.length, '配重录入序号不应重复')
  let m = 0
  let t = 0
  let minMargin = Infinity
  for (const s of p.steps) {
    m += s.mass
    t += s.mass * s.coord
    assert(m <= limits.capacity + 1e-9, `第 ${s.blockIndex + 1} 块后前缀载荷越界`)
    assert(t >= limits.torqueMin - 1e-9 && t <= limits.torqueMax + 1e-9, `第 ${s.blockIndex + 1} 块后前缀力矩越界`)
    minMargin = Math.min(minMargin, Math.min(limits.torqueMax - t, t - limits.torqueMin))
  }
  assert(Math.abs(minMargin - p.minMargin) < 1e-6, '方案力矩余量口径应与逐步余量一致')
}

// 确定性：同一输入两次裁决结果完全一致
const r2 = adjudicate(blocks, limits)
assert(JSON.stringify(r1) === JSON.stringify(r2), '裁决结果应确定可复现')

// 场景二：最终力矩可平衡但任一单步越界 —— 必须判无解并给出力矩触发诊断
const bad: BlockInput[] = [
  { name: 'A', mass: 10, options: [{ coord: 10, cost: 1 }, { coord: 10, cost: 1 }] },
  { name: 'B', mass: 10, options: [{ coord: -10, cost: 1 }, { coord: -10, cost: 1 }] },
  { name: 'C', mass: 1, options: [{ coord: 0, cost: 0 }, { coord: 0, cost: 0 }] },
  { name: 'D', mass: 1, options: [{ coord: 0, cost: 0 }, { coord: 0, cost: 0 }] },
]
const rl: LimitsInput = { capacity: 1000, torqueMin: -50, torqueMax: 50 }
const rr = adjudicate(bad, rl)
assert(!rr.feasible, '该场景应判无解（不允许先定最终位置再事后排序）')
if (!rr.feasible) {
  assert(rr.prefixLength === 1, '最早无法继续挂装的已选前缀应为第 1 块')
  assert(rr.triggers.includes('torque') && !rr.triggers.includes('load'), '应报告触发力矩限制')
}

console.log('SMOKE OK: 裁决业务模块冒烟通过')
