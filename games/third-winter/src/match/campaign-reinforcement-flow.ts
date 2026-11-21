import { campaignReinforcementWindow } from '../ttw/campaign/reinforcement.ts'
import type { CampaignReinforcementSchedule } from '../ttw/campaign/reinforcement.ts'
import { dueCampaignBreakoutReturns } from './campaign-breakout-returns.ts'
import type { CampaignReinforcementState, CampaignReinforcementWindow } from './campaign-reinforcement-state.ts'

export function newCampaignReinforcementWindow(): CampaignReinforcementWindow {
  return { settledOrders: [], segment: 'scheduled', rolls: [] }
}

/** The phase and segment own timing. The step is derived from the pending work within that segment. */
export function campaignReinforcementStep(state: Readonly<CampaignReinforcementState>, schedule?: CampaignReinforcementSchedule) {
  if (state.cursor.phase !== 'reinforcement') return undefined
  switch (state.segment) {
    case 'scheduled':
      if (!schedule || campaignReinforcementWindow(schedule, state.cursor).some(({ id }) => !state.settledOrders.includes(id))) {
        return 'settle-scheduled-orders'
      }
      return dueCampaignBreakoutReturns(state).length ? 'place-breakout-returns' : 'close-scheduled-orders'
    case 'supply':
      if (!state.supplyAward) return 'roll-supply'
      return state.supplyAward.status === 'deduction-pending' ? 'resolve-withdrawal-shortfall' : 'place-supply'
    case 'variable-replacements': return state.replacementAward ? 'roll-special-replacement' : 'roll-replacements'
    case 'rebuild-consolidate': return 'rebuild-or-consolidate'
  }
}
