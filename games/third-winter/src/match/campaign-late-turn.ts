import type { Side } from '@ocs-eastern/series/state-types'
import { actingSide, advancePlayerTurn } from '@ocs-eastern/series/turn'
import { resetCampaignCombatLedgers } from './campaign-combat.ts'
import { clearCampaignReserveRelease } from './campaign-ground-movement.ts'
import { clearCampaignPhaseFuel } from './campaign-fuel.ts'
import type { CampaignTurnContext, CampaignTurnState } from './campaign-turn-state.ts'

export type CampaignLateSegment = 'movement' | 'shooting' | 'ground-combat'
export type CompleteCampaignLateSegment = { type: 'complete-campaign-late-segment'; segment: CampaignLateSegment }

const sequences = {
  reaction: ['movement', 'shooting'],
  combat: ['shooting', 'ground-combat'],
  exploitation: ['movement', 'shooting', 'ground-combat'],
} satisfies Record<string, readonly CampaignLateSegment[]>

function latePhase(phase: CampaignTurnState['cursor']['phase']): phase is keyof typeof sequences {
  return phase === 'reaction' || phase === 'combat' || phase === 'exploitation'
}

export function completeCampaignLateSegment(state: Readonly<CampaignTurnState>, actor: Side, action: CompleteCampaignLateSegment,
  context: CampaignTurnContext): CampaignTurnState {
  const { cursor, lateTurnSegment } = state
  if (!latePhase(cursor.phase) || !('phasing' in cursor) || actingSide(cursor.phasing, cursor.phase) !== actor || lateTurnSegment !== action.segment) {
    throw new Error('Campaign phase segment is not open for this actor')
  }
  const sequence: readonly CampaignLateSegment[] = sequences[cursor.phase]
  const next = sequence[sequence.indexOf(lateTurnSegment) + 1]
  if (!next && cursor.phase === 'exploitation') throw new Error('Complete exploitation through its phase end')
  const blockers = context.lateSegmentEndBlockers?.(state, actor, lateTurnSegment)
  if (!blockers) throw new Error('Campaign segment end rules are unavailable')
  if (blockers.length) throw new Error('Campaign segment obligations are outstanding')
  if (next) return clearCampaignPhaseFuel(clearCampaignReserveRelease({ ...state, lateTurnSegment: next }))
  const advanced = advancePlayerTurn(cursor, actor)!
  return clearCampaignPhaseFuel(clearCampaignReserveRelease({ ...resetCampaignCombatLedgers(state), cursor: advanced, lateTurnSegment: advanced.phase === 'combat' ? 'shooting' : 'movement' }))
}
