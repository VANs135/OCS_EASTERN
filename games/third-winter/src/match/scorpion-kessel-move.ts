import type { Side } from '@ocs-eastern/series/state-types'
import { scorpionHexDistance, scorpionHexId } from '../import/hex-id.ts'
import { scorpionRegularBarrageTargets } from './scorpion-barrage-timing.ts'
import { scorpionGroundActivity } from './scorpion-ground-activity.ts'
import { scorpionMovementStepCost } from './scorpion-movement.ts'
import type { MovementBoard } from './scorpion-movement.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'

export type ScorpionKesselMove = {
  type: 'kessel-move'
  unitId: string
  headquartersId: string
  path: readonly string[]
}

/** TTW 2.3a(B), on the Scorpion crop whose Dnepr edges are Major River, not Volga-Class. */
export function scorpionKesselMovePath(state: Readonly<ScorpionInPlay>, side: Side,
  action: ScorpionKesselMove, board: MovementBoard) {
  const { unitId, headquartersId } = action
  const unit = Object.hasOwn(state.units, unitId) ? state.units[unitId] : undefined
  const headquarters = Object.hasOwn(state.units, headquartersId) ? state.units[headquartersId] : undefined
  const { phase, phasing } = state.cursor
  const activity = scorpionGroundActivity(state)
  if (side !== 'axis' || phasing !== side || phase !== 'movement' || board.weather === 'thaw' ||
    state.turn.step.kind !== 'player-turn' || scorpionRegularBarrageTargets(state).size ||
    !unit?.combat || unit.side !== side || unit.mobility !== 'leg' || unit.allowance <= 0 ||
    unit.reserve || unit.exploit || unit.disorganized || state.moved.includes(unitId) || activity.airlifted.includes(unitId)) {
    throw new Error('Kessel movement requires an unmoved Axis Leg counter in Combat or Move Mode during Movement')
  }
  if (!headquarters?.headquarters?.kessel || headquarters.side !== side) {
    throw new Error('Choose one on-map Axis Kessel HQ for the entire route')
  }
  if (!action.path.length || action.path.length > 4) throw new Error('A Kessel move must enter one to four hexes')
  const path = action.path.map(scorpionHexId)
  let from = unit.hex
  for (const [index, to] of path.entries()) {
    if (scorpionHexDistance(headquarters.hex, to) > 2) throw new Error('Every entered hex must be within two hexes of this Kessel HQ')
    const cost = scorpionMovementStepCost(board, from, to, unit)
    if (cost === null || board.enemyCombat(to, side) || board.enemySupplySource(to, side)) {
      throw new Error('Kessel movement cannot enter or cross blocked terrain or an enemy combat or supply hex')
    }
    if (index < path.length - 1 && (cost === 'all' || board.unnegatedEnemyZoc(to, side))) {
      throw new Error('Kessel movement must stop at an All-cost entry or an unnegated enemy ZOC')
    }
    from = to
  }
  if (column(from) > column(unit.hex)) throw new Error('A Kessel move cannot end east of its starting hex')
  return path
}

// The Scorpion crop's column numbers increase eastwards.
const column = (hex: string) => Number(hex.slice(1, hex.indexOf('.')))
