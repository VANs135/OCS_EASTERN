import { airbaseActiveCapacity, airbaseRefitCapacity } from '@ocs-eastern/series/airbase'
import type { Side } from '@ocs-eastern/series/state-types'
import { zocAffectsAction } from '@ocs-eastern/series/zoc'
import { romaniaAirRefitAllowed } from '../ttw/campaign/romania-air.ts'
import { campaignPhysicalSupply, campaignSupplySourceKey, spendCampaignSupply } from './campaign-supply-ledger.ts'
import type { CampaignSupplySource } from './campaign-supply-ledger.ts'
import type { CampaignTurnContext, CampaignTurnState } from './campaign-turn-state.ts'

type Base = { kind: 'map'; hex: string } | { kind: 'romania'; box: string }
export type RefitCampaignAircraft = { type: 'refit-campaign-aircraft'; base: Base; unitIds: readonly string[]; source?: CampaignSupplySource }

export interface CampaignRefitBoard {
  /** Friendly operating bases. Level zero only for an authorized airstrip. */
  bases(state: Readonly<CampaignTurnState>, side: Side): readonly { hex: string; level: number }[]
  romaniaBox?(state: Readonly<CampaignTurnState>): string | undefined
}

function refitOpen(state: Readonly<CampaignTurnState>, side: Side) {
  return state.cursor.phase === 'aircraft-refit' && state.cursor.phasing === side
}

const baseKey = (base: Base) => base.kind === 'map' ? `hex:${base.hex}` : `box:${base.box}`

function inspectRefit(state: Readonly<CampaignTurnState>, side: Side, context: CampaignTurnContext) {
  const config = context.aircraftRefit
  const ground = context.groundMovement
  const trace = ground?.traceSupply?.(state, side)
  const sources: ReturnType<typeof campaignPhysicalSupply> = ground
    ? campaignPhysicalSupply(state, side, ground.map, context.supplyPhase?.organicTransportFormation) : new Map()
  const choices: { base: Base; key: string; inactiveIds: string[]; limit: number; payments: CampaignSupplySource[] }[] = []
  const own = Object.entries(state.counters).filter(([, unit]) => unit.side === side && unit.kind === 'aircraft')
  for (const { hex: printed, level } of config?.bases(state, side) ?? []) {
    const hex = ground?.map.resolveHex(printed)
    if (!hex || !trace || !Number.isInteger(level) || level < 0 || level > 3 ||
      zocAffectsAction('aircraftRefit', trace.ground.enemyZoc.has(hex), !trace.ground.unnegatedEnemyZoc.has(hex))) continue
    const base = { kind: 'map' as const, hex }
    const key = baseKey(base)
    if (state.refittedBases?.includes(key)) continue
    const based = own.filter(([, { location }]) => location.kind === 'map' && ground?.map.resolveHex(location.hex) === hex)
    const inactiveIds = based.filter(([, unit]) => unit.active === false).map(([id]) => id)
    const limit = Math.min(airbaseRefitCapacity(level), airbaseActiveCapacity(level) - based.filter(([, unit]) => unit.active !== false).length)
    const payments = [...sources.values()].flatMap((item) => !item.formation && item.tokens >= 1 && trace.network.canUseDump(hex, item.hex)
      ? [{ ...item.source }] : [])
    if (limit > 0 && inactiveIds.length && payments.length) choices.push({ base, key, inactiveIds, limit, payments })
  }
  const box = side === 'axis' ? config?.romaniaBox?.(state) : undefined
  if (box) {
    const base = { kind: 'romania' as const, box }
    const key = baseKey(base)
    const aircraft = own.filter(([, { location }]) => location.kind === 'box' && location.box === box)
    const inactiveIds = aircraft.filter(([, unit]) => unit.active === false).map(([id]) => id)
    if (romaniaAirRefitAllowed(side, aircraft.length) && inactiveIds.length && !state.refittedBases?.includes(key)) {
      choices.push({ base, key, inactiveIds, limit: inactiveIds.length, payments: [] })
    }
  }
  return { sources, choices }
}

export function campaignRefitOptions(state: Readonly<CampaignTurnState>, side: Side, context: CampaignTurnContext) {
  return refitOpen(state, side) ? { configured: !!context.aircraftRefit, bases: inspectRefit(state, side, context).choices } : null
}

export function refitCampaignAircraft(state: Readonly<CampaignTurnState>, side: Side, action: RefitCampaignAircraft,
  context: CampaignTurnContext): CampaignTurnState {
  if (!refitOpen(state, side)) throw new Error('Campaign aircraft refit is not open for this side')
  const resolveHex = context.groundMovement?.map.resolveHex ?? (() => undefined)
  const base = action.base.kind === 'map' ? { ...action.base, hex: resolveHex(action.base.hex) ?? '' } : action.base
  const { sources, choices } = inspectRefit(state, side, context)
  const choice = choices.find(({ key }) => key === baseKey(base))
  const selected = new Set(action.unitIds)
  if (!choice || !selected.size || selected.size !== action.unitIds.length || selected.size > choice.limit ||
    action.unitIds.some((id) => !choice.inactiveIds.includes(id))) throw new Error('Choose eligible inactive aircraft within refit capacity')
  let paid = state
  if (base.kind === 'map') {
    const key = action.source && campaignSupplySourceKey(resolveHex, action.source)
    if (!key || !choice.payments.some((source) => campaignSupplySourceKey(resolveHex, source) === key)) throw new Error('Choose a reachable refit supply source')
    paid = spendCampaignSupply(state, side, sources, new Map([[key, 1]]))
  } else if (action.source) throw new Error('Romania air box refit is free')
  const counters = { ...paid.counters }
  for (const id of selected) counters[id] = { ...counters[id]!, active: true }
  return { ...paid, counters, refittedBases: [...(state.refittedBases ?? []), choice.key] }
}
