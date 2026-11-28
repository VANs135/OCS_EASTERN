// TTW §2.3a B Kessel HQ 免费移动绑定（判定复用 ttw/kessel-hq.ts；几何复用 campaignHexesWithin）。
// 单位资格/步事实（All 成本/未架桥伏尔加/未抵消 EZOC）/东西向坐标由调用方注入；每回合仅一个 Kessel 获益（账本）。
// 瓶中蝎已有 scorpion-kessel-move.ts 参考；本模块接全景会话。

import { kesselFreeMovePath, kesselFreeMoveUnitEligible, KESSEL_FREE_MOVE_RADIUS, type KesselFreeMoveStep } from '../ttw/kessel-hq.ts'
import { campaignHexesWithin } from '../ttw/campaign/hex-range.ts'
import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export type CampaignKesselAction = { type: 'kessel-campaign-free-move'; counterId: string; path: readonly string[] }
export interface CampaignKesselBoard {
  isKesselHq(state: Readonly<CampaignTurnState>, id: string): boolean
  unit(state: Readonly<CampaignTurnState>, id: string): { mode: 'combat' | 'move' | 'reserve' | 'strat'; mobility: string } | undefined
  step(state: Readonly<CampaignTurnState>, id: string, from: string, to: string): KesselFreeMoveStep
  easting(hex: string): number
}

/** UI 只读投影：在图 Kessel HQ 与本回合免费移动是否已用。 */
export function campaignKesselOptions(state: Readonly<CampaignTurnState>, side: Side, board: CampaignKesselBoard) {
  if (side !== 'axis') return null
  const kessels = Object.entries(state.counters)
    .filter(([id, c]) => c.side === 'axis' && c.location.kind === 'map' && board.isKesselHq(state, id))
    .map(([id, c]) => ({ id, hex: (c.location as { hex: string }).hex }))
  return { kessels, freeMoveUsedThisTurn: state.kesselFreeMove?.turn === state.turn }
}

/** §2.3a B：Kessel HQ 免费移动 ≤4 格、每格距起点 ≤2、遇阻必停、不可跨伏尔加、终点不更偏东。 */
export function applyCampaignKesselFreeMove(state: Readonly<CampaignTurnState>, side: Side,
  action: CampaignKesselAction, map: CampaignGroundMap, board: CampaignKesselBoard): CampaignTurnState {
  const cursor = state.cursor
  if (!('phasing' in cursor) || cursor.phase !== 'movement' || cursor.phasing !== 'axis' || side !== 'axis' ||
    state.movementSegment !== 'movement') throw new Error('Kessel free move is in the Axis movement phase')
  const counter = state.counters[action.counterId]
  if (!counter || counter.side !== 'axis' || counter.location.kind !== 'map' || !board.isKesselHq(state, action.counterId)) {
    throw new Error('Choose an on-map Axis Kessel HQ')
  }
  if (state.groundMovement?.moved.includes(action.counterId)) throw new Error('This Kessel HQ has already moved this phase')
  if (state.kesselFreeMove?.turn === state.turn) throw new Error('Only one Kessel HQ may benefit from free move per turn')
  const unit = board.unit(state, action.counterId)
  if (!unit || !kesselFreeMoveUnitEligible(unit)) throw new Error('Kessel free move requires Combat or Move Mode with Leg MA')
  const start = map.resolveHex(counter.location.hex)!
  const path = action.path.map((hex) => map.resolveHex(hex))
  if (!path.length || path.length > 4 || path.some((hex) => !hex)) throw new Error('A Kessel free move enters one to four hexes')
  const near = new Set(campaignHexesWithin(map, start, KESSEL_FREE_MOVE_RADIUS))
  if (path.some((hex) => !near.has(hex!))) throw new Error('Every entered hex must be within two hexes of the Kessel HQ')
  const steps = path.map((to, i) => board.step(state, action.counterId, i === 0 ? start : path[i - 1]!, to!))
  const verdict = kesselFreeMovePath(steps, { startEast: board.easting(start), endEast: board.easting(path[path.length - 1]!) })
  if (!verdict.ok) throw new Error(`Kessel free move: ${verdict.reason}`)
  const end = path[path.length - 1]!
  return { ...state,
    counters: { ...state.counters, [action.counterId]: { ...counter, location: { kind: 'map', hex: end } } },
    // §2.3a B：免费移动替代该 HQ 本阶段的常规移动，不能先免费再走一次常规 MA。
    groundMovement: {
      ...state.groundMovement,
      moved: [...new Set([...(state.groundMovement?.moved ?? []), action.counterId])],
      zocLocks: state.groundMovement?.zocLocks ?? [],
    },
    kesselFreeMove: { turn: state.turn, kesselId: action.counterId } }
}