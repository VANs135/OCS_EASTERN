import { acceptCommand } from '@ocs-eastern/match-core/command-log'
import type { Command, MatchRecord } from '@ocs-eastern/match-core/command-log'
import type { Side } from '@ocs-eastern/series/state-types'
import { applyCampaignReinforcement } from './campaign-reinforcement-actions.ts'
import type { CampaignCounter, CampaignReinforcementAction, CampaignReinforcementContext, CampaignReinforcementState } from './campaign-reinforcement-state.ts'

export type CampaignSession = MatchRecord<CampaignReinforcementState, CampaignReinforcementAction, Side>

/** Open the scheduled portion of a reinforcement phase on an already assembled campaign position. */
export function openCampaignReinforcementSession(turn: number, phasing: Side,
  counters: Readonly<Record<string, CampaignCounter>>): CampaignSession {
  if (!Number.isSafeInteger(turn) || turn < 1) throw new Error('Invalid campaign turn')
  return { revision: 0, receipts: [], state: { cursor: { turn, phasing, phase: 'reinforcement' },
    counters, settledOrders: [], scheduledWindow: 'open', withdrawalSupplyDebt: { axis: 0, soviet: 0 } } }
}

export function submitCampaignSession(record: Readonly<CampaignSession>, actor: Side,
  command: Readonly<Command<CampaignReinforcementAction>>, context: CampaignReinforcementContext) {
  return acceptCommand(record, actor, command, (state, side, action) => applyCampaignReinforcement(state, side, action, context))
}
