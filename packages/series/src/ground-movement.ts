import type { Mobility, StepCost } from './ground-map.ts'
import { zocAffectsAction } from './zoc.ts'

export interface GroundMoveUnit {
  mobility: Mobility
  allowance: number
  strategic: boolean
}

export interface GroundMoveBoard {
  neighbors(hex: string): readonly string[]
  /** Evaluate both directions against the same board just before this step. */
  cost(from: string, to: string, moverAt: string, first: boolean): StepCost
  crossingRefusal?(from: string, to: string): CrossingRefusal | null
  entryAt(hex: string): 'open' | 'enemy-combat' | 'entry-unresolved'
  enemyZocAt(hex: string): boolean
  negatedZocAt(hex: string): boolean
}

type Stop = 'all-mp' | 'minimum-move' | 'enemy-zoc' | 'allowance-used'
type CrossingRefusal = 'crossing-capacity' | 'crossing-strength-unavailable'
type Refusal = 'not-adjacent' | 'enemy-combat' | 'entry-unresolved' | 'impassable' | 'strategic-zoc' | 'insufficient-mp' | 'must-stop'
  | CrossingRefusal
export interface GroundStep {
  hex: string
  spent: number
  stop: Stop | null
}

// OCS 4.5, 5.8a and 6.1–6.3. Adapted from Smolensk 5603e52, move.ts (evaluateStepFrom).
export function evaluateGroundStep(board: GroundMoveBoard, unit: GroundMoveUnit, from: GroundStep, to: string, first: boolean):
  { ok: true; step: GroundStep } | { ok: false; reason: Refusal } {
  if (from.stop) return { ok: false, reason: 'must-stop' }
  if (to === from.hex || !board.neighbors(from.hex).includes(to)) return { ok: false, reason: 'not-adjacent' }
  const entry = board.entryAt(to)
  if (entry !== 'open') return { ok: false, reason: entry }
  const cost = board.cost(from.hex, to, from.hex, first)
  if (cost === null || board.cost(to, from.hex, from.hex, first) === null ||
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

interface ReachStep<Context> {
  step: GroundStep
  context: Context
  key: string
  canFinish: boolean
  paused: boolean
}

interface ReachNode<Context> extends ReachStep<Context> { parent: ReachNode<Context> | null }

/** Adapted from computeReachableHexes. Keep distinct transit states even when they end on the same hex. */
export function reachableGroundHexes<Context>(startStep: GroundStep, context: Context,
  expand: (current: GroundStep, context: Context, first: boolean) => Iterable<ReachStep<Context>>) {
  const origin = startStep.hex
  const start: ReachNode<Context> = { step: startStep, context, key: '',
    parent: null, canFinish: false, paused: false }
  const transit = new Map<string, ReachNode<Context>>()
  const destinations = new Map<string, ReachNode<Context>>()
  const queue = [start]
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!
    if (current !== start && transit.get(current.key) !== current) continue
    for (const result of expand(current.step, current.context, current === start)) {
      const { step, key, paused, canFinish } = result
      const node = { ...result, parent: current }
      const previous = destinations.get(step.hex)
      const continues = !step.stop && !paused
      if (canFinish && step.hex !== origin && (!previous || step.spent < previous.step.spent ||
        step.spent === previous.step.spent && continues && (previous.step.stop || previous.paused))) {
        destinations.set(step.hex, node)
      }
      if (continues && step.spent < (transit.get(key)?.step.spent ?? Infinity)) {
        transit.set(key, node)
        queue.push(node)
      }
    }
  }
  return [...destinations.values()].map(({ step, paused, parent }) => {
    const path = [step.hex]
    for (let node = parent; node?.parent; node = node.parent) path.push(node.step.hex)
    return { ...step, paused, path: path.reverse() }
  })
}
