import { useState } from 'react'
import { adjudicate, validateInputs } from './solver'
import type {
  AdjudicateResult,
  BlockInput,
  FeasibleResult,
  InfeasibleResult,
  LimitsInput,
} from './solver'

interface OptionDraft {
  coord: string
  cost: string
}
interface BlockDraft {
  name: string
  mass: string
  options: OptionDraft[]
}
interface LimitsDraft {
  capacity: string
  torqueMin: string
  torqueMax: string
}

interface Solved {
  blocks: BlockInput[]
  limits: LimitsInput
  result: AdjudicateResult
}

const DEFAULT_LIMITS: LimitsDraft = { capacity: '1200', torqueMin: '-500', torqueMax: '500' }

const DEFAULT_BLOCKS: BlockDraft[] = [
  { name: '配重1', mass: '300', options: [{ coord: '-2', cost: '50' }, { coord: '1.5', cost: '60' }, { coord: '3', cost: '40' }] },
  { name: '配重2', mass: '250', options: [{ coord: '-3', cost: '45' }, { coord: '2', cost: '55' }] },
  { name: '配重3', mass: '200', options: [{ coord: '-1', cost: '30' }, { coord: '0.5', cost: '35' }, { coord: '2.5', cost: '25' }] },
  { name: '配重4', mass: '150', options: [{ coord: '-2.5', cost: '20' }, { coord: '1', cost: '28' }] },
  { name: '配重5', mass: '100', options: [{ coord: '-0.5', cost: '10' }, { coord: '0.8', cost: '12' }, { coord: '2', cost: '8' }] },
]

function parseNum(s: string): number {
  const t = s.trim()
  return t === '' ? Number.NaN : Number(t)
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const s = String(Math.round(v * 1000) / 1000)
  return s === '-0' ? '0' : s
}

