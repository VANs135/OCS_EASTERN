import type { Side } from '@ocs-eastern/series/state-types'
import { advancePlayerTurn } from '@ocs-eastern/series/turn'
import { returnCampaignBreakout } from './campaign-breakout-returns.ts'
import { applyCampaignReinforcement } from './campaign-reinforcement-actions.ts'
import { newCampaignReinforcementWindow } from './campaign-reinforcement-flow.ts'
import type { CampaignReinforcementState } from './campaign-reinforcement-state.ts'
import type { CampaignReinforcementPhaseAction, CampaignTurnContext, CampaignTurnState } from './campaign-turn-state.ts'

/** Give the ordinary reinforcement kernel a view of the current board and its own window. */
export function campaignReinforcementAtCursor(state: Readonly<CampaignTurnState>): CampaignReinforcementState | null {
  const { cursor, reinforcement, turn, when, rng, counters, supplyDumps, withdrawalSupplyDebt } = state
  if (cursor.phase !== 'reinforcement' || reinforcement?.stage !== 'ordinary') return null
  return { ...reinforcement.window, cursor: { turn, phasing: cursor.phasing, phase: cursor.phase },
    when, rng, counters, supplyDumps, withdrawalSupplyDebt }
}

function requireClearBoundary(state: Readonly<CampaignTurnState>, stage: 'opening' | 'closing', context: CampaignTurnContext) {
  const blockers = context.reinforcementBlockers?.(state, stage)
  if (!blockers) throw new Error(`Campaign reinforcement ${stage} rules are not configured`)
  if (blockers.length) throw new Error(`Campaign reinforcement ${stage} obligations are outstanding`)
}

export function applyCampaignReinforcementPhase(state: Readonly<CampaignTurnState>, actor: Side,
  action: CampaignReinforcementPhaseAction, context: CampaignTurnContext): CampaignTurnState {
  const { cursor, reinforcement } = state
  if (cursor.phase !== 'reinforcement' || cursor.phasing !== actor || !reinforcement) throw new Error('Campaign reinforcement is not open for this side')
  if (action.type === 'complete-campaign-reinforcement-opening') {
    if (reinforcement.stage !== 'opening') throw new Error('Campaign reinforcement opening is not active')
    requireClearBoundary(state, 'opening', context)
    return { ...state, reinforcement: { stage: 'ordinary', window: newCampaignReinforcementWindow() } }
  }
  if (action.type === 'complete-campaign-rebuilds') {
    if (reinforcement.stage !== 'ordinary' || reinforcement.window.segment !== 'rebuild-consolidate') {
      throw new Error('The rebuild and consolidation window is not active')
    }
    return { ...state, reinforcement: { stage: 'closing', window: reinforcement.window } }
  }
  if (action.type === 'complete-campaign-reinforcement') {
    if (reinforcement.stage !== 'closing') throw new Error('Campaign reinforcement closing is not active')
    requireClearBoundary(state, 'closing', context)
    return { ...state, cursor: advancePlayerTurn(cursor, actor)!, movementSegment: 'breakout' }
  }

  const active = campaignReinforcementAtCursor(state)
  if (!active) throw new Error('Ordinary campaign reinforcement is not open')
  const updated = action.type === 'return-campaign-breakout' ? returnCampaignBreakout(active, actor, action, context.breakoutReturns)
    : applyCampaignReinforcement(active, actor, action, context.reinforcement)
  const { rng, counters, supplyDumps, withdrawalSupplyDebt, cursor: _cursor, when: _when, ...window } = updated
  return { ...state, rng, counters, supplyDumps, withdrawalSupplyDebt, reinforcement: { stage: 'ordinary', window } }
}
