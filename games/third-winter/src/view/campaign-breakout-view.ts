import type { Side } from '@ocs-eastern/series/state-types'
import { campaignBreakoutOptions } from '../match/campaign-breakout.ts'
import type { CampaignBreakoutBoard } from '../match/campaign-breakout.ts'
import type { CampaignTurnState } from '../match/campaign-turn-state.ts'

export function projectCampaignBreakout(state: Readonly<CampaignTurnState>, viewer: Side, board?: CampaignBreakoutBoard) {
  if (state.cursor.phase !== 'movement' || state.cursor.phasing !== viewer) return null
  return { options: campaignBreakoutOptions(state, viewer, board),
    results: state.breakoutRolls.filter(({ side, turn }) => side === viewer && turn === state.turn).map((roll) => ({ ...roll })) }
}
