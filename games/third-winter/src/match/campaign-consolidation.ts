import { consolidationGroupKey, consolidationUnitRejection, planMultiStepConsolidation } from '@ocs-eastern/series/consolidation'
import type { MultiStepConsolidationUnit } from '@ocs-eastern/series/consolidation'
import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignConsolidationBox } from '../ttw/campaign/consolidation.ts'
import { campaignConsolidationLocation } from './campaign-consolidation-location.ts'
import type { CampaignFormationProfile } from './campaign-formation-exchange.ts'
import { isCampaignRebuildWindow } from './campaign-reinforcement-flow.ts'
import type { CampaignReinforcementContext, CampaignReinforcementState } from './campaign-reinforcement-state.ts'

export type ConsolidateCampaignUnits = { type: 'consolidate-campaign-units'; keepId: string; removeId: string }
export type CampaignConsolidationResult = Extract<ReturnType<typeof planMultiStepConsolidation>, { ok: true }>['plan']

export interface CampaignConsolidationBoard {
  /** Complete and canonical printed face facts. Leave unavailable faces unresolved. */
  profileOf(state: Readonly<CampaignReinforcementState>, id: string):
    Pick<MultiStepConsolidationUnit, 'combatFaceKey' | 'moveFaceKey' | 'printedSteps'> | undefined
  boxOf?(id: string): CampaignConsolidationBox | undefined
  formationOf?(state: Readonly<CampaignReinforcementState>, id: string): CampaignFormationProfile | undefined
}

function inspectCounter(state: Readonly<CampaignReinforcementState>, actor: Side, id: string, context: CampaignReinforcementContext):
  { unit: MultiStepConsolidationUnit } | { reason: string } {
  const counter = Object.hasOwn(state.counters, id) ? state.counters[id] : undefined
  if (counter?.side !== actor || counter.kind !== 'land') return { reason: 'choose-a-friendly-ground-unit' }
  const location = campaignConsolidationLocation(counter.location, context.resolveHex, context.consolidation?.boxOf)
  if ('reason' in location) return location

  const profile = context.consolidation?.profileOf(state, id)
  if (!profile) return { reason: 'missing-printed-profile' }
  const { stepsLost, currentRe } = counter
  if (stepsLost === undefined || !Number.isSafeInteger(stepsLost) || stepsLost < 0) return { reason: 'missing-or-invalid-step-losses' }
  const steps = profile.printedSteps - stepsLost
  // OCS 4.6 and 9.11. Each surviving step of a multi-step unit represents one RE.
  if (currentRe !== undefined && currentRe !== steps) return { reason: 'step-losses-and-re-disagree' }
  const unit = { ...profile, id, locationKey: location.key, steps, disorganized: counter.disorganized === true, internalStocks: counter.internalStocks }
  const rejection = consolidationUnitRejection(unit)
  return rejection ? { reason: rejection } : { unit }
}

/** Members of the same group are interchangeable as keep/remove choices. */
export function campaignConsolidationOptions(state: Readonly<CampaignReinforcementState>, actor: Side, context: CampaignReinforcementContext) {
  if (!isCampaignRebuildWindow(state, actor)) return null
  const lastResult = state.lastConsolidation ? { ...state.lastConsolidation } : null
  if (!context.consolidation) return { configured: false, groups: [], rejected: [], lastResult }
  const matches = new Map<string, { counterId: string; steps: number; printedSteps: number }[]>()
  const rejected: { counterId: string; reason: string }[] = []
  for (const [counterId, counter] of Object.entries(state.counters)) {
    if (counter.side !== actor || counter.kind !== 'land' || (counter.location.kind !== 'map' && counter.location.kind !== 'box')) continue
    const inspected = inspectCounter(state, actor, counterId, context)
    if ('reason' in inspected) {
      rejected.push({ counterId, reason: inspected.reason })
      continue
    }
    const { unit } = inspected
    const key = consolidationGroupKey(unit)
    const group = matches.get(key) ?? []
    group.push({ counterId, steps: unit.steps, printedSteps: unit.printedSteps })
    matches.set(key, group)
  }
  const groups = [...matches.values()].filter((group) => {
    if (group.length > 1) return true
    rejected.push({ counterId: group[0]!.counterId, reason: 'no-equivalent-unit-at-location' })
    return false
  })
  return { configured: true, groups, rejected, lastResult }
}

export function consolidateCampaignUnits(state: Readonly<CampaignReinforcementState>, actor: Side,
  action: ConsolidateCampaignUnits, context: CampaignReinforcementContext): CampaignReinforcementState {
  if (!isCampaignRebuildWindow(state, actor)) throw new Error('Campaign consolidation window is not open for this side')
  if (!context.consolidation) throw new Error('Campaign consolidation profiles are not configured')
  const keep = inspectCounter(state, actor, action.keepId, context)
  const remove = inspectCounter(state, actor, action.removeId, context)
  if ('reason' in keep) throw new Error(`Campaign consolidation: ${keep.reason}`)
  if ('reason' in remove) throw new Error(`Campaign consolidation: ${remove.reason}`)
  const result = planMultiStepConsolidation(keep.unit, remove.unit)
  if (!result.ok) throw new Error(`Campaign consolidation: ${result.reason}`)

  const { keepId, removeId, stepsAfter } = result.plan
  return { ...state, lastConsolidation: result.plan, counters: { ...state.counters,
    [keepId]: { ...state.counters[keepId]!, currentRe: stepsAfter, stepsLost: keep.unit.printedSteps - stepsAfter },
    [removeId]: { ...state.counters[removeId]!, location: { kind: 'consolidated' } },
  } }
}