export default function App() {
  const [limits, setLimits] = useState<LimitsDraft>(DEFAULT_LIMITS)
  const [blocks, setBlocks] = useState<BlockDraft[]>(DEFAULT_BLOCKS)
  const [solved, setSolved] = useState<Solved | null>(null)
  const [revoked, setRevoked] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [computing, setComputing] = useState(false)
  const [stepIdx, setStepIdx] = useState(0)

  // 任一草稿编辑立即撤销旧方案
  const mutate = (fn: () => void) => {
    fn()
    if (solved) {
      setSolved(null)
      setRevoked(true)
    }
    setErrors([])
  }

  const updateLimit = (field: keyof LimitsDraft, value: string) =>
    mutate(() => setLimits((l) => ({ ...l, [field]: value })))

  const updateBlock = (i: number, field: 'name' | 'mass', value: string) =>
    mutate(() => setBlocks((bs) => bs.map((b, bi) => (bi === i ? { ...b, [field]: value } : b))))

  const updateOption = (i: number, j: number, field: keyof OptionDraft, value: string) =>
    mutate(() =>
      setBlocks((bs) =>
        bs.map((b, bi) =>
          bi !== i ? b : { ...b, options: b.options.map((o, oj) => (oj === j ? { ...o, [field]: value } : o)) },
        ),
      ),
    )

  const addBlock = () =>
    mutate(() =>
      setBlocks((bs) =>
        bs.length >= 7
          ? bs
          : [...bs, { name: `配重${bs.length + 1}`, mass: '100', options: [{ coord: '-1', cost: '10' }, { coord: '1', cost: '10' }] }],
      ),
    )

  const removeBlock = (i: number) =>
    mutate(() => setBlocks((bs) => (bs.length <= 4 ? bs : bs.filter((_, bi) => bi !== i))))

  const addOption = (i: number) =>
    mutate(() =>
      setBlocks((bs) =>
        bs.map((b, bi) =>
          bi !== i || b.options.length >= 3 ? b : { ...b, options: [...b.options, { coord: '0', cost: '10' }] },
        ),
      ),
    )

  const removeOption = (i: number, j: number) =>
    mutate(() =>
      setBlocks((bs) =>
        bs.map((b, bi) =>
          bi !== i || b.options.length <= 2 ? b : { ...b, options: b.options.filter((_, oj) => oj !== j) },
        ),
      ),
    )

  const loadSample = () =>
    mutate(() => {
      setLimits(DEFAULT_LIMITS)
      setBlocks(DEFAULT_BLOCKS)
    })

  const run = () => {
    const parsedBlocks: BlockInput[] = blocks.map((b) => ({
      name: b.name.trim() || '（未命名）',
      mass: parseNum(b.mass),
      options: b.options.map((o) => ({ coord: parseNum(o.coord), cost: parseNum(o.cost) })),
    }))
    const parsedLimits: LimitsInput = {
      capacity: parseNum(limits.capacity),
      torqueMin: parseNum(limits.torqueMin),
      torqueMax: parseNum(limits.torqueMax),
    }
    const errs = validateInputs(parsedBlocks, parsedLimits)
    setErrors(errs)
    if (errs.length > 0) {
      setSolved(null)
      return
    }
    setComputing(true)
    // 让按钮状态先渲染，再执行搜索
    window.setTimeout(() => {
      const result = adjudicate(parsedBlocks, parsedLimits)
      setSolved({ blocks: parsedBlocks, limits: parsedLimits, result })
      setRevoked(false)
      setStepIdx(0)
      setComputing(false)
    }, 30)
  }

  return (
    <div className="app">
      <header>
        <h1>剧场升降幕配重挂装裁决</h1>
        <p className="muted">
          录入 4~7 块幕布配重（质量、可挂入的 2~3 个导轨位置及各位置安装代价）、卷扬轴总载荷与左右力矩闭区间；
          点击「裁决」联合确定每块配重恰用一次的挂装位置与完整挂装顺序，保证挂装途中每一个前缀状态都不失衡。
        </p>
      </header>

      <section className="card">
        <h2>卷扬轴限制</h2>
        <div className="limits">
          <label>
            总载荷（kg）
            <input type="number" step="any" value={limits.capacity} onChange={(e) => updateLimit('capacity', e.target.value)} />
          </label>
          <label>
            力矩下界（kg·m）
            <input type="number" step="any" value={limits.torqueMin} onChange={(e) => updateLimit('torqueMin', e.target.value)} />
          </label>
          <label>
            力矩上界（kg·m）
            <input type="number" step="any" value={limits.torqueMax} onChange={(e) => updateLimit('torqueMax', e.target.value)} />
          </label>
        </div>
        <p className="muted">
          力矩 = 已挂质量 × 位置坐标 的累计值，坐标左负右正。每个前缀状态都必须同时满足：已挂质量 ≤ 总载荷，且力矩 ∈ [下界, 上界]。
        </p>
      </section>

      <section className="card">
        <h2>配重草稿（{blocks.length} / 7 块）</h2>
        {blocks.map((b, i) => (
          <div className="block-card" key={i}>
            <div className="block-head">
              <span className="tag">#{i + 1}</span>
              <input className="name" aria-label="配重名称" value={b.name} onChange={(e) => updateBlock(i, 'name', e.target.value)} />
              <label>
                质量（kg）
                <input type="number" step="any" value={b.mass} onChange={(e) => updateBlock(i, 'mass', e.target.value)} />
              </label>
              <button type="button" onClick={() => removeBlock(i)} disabled={blocks.length <= 4}>
                删除本块
              </button>
            </div>
            <table className="opts">
              <thead>
                <tr>
                  <th>候选位置</th>
                  <th>坐标（m，左负右正）</th>
                  <th>安装代价</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {b.options.map((o, j) => (
                  <tr key={j}>
                    <td>#{j + 1}</td>
                    <td>
                      <input type="number" step="any" value={o.coord} onChange={(e) => updateOption(i, j, 'coord', e.target.value)} />
                    </td>
                    <td>
                      <input type="number" step="any" value={o.cost} onChange={(e) => updateOption(i, j, 'cost', e.target.value)} />
                    </td>
                    <td>
                      <button type="button" onClick={() => removeOption(i, j)} disabled={b.options.length <= 2}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" onClick={() => addOption(i)} disabled={b.options.length >= 3}>
              ＋ 添加候选位置（{b.options.length}/3）
            </button>
          </div>
        ))}
        <div className="row">
          <button type="button" onClick={addBlock} disabled={blocks.length >= 7}>
            ＋ 添加配重
          </button>
          <button type="button" onClick={loadSample}>
            恢复示例数据
          </button>
          <button type="button" className="primary" onClick={run} disabled={computing}>
            {computing ? '裁决中…' : '裁 决'}
          </button>
        </div>
      </section>

      {errors.length > 0 && (
        <section className="card errors">
          <h2>录入有误，请修正后重新裁决</h2>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </section>
      )}

      {revoked && !solved && <div className="notice">草稿已修改，旧方案已撤销，请重新点击「裁决」。</div>}

      {solved && solved.result.feasible && (
        <FeasiblePanel blocks={solved.blocks} limits={solved.limits} result={solved.result} stepIdx={stepIdx} onStep={setStepIdx} />
      )}
      {solved && !solved.result.feasible && <InfeasiblePanel blocks={solved.blocks} limits={solved.limits} result={solved.result} />}

      <section className="card rules">
        <h2>裁决规则</h2>
        <ol>
          <li>每块配重恰好挂装一次，位置取自其候选导轨位置；顺序与位置联合搜索，任一前缀状态越界即剪枝，不会先定最终位置再事后排序。</li>
          <li>单步力矩余量 = min(上界 − 力矩, 力矩 − 下界)；方案力矩余量 = 所有前缀步余量的最小值（最危险的一步）。</li>
          <li>多套可行方案依次决胜：方案力矩余量最大 → 总安装代价最小 → 挂装顺序的配重录入序号、各步采用位置录入序号字典序最小。</li>
          <li>无可行方案时，指出按录入顺序最早无法继续挂装的已选前缀，及其触发的载荷 / 力矩限制。</li>
          <li>任何草稿编辑都会立即撤销旧方案。</li>
        </ol>
      </section>
    </div>
  )
}

function FeasiblePanel({
  blocks,
  limits,
  result,
  stepIdx,
  onStep,
}: {
  blocks: BlockInput[]
  limits: LimitsInput
  result: FeasibleResult
  stepIdx: number
  onStep: (i: number) => void
}) {
  const plan = result.plan
  const step = plan.steps[stepIdx]
  const blk = blocks[step.blockIndex]
  const notUsed = blk.options
    .map((o, j) => ({ o, j }))
    .filter(({ j }) => j !== step.optionIndex)

  return (
    <section className="card result ok">
      <h2>裁决结果：存在可行挂装方案</h2>
      <div className="stats">
        <div className="stat">
          <span>总安装代价</span>
          <b>{fmt(plan.totalCost)}</b>
        </div>
        <div className="stat">
          <span>已挂总质量 / 总载荷</span>
          <b>
            {fmt(plan.totalMass)} / {fmt(limits.capacity)} kg
          </b>
        </div>
        <div className="stat">
          <span>最终力矩（区间 [{fmt(limits.torqueMin)}, {fmt(limits.torqueMax)}]）</span>
          <b>{fmt(plan.finalTorque)} kg·m</b>
        </div>
        <div className="stat">
          <span>方案力矩余量（最危险一步）</span>
          <b>{fmt(plan.minMargin)} kg·m</b>
        </div>
        <div className="stat">
          <span>搜索状态数</span>
          <b>{result.explored}</b>
        </div>
      </div>

      <div className="stepper">
        <button type="button" onClick={() => onStep(0)} disabled={stepIdx === 0}>
          ⏮ 首步
        </button>
        <button type="button" onClick={() => onStep(stepIdx - 1)} disabled={stepIdx === 0}>
          ◀ 上一步
        </button>
        <span>
          第 {stepIdx + 1} / {plan.steps.length} 步
        </span>
        <button type="button" onClick={() => onStep(stepIdx + 1)} disabled={stepIdx >= plan.steps.length - 1}>
          下一步 ▶
        </button>
        <button type="button" onClick={() => onStep(plan.steps.length - 1)} disabled={stepIdx >= plan.steps.length - 1}>
          末步 ⏭
        </button>
      </div>

      <div className="current">
        <h3>
          第 {stepIdx + 1} 步：挂装「{blk.name}」（录入序号 #{step.blockIndex + 1}）
        </h3>
        <div className="stats">
          <div className="stat">
            <span>采用位置</span>
            <b>
              #{step.optionIndex + 1}（{fmt(step.coord)} m）
            </b>
          </div>
          <div className="stat">
            <span>未采用位置</span>
            <b>{notUsed.length > 0 ? notUsed.map(({ o, j }) => `#${j + 1}（${fmt(o.coord)} m）`).join('、') : '无'}</b>
          </div>
          <div className="stat">
            <span>已挂质量</span>
            <b>{fmt(step.cumMass)} kg</b>
          </div>
          <div className="stat">
            <span>累计力矩</span>
            <b>{fmt(step.cumTorque)} kg·m</b>
          </div>
          <div className="stat">
            <span>本步力矩余量</span>
            <b>{fmt(step.margin)} kg·m</b>
          </div>
        </div>
      </div>

      <table className="steps">
        <thead>
          <tr>
            <th>步骤</th>
            <th>配重（录入序号）</th>
            <th>质量 kg</th>
            <th>采用位置</th>
            <th>未采用位置</th>
            <th>安装代价</th>
            <th>已挂质量 kg</th>
            <th>累计力矩 kg·m</th>
            <th>力矩余量 kg·m</th>
          </tr>
        </thead>
        <tbody>
          {plan.steps.map((s, k) => {
            const b = blocks[s.blockIndex]
            const others = b.options
              .map((o, j) => ({ o, j }))
              .filter(({ j }) => j !== s.optionIndex)
              .map(({ o, j }) => `#${j + 1}（${fmt(o.coord)} m）`)
              .join('、')
            return (
              <tr key={k} className={k === stepIdx ? 'current-row' : ''} onClick={() => onStep(k)}>
                <td>{k + 1}</td>
                <td>
                  {b.name}（#{s.blockIndex + 1}）
                </td>
                <td>{fmt(s.mass)}</td>
                <td>
                  #{s.optionIndex + 1}（{fmt(s.coord)} m）
                </td>
                <td>{others || '无'}</td>
                <td>{fmt(s.cost)}</td>
                <td>{fmt(s.cumMass)}</td>
                <td>{fmt(s.cumTorque)}</td>
                <td>{fmt(s.margin)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

function InfeasiblePanel({
  blocks,
  limits,
  result,
}: {
  blocks: BlockInput[]
  limits: LimitsInput
  result: InfeasibleResult
}) {
  const k = result.prefixLength
  return (
    <section className="card result danger">
      <h2>裁决结果：无可行挂装方案</h2>
      <p>
        最早无法继续挂装的已选前缀：按录入顺序第 1 ~ {k} 块配重（共 {k} 块）。
      </p>
      <p className="muted">
        {k === 1
          ? '第 1 块配重即无法挂装。'
          : `前 ${k - 1} 块尚可找到满足全部前缀约束的挂装方式；加入第 ${k} 块后，无论挂装顺序与位置如何安排都无法完成。`}
      </p>
      <ul className="triggers">
        {result.triggers.includes('load') && (
          <li>
            触发总载荷限制：前 {k} 块质量合计 {fmt(result.prefixMass)} kg，超过卷扬轴总载荷 {fmt(limits.capacity)} kg。
          </li>
        )}
        {result.triggers.includes('torque') && (
          <li>
            触发力矩限制：在左右力矩闭区间 [{fmt(limits.torqueMin)}, {fmt(limits.torqueMax)}] kg·m 内，前 {k}{' '}
            块的任意挂装顺序与位置组合都会出现越界前缀。
          </li>
        )}
      </ul>
      <table className="steps">
        <thead>
          <tr>
            <th>录入序号</th>
            <th>名称</th>
            <th>质量 kg</th>
            <th>候选位置（坐标 m / 安装代价）</th>
          </tr>
        </thead>
        <tbody>
          {result.prefixBlockIndices.map((bi) => {
            const b = blocks[bi]
            return (
              <tr key={bi} className={bi === k - 1 ? 'bad-row' : ''}>
                <td>#{bi + 1}</td>
                <td>{b.name}</td>
                <td>{fmt(b.mass)}</td>
                <td>{b.options.map((o, j) => `#${j + 1}（${fmt(o.coord)} m / ${fmt(o.cost)}）`).join('、')}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="muted">搜索状态数：{result.explored}。请调整草稿（质量、候选位置、载荷或力矩区间）后重新裁决。</p>
    </section>
  )
}
