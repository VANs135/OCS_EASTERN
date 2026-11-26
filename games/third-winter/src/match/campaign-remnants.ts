import type { Side } from '@ocs-eastern/series/state-types'
import { remnantRebuildEligible } from '../ttw/combat-special.ts'
import { emptyCampaignReplacementSpent } from './campaign-reinforcement-state.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

/** TTW 2.4d 残部重建事实：与 Corps/Army HQ 同格判定、母师满步数。 */
export interface CampaignRemnantRebuildBoard {
  isRemnant(state: Readonly<CampaignTurnState>, id: string): boolean
  isParentDivision(state: Readonly<CampaignTurnState>, id: string): boolean
  hqStacked(state: Readonly<CampaignTurnState>, hex: string): boolean
  printedStepsOf(state: Readonly<CampaignTurnState>, id: string): number
}

export type RebuildCampaignFromRemnant = { type: 'rebuild-campaign-from-remnant'; remnantId: string; divisionId: string }

/**
 * TTW 2.4d：轴心增援重建窗口花 1 Pax，移除与 Corps/Army HQ 同格的残部营，
 * 重建一个 16-4-3 师（仅一步）于残部格；残部立即回池（删除实例）。
 */
export function rebuildCampaignFromRemnant(state: Readonly<CampaignTurnState>, actor: Side,
  action: RebuildCampaignFromRemnant, board: CampaignRemnantRebuildBoard | undefined): CampaignTurnState {
  if (!board) throw new Error('Campaign remnant rebuild rules are not configured')
  const { cursor, reinforcement } = state
  if (cursor.phase !== 'reinforcement' || cursor.phasing !== 'axis' || actor !== 'axis' ||
    reinforcement?.stage !== 'ordinary' || reinforcement.window.segment !== 'rebuild-consolidate') {
    throw new Error('Remnant rebuild is only open in the Axis rebuild and consolidation window')
  }
  const remnant = Object.hasOwn(state.counters, action.remnantId) ? state.counters[action.remnantId] : undefined
  const division = Object.hasOwn(state.counters, action.divisionId) ? state.counters[action.divisionId] : undefined
  const hex = remnant?.location.kind === 'map' ? remnant.location.hex : undefined
  if (!remnant || remnant.side !== 'axis' || !hex || !board.isRemnant(state, action.remnantId) ||
    !division || division.side !== 'axis' || division.location.kind !== 'dead-pile' ||
    !board.isParentDivision(state, action.divisionId)) {
    throw new Error('Choose a map remnant and a dead-pile 16-4-3 division')
  }
  const window = reinforcement.window
  const spent = window.replacementSpent ?? emptyCampaignReplacementSpent()
  const pax = state.replacementHoldings[actor].pax + (window.replacementAward?.pax ?? 0) - spent.pax
  if (!remnantRebuildEligible({ axisReinforcement: true, corpsOrArmyHqStacked: board.hqStacked(state, hex), paxAvailable: pax >= 1 })) {
    throw new Error('Remnant rebuild requires a stacked Corps/Army HQ and one Pax')
  }
  const printedSteps = board.printedStepsOf(state, action.divisionId)
  if (!Number.isSafeInteger(printedSteps) || printedSteps < 1) throw new Error('Remnant rebuild: printed-steps-unavailable')
  const counters = { ...state.counters }
  counters[action.divisionId] = { ...division, location: { kind: 'map', hex }, currentRe: 1, stepsLost: printedSteps - 1,
    mode: 'combat', disorganized: false, internalStocks: undefined }
  delete counters[action.remnantId]
  return { ...state, counters,
    reinforcement: { ...reinforcement, window: { ...window, replacementSpent: { ...spent, pax: spent.pax + 1 } } } }
}