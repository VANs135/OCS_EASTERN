import { acceptCommand } from '@ocs-eastern/match-core/command-log'
import type { Command, MatchRecord } from '@ocs-eastern/match-core/command-log'
import { applySetupStep, createSetupState } from '@ocs-eastern/series/setup-workflow'
import type { SetupAction, SetupDrawRecord, SetupPlan, SetupRules, SetupState } from '@ocs-eastern/series/setup-workflow'
import type { Side } from '@ocs-eastern/series/state-types'
import { applyCampaignTurn, openCampaignMatch } from './campaign-match.ts'
import type { CampaignMatchOpening } from './campaign-match.ts'
import type { CampaignCounter } from './campaign-reinforcement-state.ts'
import type { CampaignTurnAction, CampaignTurnContext, CampaignTurnState } from './campaign-turn-state.ts'

export type CampaignOpeningAction = SetupAction | CampaignTurnAction
export type CampaignOpeningState =
  | { kind: 'setup'; opening: Omit<CampaignMatchOpening, 'counters'>; setup: SetupState<CampaignCounter> }
  | { kind: 'playing'; turn: CampaignTurnState; setupDraws: readonly SetupDrawRecord[] }

export type CampaignOpeningSession = MatchRecord<CampaignOpeningState, CampaignOpeningAction, Side>

export interface CampaignOpeningContext {
  setupPlan: SetupPlan
  setupRules: SetupRules<CampaignCounter>
  turn: CampaignTurnContext
}

/** Configure a new game with its own normalized setup instructions and physical counter pool. */
export function openCampaignSession(opening: CampaignMatchOpening, context: CampaignOpeningContext, seed: number): CampaignOpeningSession {
  const { counters, ...initial } = opening
  const prepared = openCampaignMatch(opening, seed).state
  const setup = createSetupState(counters, context.setupPlan, context.setupRules, prepared.rng.seed)
  return { revision: 0, receipts: [], state: { kind: 'setup', opening: { ...initial, opening: prepared.opening }, setup } }
}

function isSetupAction(action: CampaignOpeningAction): action is SetupAction {
  return action.type === 'setup-place' || action.type === 'setup-draw' || action.type === 'setup-confirm'
}

/** Setup and player turns use the same revision, receipts and random sequence. */
export function submitCampaignSessionCommand(record: Readonly<CampaignOpeningSession>, actor: Side,
  command: Readonly<Command<CampaignOpeningAction>>, context: CampaignOpeningContext) {
  return acceptCommand(record, actor, command, (state, side, action): CampaignOpeningState => {
    if (state.kind === 'setup') {
      if (!isSetupAction(action)) throw new Error('Complete setup before starting the turn')
      const setup = applySetupStep(state.setup, context.setupPlan, side, action, context.setupRules)
      if (setup.stepIndex < context.setupPlan.steps.length) return { ...state, setup }
      const turn = openCampaignMatch({ ...state.opening, counters: setup.counters }, setup.rng).state
      return { kind: 'playing', turn, setupDraws: setup.draws }
    }
    if (isSetupAction(action)) throw new Error('Setup is already complete')
    return { ...state, turn: applyCampaignTurn(state.turn, side, action, context.turn) }
  })
}
