// 通规 OCS 16.0b–c / 13.8d 工事劳动绑定（判定复用 series/hedgehog-work，TTW §1.1b 上限经 maxLevel 注入）。
// 移动阶段内，静止的当地 ≥1 RE 战斗单位或距 ≤2 的工程单位改一级工事：建造 8T、缩减免费；每格每回合每操作一次。
// 工事归属随建造方；敌人格不可劳动；印刷工事由 board.printed 回退。

import { hedgehogNextLevel, hedgehogWorkRefusal, hedgehogWorkTokenCost } from '@ocs-eastern/series/hedgehog-work'
import type { HedgehogOperation } from '@ocs-eastern/series/hedgehog-work'
import type { Side } from '@ocs-eastern/series/state-types'
import { TTW_HEDGEHOG_MAX_LEVEL } from '../ttw/campaign/fortification.ts'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignHedgehog { side: Side; level: 1 | 2 }

export type CampaignHedgehogAction = { type: 'work-campaign-hedgehog'; operation: HedgehogOperation;
  hex: string; unitIds: readonly string[]; payments?: readonly { hex: string; tokens: number }[] }

export interface CampaignHedgehogWorker {
  hex: string
  combat: boolean
  /** 静止劳动条件：战斗模式、本阶段未移动、非预备/战略/露械。 */
  stationary: boolean
  re: number
  /** OCS 13.8d：该工人能否在此格担任工程师（工程能力＋距 ≤2 且路径可通行）。 */
  engineerAt(hex: string): boolean
}

export interface CampaignHedgehogBoard {
  map: CampaignGroundMap
  worker(state: Readonly<CampaignTurnState>, id: string): CampaignHedgehogWorker | undefined
  /** 印刷工事（地图/初设）回退；TTW §1.1b 上限由 maxLevel 表达。 */
  printed?(state: Readonly<CampaignTurnState>, hex: string): CampaignHedgehog | null
  /** 建造付款是否可被这些工人使用（throw/补给网注入）；缺省仅允许同格堆。 */
  canPay?(state: Readonly<CampaignTurnState>, unitIds: readonly string[], hex: string): boolean
  /** 工事上限（缺省 TTW §1.1b Level-2）。 */
  maxLevel?: number
}

/** OCS 9.14e：敌方攻击单位进入工事格时降一级并归进入方；1 级工事直接移除。 */
export interface CampaignHedgehogCaptureBoard {
  attackCapable(state: Readonly<CampaignTurnState>, id: string): boolean
  /** 印刷工事回退；无状态记录时仍可被夺取。 */
  printed?(state: Readonly<CampaignTurnState>, hex: string): CampaignHedgehog | null
}

export function captureCampaignHedgehog(state: Readonly<CampaignTurnState>, side: Side, hex: string,
  ids: readonly string[], board: CampaignHedgehogCaptureBoard): CampaignTurnState {
  const current = state.hedgehogs && Object.hasOwn(state.hedgehogs, hex)
    ? state.hedgehogs[hex] : board.printed?.(state, hex) ?? null
  if (!current || current.side === side) return state
  if (!ids.some((id) => board.attackCapable(state, id))) return state
  const next = current.level === 2 ? { side, level: 1 as const } : null
  return { ...state, hedgehogs: { ...state.hedgehogs, [hex]: next } }
}

/** 工事等级：状态写入优先，印刷工事回退。 */
export function campaignHedgehogLevel(state: Readonly<CampaignTurnState>, hex: string, board?: CampaignHedgehogBoard): number {
  if (state.hedgehogs && Object.hasOwn(state.hedgehogs, hex)) return state.hedgehogs[hex]?.level ?? 0
  return board?.printed?.(state, hex)?.level ?? 0
}

/** 战斗/炮击板 hedgehogAt 的实现：状态工事优先，印刷回退。 */
export function campaignHedgehogAt(board: CampaignHedgehogBoard) {
  return (state: Readonly<CampaignTurnState>, hex: string) => {
    const hex2 = board.map.resolveHex(hex) ?? hex
    return campaignHedgehogLevel(state, hex2, board)
  }
}

