import { internalRecoveryPerLevel } from '@ocs-eastern/series/internal-stocks'
import { nextReinforcementSegment } from '@ocs-eastern/series/reinforcement'
import type { Side } from '@ocs-eastern/series/state-types'
import { campaignArrivalCandidates, supportsCampaignArrival } from '../ttw/campaign/arrival-sites.ts'
import { campaignReinforcementWindow } from '../ttw/campaign/reinforcement.ts'
import { skipsCampaignReinforcementTables } from '../ttw/campaign/reinforcement-timing.ts'
import type { CampaignReinforcement } from '../ttw/campaign/reinforcement.ts'
import type { CampaignCounter, CampaignReinforcementAction, CampaignReinforcementContext, CampaignReinforcementState } from './campaign-reinforcement-state.ts'
import { dueCampaignBreakoutReturns } from './campaign-breakout-returns.ts'
import { consolidateCampaignUnits } from './campaign-consolidation.ts'
import { rollCampaignSupply } from './campaign-supply-award.ts'
import { placeCampaignSupply } from './campaign-supply-placement.ts'
import { rollCampaignReplacements, rollCampaignSpecialReplacement } from './campaign-replacement-rolls.ts'

type Classified = Extract<CampaignReinforcement, { status: 'classified' }>
type Blocked = 'settled' | 'data-pending' | 'unsupported' | 'unbound' | 'counter-unavailable' | 'no-destination'
type OrderProgress = { order: CampaignReinforcement; status: Blocked } | {
  order: Classified
  status: 'ready'
  counterIds: readonly string[]
  capacity: ReadonlyMap<string, number>
  supplyDebt: number
}

export function scheduledCampaignReinforcements(state: Readonly<CampaignReinforcementState>, context: CampaignReinforcementContext): OrderProgress[] {
  if (state.segment !== 'scheduled') return []
  return campaignReinforcementWindow(context.schedule, state.cursor).map((order) => prepareOrder(state, order, context))
}

function prepareOrder(state: Readonly<CampaignReinforcementState>, order: CampaignReinforcement,
  context: CampaignReinforcementContext): OrderProgress {
  if (state.settledOrders.includes(order.id)) return { order, status: 'settled' }
  if (order.status === 'pending') return { order, status: 'data-pending' }
  const { operation } = order
  if (operation.kind === 'arrival' && !supportsCampaignArrival(operation)) return { order, status: 'unsupported' }
  const counterIds = context.bindings.get(order.id)
  if (!counterIds?.length || new Set(counterIds).size !== counterIds.length) return { order, status: 'unbound' }

  let supplyDebt = 0
  for (const id of counterIds) {
    const unit = Object.hasOwn(state.counters, id) ? state.counters[id] : undefined
    const location = unit?.location.kind
    if (!unit || unit.side !== order.side || unit.definition !== order.definition || unit.kind !== order.counterKind ||
      (operation.kind === 'withdraw' ? location === 'available' || location === 'withdrawn' || location === 'consolidated'
        : location !== 'available')) {
      return { order, status: 'counter-unavailable' }
    }
    if (operation.kind === 'withdraw' && unit.internalStocks) {
      if (unit.currentRe === undefined || !Number.isFinite(unit.currentRe) || unit.currentRe <= 0) {
        return { order, status: 'counter-unavailable' }
      }
      supplyDebt += internalRecoveryPerLevel(unit.currentRe) * (unit.internalStocks === 'exhausted' ? 2 : 1)
    }
  }
  if (!Number.isSafeInteger(supplyDebt + state.withdrawalSupplyDebt[order.side])) return { order, status: 'counter-unavailable' }

  const capacity = operation.kind === 'arrival' ? legalArrivalCapacity(state, order, operation, context) : new Map<string, number>()
  if (operation.kind === 'arrival' && [...capacity.values()].reduce((total, atHex) => total + atHex, 0) < counterIds.length) {
    return { order, status: 'no-destination' }
  }
  return { order, status: 'ready', counterIds, capacity, supplyDebt }
}

function legalArrivalCapacity(state: Readonly<CampaignReinforcementState>, order: Classified,
  operation: Extract<Classified['operation'], { kind: 'arrival' }>, context: CampaignReinforcementContext) {
  const aircraft = order.counterKind === 'aircraft'
  const choices = campaignArrivalCandidates(operation, order.side, aircraft, context.arrivalSites(state))
  const enemyHexes = new Set<string>()
  const activeAt = new Map<string, number>()
  for (const unit of Object.values(state.counters)) if (unit.location.kind === 'map') {
    const hex = context.resolveHex(unit.location.hex)
    if (!hex) continue
    if (unit.side !== order.side) enemyHexes.add(hex)
    else if (unit.kind === 'aircraft' && unit.active) activeAt.set(hex, (activeAt.get(hex) ?? 0) + 1)
  }
  const result = new Map<string, number>()
  for (const [printed, limit] of choices) {
    const hex = context.resolveHex(printed)
    if (!hex || enemyHexes.has(hex)) continue
    const left = limit - (activeAt.get(hex) ?? 0)
    if (left > 0) result.set(hex, left)
  }
  return result
}

