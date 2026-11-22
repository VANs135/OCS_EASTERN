import { formationExchangeRejection } from '@ocs-eastern/series/consolidation'
import type { FormationExchangeUnit } from '@ocs-eastern/series/consolidation'
import type { Side } from '@ocs-eastern/series/state-types'
import { campaignConsolidationLocation } from './campaign-consolidation-location.ts'
import { isCampaignRebuildWindow } from './campaign-reinforcement-flow.ts'
import type { CampaignCounter, CampaignReinforcementContext, CampaignReinforcementState } from './campaign-reinforcement-state.ts'

export type ExchangeCampaignFormationUnit = { type: 'exchange-campaign-formation-unit'; fieldId: string; replacementId: string }
export type CampaignFormationProfile = Pick<FormationExchangeUnit, 'formationId' | 'role' | 'cargoCapacityTokens'>

function participant(state: Readonly<CampaignReinforcementState>, actor: Side, id: string, source: 'field' | 'dead-pile',
  context: CampaignReinforcementContext): { unit: FormationExchangeUnit; counter: CampaignCounter } | { reason: string } {
  const counter = Object.hasOwn(state.counters, id) ? state.counters[id] : undefined
  if (counter?.side !== actor || counter.specialTruckExtender || (counter.kind !== 'land' && counter.kind !== 'transport')) {
    return { reason: 'choose-a-friendly-ground-unit-or-transport' }
  }
  if (source === 'dead-pile') {
    if (counter.location.kind !== 'dead-pile') return { reason: 'replacement-is-not-in-dead-pile' }
  } else {
    const location = campaignConsolidationLocation(counter.location, context.resolveHex, context.consolidation?.boxOf)
    if ('reason' in location) return location
  }
  const profile = context.consolidation?.formationOf?.(state, id)
  const faces = context.consolidation?.profileOf(state, id)
  if (!profile || !faces) return { reason: 'missing-formation-profile' }
  if ((counter.kind === 'land') !== (profile.role === 'ground') ||
    (profile.role === 'organic-transport' && !profile.formationId)) return { reason: 'invalid-formation-profile' }
  return { counter, unit: { ...profile, id,
    combatFaceKey: faces.combatFaceKey, moveFaceKey: faces.moveFaceKey,
    disorganized: counter.disorganized === true, internalStocks: counter.internalStocks, cargoTokens: counter.transportCargoTokens } }
}

export function campaignFormationExchangeOptions(state: Readonly<CampaignReinforcementState>, actor: Side,
  context: CampaignReinforcementContext) {
  if (!isCampaignRebuildWindow(state, actor)) return null
  const lastResult = state.lastFormationExchange ? { ...state.lastFormationExchange } : null
  if (!context.consolidation?.formationOf) return { configured: false, choices: [], lastResult }
  const pool = new Map<string, FormationExchangeUnit[]>()
  const field: FormationExchangeUnit[] = []
  const key = (unit: FormationExchangeUnit) => JSON.stringify([unit.combatFaceKey, unit.moveFaceKey])
  for (const [id, { side, location }] of Object.entries(state.counters)) {
    if (side !== actor) continue
    const source = location.kind === 'dead-pile' ? 'dead-pile' : 'field'
    const read = participant(state, actor, id, source, context)
    if ('reason' in read) continue
    if (source === 'field') field.push(read.unit)
    else {
      const printed = key(read.unit)
      const sameFaces = pool.get(printed) ?? []
      sameFaces.push(read.unit)
      pool.set(printed, sameFaces)
    }
  }
  const choices = field.flatMap((unit) => {
    const replacementIds = (pool.get(key(unit)) ?? []).filter((replacement) => !formationExchangeRejection(unit, replacement))
      .map(({ id }) => id)
    return replacementIds.length ? [{ fieldId: unit.id, replacementIds }] : []
  })
  return { configured: true, choices, lastResult }
}

export function exchangeCampaignFormationUnit(state: Readonly<CampaignReinforcementState>, actor: Side,
  action: ExchangeCampaignFormationUnit, context: CampaignReinforcementContext): CampaignReinforcementState {
  if (!isCampaignRebuildWindow(state, actor)) throw new Error('Campaign formation exchange window is not open for this side')
  const field = participant(state, actor, action.fieldId, 'field', context)
  const replacement = participant(state, actor, action.replacementId, 'dead-pile', context)
  if ('reason' in field) throw new Error(`Campaign formation exchange: ${field.reason}`)
  if ('reason' in replacement) throw new Error(`Campaign formation exchange: ${replacement.reason}`)
  const reason = formationExchangeRejection(field.unit, replacement.unit)
  if (reason) throw new Error(`Campaign formation exchange: ${reason}`)
  const { fieldId, replacementId } = action
  const { definition, kind, side, ...fieldState } = field.counter
  const fieldIdentity = { definition, kind, side }
  return { ...state, counters: { ...state.counters,
    [fieldId]: { ...fieldIdentity, location: { kind: 'dead-pile' } },
    [replacementId]: { ...fieldState, definition: replacement.counter.definition, kind: replacement.counter.kind, side },
  }, lastFormationExchange: { fieldId, replacementId } }
}
