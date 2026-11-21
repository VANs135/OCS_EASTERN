import type { Side } from '@ocs-eastern/series/state-types'
import { chooseScorpionCombatTerrain, declareScorpionCombat, defendScorpionCombat, selectScorpionCombatRating } from './scorpion-combat.ts'
import type { ChooseCombatTerrain, DeclareCombat, DefendCombat, ScorpionCombatBoard } from './scorpion-combat.ts'
import { advanceScorpionCombat, continueScorpionRetreatResult, resolveScorpionCombat } from './scorpion-combat-result.ts'
import type { ResolveCombat } from './scorpion-combat-result.ts'
import type { GroundPolicies } from './scorpion-ground-actions.ts'
import { continueScorpionOverrunMove, declareScorpionOverrun } from './scorpion-overrun.ts'
import type { DeclareOverrun, FinishOverrunMove } from './scorpion-overrun.ts'
import type { ContinueCombatRetreat } from './scorpion-retreat.ts'
import type { ScorpionRoll } from './scorpion-reroll.ts'
import type { ScorpionInPlay, ScorpionSession } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'

export type ScorpionCombatAction = DeclareCombat | DeclareOverrun | DefendCombat | ChooseCombatTerrain
  | ResolveCombat | ContinueCombatRetreat | FinishOverrunMove
  | { type: 'select-combat-rating'; unitId: string }
  | { type: 'advance-after-combat'; unitIds: readonly string[] }

/** Ground combat and overruns share the same defender, result and retreat windows. */
export function applyScorpionCombatAction(state: Readonly<ScorpionSession>, actor: Side, action: ScorpionCombatAction,
  assets: ScorpionSetupAssets, board: GroundPolicies & { combat?: ScorpionCombatBoard }, offer?: ScorpionRoll): ScorpionInPlay {
  switch (action.type) {
    case 'continue-combat-retreat':
      if (state.kind !== 'playing') throw new Error('There is no combat retreat to continue')
      return continueScorpionRetreatResult(state, actor, action, assets, board)
    case 'continue-overrun-move':
      if (state.kind !== 'playing' || state.turn.step.kind !== 'player-turn') throw new Error('Overrun movement is unavailable')
      return continueScorpionOverrunMove(state, actor, action, assets, board)
  }

  const { combat, supplyRail } = board
  if (state.kind !== 'playing' || state.turn.step.kind !== 'player-turn' || !combat) {
    throw new Error('Combat requires an active player turn and the OCS v4.3 table')
  }
  switch (action.type) {
    case 'declare-combat':
      return declareScorpionCombat(state, actor, action, assets.map, combat, supplyRail)
    case 'declare-overrun':
      return declareScorpionOverrun(state, actor, action, assets, board, combat)
    case 'defend-combat':
      return defendScorpionCombat(state, actor, action, assets.map, supplyRail)
    case 'select-combat-rating':
      return selectScorpionCombatRating(state, actor, action.unitId)
    case 'choose-combat-terrain':
      return chooseScorpionCombatTerrain(state, actor, action, assets.map, combat.table, offer)
    case 'resolve-combat':
      return resolveScorpionCombat(state, actor, action, assets, board)
    case 'advance-after-combat':
      return advanceScorpionCombat(state, actor, action.unitIds, assets, board)
  }
}
