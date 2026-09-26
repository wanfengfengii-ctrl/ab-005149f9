import { describe, expect, it } from 'vitest'
import { adjudicate, validateInputs } from './solver'
import type { BlockInput, LimitsInput } from './solver'

/** 力矩中性配重（坐标 0，代价 0），用于把场景凑够 4 块 */
const neutral = (name: string): BlockInput => ({
  name,
  mass: 1,
  options: [
    { coord: 0, cost: 0 },
    { coord: 0, cost: 0 },
  ],
})

const wideLimits: LimitsInput = { capacity: 100000, torqueMin: -1e6, torqueMax: 1e6 }

describe('validateInputs 录入校验', () => {
  const okBlocks: BlockInput[] = [
    { name: 'A', mass: 10, options: [{ coord: -1, cost: 1 }, { coord: 1, cost: 2 }] },
    { name: 'B', mass: 20, options: [{ coord: -2, cost: 1 }, { coord: 2, cost: 2 }, { coord: 0, cost: 3 }] },
    { name: 'C', mass: 30, options: [{ coord: -3, cost: 0 }, { coord: 3, cost: 0 }] },
    { name: 'D', mass: 40, options: [{ coord: -4, cost: 5 }, { coord: 4, cost: 6 }] },
  ]
  const okLimits: LimitsInput = { capacity: 100, torqueMin: -10, torqueMax: 10 }

  it('接受合法输入', () => {
    expect(validateInputs(okBlocks, okLimits)).toEqual([])
  })

  it('配重数量须为 4~7 块', () => {
    expect(validateInputs(okBlocks.slice(0, 3), okLimits).join()).toContain('4~7')
    const eight = [...okBlocks, ...okBlocks.map((b) => ({ ...b }))]
    expect(validateInputs(eight, okLimits).join()).toContain('4~7')
  })

  it('每块候选位置须为 2~3 个', () => {
    const one = [{ name: 'X', mass: 1, options: [{ coord: 0, cost: 0 }] }, ...okBlocks.slice(1)]
    expect(validateInputs(one, okLimits).join()).toContain('2~3')
    const four = [
      { name: 'X', mass: 1, options: [0, 1, 2, 3].map((c) => ({ coord: c, cost: 0 })) },
      ...okBlocks.slice(1),
    ]
    expect(validateInputs(four, okLimits).join()).toContain('2~3')
  })

  it('拒绝非正质量、负代价、非法区间、非正载荷', () => {
    expect(validateInputs([{ ...okBlocks[0], mass: 0 }, ...okBlocks.slice(1)], okLimits).join()).toContain('质量')
    const negCost = [
      { name: 'X', mass: 1, options: [{ coord: 0, cost: -1 }, { coord: 1, cost: 0 }] },
      ...okBlocks.slice(1),
    ]
    expect(validateInputs(negCost, okLimits).join()).toContain('安装代价')
    expect(validateInputs(okBlocks, { ...okLimits, torqueMin: 5, torqueMax: -5 }).join()).toContain('下界')
    expect(validateInputs(okBlocks, { ...okLimits, capacity: 0 }).join()).toContain('总载荷')
  })

  it('adjudicate 对非法输入直接抛错', () => {
    expect(() => adjudicate(okBlocks.slice(0, 2), okLimits)).toThrow()
  })
})

