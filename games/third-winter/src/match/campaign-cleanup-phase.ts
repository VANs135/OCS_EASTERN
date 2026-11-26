import { cleanupUnitMarkers, removeExpiredTrainbusting } from '@ocs-eastern/series/cleanup'
import type { Side } from '@ocs-eastern/series/state-types'
import { advancePlayerTurn } from '@ocs-eastern/series/turn'
import { readyCampaignSte } from './campaign-special-truck-extender.ts'
import { resetCampaignCombatLedgers } from './campaign-combat.ts'
import type { CampaignTurnContext, CampaignTurnState } from './campaign-turn-state.ts'

export type CampaignRoundEnd = { kind: 'continue'; date: string } | { kind: 'ended' }

export function completeCampaignCleanup(state: Readonly<CampaignTurnState>, side: Side, context: CampaignTurnContext): CampaignTurnState {
  const { cursor } = state
  if (cursor.phase !== 'cleanup' || cursor.phasing !== side) throw new Error('Campaign cleanup is not open for this side')
  const blockers = context.cleanupEndBlockers?.(state, side)
  if (!blockers) throw new Error('Campaign cleanup end rules are unavailable')
  if (blockers.length) throw new Error('Campaign cleanup obligations are outstanding')

  const counters = { ...state.counters }
  for (const [id, unit] of Object.entries(counters)) {
    const markers = cleanupUnitMarkers(unit, side)
    if (markers) counters[id] = { ...unit, ...markers }
  }
  const settled = resetCampaignCombatLedgers(readyCampaignSte({ ...state, counters, trainbusting: removeExpiredTrainbusting(state.trainbusting, side),
    groundMovement: undefined, cleanup: undefined, reinforcement: undefined }))
  const next = advancePlayerTurn(cursor, side)
  if (next) return { ...settled, cursor: next }

  const result = context.roundEnd?.(settled)
  if (!result) throw new Error('Campaign round end is unavailable')
  if (result.kind === 'ended') return { ...settled, cursor: { phase: 'ended', reason: 'scenario-end' } }
  const date = new Date(`${result.date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result.date) || !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== result.date || result.date <= state.when.date) throw new Error('Invalid next campaign date')
  return { ...settled, turn: state.turn + 1, when: { ...state.when, date: result.date }, opening: undefined, weather: null,
    cursor: { phase: 'pre-turn', segment: 'weather' } }
}
