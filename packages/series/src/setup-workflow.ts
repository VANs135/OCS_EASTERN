import { drawWithoutReplacement } from './pool-draw.ts'
import { createRngState } from './rng.ts'
import type { RngState, Side } from './state-types.ts'

export interface SetupCounter {
  side: Side
  location: { kind: string; hex?: string }
}

export type SetupStep = { id: string; side: Side } & (
  | { kind: 'place'; counterId: string; destinations: readonly string[] }
  | { kind: 'draw'; pool: string; count: number; hex: string }
  | { kind: 'confirm' }
)

export interface SetupPlan {
  steps: readonly SetupStep[]
  pools: Readonly<Record<string, { side: Side; counterIds: readonly string[] }>>
}

export type SetupAction = { stepId: string } & (
  | { type: 'setup-place'; hex: string }
  | { type: 'setup-draw' }
  | { type: 'setup-confirm' }
)

export interface SetupDrawRecord {
  stepId: string
  side: Side
  pool: string
  counterId: string
  before: number
  after: number
}

export interface SetupState<C extends SetupCounter> {
  stepIndex: number
  counters: Readonly<Record<string, C>>
  rng: RngState
  draws: readonly SetupDrawRecord[]
}

export interface SetupRules<C extends SetupCounter> {
  isHex(hex: string): boolean
  canPlace?(counters: Readonly<Record<string, C>>, counterId: string, hex: string): boolean
  place(counter: Readonly<C>, hex: string): C
}

function counterAt<C extends SetupCounter>(counters: Readonly<Record<string, C>>, id: string) {
  return Object.hasOwn(counters, id) ? counters[id] : undefined
}

/** The plan contains ordered, reviewed instructions and physical pool identities. */
export function createSetupState<C extends SetupCounter>(counters: Readonly<Record<string, C>>, plan: SetupPlan,
  rules: SetupRules<C>, seed: number): SetupState<C> {
  if (!plan.steps.length || plan.steps.at(-1)?.kind !== 'confirm') throw new Error('Setup requires a final confirmation')
  const poolIds = new Set<string>()
  for (const [poolId, pool] of Object.entries(plan.pools)) {
    if (!poolId.trim() || (pool.side !== 'axis' && pool.side !== 'soviet')) throw new Error('Invalid setup pool ID or side')
    for (const id of pool.counterIds) {
      const counter = counterAt(counters, id)
      if (!counter || counter.side !== pool.side || counter.location.kind !== 'available' || poolIds.has(id)) {
        throw new Error(`Invalid or duplicate setup pool counter: ${id}`)
      }
      poolIds.add(id)
    }
  }
  const stepIds = new Set<string>()
  const placements = new Set<string>()
  const drawCounts = new Map<string, number>()
  for (const step of plan.steps) {
    if (!step.id.trim() || stepIds.has(step.id) || (step.side !== 'axis' && step.side !== 'soviet')) {
      throw new Error(`Invalid or duplicate setup step: ${step.id}`)
    }
    stepIds.add(step.id)
    if (step.kind === 'place') {
      const counter = counterAt(counters, step.counterId)
      if (!counter || counter.side !== step.side || !['map', 'available'].includes(counter.location.kind) || poolIds.has(step.counterId) ||
        placements.has(step.counterId) || !step.destinations.length || new Set(step.destinations).size !== step.destinations.length ||
        !step.destinations.every((hex) => rules.isHex(hex))) throw new Error(`Invalid setup placement step: ${step.id}`)
      placements.add(step.counterId)
    } else if (step.kind === 'draw') {
      const pool = Object.hasOwn(plan.pools, step.pool) ? plan.pools[step.pool] : undefined
      const total = (drawCounts.get(step.pool) ?? 0) + step.count
      if (!pool || pool.side !== step.side || !Number.isSafeInteger(step.count) || step.count < 1 ||
        !Number.isSafeInteger(total) || total > pool.counterIds.length || !rules.isHex(step.hex)) throw new Error(`Invalid setup draw step: ${step.id}`)
      drawCounts.set(step.pool, total)
    } else if (step.kind !== 'confirm') throw new Error('Unsupported setup instruction')
  }
  return { stepIndex: 0, counters: { ...counters }, rng: createRngState(seed), draws: [] }
}

function placeCounter<C extends SetupCounter>(counters: Record<string, C>, id: string, side: Side, hex: string, rules: SetupRules<C>) {
  const counter = counterAt(counters, id)
  if (!counter || counter.side !== side || !rules.isHex(hex) || rules.canPlace?.(counters, id, hex) === false) {
    throw new Error(`Invalid setup destination: ${id}`)
  }
  const placed = rules.place(counter, hex)
  if (placed.side !== side || placed.location.kind !== 'map' || placed.location.hex !== hex) throw new Error('Invalid setup placement result')
  counters[id] = placed
}

/** One accepted action resolves the current step and advances to the next configured instruction. */
export function applySetupStep<C extends SetupCounter>(state: Readonly<SetupState<C>>, plan: SetupPlan,
  actor: Side, action: SetupAction, rules: SetupRules<C>): SetupState<C> {
  const step = plan.steps[state.stepIndex]
  if (!step || actor !== step.side || action.stepId !== step.id) throw new Error('Setup awaits the current step and responding side')
  const next = { ...state, stepIndex: state.stepIndex + 1 }
  if (step.kind === 'confirm' && action.type === 'setup-confirm') return next
  const counters = { ...state.counters }
  if (step.kind === 'place' && action.type === 'setup-place') {
    if (!step.destinations.includes(action.hex)) throw new Error('Choose an offered setup destination')
    placeCounter(counters, step.counterId, actor, action.hex, rules)
    return { ...next, counters }
  }
  if (step.kind === 'draw' && action.type === 'setup-draw') {
    const pool = plan.pools[step.pool]!
    const available = pool.counterIds.filter((id) => counterAt(counters, id)?.location.kind === 'available')
    const result = drawWithoutReplacement(state.rng, available, step.count)
    for (const { item } of result.draws) placeCounter(counters, item, actor, step.hex, rules)
    return { ...next, counters, rng: result.rng, draws: [...state.draws, ...result.draws.map(({ item, before, after }) =>
      ({ stepId: step.id, side: actor, pool: step.pool, counterId: item, before, after }))] }
  }
  throw new Error('Wrong action for the current setup step')
}

export function setupDecision<C extends SetupCounter>(state: Readonly<SetupState<C>>, plan: SetupPlan, viewer: Side,
  rules: SetupRules<C>) {
  const step = plan.steps[state.stepIndex]
  if (!step) return { phase: 'setup' as const, segment: 'complete', step: 'complete', actor: null, active: null }
  const segment = step.kind === 'place' ? 'placement' : step.kind === 'draw' ? 'pool-draw' : 'confirmation'
  const base = { phase: 'setup' as const, segment, step: `setup-${step.kind}`, actor: step.side }
  if (viewer !== step.side) return { ...base, active: null }
  if (step.kind === 'place') return { ...base, active: { ...step, destinations: step.destinations.filter((hex) =>
    rules.isHex(hex) && rules.canPlace?.(state.counters, step.counterId, hex) !== false) } }
  if (step.kind === 'draw') return { ...base, active: { ...step, remaining: plan.pools[step.pool]!.counterIds.filter((id) =>
    counterAt(state.counters, id)?.location.kind === 'available').length } }
  return { ...base, active: { ...step } }
}
