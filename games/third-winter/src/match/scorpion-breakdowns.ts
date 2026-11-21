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
  counters: ReadonlyMap<string, { pool: string; copies: number }>
}

export interface ScorpionBreakdownOrder {
  parentId: string
  definitions: readonly string[]
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
  const occupiedIds = new Set([...Object.keys(units), ...state.pieces.map(({ id }) => id)])
  const inUse = new Map<string, number>()
  for (const { definition } of [...Object.values(units), ...state.pieces]) {
    inUse.set(definition, (inUse.get(definition) ?? 0) + 1)
  }
  const parents = new Set<string>()
  for (const { parentId, definitions } of orders) {
    const parent = Object.hasOwn(units, parentId) ? units[parentId] : undefined
    const pool = parent && breakdowns.parentPools.get(parent.definition)
    if (parents.has(parentId) || !departing.includes(parentId) || !parent?.combat || parent.side !== side ||
      parent.combatClass !== 'other' || !pool || !Array.isArray(definitions) || !definitions.length ||
      parent.printedRe - parent.stepsLost <= definitions.length) {
      throw new Error('Choose a distinct eligible multi-step unit before it starts moving, leaving its last step intact')
    }
    parents.add(parentId)
    const { disorganized, reserve, exploit, exploitRating, released, outOfSupply, internalStocks } = parent
    for (const key of definitions) {
      const entry = breakdowns.counters.get(key)
      const definition = catalog.definitions.get(key)
      if (!entry || entry.pool !== pool || definition?.kind !== 'land' || definition.source.side !== side ||
        definition.source.re !== 1 || !Number.isSafeInteger(entry.copies) || entry.copies < 0) {
        throw new Error('Choose a one-step breakdown from the parent unit’s pool')
      }
      const used = inUse.get(key) ?? 0
      if (used >= entry.copies) throw new Error('No copy of this breakdown counter remains in the pool')
      const deployed = deployScorpionGroundCounter(definition, parent.hex, 0)
      const counter = parent.moveMode ? scorpionModeFace(deployed, definition, 'move') : deployed
      if (!counter.combat || counter.combatClass !== 'other') throw new Error('Choose an eligible breakdown counter')
      if (counter.actionRating > parent.actionRating) throw new Error('Breakdown action rating exceeds the parent unit’s rating')
      let copy = 1
      let id = `breakdown:${key}:${copy}`
      while (occupiedIds.has(id)) id = `breakdown:${key}:${++copy}`
      units[id] = { ...counter, formation: undefined, disorganized, reserve, exploit, exploitRating, released, outOfSupply, internalStocks }
      occupiedIds.add(id)
      detachedIds.push(id)
      inUse.set(key, used + 1)
    }
    units[parentId] = { ...parent, stepsLost: parent.stepsLost + definitions.length }
  }
  return { state: { ...state, units }, detachedIds }
}
