// TTW 战役会话燃料绑定（通规 §12.5，判定复用 series/fuel；参考已验收的 scorpion-fuel.ts 结构）。
// 1 SP = bulkFuelCost(4) tokens；单单位法每单位 singleUnitFuelCost(1) T。编队/HQ 法标记持续到本方清理阶段（12.5d），
// 单单位法只本阶段有效（换段即失效）。fuelReady 由会话 moveProfile 取 campaignUnitFuelReady。

import { bulkFuelCost, singleUnitFuelCost } from '@ocs-eastern/series/ground-logistics'
import type { Side } from '@ocs-eastern/series/state-types'
import { actingSide } from '@ocs-eastern/series/turn'
import { campaignHexesWithin } from '../ttw/campaign/hex-range.ts'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import { campaignPhysicalSupply, spendCampaignSupply } from './campaign-supply-ledger.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export type CampaignFormationFuel = { side: Side; formation: string; recipients: readonly string[] }
export type CampaignHeadquartersFuel = { side: Side; id: string; used?: { turn: number; phasing: Side; phase: string; hex: string }
  /** 12.5e：投递基点半径内获得燃料的独立单位。 */
  recipients?: readonly string[] }
export type CampaignFuelPayment = { key: string; tokens: number }
export type CampaignFuelAction =
  | { type: 'fuel-campaign-formation'; formation: string; headquartersId?: string; payments: readonly CampaignFuelPayment[] }
  | { type: 'fuel-campaign-headquarters'; headquartersId: string; payments: readonly CampaignFuelPayment[]
    /** 12.5e：投递基点（HQ 的起始格或结束格），覆盖其投递距离内所有独立单位；缺省只覆盖 HQ 自己。 */
    deliveryHex?: string }
  | { type: 'fuel-campaign-unit'; unitId: string; sourceKey: string }

export interface CampaignHeadquartersFuelHooks {
  /** 12.5e：HQ 的 throw 半径（格）。 */
  throwRange?(state: Readonly<CampaignTurnState>, id: string): number | undefined
  /** 通规 3.2f：该单位是否为独立单位（绑定层按编队归属与印值判定）。 */
  independent?(state: Readonly<CampaignTurnState>, id: string): boolean
}

function fuelWindowOpen(state: Readonly<CampaignTurnState>, side: Side): boolean {
  const cursor = state.cursor
  if (!('phasing' in cursor)) return false
  return side === actingSide(cursor.phasing, cursor.phase) &&
    (cursor.phase === 'movement' || cursor.phase === 'reaction' || cursor.phase === 'exploitation')
}
function spendingOf(payments: readonly CampaignFuelPayment[]): Map<string, number> {
  const spending = new Map<string, number>()
  for (const { key, tokens } of payments) spending.set(key, (spending.get(key) ?? 0) + tokens)
  return spending
}
const totalTokens = (payments: readonly CampaignFuelPayment[]) => payments.reduce((sum, p) => sum + p.tokens, 0)

/** 12.5c-A/B：编队法/HQ 法付 1 SP（bulkFuelCost tokens），落编队/HQ 燃料标记。 */
export function buyCampaignFuel(state: Readonly<CampaignTurnState>, side: Side,
  action: Extract<CampaignFuelAction, { type: 'fuel-campaign-formation' | 'fuel-campaign-headquarters' }>,
  map: CampaignGroundMap, organicFormation?: (state: Readonly<CampaignTurnState>, id: string) => string | undefined,
  hooks?: CampaignHeadquartersFuelHooks): CampaignTurnState {
  if (!fuelWindowOpen(state, side)) throw new Error('Fuel is paid in the active movement segment')
  if (totalTokens(action.payments) !== bulkFuelCost) throw new Error('Bulk fuel costs 1 SP')
  const sources = campaignPhysicalSupply(state, side, map, organicFormation)
  const hq = action.headquartersId ? state.counters[action.headquartersId] : undefined
  if (action.headquartersId !== undefined && (!hq || hq.kind !== 'hq' || hq.side !== side)) throw new Error('Choose a friendly HQ')
  if (action.type === 'fuel-campaign-headquarters') {
    if (!hq || state.headquartersFuel?.some(({ id }) => id === action.headquartersId)) throw new Error('Choose an unfueled friendly HQ')
    let recipients: string[] = []
    if (action.deliveryHex !== undefined) {
      if (hq.location.kind !== 'map') throw new Error('The HQ must be on the map to throw fuel')
      const radius = hooks?.throwRange?.(state, action.headquartersId)
      if (radius === undefined) throw new Error('The HQ throw range is unavailable')
      const delivery = map.resolveHex(action.deliveryHex)
      const reach = campaignHexesWithin(map, map.resolveHex(hq.location.hex) ?? hq.location.hex, radius)
      if (!delivery || !reach.includes(delivery)) throw new Error('Fuel is delivered within the HQ throw range')
      // 12.5c-B/12.5e：投递基点固定后，其投递距离内的所有独立单位一并获得燃料。
      const coverage = campaignHexesWithin(map, delivery, radius)
      const moved = new Set(state.groundMovement?.moved ?? [])
      recipients = Object.entries(state.counters)
        .filter(([id, c]) => c.side === side && c.location.kind === 'map' &&
          coverage.includes(map.resolveHex(c.location.hex) ?? c.location.hex) && hooks?.independent?.(state, id) === true)
        .map(([id]) => id)
      const early = recipients.find((id) => moved.has(id))
      if (early) throw new Error('12.5e：独立单位必须先确定投递位置再移动')
    }
    const paid = spendCampaignSupply(state, side, sources, spendingOf(action.payments))
    return { ...paid, headquartersFuel: [...(state.headquartersFuel ?? []),
      { side, id: action.headquartersId, ...(recipients.length ? { recipients } : {}) }] }
  }
  if (!action.formation || state.formationFuel?.some((f) => f.formation === action.formation && f.side === side)) {
    throw new Error('Choose a formation without an active formation fuel marker')
  }
  if (!hq && new Set(action.payments.map(({ key }) => key)).size !== 1) {
    throw new Error('Formation fuel requires one common direct draw source or one throwing HQ')
  }
  // 受油者＝该编队在图成员（机动类型由 board profile 在 fuelReady 时判；徒步成员受覆盖但不耗油）。
  const recipients = Object.entries(state.counters)
    .filter(([id, c]) => c.side === side && c.location.kind === 'map' && organicFormation?.(state, id) === action.formation)
    .map(([id]) => id)
  if (!recipients.length) throw new Error('No member of the formation can receive fuel from that source')
  const paid = spendCampaignSupply(state, side, sources, spendingOf(action.payments))
  return { ...paid, formationFuel: [...(state.formationFuel ?? []), { side, formation: action.formation, recipients }] }
}

