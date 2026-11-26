// TTW §2.3a Kessel HQ 放置/移除/返回绑定（数据驱动：数据库 rebuild_after_turns=3）。
// 离图持有→轴心增援阶段放在任意友方战斗单位格（即使口袋/EZOC）；自愿移除或战斗被毁后 3 回合方可再放。
// 资格（isKesselHq）/落点友方战斗单位事实由调用方注入；返回调度账本 kesselReturn[kesselId]=可用回合。

import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignTurnState } from './campaign-turn-state.ts'

/** §2.3a：被毁或自愿移除后三回合返回（与数据库 rebuild_after_turns 一致）。 */
export const KESSEL_RETURN_TURNS = 3

export type CampaignKesselPlacementAction =
  | { type: 'place-campaign-kessel'; kesselId: string; hex: string }
  | { type: 'remove-campaign-kessel'; kesselId: string }

export interface CampaignKesselPlacementBoard {
  resolveHex(hex: string): string | undefined
  isKesselHq(state: Readonly<CampaignTurnState>, id: string): boolean
  /** 落点格是否有友方战斗单位（§2.3a 须与任意友方战斗单位同格）。 */
  friendlyCombatAt(state: Readonly<CampaignTurnState>, hex: string): boolean
}

function requireAxisReinforcement(state: Readonly<CampaignTurnState>, actor: Side): void {
  const { cursor, reinforcement } = state
  if (cursor.phase !== 'reinforcement' || cursor.phasing !== 'axis' || actor !== 'axis' || reinforcement?.stage !== 'ordinary') {
    throw new Error('Kessel HQs are placed and removed during the Axis reinforcement phase')
  }
}
function returnDue(state: Readonly<CampaignTurnState>, kesselId: string): boolean {
  const due = state.kesselReturn?.[kesselId]
  return due === undefined || state.turn >= due
}

/** §2.3a：把离图（或被毁待返回）的 Kessel HQ 放到友方战斗单位格；返回期未满拒绝。校验失败不改局面。 */
export function placeCampaignKessel(state: Readonly<CampaignTurnState>, actor: Side,
  action: Extract<CampaignKesselPlacementAction, { type: 'place-campaign-kessel' }>,
  board: CampaignKesselPlacementBoard | undefined): CampaignTurnState {
  if (!board) throw new Error('Campaign Kessel placement rules are not configured')
  requireAxisReinforcement(state, actor)
  const counter = state.counters[action.kesselId]
  if (!counter || counter.side !== 'axis' || !board.isKesselHq(state, action.kesselId)) {
    throw new Error('Choose an Axis Kessel HQ')
  }
  if (counter.location.kind !== 'available' && counter.location.kind !== 'dead-pile') {
    throw new Error('A Kessel HQ is placed from off map (or returns from the dead pile)')
  }
  if (!returnDue(state, action.kesselId)) throw new Error('A Kessel HQ returns three turns after removal or destruction')
  const hex = board.resolveHex(action.hex)
  if (!hex || !board.friendlyCombatAt(state, hex)) throw new Error('A Kessel HQ must be placed with a friendly combat unit')
  const { [action.kesselId]: _cleared, ...rest } = state.kesselReturn ?? {}
  return { ...state,
    counters: { ...state.counters, [action.kesselId]: { ...counter, location: { kind: 'map', hex },
      mode: 'combat', disorganized: false, internalStocks: undefined } },
    kesselReturn: rest }
}

/** §2.3a：轴心增援阶段自愿移除在图 Kessel HQ 回离图池，并调度三回合后返回。 */
export function removeCampaignKessel(state: Readonly<CampaignTurnState>, actor: Side,
  action: Extract<CampaignKesselPlacementAction, { type: 'remove-campaign-kessel' }>,
  board: CampaignKesselPlacementBoard | undefined): CampaignTurnState {
  if (!board) throw new Error('Campaign Kessel placement rules are not configured')
  requireAxisReinforcement(state, actor)
  const counter = state.counters[action.kesselId]
  if (!counter || counter.side !== 'axis' || !board.isKesselHq(state, action.kesselId)) {
    throw new Error('Choose an Axis Kessel HQ')
  }
  if (counter.location.kind !== 'map') throw new Error('Only an on-map Kessel HQ can be removed')
  return { ...state,
    counters: { ...state.counters, [action.kesselId]: { ...counter, location: { kind: 'available' } } },
    kesselReturn: { ...(state.kesselReturn ?? {}), [action.kesselId]: state.turn + KESSEL_RETURN_TURNS } }
}

/** 战斗被毁时调度返回（损失结算钩子调用）：只记 turn+3，算子位置由损失结算决定。 */
export function scheduleCampaignKesselReturn(state: Readonly<CampaignTurnState>, kesselId: string): CampaignTurnState {
  return { ...state, kesselReturn: { ...(state.kesselReturn ?? {}), [kesselId]: state.turn + KESSEL_RETURN_TURNS } }
}

/** UI 只读投影：可放置（离图且返回期已满）/在图（可移除）/待返回（id＋可用回合）。 */
export function campaignKesselPlacementOptions(state: Readonly<CampaignTurnState>, side: Side,
  board: CampaignKesselPlacementBoard) {
  if (side !== 'axis') return null
  const placeable: string[] = []
  const onMap: { id: string; hex: string }[] = []
  const pending: { id: string; availableTurn: number }[] = []
  for (const [id, counter] of Object.entries(state.counters)) {
    if (counter.side !== 'axis' || !board.isKesselHq(state, id)) continue
    if (counter.location.kind === 'map') { onMap.push({ id, hex: counter.location.hex }); continue }
    if (counter.location.kind !== 'available' && counter.location.kind !== 'dead-pile') continue
    const due = state.kesselReturn?.[id]
    if (due !== undefined && state.turn < due) pending.push({ id, availableTurn: due })
    else placeable.push(id)
  }
  return { placeable, onMap, pending }
}