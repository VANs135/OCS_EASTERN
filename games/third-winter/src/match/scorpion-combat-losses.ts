import { scorpionSupplyNetwork } from '../ttw/scorpion/supply-trace.ts'
import { scorpionSuddenDeath } from '../ttw/scorpion/victory.ts'
import { remainingSteps, takeScorpionSteps } from './scorpion-losses.ts'
import { placeScorpionRemnant } from './scorpion-remnants.ts'
import type { ScorpionRemnantPlacement } from './scorpion-remnants.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'
import { scorpionSupplyPosition } from './scorpion-supply-position.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'

export function validateCombatLossOrder(state: Readonly<ScorpionInPlay>, participants: readonly string[], leader: string,
  order: readonly string[], required: number): ReadonlyMap<string, number> {
  if (order.length !== required || (required > 0 && order[0] !== leader)) {
    throw new Error('Assign all combat losses, starting with the Action Rating unit')
  }
  const available = new Map(participants.map((id) => [id, remainingSteps(state.units[id]!)]))
  const assigned = new Map<string, number>()
  for (const id of order) {
    const received = assigned.get(id) ?? 0
    const least = Math.min(...[...available].filter(([key, max]) => (assigned.get(key) ?? 0) < max)
      .map(([key]) => assigned.get(key) ?? 0))
    if ((available.get(id) ?? 0) <= received || received > least) {
      throw new Error('Each involved unit takes one loss before a surviving unit takes another')
    }
    assigned.set(id, received + 1)
  }
  return assigned
}

export function applyScorpionCombatLosses(state: Readonly<ScorpionInPlay>, allocation: ReadonlyMap<string, number>,
  assets: ScorpionSetupAssets, railroad?: SupplyRailBoard, remnants?: readonly ScorpionRemnantPlacement[]): ScorpionInPlay {
  let current = state
  let vp = state.arrival.sovietVp
  const choices = new Map(remnants?.map(({ divisionId, hex }) => [divisionId, hex]))
  if (remnants && choices.size !== remnants.length) throw new Error('Choose one hex per remnant')
  for (const [id, steps] of allocation) {
    const unit = current.units[id]!
    let isolated = false
    if (unit.side === 'axis') {
      const network = scorpionSupplyNetwork(assets.map, scorpionSupplyPosition(current, assets.map, 'axis', railroad))
      isolated = !network.trace(unit.hex, unit.traceDrawMobility).length
    }
    const settled = takeScorpionSteps(current, new Map([[id, steps]]), assets.catalog)
    const deployed = remnants && unit.side === 'axis' && !Object.hasOwn(settled.units, id)
      ? placeScorpionRemnant(settled, id, unit, choices.get(id), assets) : settled
    if (deployed !== settled) choices.delete(id)
    // Scenario p.53. A step that creates a remnant counts once, including if it was already out of trace.
    vp += isolated ? steps : deployed !== settled ? 1 : 0
    current = deployed
  }
  if (choices.size) throw new Error('Remnant placement must match a destroyed eligible division')
  return { ...current, arrival: { ...current.arrival, sovietVp: vp }, victory: scorpionSuddenDeath(current.cursor.turn, vp) }
}
