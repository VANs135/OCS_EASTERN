import type { Side } from '@ocs-eastern/series/state-types'
import { advancePlayerTurn } from '@ocs-eastern/series/turn'
import { returnCampaignBreakout } from './campaign-breakout-returns.ts'
import { applyCampaignReinforcement } from './campaign-reinforcement-actions.ts'
import { placeCampaignSpecialHedgehog } from './campaign-special-hedgehog.ts'
import { placeCampaignHqRecovery } from './campaign-hq-recovery.ts'
import { placeCampaignKessel, removeCampaignKessel } from './campaign-kessel-placement.ts'
import { rebuildCampaignFromRemnant } from './campaign-remnants.ts'
import { newCampaignReinforcementWindow } from './campaign-reinforcement-flow.ts'
import type { CampaignReinforcementState } from './campaign-reinforcement-state.ts'
import { emptyCampaignReplacementSpent } from './campaign-reinforcement-state.ts'
import type { CampaignReinforcementPhaseAction, CampaignTurnContext, CampaignTurnState } from './campaign-turn-state.ts'
import { beginCampaignPontoonPhase } from './campaign-pontoon-phase.ts'
import { beginCampaignKhersonFerryPhase } from './campaign-kherson-ferry.ts'

/** Give the ordinary reinforcement kernel a view of the current board and its own window. */
export function campaignReinforcementAtCursor(state: Readonly<CampaignTurnState>): CampaignReinforcementState | null {
  const { cursor, reinforcement, turn, when, rng, counters, supplyDumps, withdrawalSupplyDebt, replacementHoldings } = state
  if (cursor.phase !== 'reinforcement' || reinforcement?.stage !== 'ordinary') return null
  return { ...reinforcement.window, cursor: { turn, phasing: cursor.phasing, phase: cursor.phase },
    when, rng, counters, supplyDumps, withdrawalSupplyDebt, replacementHoldings }
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
    // TTW 1.7a. Bank the unspent Pax/Ally; Air/Eq/SR expire with the window.
    const award = reinforcement.window.replacementAward
    const spent = reinforcement.window.replacementSpent ?? emptyCampaignReplacementSpent()
    const holdings = state.replacementHoldings[actor]
    const banked = { pax: holdings.pax + (award?.pax ?? 0) - spent.pax, ally: holdings.ally + (award?.ally ?? 0) - spent.ally }
    return { ...state, replacementHoldings: { ...state.replacementHoldings, [actor]: banked },
      reinforcement: { stage: 'closing', window: reinforcement.window } }
  }
  if (action.type === 'complete-campaign-reinforcement') {
    if (reinforcement.stage !== 'closing') throw new Error('Campaign reinforcement closing is not active')
    requireClearBoundary(state, 'closing', context)
    const opened = { ...state, cursor: advancePlayerTurn(cursor, actor)!, movementSegment: 'breakout' as const }
    const engineering = beginCampaignPontoonPhase(opened, actor, context.groundMovement)
    return beginCampaignKhersonFerryPhase(engineering, actor, context.groundMovement?.map)
  }

  if (action.type === 'place-campaign-special-hedgehog') {
    if (!context.specialHedgehog) throw new Error('Campaign special replacement hedgehogs require a trace board')
    return placeCampaignSpecialHedgehog(state, actor, action, context.specialHedgehog)
  }
  if (action.type === 'place-campaign-hq-recovery') return placeCampaignHqRecovery(state, actor, action, context.hqRecovery)
  if (action.type === 'rebuild-campaign-from-remnant') return rebuildCampaignFromRemnant(state, actor, action, context.remnantRebuild)
  if (action.type === 'place-campaign-kessel') return placeCampaignKessel(state, actor, action, context.kesselPlacement)
  if (action.type === 'remove-campaign-kessel') return removeCampaignKessel(state, actor, action, context.kesselPlacement)

  const active = campaignReinforcementAtCursor(state)
  if (!active) throw new Error('Ordinary campaign reinforcement is not open')
  const updated = action.type === 'return-campaign-breakout' ? returnCampaignBreakout(active, actor, action, context.breakoutReturns)
    : applyCampaignReinforcement(active, actor, action, context.reinforcement)
  const { rng, counters, supplyDumps, withdrawalSupplyDebt, replacementHoldings, cursor: _cursor, when: _when, ...window } = updated
  return { ...state, rng, counters, supplyDumps, withdrawalSupplyDebt, replacementHoldings, reinforcement: { stage: 'ordinary', window } }
}