export function applyCampaignReinforcement(state: Readonly<CampaignReinforcementState>, actor: Side,
  action: CampaignReinforcementAction, context: CampaignReinforcementContext): CampaignReinforcementState {
  if (state.cursor.phase !== 'reinforcement' || state.cursor.phasing !== actor) {
    throw new Error('The active side must be in its reinforcement phase')
  }
  if (action.type === 'roll-campaign-supply') return rollCampaignSupply(state, context)
  if (action.type === 'place-campaign-supply') return placeCampaignSupply(state, action, context)
  if (action.type === 'roll-campaign-replacements') return rollCampaignReplacements(state, context)
  if (action.type === 'roll-campaign-special-replacement') return rollCampaignSpecialReplacement(state, context)
  if (action.type === 'consolidate-campaign-units') return consolidateCampaignUnits(state, actor, action, context)
  if (state.segment !== 'scheduled') throw new Error('The scheduled reinforcement window must be open')
  const window = campaignReinforcementWindow(context.schedule, state.cursor)
  if (action.type === 'complete-scheduled-reinforcements') {
    if (window.some(({ id }) => !state.settledOrders.includes(id))) throw new Error('Scheduled reinforcements are still outstanding')
    if (dueCampaignBreakoutReturns(state).length) throw new Error('Due campaign breakout returns must be placed before closing scheduled reinforcements')
    const segment = skipsCampaignReinforcementTables(state.when) ? 'rebuild-consolidate' : nextReinforcementSegment('scheduled')!
    return { ...state, segment }
  }
  if (action.type !== 'execute-scheduled-reinforcement') throw new Error('Unknown campaign reinforcement command')
  const order = window.find(({ id }) => id === action.orderId)
  if (!order) throw new Error('The order is not due for this turn and side')
  const progress = prepareOrder(state, order, context)
  if (progress.status !== 'ready') throw new Error(`Scheduled reinforcement ${order.id}: ${progress.status}`)

  const counters = { ...state.counters }
  if (progress.order.operation.kind === 'arrival') {
    const placements = arrivalPlacements(progress.counterIds, progress.capacity, action.placements, context)
    for (const [id, hex] of placements) {
      const unit = counters[id]!
      counters[id] = { ...unit, location: { kind: 'map', hex }, ...(unit.kind === 'aircraft' ? { active: true } : {}) }
    }
  } else {
    if (action.placements !== undefined) throw new Error('This order has no map placement')
    const withdrawal = progress.order.operation.kind === 'withdraw'
    const location: CampaignCounter['location'] = { kind: withdrawal ? 'withdrawn' : 'dead-pile' }
    for (const id of progress.counterIds) {
      const unit = counters[id]!
      counters[id] = { ...unit, location, ...(unit.kind === 'aircraft' ? { active: false } : {}),
        ...(withdrawal ? { internalStocks: undefined } : {}) }
    }
  }
  return { ...state, counters, settledOrders: [...state.settledOrders, order.id],
    withdrawalSupplyDebt: { ...state.withdrawalSupplyDebt, [actor]: state.withdrawalSupplyDebt[actor] + progress.supplyDebt } }
}

function arrivalPlacements(counterIds: readonly string[], capacity: ReadonlyMap<string, number>,
  input: Extract<CampaignReinforcementAction, { type: 'execute-scheduled-reinforcement' }>['placements'],
  context: CampaignReinforcementContext) {
  if (!Array.isArray(input) || input.length !== counterIds.length) throw new Error('Place exactly the counters bound to this order')
  const result = new Map<string, string>()
  const usedAt = new Map<string, number>()
  for (const { counterId, hex: printed } of input) {
    if (!counterIds.includes(counterId) || result.has(counterId)) throw new Error('Place exactly the counters bound to this order')
    const hex = context.resolveHex(printed)
    if (!hex || !capacity.has(hex)) throw new Error('Illegal campaign arrival hex')
    const count = (usedAt.get(hex) ?? 0) + 1
    if (count > capacity.get(hex)!) throw new Error('Campaign arrival exceeds the airbase active aircraft capacity')
    result.set(counterId, hex)
    usedAt.set(hex, count)
  }
  return result
}
