import type { Side } from '@ocs-eastern/series/state-types'
import { nextSupplyPhaseObligation } from '@ocs-eastern/series/supply-progress'
import { advancePlayerTurn } from '@ocs-eastern/series/turn'
import { assignCampaignAttrition, checkCampaignAttrition } from './campaign-supply-attrition.ts'
import type { AssignCampaignAttrition, CampaignAttrition } from './campaign-supply-attrition.ts'
import { campaignRecoveryCost, campaignRecoveryDuties, campaignSupplyPosition } from './campaign-supply-stock.ts'
import type { CampaignSupplyPosition } from './campaign-supply-stock.ts'
import { campaignSupplySourceKey, spendCampaignSupply } from './campaign-supply-ledger.ts'
import type { CampaignSupplySource } from './campaign-supply-ledger.ts'
import { hasCampaignSupplyTrace, openCampaignFeeding } from './campaign-supply-trace-step.ts'
import type { CampaignFeeding } from './campaign-supply-trace-step.ts'
import type { CampaignTurnContext, CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignSupplyWindow {
  feeding: CampaignFeeding
  attrition?: readonly CampaignAttrition[]
}

export type CampaignSupplyAction = { type: 'recover-campaign-stocks'; unitId: string;
  payments: readonly { source: CampaignSupplySource; tokens: number }[] }
  | { type: 'complete-campaign-stock-recovery' }
  | { type: 'choose-campaign-formation-trace'; formation: string; anchor: string }
  | { type: 'feed-campaign-units'; payments: readonly { source: CampaignSupplySource; portions: readonly { unitId: string; re: number }[] }[] }
  | { type: 'check-campaign-attrition' } | AssignCampaignAttrition | { type: 'complete-campaign-supply' }

function supplyOpen(state: Readonly<CampaignTurnState>, side: Side) {
  return state.cursor.phase === 'supply' && state.cursor.phasing === side
}

function currentObligation(window?: CampaignSupplyWindow) {
  return nextSupplyPhaseObligation({ recoverySettled: window !== undefined, feedingSettled: window?.attrition !== undefined,
    pendingAttrition: window?.attrition?.filter(({ assigned }) => !assigned).map(({ hex }) => hex) ?? [] })
}

function supplySourcesFor(position: CampaignSupplyPosition, unitIds: readonly string[], paidRe?: Readonly<Record<string, number>>) {
  const choices = new Map([...position.sources].map(([key, entry]) => [key, { source: entry.source, tokens: entry.tokens }]))
  for (const key of Object.keys(paidRe ?? {})) {
    if (key.startsWith('dump:') && !choices.has(key)) choices.set(key, { source: { kind: 'dump', hex: key.slice(5) }, tokens: 0 })
  }
  return [...choices].flatMap(([key, { source, tokens }]) => {
    const paid = paidRe?.[key] ?? 0
    const coveredRe = 2 * Math.ceil(paid / 2) - paid
    if (!tokens && !coveredRe) return []
    const eligibleIds = unitIds.filter((id) => position.canUse(id, key, coveredRe ? source : undefined))
    return eligibleIds.length ? [{ source: { ...source }, tokens, coveredRe, unitIds: eligibleIds }] : []
  })
}

export function campaignSupplyDecision(state: Readonly<CampaignTurnState>, side: Side, context: CampaignTurnContext) {
  if (!supplyOpen(state, side)) return null
  const position = campaignSupplyPosition(state, side, context.supplyPhase, context.groundMovement)
  const window = state.supplyPhase
  const next = currentObligation(window)
  const segment = next.kind === 'recovery' ? 'stock-recovery' : next.kind === 'feeding' ? 'trace-and-feeding' : 'attrition'
  if (!position) return { segment, step: 'board-unavailable' }
  if (next.kind === 'recovery') {
    const duties = campaignRecoveryDuties(position)
    const recovery = [...position.units].flatMap(([id, unit]) => unit.counter.internalStocks ?
      [{ id, amountPerLevel: campaignRecoveryCost(unit), level: unit.counter.internalStocks }] : [])
    return { segment, step: duties.unitIds.length ? 'recover-stocks' : 'complete-stock-recovery', recovery,
      sources: supplySourcesFor(position, recovery.map(({ id }) => id)), mandatoryIds: duties.unitIds }
  }
  if (next.kind === 'feeding') {
    const { feeding } = window!
    const choices = feeding.formations.map((entry) => ({ ...entry, members: [...entry.members], anchors: [...entry.anchors] }))
    const units = [...position.units].map(([id, unit]) => ({ id, re: unit.re, trace: hasCampaignSupplyTrace(feeding, id),
      fed: feeding.fed.includes(id), strategic: unit.counter.mode === 'strat' }))
    return { segment, step: choices.some(({ selected }) => !selected) ? 'choose-formation-trace' : 'feed-or-check-attrition', choices, units,
      sources: supplySourcesFor(position, units.filter(({ trace, fed, strategic }) => !trace && !fed && !strategic).map(({ id }) => id), feeding.reBySource) }
  }
  return { segment, step: next.kind === 'attrition' ? 'assign-attrition' : 'complete-supply',
    stacks: window!.attrition!.map((item) => ({ ...item, units: [...item.units], dice: [...item.dice] })),
    ...(next.kind === 'attrition' ? { hex: next.hex } : {}) }
}

function recoverStocks(state: Readonly<CampaignTurnState>, side: Side, action: Extract<CampaignSupplyAction, { type: 'recover-campaign-stocks' }>,
  position: CampaignSupplyPosition) {
  const unit = position.units.get(action.unitId)
  if (!unit?.counter.internalStocks) throw new Error('Choose a friendly unit with depleted internal stocks')
  const spending = new Map<string, number>()
  for (const { source, tokens } of action.payments) {
    const key = campaignSupplySourceKey(position.resolveHex, source)
    if (!Number.isSafeInteger(tokens) || tokens < 1 || !position.canUse(action.unitId, key)) throw new Error('Invalid stock recovery payment')
    spending.set(key, (spending.get(key) ?? 0) + tokens)
  }
  const base = campaignRecoveryCost(unit)
  const cost = [...spending.values()].reduce((sum, amount) => sum + amount, 0)
  if (cost !== base && !(unit.counter.internalStocks === 'exhausted' && cost === 2 * base)) throw new Error('Pay exactly one or two eligible recovery levels')
  const paid = spendCampaignSupply(state, side, position.sources, spending)
  return { ...paid, counters: { ...paid.counters, [action.unitId]: { ...unit.counter,
    internalStocks: unit.counter.internalStocks === 'exhausted' && cost === base ? 'low' as const : undefined } } }
}

function feedUnits(state: Readonly<CampaignTurnState>, side: Side, feeding: CampaignFeeding, position: CampaignSupplyPosition,
  action: Extract<CampaignSupplyAction, { type: 'feed-campaign-units' }>) {
  const byUnit = new Map<string, number>()
  const bySource = new Map<string, number>()
  if (!action.payments.length) throw new Error('Choose units and a source for feeding')
  for (const { source, portions } of action.payments) {
    const key = campaignSupplySourceKey(position.resolveHex, source)
    if (!portions.length) throw new Error('Choose recipients for each feeding payment')
    for (const { unitId, re } of portions) {
      const unit = position.units.get(unitId)
      if (!unit || !Number.isFinite(re) || re <= 0 || unit.counter.mode === 'strat' || feeding.fed.includes(unitId) ||
        hasCampaignSupplyTrace(feeding, unitId) || !position.canUse(unitId, key, feeding.reBySource[key] ? source : undefined)) {
        throw new Error('Choose an untraced friendly unit that can eat from this source')
      }
      byUnit.set(unitId, (byUnit.get(unitId) ?? 0) + re)
      bySource.set(key, (bySource.get(key) ?? 0) + re)
    }
  }
  if ([...byUnit].some(([id, amount]) => amount !== position.units.get(id)!.re)) throw new Error('Cover the entire current RE of each selected unit')
  const reBySource = { ...feeding.reBySource }
  const spending = new Map<string, number>()
  for (const [key, re] of bySource) {
    const alreadyFed = reBySource[key] ?? 0
    reBySource[key] = alreadyFed + re
    spending.set(key, Math.ceil((alreadyFed + re) / 2) - Math.ceil(alreadyFed / 2))
  }
  const paid = spendCampaignSupply(state, side, position.sources, spending)
  return { ...paid, supplyPhase: { feeding: { ...feeding, fed: [...feeding.fed, ...byUnit.keys()], reBySource } } }
}

export function applyCampaignSupplyPhase(state: Readonly<CampaignTurnState>, side: Side, action: CampaignSupplyAction,
  context: CampaignTurnContext): CampaignTurnState {
  const { cursor } = state
  if (cursor.phase !== 'supply' || cursor.phasing !== side) throw new Error('Campaign supply is not open for this side')
  const board = context.supplyPhase
  const position = campaignSupplyPosition(state, side, board, context.groundMovement)
  if (!position || !board) throw new Error('Campaign supply board is unavailable')
  const window = state.supplyPhase
  const next = currentObligation(window)
  if (next.kind === 'recovery') {
    if (action.type === 'recover-campaign-stocks') return recoverStocks(state, side, action, position)
    if (action.type !== 'complete-campaign-stock-recovery') throw new Error('Settle stock recovery before feeding or attrition')
    const duties = campaignRecoveryDuties(position)
    if (duties.unitIds.length) throw new Error('Recover affordable internal stocks first')
    const settled = spendCampaignSupply(state, side, position.sources, duties.remainder)
    return { ...settled, supplyPhase: { feeding: openCampaignFeeding(position) } }
  }
  if (next.kind === 'feeding') {
    const { feeding } = window!
    if (action.type === 'choose-campaign-formation-trace') {
      const choice = feeding.formations.find(({ formation }) => formation === action.formation)
      if (feeding.fed.length || !choice?.anchors.includes(action.anchor)) throw new Error('Choose an offered formation trace anchor before payment')
      return { ...state, supplyPhase: { feeding: { ...feeding, formations: feeding.formations.map((entry) =>
        entry === choice ? { ...entry, selected: action.anchor } : entry) } } }
    }
    if (feeding.formations.some(({ selected }) => !selected)) throw new Error('Select the formation trace sources first')
    if (action.type === 'feed-campaign-units') return feedUnits(state, side, feeding, position, action)
    if (action.type === 'check-campaign-attrition') return checkCampaignAttrition(state, feeding, position)
    throw new Error('Settle trace and attrition before ending supply')
  }
  if (next.kind === 'attrition' && action.type === 'assign-campaign-attrition') return assignCampaignAttrition(state, window!.attrition!, action, position, board)
  if (next.kind !== 'complete' || action.type !== 'complete-campaign-supply') throw new Error('Resolve all current attrition before ending supply')
  return { ...state, cursor: advancePlayerTurn(cursor, side)!,
    supplyPhase: undefined, lateTurnSegment: 'movement' }
}
