import type { Mobility, StepCost } from './ground-map.ts'
import { zocAffectsAction } from './zoc.ts'

export interface GroundMoveUnit {
  mobility: Mobility
  allowance: number
  strategic: boolean
}

export interface GroundMoveBoard {
  neighbors(hex: string): readonly string[]
  cost(from: string, to: string): StepCost
  crossingRefusal?(from: string, to: string): CrossingRefusal | null
  entryAt(hex: string): 'open' | 'enemy-combat' | 'entry-unresolved'
  enemyZocAt(hex: string): boolean
  negatedZocAt(hex: string): boolean
}

type Stop = 'all-mp' | 'minimum-move' | 'enemy-zoc' | 'allowance-used'
type CrossingRefusal = 'crossing-capacity' | 'crossing-strength-unavailable'
type Refusal = 'not-adjacent' | 'enemy-combat' | 'entry-unresolved' | 'impassable' | 'strategic-zoc' | 'insufficient-mp' | 'must-stop'
  | CrossingRefusal
interface GroundStep {
  hex: string
  spent: number
  stop: Stop | null
}

// OCS 4.5, 5.8a and 6.1–6.3. Adapted from Smolensk 5603e52, move.ts (evaluateStepFrom).
function evaluateStep(board: GroundMoveBoard, unit: GroundMoveUnit, from: GroundStep, to: string, first: boolean):
  { ok: true; step: GroundStep } | { ok: false; reason: Refusal } {
  if (from.stop) return { ok: false, reason: 'must-stop' }
  if (to === from.hex || !board.neighbors(from.hex).includes(to)) return { ok: false, reason: 'not-adjacent' }
  const entry = board.entryAt(to)
  if (entry !== 'open') return { ok: false, reason: entry }
  const cost = board.cost(from.hex, to)
  if (cost === null || board.cost(to, from.hex) === null ||
    (cost !== 'all' && (!Number.isFinite(cost) || cost < 0))) return { ok: false, reason: 'impassable' }
  const crossingRefusal = board.crossingRefusal?.(from.hex, to)
  if (crossingRefusal) return { ok: false, reason: crossingRefusal }
  const enemyZoc = board.enemyZocAt(to)
  const negated = board.negatedZocAt(to)
  if (unit.strategic && zocAffectsAction('stratMovement', enemyZoc, negated)) return { ok: false, reason: 'strategic-zoc' }
  const remaining = unit.allowance - from.spent
  if (cost === 'all' || cost > remaining) {
    if (!first || remaining <= 0) return { ok: false, reason: 'insufficient-mp' }
    return { ok: true, step: { hex: to, spent: unit.allowance, stop: cost === 'all' ? 'all-mp' : 'minimum-move' } }
  }
  const spent = from.spent + cost
  const stop = unit.mobility === 'truck' && zocAffectsAction('truckMovement', enemyZoc, negated) ? 'enemy-zoc'
    : spent >= unit.allowance ? 'allowance-used' : null
  return { ok: true, step: { hex: to, spent, stop } }
}

export function walkGroundRoute(board: GroundMoveBoard, unit: GroundMoveUnit, origin: string, path: readonly string[]) {
  let step: GroundStep = { hex: origin, spent: 0, stop: null }
  for (const [index, to] of path.entries()) {
    const result = evaluateStep(board, unit, step, to, index === 0)
    if (!result.ok) return { ...result, hex: to }
    step = result.step
  }
  return { ok: true as const, step }
}

interface ReachNode extends GroundStep { parent: ReachNode | null }

/** Adapted from computeReachableHexes. The least costly passable route wins for each hex. */
export function reachableGroundHexes(board: GroundMoveBoard, unit: GroundMoveUnit, origin: string) {
  const start: ReachNode = { hex: origin, spent: 0, stop: null, parent: null }
  const best = new Map([[origin, start]])
  const queue = [start]
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!
    if (current.stop || best.get(current.hex) !== current) continue
    for (const to of board.neighbors(current.hex)) {
      const result = evaluateStep(board, unit, current, to, current === start)
      if (!result.ok) continue
      const previous = best.get(to)
      const { step } = result
      if (previous && (previous.spent < step.spent || previous.spent === step.spent && (!previous.stop || step.stop))) continue
      const node = { ...step, parent: current }
      best.set(to, node)
      queue.push(node)
    }
  }
  best.delete(origin)
  return [...best.values()].map(({ hex, spent, stop, parent }) => {
    const path = [hex]
    for (let node = parent; node?.parent; node = node.parent) path.push(node.hex)
    return { hex, spent, stop, path: path.reverse() }
  })
}
