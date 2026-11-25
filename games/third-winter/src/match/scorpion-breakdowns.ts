import { canDetachBreakdownSteps, isBreakdownCounter } from '@ocs-eastern/series/breakdown'
import type { Side } from '@ocs-eastern/series/state-types'
import { deployScorpionGroundCounter } from '../import/scorpion-deployment.ts'
import { scorpionModeFace } from '../import/scorpion-mode-face.ts'
import { scorpionGroundActivity } from './scorpion-ground-activity.ts'
import { canMoveInPhase } from './scorpion-movement.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'

export interface ScorpionBreakdownRules {
  /** An explicit pool assignment encodes nationality and TTW 1.6e exceptions. */
  parentPools: ReadonlyMap<string, string>
  /** Null means the scenario has no numerical limit for this breakdown definition. */
  counters: ReadonlyMap<string, { pool: string; copies: number | null }>
}

export interface ScorpionBreakdownOrder {
  parentId: string
  definitions: readonly string[]
}

type BreakdownPosition = Pick<ScorpionInPlay, 'units' | 'pieces' | 'breakdownReturns'>

function breakdownStockPosition({ units, pieces }: Readonly<BreakdownPosition>) {
  const occupiedIds = new Set([...Object.keys(units), ...pieces.map(({ id }) => id)])
  const inUse = new Map<string, number>()
  for (const { definition } of [...Object.values(units), ...pieces]) {
    inUse.set(definition, (inUse.get(definition) ?? 0) + 1)
  }
  return { occupiedIds, inUse }
}

function* freeBreakdownIds(definition: string, occupiedIds: ReadonlySet<string>, returned: readonly string[] = []) {
  const known = new Set(returned)
  for (const id of known) if (!occupiedIds.has(id)) yield id
  for (let copy = 1; ; copy++) {
    const id = `breakdown:${definition}:${copy}`
    if (!occupiedIds.has(id) && !known.has(id)) yield id
  }
}

/** The box and the allocation command use the same count and physical identities. */
export function scorpionBreakdownStock(board: Readonly<BreakdownPosition>, { breakdowns, catalog }: ScorpionSetupAssets) {
  if (!breakdowns) return []
  const { occupiedIds, inUse } = breakdownStockPosition(board)
  return [...breakdowns.counters].flatMap(([definition, { pool, copies }]) => {
    const side = catalog.definitions.get(definition)?.source.side
    if (!side || (copies !== null && (!Number.isSafeInteger(copies) || copies < 0))) return []
    const used = inUse.get(definition) ?? 0
    const ids = freeBreakdownIds(definition, occupiedIds, board.breakdownReturns?.[definition])
    // An unlimited pool exposes the next allocatable identity, not infinitely many counters.
    const availableIds = Array.from({ length: copies === null ? 1 : Math.max(0, copies - used) }, () => ids.next().value!)
    return [{ definition, side, pool, copies, inUse: used, availableIds }]
  })
}

/** Single-counter options for a validated departure window, using the same stock and eligibility checks as submission. */
export function* scorpionBreakdownChoices(state: Readonly<ScorpionInPlay>, side: Side, departing: readonly string[],
  assets: ScorpionSetupAssets): Generator<ScorpionBreakdownOrder> {
  if (!assets.breakdowns) return
  for (const parentId of departing) {
    const parent = state.units[parentId]
    if (!parent || parent.side !== side || !canDetachBreakdownSteps(parent, 1)) continue
    const pool = assets.breakdowns.parentPools.get(parent.definition)
    if (!pool) continue
    for (const [definition, counter] of assets.breakdowns.counters) {
      if (counter.pool !== pool) continue
      const order = { parentId, definitions: [definition] }
      try { detachScorpionBreakdowns(state, side, [order], departing, assets) } catch { continue }
      yield order
    }
  }
}

/** OCS 20.0a. The ordinary move must not have started. */
export function splitScorpionAtStartOfMove(state: Readonly<ScorpionInPlay>, side: Side, parentId: string,
  definitions: readonly string[], assets: ScorpionSetupAssets): ScorpionInPlay {
  const parent = Object.hasOwn(state.units, parentId) ? state.units[parentId] : undefined
  const activity = scorpionGroundActivity(state)
  if (!parent || !canMoveInPhase(parent, state.cursor.phase) ||
    state.moved.includes(parentId) || activity.airlifted.includes(parentId) || (activity.spent[parentId] ?? 0) > 0) {
    throw new Error('Choose an eligible multi-step unit before it starts moving, leaving its last step intact')
  }
  return detachScorpionBreakdowns(state, side, [{ parentId, definitions }], [parentId], assets).state
}

/** OCS 20.0 and TTW 1.6e. Call from a validated departure window. */
export function detachScorpionBreakdowns(state: Readonly<ScorpionInPlay>, side: Side, orders: readonly ScorpionBreakdownOrder[],
  departing: readonly string[], { breakdowns, catalog }: ScorpionSetupAssets) {
  const detachedIds: string[] = []
  if (!Array.isArray(orders)) throw new Error('Give a list of breakdown orders')
  if (!orders.length) return { state, detachedIds }
  if (!breakdowns) throw new Error('No breakdown pools configured for this scenario')
  const units = { ...state.units }
  const { occupiedIds, inUse } = breakdownStockPosition(state)
  const parents = new Set<string>()
  for (const { parentId, definitions } of orders) {
    const parent = Object.hasOwn(units, parentId) ? units[parentId] : undefined
    const pool = parent && breakdowns.parentPools.get(parent.definition)
    if (parents.has(parentId) || !departing.includes(parentId) || !parent || parent.side !== side || !pool ||
      !Array.isArray(definitions) || !canDetachBreakdownSteps(parent, definitions.length)) {
      throw new Error('Choose a distinct eligible multi-step unit before it starts moving, leaving its last step intact')
    }
    parents.add(parentId)
    const { disorganized, reserve, exploit, exploitRating, released, outOfSupply, internalStocks } = parent
    for (const key of definitions) {
      const entry = breakdowns.counters.get(key)
      const definition = catalog.definitions.get(key)
      if (!entry || entry.pool !== pool || definition?.kind !== 'land' || definition.source.side !== side ||
        definition.source.re !== 1 || (entry.copies !== null && (!Number.isSafeInteger(entry.copies) || entry.copies < 0))) {
        throw new Error('Choose a one-step breakdown from the parent unit’s pool')
      }
      const used = inUse.get(key) ?? 0
      if (entry.copies !== null && used >= entry.copies) throw new Error('No copy of this breakdown counter remains in the pool')
      const deployed = deployScorpionGroundCounter(definition, parent.hex, 0)
      const counter = parent.moveMode ? scorpionModeFace(deployed, definition, 'move') : deployed
      if (!isBreakdownCounter(counter)) throw new Error('Choose an eligible breakdown counter')
      if (counter.actionRating > parent.actionRating) throw new Error('Breakdown action rating exceeds the parent unit’s rating')
      const id = freeBreakdownIds(key, occupiedIds, state.breakdownReturns?.[key]).next().value!
      units[id] = { ...counter, formation: undefined, disorganized, reserve, exploit, exploitRating, released, outOfSupply, internalStocks }
      occupiedIds.add(id)
      detachedIds.push(id)
      inUse.set(key, used + 1)
    }
    units[parentId] = { ...parent, stepsLost: parent.stepsLost + definitions.length }
  }
  return { state: { ...state, units }, detachedIds }
}