describe('adjudicate 可行场景', () => {
  it('每块配重恰用一次，且每个前缀状态同时满足载荷与力矩限制', () => {
    const blocks: BlockInput[] = [
      { name: '配重1', mass: 300, options: [{ coord: -2, cost: 50 }, { coord: 1.5, cost: 60 }, { coord: 3, cost: 40 }] },
      { name: '配重2', mass: 250, options: [{ coord: -3, cost: 45 }, { coord: 2, cost: 55 }] },
      { name: '配重3', mass: 200, options: [{ coord: -1, cost: 30 }, { coord: 0.5, cost: 35 }, { coord: 2.5, cost: 25 }] },
      { name: '配重4', mass: 150, options: [{ coord: -2.5, cost: 20 }, { coord: 1, cost: 28 }] },
      { name: '配重5', mass: 100, options: [{ coord: -0.5, cost: 10 }, { coord: 0.8, cost: 12 }, { coord: 2, cost: 8 }] },
    ]
    const limits: LimitsInput = { capacity: 1200, torqueMin: -500, torqueMax: 500 }
    const r = adjudicate(blocks, limits)
    expect(r.feasible).toBe(true)
    if (!r.feasible) return
    const p = r.plan
    expect(p.steps).toHaveLength(5)
    expect(new Set(p.steps.map((s) => s.blockIndex))).toEqual(new Set([0, 1, 2, 3, 4]))
    let minMargin = Infinity
    for (const s of p.steps) {
      expect(s.cumMass).toBeLessThanOrEqual(limits.capacity + 1e-9)
      expect(s.cumTorque).toBeGreaterThanOrEqual(limits.torqueMin - 1e-9)
      expect(s.cumTorque).toBeLessThanOrEqual(limits.torqueMax + 1e-9)
      expect(s.margin).toBeCloseTo(Math.min(limits.torqueMax - s.cumTorque, s.cumTorque - limits.torqueMin), 9)
      minMargin = Math.min(minMargin, s.margin)
    }
    expect(p.minMargin).toBeCloseTo(minMargin, 9)
    expect(p.totalMass).toBeCloseTo(1000, 9)
    expect(p.totalCost).toBeCloseTo(p.steps.reduce((s, x) => s + x.cost, 0), 9)
    // 确定性：同一输入两次裁决结果完全一致
    expect(JSON.stringify(adjudicate(blocks, limits))).toBe(JSON.stringify(r))
  })

  it('不能先选最终位置再事后排序：最终力矩可平衡但任一单步越界即无解', () => {
    const blocks: BlockInput[] = [
      { name: 'A', mass: 10, options: [{ coord: 10, cost: 1 }, { coord: 10, cost: 1 }] },
      { name: 'B', mass: 10, options: [{ coord: -10, cost: 1 }, { coord: -10, cost: 1 }] },
      neutral('C'),
      neutral('D'),
    ]
    // 最终力矩 100 - 100 = 0 在区间内，但第一块挂上去就 ±100 越界
    const limits: LimitsInput = { capacity: 1000, torqueMin: -50, torqueMax: 50 }
    const r = adjudicate(blocks, limits)
    expect(r.feasible).toBe(false)
    if (r.feasible) return
    expect(r.prefixLength).toBe(1)
    expect(r.triggers).toEqual(['torque'])
  })

  it('多套可行方案先取方案力矩余量最大者，再按录入序号字典序稳定决胜', () => {
    const blocks: BlockInput[] = [
      { name: 'A', mass: 10, options: [{ coord: 5, cost: 1 }, { coord: -5, cost: 1 }] },
      { name: 'B', mass: 10, options: [{ coord: 5, cost: 1 }, { coord: -5, cost: 1 }] },
      neutral('C'),
      neutral('D'),
    ]
    const limits: LimitsInput = { capacity: 1000, torqueMin: -100, torqueMax: 100 }
    const r = adjudicate(blocks, limits)
    expect(r.feasible).toBe(true)
    if (!r.feasible) return
    // 最优余量 50：先 +50 再回 0（或先 -50 再回 0），字典序最小者为 A@+5 → B@-5
    expect(r.plan.minMargin).toBeCloseTo(50, 9)
    expect(r.plan.finalTorque).toBeCloseTo(0, 9)
    expect(r.plan.steps.map((s) => s.blockIndex)).toEqual([0, 1, 2, 3])
    expect(r.plan.steps.map((s) => s.optionIndex)).toEqual([0, 1, 0, 0])
  })

  it('余量并列时取总安装代价最小者', () => {
    const blocks: BlockInput[] = [
      { name: 'A', mass: 10, options: [{ coord: 5, cost: 100 }, { coord: -5, cost: 1 }] },
      { name: 'B', mass: 10, options: [{ coord: 5, cost: 1 }, { coord: -5, cost: 100 }] },
      neutral('C'),
      neutral('D'),
    ]
    const limits: LimitsInput = { capacity: 1000, torqueMin: -100, torqueMax: 100 }
    const r = adjudicate(blocks, limits)
    expect(r.feasible).toBe(true)
    if (!r.feasible) return
    expect(r.plan.minMargin).toBeCloseTo(50, 9)
    // 同为余量 50：A@-5(代价1) + B@+5(代价1) 总代价 2，优于 200
    expect(r.plan.totalCost).toBeCloseTo(2, 9)
    expect(r.plan.steps.map((s) => s.optionIndex)).toEqual([1, 0, 0, 0])
  })
})

describe('adjudicate 无解诊断', () => {
  it('载荷触发：指出最早无法继续挂装的已选前缀', () => {
    const blocks: BlockInput[] = [
      { name: 'A', mass: 60, options: [{ coord: 0, cost: 1 }, { coord: 0, cost: 1 }] },
      { name: 'B', mass: 60, options: [{ coord: 0, cost: 1 }, { coord: 0, cost: 1 }] },
      neutral('C'),
      neutral('D'),
    ]
    const limits: LimitsInput = { capacity: 100, torqueMin: -1e6, torqueMax: 1e6 }
    const r = adjudicate(blocks, limits)
    expect(r.feasible).toBe(false)
    if (r.feasible) return
    expect(r.prefixLength).toBe(2) // 第 1 块可挂，前 2 块合计 120 > 100
    expect(r.prefixBlockIndices).toEqual([0, 1])
    expect(r.prefixMass).toBeCloseTo(120, 9)
    expect(r.triggers).toEqual(['load'])
  })

  it('力矩触发：前缀中段才暴露的失衡', () => {
    const blocks: BlockInput[] = [
      neutral('A'),
      { name: 'B', mass: 10, options: [{ coord: 100, cost: 1 }, { coord: 100, cost: 1 }] },
      neutral('C'),
      neutral('D'),
    ]
    const limits: LimitsInput = { capacity: 1000, torqueMin: -50, torqueMax: 50 }
    const r = adjudicate(blocks, limits)
    expect(r.feasible).toBe(false)
    if (r.feasible) return
    expect(r.prefixLength).toBe(2) // 第 1 块可挂，前 2 块任何顺序力矩都越界
    expect(r.triggers).toEqual(['torque'])
  })

  it('载荷与力矩可同时触发', () => {
    const blocks: BlockInput[] = [
      { name: 'A', mass: 200, options: [{ coord: 100, cost: 1 }, { coord: 100, cost: 1 }] },
      neutral('B'),
      neutral('C'),
      neutral('D'),
    ]
    const limits: LimitsInput = { capacity: 100, torqueMin: -10, torqueMax: 10 }
    const r = adjudicate(blocks, limits)
    expect(r.feasible).toBe(false)
    if (r.feasible) return
    expect(r.prefixLength).toBe(1)
    expect(r.triggers).toEqual(['load', 'torque'])
  })

  it('宽限制下必然可行（兜底 sanity）', () => {
    const blocks: BlockInput[] = [neutral('A'), neutral('B'), neutral('C'), neutral('D')]
    const r = adjudicate(blocks, wideLimits)
    expect(r.feasible).toBe(true)
  })
})
