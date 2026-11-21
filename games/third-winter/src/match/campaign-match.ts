import { acceptCommand } from '@ocs-eastern/match-core/command-log'
import type { Command, MatchRecord } from '@ocs-eastern/match-core/command-log'
import { createRngState } from '@ocs-eastern/series/rng'
import type { Side } from '@ocs-eastern/series/state-types'
import { advancePlayerTurn } from '@ocs-eastern/series/turn'
import { initialWeatherHistory } from '../ttw/campaign/weather.ts'
import { consolidateCampaignAircraft } from './campaign-aircraft-consolidation.ts'
import { applyCampaignBreakout } from './campaign-breakout.ts'
import { applyCampaignGroundMovement } from './campaign-ground-movement.ts'
import { applyCampaignPreTurn } from './campaign-pre-turn.ts'
import { applyCampaignReinforcementPhase } from './campaign-reinforcement-phase.ts'
import type { CampaignTurnAction, CampaignTurnContext, CampaignTurnState } from './campaign-turn-state.ts'

export type CampaignMatch = MatchRecord<CampaignTurnState, CampaignTurnAction, Side>

type CampaignMatchOpening = Pick<CampaignTurnState, 'when' | 'turn' | 'opening' | 'counters'> & Partial<
  Pick<CampaignTurnState, 'weatherHistory' | 'ferries' | 'supplyDumps' | 'withdrawalSupplyDebt'>>

/** Use a normalized board after scenario setup, or a small board for single-mechanism tests. */
export function openCampaignMatch(opening: CampaignMatchOpening, seed: number): CampaignMatch {
  const { when, turn } = opening
  const date = new Date(`${when.date}T00:00:00Z`)
  if (!Number.isSafeInteger(turn) || turn < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(when.date) ||
    !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== when.date) {
    throw new Error('Invalid campaign turn or date')
  }
  return { revision: 0, receipts: [], state: { ...opening, cursor: { phase: 'pre-turn', segment: 'weather' },
    rng: createRngState(seed), weather: null, weatherHistory: { ...(opening.weatherHistory ?? initialWeatherHistory) },
    preTurnRolls: [], breakoutRolls: [], ferries: opening.ferries ?? [], supplyDumps: opening.supplyDumps ?? { axis: {}, soviet: {} },
    withdrawalSupplyDebt: opening.withdrawalSupplyDebt ?? { axis: 0, soviet: 0 } } }
}

export function submitCampaignMatch(record: Readonly<CampaignMatch>, actor: Side,
  command: Readonly<Command<CampaignTurnAction>>, context: CampaignTurnContext) {
  return acceptCommand(record, actor, command, (state, side, action) => applyCampaignTurn(state, side, action, context))
}

function applyCampaignTurn(state: Readonly<CampaignTurnState>, actor: Side,
  action: CampaignTurnAction, context: CampaignTurnContext): CampaignTurnState {
  switch (action.type) {
    case 'determine-campaign-weather':
    case 'roll-campaign-event':
    case 'roll-campaign-initiative':
    case 'choose-campaign-first':
      return applyCampaignPreTurn(state, actor, action, context.thawTiming)
    case 'attempt-campaign-breakout':
    case 'complete-campaign-breakout':
      return applyCampaignBreakout(state, actor, action, context.breakoutBoard)
    case 'move-campaign-ground':
    case 'hold-campaign-ground-zoc':
    case 'complete-campaign-ground-movement':
      return applyCampaignGroundMovement(state, actor, action, context.groundMovement)
    case 'consolidate-campaign-aircraft':
      return consolidateCampaignAircraft(state, actor, action, context)
    case 'complete-campaign-refit': {
      const { cursor } = state
      if (cursor.phase !== 'aircraft-refit') throw new Error('Campaign refit is not open in this campaign player turn')
      if (cursor.phasing !== actor) throw new Error('Only the active side can complete campaign refit')
      return { ...state, cursor: advancePlayerTurn(cursor, actor)!, reinforcement: { stage: 'opening' } }
    }
    default:
      return applyCampaignReinforcementPhase(state, actor, action, context)
  }
}
