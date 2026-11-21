import { acceptCommand } from '@ocs-eastern/match-core/command-log'
import type { Command, MatchRecord } from '@ocs-eastern/match-core/command-log'
import { createRngState } from '@ocs-eastern/series/rng'
import type { Side } from '@ocs-eastern/series/state-types'
import { advancePlayerTurn } from '@ocs-eastern/series/turn'
import { initialWeatherHistory } from '../ttw/campaign/weather.ts'
import { applyCampaignPreTurn } from './campaign-pre-turn.ts'
import { applyCampaignReinforcement } from './campaign-reinforcement-actions.ts'
import { newCampaignReinforcementWindow } from './campaign-reinforcement-flow.ts'
import type { CampaignReinforcementState } from './campaign-reinforcement-state.ts'
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
    preTurnRolls: [], ferries: opening.ferries ?? [], supplyDumps: opening.supplyDumps ?? { axis: {}, soviet: {} },
    withdrawalSupplyDebt: opening.withdrawalSupplyDebt ?? { axis: 0, soviet: 0 } } }
}

/** Give the existing reinforcement kernel a view of the current board and its own window. */
export function campaignReinforcementAtCursor(state: Readonly<CampaignTurnState>): CampaignReinforcementState | null {
  const { cursor, reinforcement, turn, when, rng, counters, supplyDumps, withdrawalSupplyDebt } = state
  if (cursor.phase !== 'reinforcement' || reinforcement?.stage !== 'ordinary') return null
  return { ...reinforcement.window, cursor: { turn, phasing: cursor.phasing, phase: cursor.phase },
    when, rng, counters, supplyDumps, withdrawalSupplyDebt }
}

export function submitCampaignMatch(record: Readonly<CampaignMatch>, actor: Side,
  command: Readonly<Command<CampaignTurnAction>>, context: CampaignTurnContext) {
  return acceptCommand(record, actor, command, (state, side, action) => applyCampaignTurn(state, side, action, context))
}

function requireClearBoundary(state: Readonly<CampaignTurnState>, stage: 'opening' | 'closing', context: CampaignTurnContext) {
  const blockers = context.reinforcementBlockers?.(state, stage)
  if (!blockers) throw new Error(`Campaign reinforcement ${stage} rules are not configured`)
  if (blockers.length) throw new Error(`Campaign reinforcement ${stage} obligations are outstanding`)
}

function applyCampaignTurn(state: Readonly<CampaignTurnState>, actor: Side,
  action: CampaignTurnAction, context: CampaignTurnContext): CampaignTurnState {
  switch (action.type) {
    case 'determine-campaign-weather':
    case 'roll-campaign-event':
    case 'roll-campaign-initiative':
    case 'choose-campaign-first':
      return applyCampaignPreTurn(state, actor, action, context.thawTiming)
  }

  const { cursor, reinforcement } = state
  if (cursor.phase === 'pre-turn' || cursor.phase === 'ended' || cursor.phasing !== actor) {
    throw new Error('The active side must be in its campaign player turn')
  }
  if (action.type === 'complete-campaign-refit') {
    if (cursor.phase !== 'aircraft-refit') throw new Error('Campaign refit is not open')
    return { ...state, cursor: advancePlayerTurn(cursor, actor)!, reinforcement: { stage: 'opening' } }
  }
  if (cursor.phase !== 'reinforcement' || !reinforcement) throw new Error('Campaign reinforcement is not open')
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
    return { ...state, cursor: advancePlayerTurn(cursor, actor)! }
  }

  const active = campaignReinforcementAtCursor(state)
  if (!active) throw new Error('Ordinary campaign reinforcement is not open')
  const { rng, counters, supplyDumps, withdrawalSupplyDebt, cursor: _cursor, when: _when, ...window } =
    applyCampaignReinforcement(active, actor, action, context.reinforcement)
  return { ...state, rng, counters, supplyDumps, withdrawalSupplyDebt, reinforcement: { stage: 'ordinary', window } }
}
