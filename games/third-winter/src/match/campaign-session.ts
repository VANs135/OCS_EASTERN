import { acceptCommand } from '@ocs-eastern/match-core/command-log'
import type { Command, MatchRecord } from '@ocs-eastern/match-core/command-log'
import { createRngState } from '@ocs-eastern/series/rng'
import type { RngState, Side } from '@ocs-eastern/series/state-types'
import type { CampaignReinforcementDate } from '../ttw/campaign/reinforcement-timing.ts'
import { applyCampaignReinforcement } from './campaign-reinforcement-actions.ts'
import { newCampaignReinforcementWindow } from './campaign-reinforcement-flow.ts'
import type { CampaignCounter, CampaignReinforcementAction, CampaignReinforcementContext, CampaignReinforcementState } from './campaign-reinforcement-state.ts'

export type CampaignSession = MatchRecord<CampaignReinforcementState, CampaignReinforcementAction, Side>

interface CampaignReinforcementOpening {
  when?: CampaignReinforcementDate
  rng?: RngState
  withdrawalSupplyDebt?: Readonly<Record<Side, number>>
  supplyDumps?: CampaignReinforcementState['supplyDumps']
}

/** Isolated ordinary reinforcement window for mechanism-level use. */
export function openCampaignReinforcementSession(turn: number, phasing: Side,
  counters: Readonly<Record<string, CampaignCounter>>, opening: CampaignReinforcementOpening = {}): CampaignSession {
  if (!Number.isSafeInteger(turn) || turn < 1) throw new Error('Invalid campaign turn')
  return { revision: 0, receipts: [], state: { cursor: { turn, phasing, phase: 'reinforcement' },
    when: opening.when, rng: opening.rng ?? createRngState(0), counters, ...newCampaignReinforcementWindow(),
    withdrawalSupplyDebt: opening.withdrawalSupplyDebt ?? { axis: 0, soviet: 0 },
    supplyDumps: opening.supplyDumps ?? { axis: {}, soviet: {} } } }
}

export function submitCampaignSession(record: Readonly<CampaignSession>, actor: Side,
  command: Readonly<Command<CampaignReinforcementAction>>, context: CampaignReinforcementContext) {
  return acceptCommand(record, actor, command, (state, side, action) => applyCampaignReinforcement(state, side, action, context))
}
