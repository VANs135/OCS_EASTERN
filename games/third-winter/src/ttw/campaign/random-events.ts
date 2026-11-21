import type { Die } from '@ocs-eastern/series/dice'

export type CampaignEventCheck = 'event-category' | 'event-code'
export interface CampaignEventDraw {
  table: 'common' | 'rare'
  code: number
}

/** TTW 1.9 and Living Rules pp. 27–28. A 6 has no event and uses no table dice. */
export function drawCampaignEvent(roll: (check: CampaignEventCheck) => Die): CampaignEventDraw | undefined {
  const category = roll('event-category')
  if (category === 6) return undefined
  return { table: category === 5 ? 'rare' : 'common', code: 10 * roll('event-code') + roll('event-code') }
}
