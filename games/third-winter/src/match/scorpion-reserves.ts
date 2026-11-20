import { reserveHexesInUse } from '@ocs-eastern/series/reserve'
import type { Side } from '@ocs-eastern/series/state-types'
import type { DeployedCounter } from '../import/scorpion-deployment.ts'
import { actingSide } from '@ocs-eastern/series/turn'
import { scorpionModeFace } from '../import/scorpion-mode-face.ts'
import type { GroundFace } from '../import/scorpion-mode-face.ts'
import { scorpionGroundActivity } from './scorpion-ground-activity.ts'
import { scorpionHedgehogLevel } from './scorpion-hedgehogs.ts'
import { assertScorpionPhaseStacking } from './scorpion-stacking.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'
import { scorpionEnemyZoc } from './scorpion-supply-position.ts'

export type ScorpionReserveFace = GroundFace | 'current'
export const scorpionReserveMarkerLimit = 6

export function scorpionReserveStock(units: Iterable<DeployedCounter>, side: Side) {
  return scorpionReserveMarkerLimit - reserveHexesInUse(units, side).size
}
export type ScorpionReserveAction = { type: 'mark-reserve'; unitId: string; face?: ScorpionReserveFace }
  | { type: 'leave-reserve'; unitId: string; face?: ScorpionReserveFace }
  | { type: 'release-reserve'; unitId: string }

export function applyScorpionReserve(state: Readonly<ScorpionInPlay>, side: Side,
  action: ScorpionReserveAction, assets: ScorpionSetupAssets): ScorpionInPlay {
  if (action.type === 'mark-reserve') {
    const marked = prepareScorpionReserve(state, side, action.unitId, action.face ?? 'current', assets)
    assertScorpionReserveCapacity(marked, side)
    return marked
  }
  const unit = Object.hasOwn(state.units, action.unitId) ? state.units[action.unitId] : undefined
  const phase = state.cursor.phase
  if (action.type === 'leave-reserve') {
    if (!unit?.reserve) throw new Error('Choose a unit in Reserve')
    const oriented = prepareScorpionReserve(state, side, action.unitId, action.face ?? 'current', assets)
    return { ...oriented, units: { ...oriented.units,
      [action.unitId]: { ...oriented.units[action.unitId]!, reserve: undefined } } }
  }
  if (!unit?.reserve || unit.side !== side || unit.disorganized || actingSide(state.cursor.phasing, phase) !== side ||
    (phase !== 'reaction' && phase !== 'exploitation') || (phase === 'exploitation' && state.combatTargets?.length)) {
    throw new Error('Release an eligible friendly Reserve during the Reaction or Exploitation movement segment')
  }
  return { ...state, units: { ...state.units, [action.unitId]: { ...unit, reserve: undefined, released: true } } }
}

export function prepareScorpionReserve(state: Readonly<ScorpionInPlay>, side: Side, unitId: string,
  face: ScorpionReserveFace, { map, catalog }: ScorpionSetupAssets): ScorpionInPlay {
  const unit = Object.hasOwn(state.units, unitId) ? state.units[unitId] : undefined
  if (!unit || unit.side !== side || (!unit.combat && unit.organicTruck === undefined) || unit.disorganized || unit.exploit ||
    state.cursor.phase !== 'movement' || state.cursor.phasing !== side || state.moved.includes(unitId) ||
    scorpionGroundActivity(state).airlifted.includes(unitId)) {
    throw new Error('Reserve requires an eligible friendly unit before it moves in its Movement phase')
  }
  if (!unit.reserve && scorpionEnemyZoc(state, map, side).has(unit.hex)) {
    throw new Error('A unit cannot enter Reserve in enemy ZOC')
  }
  if (face !== 'current' && face !== 'combat' && face !== 'move') throw new Error('Invalid Reserve orientation')
  const oriented = face === 'current' ? unit : scorpionModeFace(unit, catalog.definitions.get(unit.definition), face)
  return { ...state, units: { ...state.units, [unitId]: { ...oriented, reserve: unitId } } }
}

export function assertScorpionReserveCapacity(state: Readonly<ScorpionInPlay>, side: Side) {
  if (scorpionReserveStock(Object.values(state.units), side) < 0) throw new Error('No free Reserve marker for this hex')
}

export function assertScorpionMovementEnd(state: Readonly<ScorpionInPlay>, side: Side,
  hedgehogAt: ((hex: string) => number) | undefined) {
  const hexes = reserveHexesInUse(Object.values(state.units), side)
  if ([...hexes].some((hex) => scorpionHedgehogLevel(state, hex, hedgehogAt) > 0)) {
    throw new Error('A Reserve cannot share a hex with a hedgehog at the end of a Movement Segment')
  }
  assertScorpionPhaseStacking(state, side)
}