/** 12.5c-C：单单位法付 1 T，从直接拖取来源（dump/transport）加油，只本阶段有效。 */
export function fuelCampaignUnit(state: Readonly<CampaignTurnState>, side: Side,
  action: Extract<CampaignFuelAction, { type: 'fuel-campaign-unit' }>, map: CampaignGroundMap): CampaignTurnState {
  if (!fuelWindowOpen(state, side)) throw new Error('Fuel is paid in the active movement segment')
  const counter = state.counters[action.unitId]
  if (!counter || counter.side !== side || counter.location.kind !== 'map') throw new Error('Choose a friendly on-map counter')
  if (counter.fueled || campaignHasBulkFuel(state, action.unitId)) throw new Error('This counter does not require a fuel payment')
  const sources = campaignPhysicalSupply(state, side, map)
  const paid = spendCampaignSupply(state, side, sources, new Map([[action.sourceKey, singleUnitFuelCost]]))
  return { ...paid, counters: { ...paid.counters, [action.unitId]: { ...counter, fueled: true } } }
}

export function campaignHasBulkFuel(state: Pick<CampaignTurnState, 'formationFuel' | 'headquartersFuel'>, unitId: string): boolean {
  return state.formationFuel?.some(({ recipients }) => recipients.includes(unitId)) === true ||
    state.headquartersFuel?.some(({ id, recipients }) => id === unitId || recipients?.includes(unitId) === true) === true
}
/** moveProfile 的 fuelReady 口径：已单单位加油或受编队/HQ 标记覆盖。 */
export function campaignUnitFuelReady(state: Readonly<CampaignTurnState>, unitId: string): boolean {
  return state.counters[unitId]?.fueled === true || campaignHasBulkFuel(state, unitId)
}

/** 12.5c-C：换段/换方/换回合清单单位法燃料（编队/HQ 法保留到本方清理阶段）。 */
export function clearCampaignPhaseFuel(state: Readonly<CampaignTurnState>): CampaignTurnState {
  let changed = false
  const counters = { ...state.counters }
  for (const [id, counter] of Object.entries(counters)) {
    if (counter.fueled === true) { counters[id] = { ...counter, fueled: false }; changed = true }
  }
  return changed ? { ...state, counters } : state
}
/** 12.5d：本方清理阶段移除编队/HQ 燃料标记。 */
export function clearCampaignCleanupFuel(state: Readonly<CampaignTurnState>, side: Side): CampaignTurnState {
  const formationFuel = (state.formationFuel ?? []).filter((f) => f.side !== side)
  const headquartersFuel = (state.headquartersFuel ?? []).filter((f) => f.side !== side)
  return { ...state, formationFuel, headquartersFuel }
}

/** UI 只读投影（与 campaignGroundMovementOptions 同款）：可用燃料来源＋各在图算子燃料状态。
 *  三法适用性由 UI 选中单位后经 series/fuel `fuelMethodAvailability` 判定；本投影不替代结算入口。 */
export function campaignFuelOptions(state: Readonly<CampaignTurnState>, side: Side, map: CampaignGroundMap,
  organicFormation?: (state: Readonly<CampaignTurnState>, id: string) => string | undefined) {
  if (!fuelWindowOpen(state, side)) return null
  const sources = campaignPhysicalSupply(state, side, map, organicFormation)
  const counters = Object.entries(state.counters)
    .filter(([, c]) => c.side === side && c.location.kind === 'map')
    .map(([id, c]) => ({ id, hex: (c.location as { hex: string }).hex, isHq: c.kind === 'hq',
      fueled: c.fueled === true, bulkCovered: campaignHasBulkFuel(state, id),
      formation: organicFormation?.(state, id) ?? null }))
  return { configured: true as const,
    sources: [...sources.entries()].map(([key, e]) => ({ key, hex: e.hex, tokens: e.tokens, kind: e.source.kind })),
    counters }
}