/** UI 只读投影：在图工事（状态层）与本回合变更状态，供工事面板渲染（不替代劳动入口）。 */
export function campaignHedgehogOptions(state: Readonly<CampaignTurnState>, side: Side) {
  const entries = Object.entries(state.hedgehogs ?? {}).flatMap(([hex, hedgehog]) => hedgehog === null ? [] :
    [{ hex, side: hedgehog.side, level: hedgehog.level, owned: hedgehog.side === side,
      changedThisTurn: (state.hedgehogBuiltAt?.[hex] ?? -1) === state.turn || (state.hedgehogReducedAt?.[hex] ?? -1) === state.turn }])
  return { hedgehogs: entries, maxLevel: TTW_HEDGEHOG_MAX_LEVEL }
}

/** OCS 16.0b–c / 13.8d / TTW §1.1b：工事建造/缩减（移动阶段，单状态写入入口）。 */
export function workCampaignHedgehog(state: Readonly<CampaignTurnState>, side: Side,
  action: CampaignHedgehogAction, board: CampaignHedgehogBoard): CampaignTurnState {
  const { cursor } = state
  if (!('phasing' in cursor) || cursor.phase !== 'movement' || cursor.phasing !== side ||
    state.movementSegment !== 'movement') throw new Error('Hedgehog work is available in your movement segment')
  if (!Array.isArray(action.unitIds) || !action.unitIds.length || new Set(action.unitIds).size !== action.unitIds.length) {
    throw new Error('Choose the distinct units doing the hedgehog work')
  }
  const hex = board.map.resolveHex(action.hex)
  if (!hex) throw new Error('Choose an on-map hex for hedgehog work')
  const current = state.hedgehogs && Object.hasOwn(state.hedgehogs, hex)
    ? state.hedgehogs[hex] : board.printed?.(state, hex) ?? null
  const workers = action.unitIds.map((id) => {
    const counter = state.counters[id]
    const worker = board.worker(state, id)
    if (!counter || counter.side !== side || !worker) throw new Error('Hedgehog work requires your own eligible units')
    return worker
  })
  const localRe = workers.filter((worker) => worker.hex === hex && worker.combat && worker.stationary)
    .reduce((sum, worker) => sum + worker.re, 0)
  const enemyInHex = Object.values(state.counters).some((counter) =>
    counter.side !== side && counter.location.kind === 'map' && board.map.resolveHex(counter.location.hex) === hex)
  const log = action.operation === 'build' ? state.hedgehogBuiltAt : state.hedgehogReducedAt
  const refusal = hedgehogWorkRefusal({ operation: action.operation, onMap: true, current, side,
    maxLevel: board.maxLevel ?? TTW_HEDGEHOG_MAX_LEVEL, enemyInHex,
    levelChangedThisTurn: log?.[hex] === state.turn,
    localRe, engineerWithin2: workers.length === 1 && workers[0]!.engineerAt(hex) })
  if (refusal) throw new Error(`Illegal hedgehog work: ${refusal}`)
  const cost = hedgehogWorkTokenCost(action.operation)
  const payments = action.payments ?? []
  const total = payments.reduce((sum, payment) => sum + payment.tokens, 0)
  if (total !== cost) throw new Error(`Hedgehog work requires exactly ${cost} transport points`)
  const dumps = { ...(state.supplyDumps[side] ?? {}) }
  for (const payment of payments) {
    const payHex = board.map.resolveHex(payment.hex)
    if (!payHex || !Number.isSafeInteger(payment.tokens) || payment.tokens <= 0) throw new Error('Invalid hedgehog work payment')
    if ((dumps[payHex] ?? 0) < payment.tokens) throw new Error('The payment hex holds too few transport points')
    if (board.canPay && !board.canPay(state, action.unitIds, payHex)) throw new Error('The paying dump is out of the workers reach')
    dumps[payHex] = dumps[payHex]! - payment.tokens
    if (dumps[payHex] === 0) delete dumps[payHex]
  }
  const next = hedgehogNextLevel(action.operation, current?.level ?? 0)
  return { ...state,
    supplyDumps: { ...state.supplyDumps, [side]: dumps },
    hedgehogs: { ...state.hedgehogs, [hex]: next === null ? null : { side, level: next as 1 | 2 } },
    [action.operation === 'build' ? 'hedgehogBuiltAt' : 'hedgehogReducedAt']: { ...log, [hex]: state.turn },
    groundMovement: { ...state.groundMovement, moved: [...new Set([...(state.groundMovement?.moved ?? []), ...action.unitIds])],
      zocLocks: state.groundMovement?.zocLocks ?? [] } }
}