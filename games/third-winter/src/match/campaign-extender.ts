// 通规 OCS 12.7a/d/e、5.7f 延补转换绑定（判定复用 series/extender-conversion）。
// 移动/反应/开发段内，同格 5 点普通运输点数翻转为一枚延补器（卡车 20MP、马车 10MP）；
// 普通卡车不能参与（5.7f）；已装载的点必须先卸（12.7d）；每枚计数器付自身 MA 的一半（12.7e）；
// 余量点数按 1-5 面额落回同格。反向翻面把延补器换回 5 点同类运输点数。
// 计数器面额/装载/已用 MA 属数据面，由注入的 board 提供。

import { EXTENDER_FLIP_MA_FRACTION, EXTENDER_SEGMENTS, extenderConversionOptions, extenderConversionRefusal,
  planExtenderConversion } from '@ocs-eastern/series/extender-conversion'
import type { ExtenderTransportKind } from '@ocs-eastern/series/extender-conversion'
import type { Side } from '@ocs-eastern/series/state-types'
import { actingSide } from '@ocs-eastern/series/turn'
import { normalTruckExtenderRefusal } from '../ttw/campaign/special-truck-extender.ts'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export const CAMPAIGN_EXTENDER_RANGE: Readonly<Record<ExtenderTransportKind, number>> = { truck: 20, wagon: 10 }

export interface CampaignExtender { id: string; side: Side; hex: string; kind: ExtenderTransportKind; range: number }

export interface CampaignExtenderTransport {
  id: string
  kind: ExtenderTransportKind
  points: number
  loaded?: boolean
  mpSpent?: number
  ma?: number
}

export interface CampaignExtenderBoard {
  map: CampaignGroundMap
  transports(state: Readonly<CampaignTurnState>, side: Side, hex: string): readonly CampaignExtenderTransport[]
  /** 12.7a/d：把 1-5 点运输点数落成同格计数器。 */
  placeTransport?(state: Readonly<CampaignTurnState>, side: Side,
    facts: { kind: ExtenderTransportKind; points: number; hex: string; mpSpent?: number }): CampaignTurnState
  /** 12.7f：崩溃落点补给 trace 判定；缺省不允许崩溃。 */
  hasTrace?(state: Readonly<CampaignTurnState>, side: Side, hex: string): boolean
}

export type CampaignExtenderAction =
  | { type: 'convert-campaign-extender'; hex: string; kind: ExtenderTransportKind; count: number }
  | { type: 'flip-campaign-extender'; id: string }
  | { type: 'collapse-campaign-extender'; id: string; destination: string }

function extenderWindow(state: Readonly<CampaignTurnState>, side: Side) {
  const { cursor } = state
  if (!('phasing' in cursor)) return false
  return (EXTENDER_SEGMENTS as readonly string[]).includes(cursor.phase) &&
    actingSide(cursor.phasing, cursor.phase) === side
}

export function campaignExtenders(state: Readonly<CampaignTurnState>, side: Side) {
  return (state.extenders ?? []).filter((extender) => extender.side === side)
    .map(({ hex, kind, range }) => ({ hex, kind, range, mobility: kind }))
}

export function campaignExtenderHexOptions(state: Readonly<CampaignTurnState>, side: Side, hex: string,
  board: CampaignExtenderBoard) {
  if (!extenderWindow(state, side)) return null
  const resolved = board.map.resolveHex(hex)
  if (!resolved) return null
  const transports = board.transports(state, side, resolved)
  return { hex: resolved, transports, options: extenderConversionOptions({ entries: transports }),
    refusal: extenderConversionRefusal({ segment: state.cursor.phase, entries: transports }) }
}

export function campaignExtenderOptions(state: Readonly<CampaignTurnState>, side: Side) {
  return extenderWindow(state, side) ? { extenders: campaignExtenders(state, side) } : null
}

/** OCS 12.7a/d/e、5.7f：普通运输点数 -> 延补器（单一状态写入入口）。 */
export function convertCampaignExtender(state: Readonly<CampaignTurnState>, side: Side,
  action: Extract<CampaignExtenderAction, { type: 'convert-campaign-extender' }>,
  board: CampaignExtenderBoard): CampaignTurnState {
  if (!extenderWindow(state, side)) throw new Error('Extender conversion needs your movement, reaction or exploitation segment')
  const forbidden = normalTruckExtenderRefusal(side, action.kind)
  if (forbidden) throw new Error(`Illegal extender conversion: ${forbidden}`)
  const hex = board.map.resolveHex(action.hex)
  if (!hex) throw new Error('Choose an on-map hex for the extender conversion')
  const entries = board.transports(state, side, hex)
  const refusal = extenderConversionRefusal({ segment: state.cursor.phase, entries })
  if (refusal) throw new Error(`Illegal extender conversion: ${refusal}`)
  const plan = planExtenderConversion({ kind: action.kind, count: action.count, entries })
  if (typeof plan === 'string') throw new Error(`Illegal extender conversion: ${plan}`)
  if (plan.leftoverPoints > 0 && (!board.placeTransport || plan.leftoverPlacement.length !== 1)) {
    throw new Error('The leftover transport points cannot be placed')
  }
  const counters = { ...state.counters }
  const paid = new Map<string, number>()
  for (const swap of plan.swaps) {
    const counter = counters[swap.transportUnitId]
    if (!counter || counter.side !== side || counter.location.kind !== 'map') {
      throw new Error('The chosen transport counter is not on this map')
    }
    const entry = entries.find((item) => item.id === swap.transportUnitId)
    const ma = entry?.ma ?? CAMPAIGN_EXTENDER_RANGE[action.kind]
    paid.set(swap.transportUnitId, (entry?.mpSpent ?? 0) + ma * EXTENDER_FLIP_MA_FRACTION)
    delete counters[swap.transportUnitId]
  }
  const serial = state.extenderSerial ?? 1
  const extender: CampaignExtender = { id: `extender:${action.kind}:${serial}`, side, hex, kind: action.kind,
    range: CAMPAIGN_EXTENDER_RANGE[action.kind] }
  const groundMovement = state.groundMovement === undefined ? undefined : {
    ...state.groundMovement,
    moved: (state.groundMovement.moved ?? []).filter((id) => !paid.has(id)),
    zocLocks: state.groundMovement.zocLocks ?? [] }
  let next: CampaignTurnState = { ...state, counters,
    extenders: [...(state.extenders ?? []), extender], extenderSerial: serial + 1, groundMovement }
  if (plan.leftoverPoints > 0) {
    next = board.placeTransport!(next, side, { kind: action.kind, points: plan.leftoverPoints, hex,
      mpSpent: Math.max(...[...paid.values()]) })
  }
  return next
}

