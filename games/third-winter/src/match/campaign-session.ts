import { acceptCommand } from '@ocs-eastern/match-core/command-log'
import type { Command, MatchRecord } from '@ocs-eastern/match-core/command-log'
import { createRngState } from '@ocs-eastern/series/rng'
import type { RngState, Side } from '@ocs-eastern/series/state-types'
import type { CampaignReinforcementDate } from '../ttw/campaign/reinforcement-timing.ts'
import { applyCampaignReinforcement } from './campaign-reinforcement-actions.ts'
import type { CampaignCounter, CampaignReinforcementAction, CampaignReinforcementContext, CampaignReinforcementState } from './campaign-reinforcement-state.ts'

export type CampaignSession = MatchRecord<CampaignReinforcementState, CampaignReinforcementAction, Side>

interface CampaignReinforcementOpening {
  when?: CampaignReinforcementDate
  rng?: RngState
  withdrawalSupplyDebt?: Readonly<Record<Side, number>>
}

/** Open the ordinary scheduled portion after any game-specific start-of-phase actions. */
export function openCampaignReinforcementSession(turn: number, phasing: Side,
  counters: Readonly<Record<string, CampaignCounter>>, opening: CampaignReinforcementOpening = {}): CampaignSession {
  if (!Number.isSafeInteger(turn) || turn < 1) throw new Error('Invalid campaign turn')
  return { revision: 0, receipts: [], state: { cursor: { turn, phasing, phase: 'reinforcement' },
    when: opening.when, rng: opening.rng ?? createRngState(0), counters, settledOrders: [], step: 'scheduled',
    withdrawalSupplyDebt: opening.withdrawalSupplyDebt ?? { axis: 0, soviet: 0 } } }
}

export function submitCampaignSession(record: Readonly<CampaignSession>, actor: Side,
  command: Readonly<Command<CampaignReinforcementAction>>, context: CampaignReinforcementContext) {
  return acceptCommand(record, actor, command, (state, side, action) => applyCampaignReinforcement(state, side, action, context))
}
