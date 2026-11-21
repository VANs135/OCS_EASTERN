import { aircraftConsolidationGroupKey, aircraftConsolidationRejection, planAircraftConsolidation } from '@ocs-eastern/series/consolidation'
import type { AircraftConsolidationUnit } from '@ocs-eastern/series/consolidation'
import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignConsolidationBox } from '../ttw/campaign/consolidation.ts'
import { campaignConsolidationLocation } from './campaign-consolidation-location.ts'
import type { CampaignTurnContext, CampaignTurnState } from './campaign-turn-state.ts'

export type ConsolidateCampaignAircraft = { type: 'consolidate-campaign-aircraft'; keepId: string; removeId: string }
export interface CampaignAircraftConsolidationBoard {
  /** Complete type and printed values of the aircraft. Leave unsettled or in-flight units unresolved. */
  profileOf(state: Readonly<CampaignTurnState>, id: string): Pick<AircraftConsolidationUnit, 'typeAndValuesKey' | 'printedSteps'> | undefined
  boxOf?(id: string): CampaignConsolidationBox | undefined
}

function isPlayerPhase(state: Readonly<CampaignTurnState>) {
  return state.cursor.phase !== 'pre-turn' && state.cursor.phase !== 'ended'
}

function participant(state: Readonly<CampaignTurnState>, actor: Side, id: string, context: CampaignTurnContext):
  { unit: AircraftConsolidationUnit } | { reason: string } {
  const counter = Object.hasOwn(state.counters, id) ? state.counters[id] : undefined
  if (counter?.side !== actor || counter.kind !== 'aircraft') return { reason: 'choose-friendly-aircraft' }
  const board = context.aircraftConsolidation
  const location = campaignConsolidationLocation(counter.location, context.reinforcement.resolveHex, board?.boxOf)
  if ('reason' in location) return location
  const profile = board?.profileOf(state, id)
  if (!profile || counter.stepsLost === undefined || typeof counter.active !== 'boolean') return { reason: 'missing-aircraft-facts' }
  const unit = { ...profile, id, locationKey: location.key, active: counter.active, stepsLost: counter.stepsLost }
  const reason = aircraftConsolidationRejection(unit)
  return reason ? { reason } : { unit }
}

export function campaignAircraftConsolidationOptions(state: Readonly<CampaignTurnState>, viewer: Side, context: CampaignTurnContext) {
  if (!isPlayerPhase(state) || !context.aircraftConsolidation) return null
  const groups = new Map<string, string[]>()
  for (const [id, { kind, side }] of Object.entries(state.counters)) {
    if (side !== viewer || kind !== 'aircraft') continue
    const read = participant(state, viewer, id, context)
    if ('reason' in read) continue
    const key = aircraftConsolidationGroupKey(read.unit)
    const group = groups.get(key) ?? []
    group.push(id)
    groups.set(key, group)
  }
  return { groups: [...groups.values()].filter((group) => group.length > 1) }
}

export function consolidateCampaignAircraft(state: Readonly<CampaignTurnState>, actor: Side,
  action: ConsolidateCampaignAircraft, context: CampaignTurnContext): CampaignTurnState {
  if (!isPlayerPhase(state)) throw new Error('Campaign aircraft consolidation requires an active player phase')
  const keep = participant(state, actor, action.keepId, context)
  const remove = participant(state, actor, action.removeId, context)
  if ('reason' in keep) throw new Error(`Campaign aircraft consolidation: ${keep.reason}`)
  if ('reason' in remove) throw new Error(`Campaign aircraft consolidation: ${remove.reason}`)
  const result = planAircraftConsolidation(keep.unit, remove.unit)
  if (!result.ok) throw new Error(`Campaign aircraft consolidation: ${result.reason}`)
  const { keepId, removeId, stepsAfter } = result.plan
  return { ...state, counters: { ...state.counters,
    [keepId]: { ...state.counters[keepId]!, stepsLost: keep.unit.printedSteps - stepsAfter },
    [removeId]: { ...state.counters[removeId]!, location: { kind: 'consolidated' } },
  } }
}
