import type { Side } from '@ocs-eastern/series/state-types'
import type { ScorpionAirBarrageBoard } from './scorpion-air-barrage.ts'
import { finishScorpionAirBarrage } from './scorpion-air-operations.ts'
import { applyScorpionBarrage } from './scorpion-barrage.ts'
import type { BarrageAction } from './scorpion-barrage.ts'
import type { ScorpionInPlay, ScorpionSession } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'

/** Ground and air fire share defender responses. Fire completion hands a suspended mission back to aviation. */
export function applyScorpionFireAction(state: Readonly<ScorpionSession>, actor: Side,
  action: BarrageAction, assets: ScorpionSetupAssets, board: ScorpionAirBarrageBoard & { supplyRail?: SupplyRailBoard }): ScorpionInPlay {
  const table = action.type === 'declare-artillery-barrage' && action.targetKind === 'air-base'
    ? board.facilityBarrage : board.barrage
  if (state.kind !== 'playing' || state.turn.step.kind !== 'player-turn' || !table) {
    throw new Error('Barrage requires an active player turn and the appropriate OCS v4.3 barrage table')
  }
  return finishScorpionAirBarrage(applyScorpionBarrage(state, actor, action, assets, table,
    board.hedgehogAt, board.supplyRail, board.offerRoll))
}