function collapseWindow(state: Readonly<CampaignTurnState>, side: Side) {
  const { cursor } = state
  return 'phasing' in cursor && cursor.phase === 'movement' && actingSide(cursor.phasing, cursor.phase) === side &&
    state.weather?.ground !== 'thaw' && !state.combat && !state.barrage
}

/** OCS 12.7d：延补器翻回 5 点同类运输点数，付自身 MA 的一半。 */
export function flipCampaignExtender(state: Readonly<CampaignTurnState>, side: Side,
  action: Extract<CampaignExtenderAction, { type: 'flip-campaign-extender' }>,
  board: CampaignExtenderBoard): CampaignTurnState {
  if (!extenderWindow(state, side)) throw new Error('Extender flip needs your movement, reaction or exploitation segment')
  const extender = (state.extenders ?? []).find((item) => item.id === action.id)
  if (!extender || extender.side !== side) throw new Error('Choose your own extender')
  if (!board.placeTransport) throw new Error('The extender flip needs a placeTransport hook')
  const flipped = board.placeTransport(state, side, { kind: extender.kind, points: 5, hex: extender.hex,
    mpSpent: extender.range * EXTENDER_FLIP_MA_FRACTION })
  return { ...flipped, extenders: (flipped.extenders ?? []).filter((item) => item.id !== extender.id) }
}

/** 12.7f：崩溃落点——射程内、除原点外、本方有 trace 的格；无视中间地形与敌军。 */
export function campaignExtenderCollapseDestinations(state: Readonly<CampaignTurnState>, side: Side,
  id: string, board: CampaignExtenderBoard): readonly string[] {
  const extender = (state.extenders ?? []).find((item) => item.id === id && item.side === side)
  if (!extender || !collapseWindow(state, side) || !board.hasTrace) return []
  const origin = board.map.resolveHex(extender.hex) ?? extender.hex
  const seen = new Set([origin])
  const destinations: string[] = []
  let frontier = [origin]
  for (let steps = 1; steps <= extender.range && frontier.length; steps += 1) {
    const next: string[] = []
    for (const hex of frontier) for (const neighbor of board.map.neighbors(hex)) {
      if (seen.has(neighbor)) continue
      seen.add(neighbor)
      next.push(neighbor)
      if (board.hasTrace(state, side, neighbor)) destinations.push(neighbor)
    }
    frontier = next
  }
  return destinations
}

/** 12.7f：玩家选择崩溃落点；延补器翻回 5 点普通运输点数并记为已行动。 */
export function collapseCampaignExtender(state: Readonly<CampaignTurnState>, side: Side,
  action: Extract<CampaignExtenderAction, { type: 'collapse-campaign-extender' }>,
  board: CampaignExtenderBoard): CampaignTurnState {
  if (!collapseWindow(state, side)) throw new Error('Extender collapse is available in your movement segment')
  const extender = (state.extenders ?? []).find((item) => item.id === action.id)
  if (!extender || extender.side !== side) throw new Error('Choose your own extender')
  if ((state.groundMovement?.moved ?? []).includes(extender.id)) throw new Error('That extender already acted this segment')
  if (!board.placeTransport) throw new Error('The extender collapse needs a placeTransport hook')
  if (!board.hasTrace) throw new Error('The extender collapse needs a trace board')
  const destination = board.map.resolveHex(action.destination)
  if (!destination) throw new Error('Choose an on-map extender collapse destination')
  const allowed = campaignExtenderCollapseDestinations(state, side, extender.id, board)
  if (!allowed.includes(destination)) throw new Error('The collapse destination needs supply trace within the extender range')
  const moved = board.placeTransport(state, side, { kind: extender.kind, points: 5, hex: destination })
  return { ...moved,
    extenders: (moved.extenders ?? []).filter((item) => item.id !== extender.id),
    groundMovement: { ...moved.groundMovement,
      moved: [...new Set([...(moved.groundMovement?.moved ?? []), extender.id])],
      zocLocks: moved.groundMovement?.zocLocks ?? [] } }
}
