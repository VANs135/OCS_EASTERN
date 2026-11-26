// TTW §2.2b Luftflotte HQ 放置/位移绑定（判定复用 ttw/luftflotte-hq.ts）。
// 移动阶段拾起放到友军村庄/城市/机场格、距在补苏军战斗单位 ≥10 格；苏军进入 10 格内必须移动。
// 格性质（村庄/城市/友军机场）与到在补苏军战斗单位距离由调用方注入。

import { luftflotteValidHex, luftflotteMustMove } from '../ttw/luftflotte-hq.ts'
import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export type CampaignLuftflottePlacementAction = { type: 'move-campaign-luftflotte'; targetHex: string }

export interface CampaignLuftflottePlacementBoard {
  resolveHex(hex: string): string | undefined
  isLuftflotteHq(state: Readonly<CampaignTurnState>, id: string): boolean
  /** 目标格性质与到最近在补苏军战斗单位的距离。 */
  siteFacts(state: Readonly<CampaignTurnState>, hex: string):
    { villageCityOrFriendlyAirBase: boolean; distanceToInSupplySovietCombat: number } | undefined
  /** 该格 10 格内是否有在补苏军战斗单位（用于必须移动判定）。 */
  sovietCombatWithin10(state: Readonly<CampaignTurnState>, hex: string): boolean
}

function locateLuftflotte(state: Readonly<CampaignTurnState>, board: CampaignLuftflottePlacementBoard): string | undefined {
  return Object.entries(state.counters).find(([id, c]) => c.side === 'axis' && board.isLuftflotteHq(state, id))?.[0]
}

/** §2.2b：移动阶段把 Luftflotte HQ 拾起放到满足条件的友军格。校验失败不改局面。 */
export function moveCampaignLuftflotte(state: Readonly<CampaignTurnState>, actor: Side,
  action: CampaignLuftflottePlacementAction, board: CampaignLuftflottePlacementBoard | undefined): CampaignTurnState {
  if (!board) throw new Error('Campaign Luftflotte placement rules are not configured')
  const cursor = state.cursor
  if (!('phasing' in cursor) || cursor.phase !== 'movement' || cursor.phasing !== 'axis' || actor !== 'axis' ||
    state.movementSegment !== 'movement') throw new Error('Luftflotte HQ is moved in the Axis movement phase')
  const id = locateLuftflotte(state, board)
  const counter = id ? state.counters[id] : undefined
  if (!id || !counter) throw new Error('No Axis Luftflotte HQ on the board')
  const target = board.resolveHex(action.targetHex)
  const facts = target ? board.siteFacts(state, target) : undefined
  if (!target || !facts) throw new Error('Choose a resolvable target hex with Luftflotte site facts')
  if (!luftflotteValidHex(facts)) {
    throw new Error('Luftflotte HQ must sit at a friendly village/city/air base, 10+ hexes from an in-supply Soviet combat unit')
  }
  return { ...state, counters: { ...state.counters, [id]: { ...counter, location: { kind: 'map', hex: target } } } }
}

/** UI 只读投影：Luftflotte HQ 当前格与是否必须移动（苏军进入 10 格内）。 */
export function campaignLuftflottePlacementOptions(state: Readonly<CampaignTurnState>, side: Side,
  board: CampaignLuftflottePlacementBoard) {
  if (side !== 'axis') return null
  const id = locateLuftflotte(state, board)
  const counter = id ? state.counters[id] : undefined
  if (!id || !counter || counter.location.kind !== 'map') return { id: id ?? null, hex: null, mustMove: false }
  const hex = counter.location.hex
  return { id, hex, mustMove: luftflotteMustMove({ sovietCombatWithin10: board.sovietCombatWithin10(state, hex) }) }
}