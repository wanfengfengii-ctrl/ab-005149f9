/**
 * 剧场升降幕配重挂装裁决核心模块。
 * 纯 TypeScript 实现，不依赖 DOM：浏览器页面、单元测试与 verify 冒烟共用同一份逻辑。
 *
 * 裁决规则（与页面展示口径完全一致）：
 *  1. 每块配重恰好挂装一次，挂装位置只能取自该块录入的候选导轨位置；
 *  2. 挂装顺序与挂装位置联合搜索：每挂完一块即检查前缀状态，
 *     任一前缀必须同时满足「已挂质量 ≤ 总载荷」且「累计力矩 ∈ [力矩下界, 力矩上界]」，
 *     越界立即剪枝 —— 绝不允许先选定最终位置再事后排序；
 *  3. 某一步的力矩余量 = min(力矩上界 − 当前力矩, 当前力矩 − 力矩下界)；
 *     方案的力矩余量 = 其所有前缀步余量的最小值（即最危险的一步）；
 *  4. 多套可行方案依次决胜：
 *       a. 方案力矩余量更大者优先；
 *       b. 总安装代价更小者优先；
 *       c. 按挂装顺序中各步配重的录入序号、再按各步采用位置的录入序号，
 *          字典序最小者优先（稳定决胜）；
 *  5. 无可行方案时，按录入顺序找出最早无法完成挂装的已选前缀，
 *     并诊断其触发的是总载荷限制还是力矩限制（两者可能同时触发）。
 */

/** 候选导轨位置：坐标（相对卷扬轴中心，左负右正，单位 m）+ 在该位置挂装此块的安装代价 */
export interface PositionOptionInput {
  coord: number
  cost: number
}

/** 一块幕布配重 */
export interface BlockInput {
  name: string
  /** 质量 kg */
  mass: number
  /** 可挂入的候选导轨位置（2~3 个） */
  options: PositionOptionInput[]
}

/** 卷扬轴限制：总载荷 + 左右力矩闭区间 */
export interface LimitsInput {
  /** 总载荷 kg */
  capacity: number
  /** 力矩闭区间下界 kg·m */
  torqueMin: number
  /** 力矩闭区间上界 kg·m */
  torqueMax: number
}

/** 挂装方案中的一步 */
export interface PlanStep {
  /** 配重录入序号（0 基） */
  blockIndex: number
  /** 采用位置录入序号（0 基） */
  optionIndex: number
  /** 本块质量 kg */
  mass: number
  /** 采用位置坐标 m */
  coord: number
  /** 该位置安装代价 */
  cost: number
  /** 本步完成后已挂质量 kg */
  cumMass: number
  /** 本步完成后累计力矩 kg·m */
  cumTorque: number
  /** 本步力矩余量 kg·m */
  margin: number
}

/** 一套完整可行方案 */
export interface Plan {
  steps: PlanStep[]
  totalMass: number
  totalCost: number
  finalTorque: number
  /** 方案力矩余量：所有前缀步余量的最小值 */
  minMargin: number
}

export interface FeasibleResult {
  feasible: true
  plan: Plan
  /** 搜索过的状态节点数（透明化展示用） */
  explored: number
}

export type FailureTrigger = 'load' | 'torque'

export interface InfeasibleResult {
  feasible: false
  /** 最早无法继续挂装的已选前缀长度 k（按录入序号第 1..k 块） */
  prefixLength: number
  /** 该前缀包含的配重录入序号（0 基） */
  prefixBlockIndices: number[]
  /** 该前缀的质量合计 kg */
  prefixMass: number
  /** 触发的限制：载荷 / 力矩（可能同时） */
  triggers: FailureTrigger[]
  explored: number
}

export type AdjudicateResult = FeasibleResult | InfeasibleResult

const EPS = 1e-9

/** 录入校验，返回全部错误信息（空数组表示合法） */
export function validateInputs(blocks: BlockInput[], limits: LimitsInput): string[] {
  const errors: string[] = []
  if (!Number.isFinite(limits.capacity) || limits.capacity <= 0) {
    errors.push('卷扬轴总载荷必须为正数')
  }
  if (!Number.isFinite(limits.torqueMin) || !Number.isFinite(limits.torqueMax)) {
    errors.push('左右力矩闭区间必须为有限数值')
  } else if (limits.torqueMin > limits.torqueMax) {
    errors.push('力矩闭区间下界不能大于上界')
  }
  if (blocks.length < 4 || blocks.length > 7) {
    errors.push(`配重数量须为 4~7 块（当前 ${blocks.length} 块）`)
  }
  blocks.forEach((b, i) => {
    const tag = `第 ${i + 1} 块配重`
    if (!Number.isFinite(b.mass) || b.mass <= 0) {
      errors.push(`${tag}：质量必须为正数`)
    }
    if (b.options.length < 2 || b.options.length > 3) {
      errors.push(`${tag}：候选导轨位置须为 2~3 个（当前 ${b.options.length} 个）`)
    }
    b.options.forEach((o, j) => {
      if (!Number.isFinite(o.coord)) {
        errors.push(`${tag} 位置 ${j + 1}：坐标必须为有限数值`)
      }
      if (!Number.isFinite(o.cost) || o.cost < 0) {
        errors.push(`${tag} 位置 ${j + 1}：安装代价必须为非负数`)
      }
    })
  })
  return errors
}

