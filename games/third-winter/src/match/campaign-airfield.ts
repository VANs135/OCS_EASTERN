// 通规 OCS 15.2–4 / 13.8d 机场施工绑定（判定复用 series/airfield-work；TTW §2.2h 跑道被占回池）。
// 移动阶段内：工程单位建造机场（每回合一级、上限 3 级、4T；已有跑道升级 3T）；
// 工程或当地静止 ≥1 RE 可降级（不低于 1 级、免费）；轴心工程单位可在无机场格建跑道（1T，消耗池中标记）。
// 跑到等级 0 的 strip 记录供 refit/整备板识别；被攻击能力苏军占领即回池（可重建）。

import { airfieldNextLevel, airfieldWorkRefusal, airfieldWorkTokenCost } from '@ocs-eastern/series/airfield-work'
import type { AirfieldOperation } from '@ocs-eastern/series/airfield-work'
import type { Side } from '@ocs-eastern/series/state-types'
import { airStripCapturedToPool } from '../ttw/campaign/fortification.ts'
import type { CampaignHedgehogWorker } from './campaign-hedgehogs.ts'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignAirBase { hex: string; side: Side; level: number; strip?: string }

export type CampaignAirfieldAction = { type: 'work-campaign-airfield'; operation: AirfieldOperation; hex: string;
  unitIds: readonly string[]; payments?: readonly { hex: string; tokens: number }[] }

export interface CampaignAirfieldBoard {
  map: CampaignGroundMap
  worker(state: Readonly<CampaignTurnState>, id: string): CampaignHedgehogWorker | undefined
  /** 池中剩余空气跑道标记 key（按 counter mix 上限）；缺省无池＝不可建跑道。 */
  airstripPool?(state: Readonly<CampaignTurnState>): readonly string[]
  /** 付款可达性（throw/补给网注入）；缺省仅同格堆。 */
  canPay?(state: Readonly<CampaignTurnState>, unitIds: readonly string[], hex: string): boolean
}

/** 某方格现有机场（同格唯一）。 */
export function campaignAirBaseAt(state: Readonly<CampaignTurnState>, hex: string): CampaignAirBase | undefined {
  return state.airBases?.find((base) => base.hex === hex)
}

/** refit/整备板用的友军机场清单（含跑道 level 0）。 */
export function campaignAirBases(state: Readonly<CampaignTurnState>, side: Side): readonly { hex: string; level: number }[] {
  return (state.airBases ?? []).filter((base) => base.side === side).map(({ hex, level }) => ({ hex, level }))
}

/** OCS 15.2–4 / 13.8d / TTW §2.2h：机场/跑道施工（单一状态写入入口）。 */
export function workCampaignAirfield(state: Readonly<CampaignTurnState>, side: Side,
  action: CampaignAirfieldAction, board: CampaignAirfieldBoard): CampaignTurnState {
  const { cursor } = state
  if (!('phasing' in cursor) || cursor.phase !== 'movement' || cursor.phasing !== side ||
    state.movementSegment !== 'movement') throw new Error('Airfield work is available in your movement segment')
  if (!Array.isArray(action.unitIds) || !action.unitIds.length || new Set(action.unitIds).size !== action.unitIds.length) {
    throw new Error('Choose the distinct units doing the airfield work')
  }
  const hex = board.map.resolveHex(action.hex)
  if (!hex) throw new Error('Choose an on-map hex for airfield work')
  const current = campaignAirBaseAt(state, hex) ?? null
  const currentFacts = current ? { side: current.side, level: current.level, strip: current.strip !== undefined } : null
  const workers = action.unitIds.map((id) => {
    const counter = state.counters[id]
    const worker = board.worker(state, id)
    if (!counter || counter.side !== side || !worker) throw new Error('Airfield work requires your own eligible units')
    return worker
  })
  const localRe = workers.filter((worker) => worker.hex === hex && worker.combat && worker.stationary)
    .reduce((sum, worker) => sum + worker.re, 0)
  const enemyInHex = Object.values(state.counters).some((counter) =>
    counter.side !== side && counter.location.kind === 'map' && board.map.resolveHex(counter.location.hex) === hex)
  const log = action.operation === 'reduce' ? state.airfieldReducedAt : state.airfieldBuiltAt
  const refusal = airfieldWorkRefusal({ operation: action.operation, side, onMap: true, current: currentFacts,
    enemyInHex, changedThisTurn: log?.[hex] === state.turn, engineerWithin2: workers.length === 1 && workers[0]!.engineerAt(hex),
    localRe, stripInPool: (board.airstripPool?.(state) ?? []).length > 0 })
  if (refusal) throw new Error(`Illegal airfield work: ${refusal}`)
  const cost = airfieldWorkTokenCost(action.operation, currentFacts)
  const payments = action.payments ?? []
  if (payments.reduce((sum, payment) => sum + payment.tokens, 0) !== cost) {
    throw new Error(`Airfield work requires exactly ${cost} transport points`)
  }
  const dumps = { ...(state.supplyDumps[side] ?? {}) }
  for (const payment of payments) {
    const payHex = board.map.resolveHex(payment.hex)
    if (!payHex || !Number.isSafeInteger(payment.tokens) || payment.tokens <= 0) throw new Error('Invalid airfield work payment')
    if ((dumps[payHex] ?? 0) < payment.tokens) throw new Error('The payment hex holds too few transport points')
    if (board.canPay && !board.canPay(state, action.unitIds, payHex)) throw new Error('The paying dump is out of the workers reach')
    dumps[payHex] = dumps[payHex]! - payment.tokens
    if (dumps[payHex] === 0) delete dumps[payHex]
  }
  const level = airfieldNextLevel(action.operation, current?.level ?? 0)
  const strip = action.operation === 'build-strip' ? (board.airstripPool?.(state) ?? [])[0] : current?.strip
  const airBase: CampaignAirBase = { hex, side, level, ...(strip ? { strip } : {}) }
  return { ...state,
    supplyDumps: { ...state.supplyDumps, [side]: dumps },
    airBases: [...(state.airBases ?? []).filter((base) => base.hex !== hex), airBase],
    [action.operation === 'reduce' ? 'airfieldReducedAt' : 'airfieldBuiltAt']: { ...log, [hex]: state.turn },
    groundMovement: { ...state.groundMovement, moved: [...new Set([...(state.groundMovement?.moved ?? []), ...action.unitIds])],
      zocLocks: state.groundMovement?.zocLocks ?? [] } }
}

/** TTW §2.2h：被攻击能力苏军占领的跑道立即回池（保留可重建；标记从记录中摘除）。 */
export function settleCampaignAirstripCapture(state: Readonly<CampaignTurnState>,
  occupiedByAttackCapableSoviet: (hex: string) => boolean): CampaignTurnState {
  const bases = state.airBases ?? []
  let changed = false
  const next = bases.map((base) => {
    if (!base.strip || !airStripCapturedToPool({ occupiedByAttackCapableSoviet: occupiedByAttackCapableSoviet(base.hex) })) return base
    changed = true
    return { hex: base.hex, side: base.side, level: base.level }
  })
  return changed ? { ...state, airBases: next } : state
}

/** UI 只读投影：双方机场/跑道与本回合施工状态（不替代施工入口）。 */
export function campaignAirfieldOptions(state: Readonly<CampaignTurnState>) {
  return { airBases: (state.airBases ?? []).map(({ hex, side, level, strip }) => ({ hex, side, level,
    strip: strip !== undefined, changedThisTurn: (state.airfieldBuiltAt?.[hex] ?? -1) === state.turn })) }
}