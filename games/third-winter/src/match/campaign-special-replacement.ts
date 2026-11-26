import { rebuildRejection, rebuildRestoredSteps } from '@ocs-eastern/series/rebuild'
import type { Side } from '@ocs-eastern/series/state-types'
import { ttwRebuildDestinationKinds, ttwSpecialRebuildsUnit } from '../ttw/campaign/rebuild.ts'
import { isCampaignRebuildWindow } from './campaign-reinforcement-flow.ts'
import type { CampaignCounter, CampaignReinforcementContext, CampaignReinforcementState, CampaignSpecialReplacement } from './campaign-reinforcement-state.ts'

/** TTW 1.7b. Consume one rolled special-replacement result to rebuild a matching dead-pile counter for free. */
export type ApplyCampaignSpecialReplacement = {
  type: 'apply-campaign-special-replacement'
  /** Index into the current window's specialReplacements results. */
  index: number
  counterId: string
  destination: { kind: string; key: string }
}

export interface CampaignSpecialRebuildResult {
  index: number
  category: CampaignSpecialReplacement
  counterId: string
  destination: { kind: string; key: string }
  stepsAfter: number
}

function inspectSpecial(state: Readonly<CampaignReinforcementState>, actor: Side, id: string, context: CampaignReinforcementContext) {
  const counter = Object.hasOwn(state.counters, id) ? state.counters[id] : undefined
  if (!counter || counter.side !== actor) return { reason: 'choose-a-friendly-counter' }
  if (counter.location.kind !== 'dead-pile') return { reason: 'special-replacement-rebuilds-from-dead-pile' }
  const profile = context.rebuild?.profileOf(state, id)
  if (!profile) return { reason: 'missing-rebuild-profile' }
  const candidate = { id, rebuildable: profile.rebuildable, isBreakdown: profile.isBreakdown, inDeadPile: true, steps: 0, printedSteps: profile.printedSteps }
  const rejection = rebuildRejection(candidate)
  return rejection ? { reason: rejection } : { counter, profile, candidate }
}

export function campaignSpecialReplacementOptions(state: Readonly<CampaignReinforcementState>, actor: Side, context: CampaignReinforcementContext) {
  if (!isCampaignRebuildWindow(state, actor)) return null
  const lastResult = state.lastSpecialRebuild ? { ...state.lastSpecialRebuild, destination: { ...state.lastSpecialRebuild.destination } } : null
  const results = (state.specialReplacements ?? []).map((category, index) => ({ index, category, supported: ttwSpecialRebuildsUnit(category) }))
  if (!context.rebuild?.specialCategoryOf) return { configured: false, results, candidates: [], lastResult }
  const candidates: { counterId: string; category: CampaignSpecialReplacement; printedSteps: number; destinations: { kind: string; key: string }[] }[] = []
  for (const [counterId, counter] of Object.entries(state.counters)) {
    if (counter.side !== actor || counter.location.kind !== 'dead-pile') continue
    const inspected = inspectSpecial(state, actor, counterId, context)
    if ('reason' in inspected) continue
    const category = context.rebuild.specialCategoryOf(state, counterId)
    if (!category || !ttwSpecialRebuildsUnit(category)) continue
    const kinds = ttwRebuildDestinationKinds(actor, inspected.profile)
    const destinations = context.rebuild.destinations(state, actor, counterId).filter((d) => kinds.includes(d.kind as typeof kinds[number]))
    candidates.push({ counterId, category, printedSteps: inspected.profile.printedSteps, destinations: destinations.map((d) => ({ ...d })) })
  }
  return { configured: true, results, candidates, lastResult }
}

export function applyCampaignSpecialReplacement(state: Readonly<CampaignReinforcementState>, actor: Side,
  action: ApplyCampaignSpecialReplacement, context: CampaignReinforcementContext): CampaignReinforcementState {
  if (!isCampaignRebuildWindow(state, actor)) throw new Error('Campaign rebuild window is not open for this side')
  if (!context.rebuild) throw new Error('Campaign rebuild profiles are not configured')
  if (!context.rebuild.specialCategoryOf) throw new Error('Campaign special replacement categories are not configured')
  const results = state.specialReplacements ?? []
  if (!Number.isSafeInteger(action.index) || action.index < 0 || action.index >= results.length) throw new Error('Campaign special replacement: invalid-result-index')
  const category = results[action.index]!
  if (!ttwSpecialRebuildsUnit(category)) throw new Error(`Campaign special replacement: ${category}-awaits-its-own-module`)

  const inspected = inspectSpecial(state, actor, action.counterId, context)
  if ('reason' in inspected) throw new Error(`Campaign special replacement: ${inspected.reason}`)
  const { counter, profile, candidate } = inspected
  if (context.rebuild.specialCategoryOf(state, action.counterId) !== category) throw new Error('Campaign special replacement: counter-does-not-match-category')

  const kinds = ttwRebuildDestinationKinds(actor, profile)
  if (!kinds.includes(action.destination.kind as typeof kinds[number])) throw new Error('Campaign special replacement: illegal-destination-kind')
  const chosen = action.destination
  if (!context.rebuild.destinations(state, actor, action.counterId).some((d) => d.kind === chosen.kind && d.key === chosen.key)) {
    throw new Error('Campaign special replacement: illegal-destination')
  }

  // TTW 1.7b. The rebuild is free: no abstract points are spent and the consumed result leaves the window.
  const stepsAfter = rebuildRestoredSteps(candidate)
  const location: CampaignCounter['location'] = chosen.kind === 'rvgk' ? { kind: 'box', box: chosen.key } : { kind: 'map', hex: chosen.key }
  const updated: CampaignCounter = { ...counter, location, currentRe: stepsAfter, stepsLost: profile.printedSteps - stepsAfter,
    mode: 'combat', disorganized: false, internalStocks: undefined, ...(counter.kind === 'aircraft' ? { active: true } : {}) }
  const lastSpecialRebuild: CampaignSpecialRebuildResult = { index: action.index, category, counterId: action.counterId, destination: { ...chosen }, stepsAfter }
  return { ...state, counters: { ...state.counters, [action.counterId]: updated },
    specialReplacements: results.filter((_, at) => at !== action.index), lastSpecialRebuild }
}