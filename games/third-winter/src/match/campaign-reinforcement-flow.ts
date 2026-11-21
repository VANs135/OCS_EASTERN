import { campaignReinforcementWindow } from '../ttw/campaign/reinforcement.ts'
import type { CampaignReinforcementSchedule } from '../ttw/campaign/reinforcement.ts'
import type { CampaignReinforcementState } from './campaign-reinforcement-state.ts'

/** The phase and segment own timing. The step is derived from the pending work within that segment. */
export function campaignReinforcementStep(state: Readonly<CampaignReinforcementState>, schedule?: CampaignReinforcementSchedule) {
  if (state.cursor.phase !== 'reinforcement') return undefined
  switch (state.segment) {
    case 'scheduled': return schedule && campaignReinforcementWindow(schedule, state.cursor)
      .every(({ id }) => state.settledOrders.includes(id)) ? 'close-scheduled-orders' : 'settle-scheduled-orders'
    case 'supply':
      if (!state.supplyAward) return 'roll-supply'
      return state.supplyAward.status === 'deduction-pending' ? 'resolve-withdrawal-shortfall' : 'place-supply'
    case 'variable-replacements': return state.replacementAward ? 'roll-special-replacement' : 'roll-replacements'
    case 'rebuild-consolidate': return 'rebuild-or-consolidate'
  }
}
