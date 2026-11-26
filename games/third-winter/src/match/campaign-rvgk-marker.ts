// TTW §3.5a RVGK 标记铁路移动绑定（判定复用 ttw/rvgk.ts）。
// 仅铁路、止可卸载格、费 5 RE 铁路运力（多轨/Trainbusting 由调用方调整）、不入/穿轴心战斗单位 10 格内
// （Kessel 补给者忽略，由调用方筛）；RVGK-1 止 Map C/D、RVGK-2 止 Map A/B。

import { RVGK_MARKER_RAIL_RE, rvgkMarkerMaps, rvgkMarkerRailValid, type RvgkBox } from '../ttw/rvgk.ts'
import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export type CampaignRvgkMarkerAction = { type: 'move-campaign-rvgk-marker'; box: RvgkBox; hex: string }

export interface CampaignRvgkMarkerBoard {
  resolveHex(hex: string): string | undefined
  detrainable(state: Readonly<CampaignTurnState>, hex: string): boolean
  /** 目标格或铁路路径是否落入轴心战斗单位 10 格内（Kessel 补给者已由调用方排除）。 */
  routeWithin10AxisCombat(state: Readonly<CampaignTurnState>, from: string, to: string): boolean
  /** 格所属地图（A/B/C/D）。 */
  mapOf(hex: string): string | undefined
  /** 本次标记铁路移动的 RE 费用（缺省 5；多轨/Trainbusting 调整由调用方给出）。 */
  railCost?(state: Readonly<CampaignTurnState>, box: RvgkBox, from: string, to: string): number
  railCapacityRemaining(state: Readonly<CampaignTurnState>): number
}

/** §3.5a：苏军移动阶段把 RVGK 标记铁路移到合法格，扣铁路运力。校验失败不改局面。 */
export function moveCampaignRvgkMarker(state: Readonly<CampaignTurnState>, actor: Side,
  action: CampaignRvgkMarkerAction, board: CampaignRvgkMarkerBoard | undefined): CampaignTurnState {
  if (!board) throw new Error('Campaign RVGK marker rules are not configured')
  const cursor = state.cursor
  if (!('phasing' in cursor) || cursor.phase !== 'movement' || cursor.phasing !== 'soviet' || actor !== 'soviet') {
    throw new Error('RVGK markers move in the Soviet movement phase')
  }
  const from = state.rvgkMarkers?.[action.box]
  if (!from) throw new Error('The RVGK marker has no current hex')
  const target = board.resolveHex(action.hex)
  if (!target) throw new Error('Choose a resolvable target hex')
  if (!rvgkMarkerRailValid({ detrainableEnd: board.detrainable(state, target),
    within10AxisCombat: board.routeWithin10AxisCombat(state, from, target) })) {
    throw new Error('RVGK marker must end in a detrainable hex, out of 10 hexes of Axis combat (into or through)')
  }
  const map = board.mapOf(target)
  if (!map || !rvgkMarkerMaps(action.box).includes(map)) throw new Error('RVGK-1 ends on Map C/D and RVGK-2 on Map A/B')
  const cost = board.railCost?.(state, action.box, from, target) ?? RVGK_MARKER_RAIL_RE
  if (cost > board.railCapacityRemaining(state)) throw new Error('Not enough rail capacity for the RVGK marker (5 RE)')
  const progress = state.groundMovement ?? { moved: [], zocLocks: [] }
  return { ...state,
    rvgkMarkers: { ...(state.rvgkMarkers ?? {}), [action.box]: target },
    groundMovement: { ...progress, railCapacitySpent: (progress.railCapacitySpent ?? 0) + cost } }
}