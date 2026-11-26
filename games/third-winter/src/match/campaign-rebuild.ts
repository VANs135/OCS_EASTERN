import { canAffordRepl, rebuildRejection, rebuildRestoredSteps, type RebuildCandidate } from '@ocs-eastern/series/rebuild'
import type { Side } from '@ocs-eastern/series/state-types'
import { ttwPointRejection, ttwRebuildDestinationKinds, type TtwReplPoint, type TtwRebuildUnitFacts } from '../ttw/campaign/rebuild.ts'
import { isCampaignRebuildWindow } from './campaign-reinforcement-flow.ts'
import { emptyCampaignReplacementSpent, type CampaignCounter, type CampaignReinforcementContext, type CampaignReinforcementState, type CampaignReplacementSpent, type CampaignSpecialReplacement } from './campaign-reinforcement-state.ts'

/** TTW 1.7. Spend abstract replacement points to rebuild a dead-pile counter or restore a reduced one. */
export type RebuildCampaignUnit = {
  type: 'rebuild-campaign-unit'
  counterId: string
  point: TtwReplPoint
  /** Eq: the awarded AR being spent; must match an available Eq point and cover the unit AR. */
  eqAr?: number
  /** Dead-pile rebuild only: where the fresh counter enters. A reduced counter restores in place. */
  destination?: { kind: string; key: string }
  stepsToRestore?: number
}

/** Complete printed face facts plus the TTW point/destination rules. Leave unavailable faces unresolved. */
export interface CampaignRebuildProfile extends TtwRebuildUnitFacts {
  printedSteps: number
  /** OCS 13.5c / TTW 1.7a: false for a yellow-dot counter, a Cossack cavalry regiment or a Slovak infantry division. */
  rebuildable: boolean
  isBreakdown: boolean
}

export interface CampaignRebuildDestination { kind: string; key: string }

export interface CampaignRebuildBoard {
  profileOf(state: Readonly<CampaignReinforcementState>, id: string): CampaignRebuildProfile | undefined
  /** Legal destinations of the kinds TTW allows for this side and unit (Axis HQ / Kessel HQ / RVGK / airbase). */
  destinations(state: Readonly<CampaignReinforcementState>, actor: Side, id: string): readonly CampaignRebuildDestination[]
  /** Per-unit rebuild cost in abstract points (rebuild table, G05). Undefined keeps the rebuild blocked. */
  costOf(state: Readonly<CampaignReinforcementState>, id: string, point: TtwReplPoint): Partial<Record<TtwReplPoint, number>> | undefined
  /** TTW 1.7b: the SR category this dead-pile counter qualifies to rebuild for free, if any. Encodes the
   * Arty single-step/regiment (not a whole division), Assault §1.6c, Flak, AA, HQ, Pontoon and Tiger facts. */
  specialCategoryOf?(state: Readonly<CampaignReinforcementState>, id: string): CampaignSpecialReplacement | undefined
}

export interface CampaignRebuildResult {
  counterId: string
  point: TtwReplPoint
  eqAr?: number
  destination?: CampaignRebuildDestination
  stepsBefore: number
  stepsAfter: number
  cost: Partial<Record<TtwReplPoint, number>>
}

const rebuildPoints = ['pax', 'eq', 'air', 'ally'] as const

/** Pax/Ally draw on banked holdings plus this phase's award; Air/Eq only on this phase's award, less spent. */
function availablePoints(state: Readonly<CampaignReinforcementState>, actor: Side) {
  const holdings = state.replacementHoldings[actor]
  const award = state.replacementAward
  const spent = state.replacementSpent ?? emptyCampaignReplacementSpent()
  const eq = [...(award?.eq ?? [])]
  for (const ar of spent.eq) { const at = eq.indexOf(ar); if (at >= 0) eq.splice(at, 1) }
  return {
    pax: holdings.pax + (award?.pax ?? 0) - spent.pax,
    ally: holdings.ally + (award?.ally ?? 0) - spent.ally,
    air: (award?.air ?? 0) - spent.air,
    eq,
  }
}

function inspectRebuild(state: Readonly<CampaignReinforcementState>, actor: Side, id: string, context: CampaignReinforcementContext):
  { reason: string } | { counter: CampaignCounter; profile: CampaignRebuildProfile; candidate: RebuildCandidate; stepsBefore: number } {
  const counter = Object.hasOwn(state.counters, id) ? state.counters[id] : undefined
  if (!counter || counter.side !== actor) return { reason: 'choose-a-friendly-counter' }
  const inDeadPile = counter.location.kind === 'dead-pile'
  if (!inDeadPile && counter.location.kind !== 'map') return { reason: 'rebuild-from-dead-pile-or-reduced-on-map' }
  const profile = context.rebuild?.profileOf(state, id)
  if (!profile) return { reason: 'missing-rebuild-profile' }
  const stepsBefore = inDeadPile ? 0 : profile.printedSteps - (counter.stepsLost ?? 0)
  const candidate = { id, rebuildable: profile.rebuildable, isBreakdown: profile.isBreakdown, inDeadPile, steps: stepsBefore, printedSteps: profile.printedSteps }
  const rejection = rebuildRejection(candidate)
  return rejection ? { reason: rejection } : { counter, profile, candidate, stepsBefore }
}

