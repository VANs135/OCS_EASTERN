import type { Side } from '@ocs-eastern/series/state-types'
import { actingSide } from '@ocs-eastern/series/turn'
import type { ScorpionMap } from '../import/scorpion-map.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'

export type ScorpionReserveAction = { type: 'mark-reserve' | 'release-reserve'; unitId: string }

/** Scorpion's six Reserve markers per side, and OCS 5.7b–c. */
export function applyScorpionReserve(state: Readonly<ScorpionInPlay>, side: Side,
  action: ScorpionReserveAction, map: ScorpionMap): ScorpionInPlay {
  const unit = Object.hasOwn(state.units, action.unitId) ? state.units[action.unitId] : undefined
  const phase = state.cursor.phase
  if (!unit || unit.side !== side || !unit.combat || unit.disorganized || actingSide(state.cursor.phasing, phase) !== side) {
    throw new Error('Only an eligible friendly unit can enter or leave Reserve')
  }
  if (action.type === 'release-reserve') {
    if (!unit.reserve || (phase !== 'reaction' && phase !== 'exploitation')) {
      throw new Error('Release Reserve units during Reaction or Exploitation')
    }
    return { ...state, units: { ...state.units, [action.unitId]: { ...unit, reserve: undefined, released: true } } }
  }
  const enemyZoc = Object.values(state.units).some((enemy) => enemy.side !== side && enemy.attackCapable &&
    !enemy.reserve && !enemy.moveMode && !enemy.outOfSupply && !enemy.disorganized && map.neighbors(enemy.hex).includes(unit.hex))
  const held = Object.values(state.units).filter((candidate) => candidate.side === side && candidate.reserve).length
  if (phase !== 'movement' || enemyZoc || unit.reserve || state.moved.includes(action.unitId) || held >= 6) {
    throw new Error('Reserve requires a free marker and an eligible unmoved unit outside enemy ZOC')
  }
  return { ...state, units: { ...state.units, [action.unitId]: { ...unit, reserve: action.unitId } } }
}