/**
 * 方案比较器：a 严格优于 b 时返回 true。
 * 依次比较：方案力矩余量（大者优）→ 总安装代价（小者优）→
 * 挂装顺序的配重录入序号字典序 → 各步采用位置录入序号字典序。
 */
function isBetter(a: Plan, b: Plan): boolean {
  if (a.minMargin > b.minMargin + EPS) return true
  if (a.minMargin < b.minMargin - EPS) return false
  if (a.totalCost < b.totalCost - EPS) return true
  if (a.totalCost > b.totalCost + EPS) return false
  const len = Math.min(a.steps.length, b.steps.length)
  for (let k = 0; k < len; k++) {
    if (a.steps[k].blockIndex !== b.steps[k].blockIndex) {
      return a.steps[k].blockIndex < b.steps[k].blockIndex
    }
  }
  for (let k = 0; k < len; k++) {
    if (a.steps[k].optionIndex !== b.steps[k].optionIndex) {
      return a.steps[k].optionIndex < b.steps[k].optionIndex
    }
  }
  return false
}

interface SearchOutcome {
  best: Plan | null
  explored: number
}

/**
 * 深度优先联合搜索「挂装顺序 × 采用位置」。
 * 每挂一块立即检查前缀约束（载荷 + 力矩闭区间），越界即剪枝；
 * 到达完整深度时用三级决胜规则保留最优方案。
 */
function searchBest(blocks: BlockInput[], limits: LimitsInput): SearchOutcome {
  const n = blocks.length
  const masses = blocks.map((b) => b.mass)
  const coords = blocks.map((b) => b.options.map((o) => o.coord))
  const costs = blocks.map((b) => b.options.map((o) => o.cost))
  const cap = limits.capacity
  const lo = limits.torqueMin
  const hi = limits.torqueMax

  let explored = 0
  let best: Plan | null = null
  const used: boolean[] = new Array<boolean>(n).fill(false)
  const steps: PlanStep[] = []

  function dfs(depth: number, cumMass: number, cumTorque: number, cumCost: number, minMargin: number): void {
    explored++
    if (depth === n) {
      const plan: Plan = {
        steps: steps.map((s) => ({ ...s })),
        totalMass: cumMass,
        totalCost: cumCost,
        finalTorque: cumTorque,
        minMargin,
      }
      if (best === null || isBetter(plan, best)) best = plan
      return
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue
      const m = masses[i]
      const newMass = cumMass + m
      if (newMass > cap + EPS) continue // 前缀触发总载荷限制，剪枝
      used[i] = true
      for (let j = 0; j < coords[i].length; j++) {
        const t = cumTorque + m * coords[i][j]
        if (t < lo - EPS || t > hi + EPS) continue // 前缀触发力矩限制，剪枝
        const margin = Math.min(hi - t, t - lo)
        steps.push({
          blockIndex: i,
          optionIndex: j,
          mass: m,
          coord: coords[i][j],
          cost: costs[i][j],
          cumMass: newMass,
          cumTorque: t,
          margin,
        })
        dfs(depth + 1, newMass, t, cumCost + costs[i][j], Math.min(minMargin, margin))
        steps.pop()
      }
      used[i] = false
    }
  }

  dfs(0, 0, 0, 0, Number.POSITIVE_INFINITY)
  return { best, explored }
}

/**
 * 裁决入口：返回最优可行方案；无解时返回最早无法继续挂装的已选前缀及触发的限制。
 * 输入非法时抛出 Error（页面应先调用 validateInputs 提示）。
 */
export function adjudicate(blocks: BlockInput[], limits: LimitsInput): AdjudicateResult {
  const errors = validateInputs(blocks, limits)
  if (errors.length > 0) {
    throw new Error(`输入无效：${errors.join('；')}`)
  }

  const main = searchBest(blocks, limits)
  if (main.best !== null) {
    return { feasible: true, plan: main.best, explored: main.explored }
  }

  // 无解诊断：按录入顺序扫描前缀，找最早无法完成挂装的已选前缀。
  // 全集无解保证某个 k（至多 k = n）首次失败。
  let explored = main.explored
  for (let k = 1; k <= blocks.length; k++) {
    const sub = blocks.slice(0, k)
    const r = searchBest(sub, limits)
    explored += r.explored
    if (r.best !== null) continue

    const prefixMass = sub.reduce((s, b) => s + b.mass, 0)
    const triggers: FailureTrigger[] = []
    // 质量均为正：若前缀质量合计已超总载荷，则载荷限制必然被触发
    if (prefixMass > limits.capacity + EPS) triggers.push('load')
    // 忽略载荷再搜一次：仍无解说明力矩闭区间本身无法维持
    const torqueOnly = searchBest(sub, { ...limits, capacity: Number.POSITIVE_INFINITY })
    explored += torqueOnly.explored
    if (torqueOnly.best === null) triggers.push('torque')

    return {
      feasible: false,
      prefixLength: k,
      prefixBlockIndices: sub.map((_, i) => i),
      prefixMass,
      triggers,
      explored,
    }
  }

  // 逻辑上不可达：全集无解时循环必然返回
  throw new Error('裁决器内部错误：诊断扫描未收敛')
}