export function campaignRebuildOptions(state: Readonly<CampaignReinforcementState>, actor: Side, context: CampaignReinforcementContext) {
  if (!isCampaignRebuildWindow(state, actor)) return null
  const lastResult = state.lastRebuild ? { ...state.lastRebuild, ...(state.lastRebuild.destination ? { destination: { ...state.lastRebuild.destination } } : {}), cost: { ...state.lastRebuild.cost } } : null
  const available = availablePoints(state, actor)
  if (!context.rebuild) return { configured: false, available, candidates: [], rejected: [], lastResult }
  const candidates: { counterId: string; stepsBefore: number; printedSteps: number; inDeadPile: boolean; destinations: CampaignRebuildDestination[]; points: TtwReplPoint[] }[] = []
  const rejected: { counterId: string; reason: string }[] = []
  for (const [counterId, counter] of Object.entries(state.counters)) {
    if (counter.side !== actor || (counter.location.kind !== 'dead-pile' && counter.location.kind !== 'map')) continue
    const inspected = inspectRebuild(state, actor, counterId, context)
    if ('reason' in inspected) { rejected.push({ counterId, reason: inspected.reason }); continue }
    const { profile, candidate, stepsBefore } = inspected
    const kinds = ttwRebuildDestinationKinds(actor, profile)
    const destinations = candidate.inDeadPile
      ? context.rebuild.destinations(state, actor, counterId).filter((d) => kinds.includes(d.kind as typeof kinds[number]))
      : []
    const points = rebuildPoints.filter((point) => point === 'eq'
      ? !profile.isAircraft && !profile.isGermanTiger && available.eq.some((ar) => ar >= profile.ar)
      : ttwPointRejection(point, profile) === null)
    candidates.push({ counterId, stepsBefore, printedSteps: profile.printedSteps, inDeadPile: candidate.inDeadPile, destinations: destinations.map((d) => ({ ...d })), points: [...points] })
  }
  return { configured: true, available, candidates, rejected, lastResult }
}

export function rebuildCampaignUnit(state: Readonly<CampaignReinforcementState>, actor: Side,
  action: RebuildCampaignUnit, context: CampaignReinforcementContext): CampaignReinforcementState {
  if (!isCampaignRebuildWindow(state, actor)) throw new Error('Campaign rebuild window is not open for this side')
  if (!context.rebuild) throw new Error('Campaign rebuild profiles are not configured')
  const inspected = inspectRebuild(state, actor, action.counterId, context)
  if ('reason' in inspected) throw new Error(`Campaign rebuild: ${inspected.reason}`)
  const { counter, profile, candidate, stepsBefore } = inspected

  const pointRejection = ttwPointRejection(action.point, profile, action.eqAr)
  if (pointRejection) throw new Error(`Campaign rebuild: ${pointRejection}`)
  if (candidate.inDeadPile) {
    if (!action.destination) throw new Error('Campaign rebuild: dead-pile-rebuild-requires-a-destination')
    const kinds = ttwRebuildDestinationKinds(actor, profile)
    if (!kinds.includes(action.destination.kind as typeof kinds[number])) throw new Error('Campaign rebuild: illegal-destination-kind')
    const chosen = action.destination
    if (!context.rebuild.destinations(state, actor, action.counterId).some((d) => d.kind === chosen.kind && d.key === chosen.key)) {
      throw new Error('Campaign rebuild: illegal-destination')
    }
  } else if (action.destination) {
    throw new Error('Campaign rebuild: reduced-counter-restores-in-place')
  }

  const cost = context.rebuild.costOf(state, action.counterId, action.point)
  if (!cost) throw new Error('Campaign rebuild: rebuild-cost-unavailable')
  const available = availablePoints(state, actor)
  if (!canAffordRepl({ pax: available.pax, ally: available.ally, air: available.air },
    { pax: cost.pax ?? 0, ally: cost.ally ?? 0, air: cost.air ?? 0 })) throw new Error('Campaign rebuild: insufficient-replacement-points')
  const eqNeed = cost.eq ?? 0
  if (eqNeed > 0) {
    if (action.eqAr === undefined || !Number.isSafeInteger(action.eqAr)) throw new Error('Campaign rebuild: eq-requires-an-awarded-ar')
    if (available.eq.filter((ar) => ar === action.eqAr).length < eqNeed) throw new Error('Campaign rebuild: insufficient-eq-points')
  }

  const spent = state.replacementSpent ?? emptyCampaignReplacementSpent()
  const replacementSpent: CampaignReplacementSpent = {
    pax: spent.pax + (cost.pax ?? 0),
    air: spent.air + (cost.air ?? 0),
    ally: spent.ally + (cost.ally ?? 0),
    eq: [...spent.eq, ...Array.from({ length: eqNeed }, () => action.eqAr!)],
  }
  const stepsAfter = rebuildRestoredSteps(candidate, action.stepsToRestore)
  const stepsLost = profile.printedSteps - stepsAfter
  // OCS 13.5b. A dead-pile counter returns fresh in combat mode at its destination; a reduced one regains steps in place.
  const updated: CampaignCounter = candidate.inDeadPile
    ? { ...counter, location: action.destination!.kind === 'rvgk' ? { kind: 'box', box: action.destination!.key } : { kind: 'map', hex: action.destination!.key },
      currentRe: stepsAfter, stepsLost, mode: 'combat', disorganized: false, internalStocks: undefined,
      ...(counter.kind === 'aircraft' ? { active: true } : {}) }
    : { ...counter, currentRe: stepsAfter, stepsLost }
  const lastRebuild: CampaignRebuildResult = { counterId: action.counterId, point: action.point,
    ...(action.eqAr === undefined ? {} : { eqAr: action.eqAr }),
    ...(action.destination ? { destination: { ...action.destination } } : {}), stepsBefore, stepsAfter, cost: { ...cost } }
  return { ...state, counters: { ...state.counters, [action.counterId]: updated }, replacementSpent, lastRebuild }
}