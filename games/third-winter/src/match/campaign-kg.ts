// TTW §2.4e 轴心 Kampfgruppe 战斗群绑定（判定复用 ttw/kg.ts）。
// KG 成员＝实际与标记同堆的合格单位（德军＋卡车/履带 MA，由调用方注入 eligible）；标记须始终≥1 合格单位同堆。
// 反应能力（掷骰取半＝可行动 KG 数）的规则在 kg.ts，反应阶段掷骰结算另接。

import { kgCreateValid, kgMarkerStays, kgReactionCount, kgPlaces2T } from '../ttw/kg.ts'
import { rollDie } from '@ocs-eastern/series/rng'
import { actingSide } from '@ocs-eastern/series/turn'
import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export type CampaignKgAction =
  | { type: 'create-campaign-kg'; unitId: string; hex: string }
  | { type: 'dissolve-campaign-kg'; id: string }
  | { type: 'roll-campaign-kg-reaction' }
  | { type: 'place-campaign-kg-2t'; id: string }
export type KgEligible = (state: Readonly<CampaignTurnState>, id: string) => boolean

function kgWindowOpen(state: Readonly<CampaignTurnState>, side: Side): boolean {
  const cursor = state.cursor
  return 'phasing' in cursor && side === 'axis' && cursor.phasing === 'axis' &&
    cursor.phase === 'movement' && state.movementSegment === 'movement'
}
const membersAt = (state: Readonly<CampaignTurnState>, map: CampaignGroundMap, hex: string, eligible: KgEligible) =>
  Object.entries(state.counters)
    .filter(([id, c]) => c.side === 'axis' && c.location.kind === 'map' &&
      (map.resolveHex(c.location.hex) ?? c.location.hex) === (map.resolveHex(hex) ?? hex) && eligible(state, id))
    .map(([id]) => id)

/** UI 只读投影：各 KG 标记格＋当前同堆合格成员。 */
export function campaignKgOptions(state: Readonly<CampaignTurnState>, side: Side, map: CampaignGroundMap, eligible: KgEligible) {
  if (side !== 'axis') return null
  return (state.kampfgruppen ?? []).map(({ id, hex }) => ({ id, hex, members: membersAt(state, map, hex, eligible) }))
}

/** §2.4e：移动阶段在合格单位上放标记创建 KG。 */
export function createCampaignKg(state: Readonly<CampaignTurnState>, side: Side,
  action: Extract<CampaignKgAction, { type: 'create-campaign-kg' }>, map: CampaignGroundMap, eligible: KgEligible): CampaignTurnState {
  if (!kgWindowOpen(state, side)) throw new Error('Kampfgruppe markers are placed in the Axis movement phase')
  const counter = state.counters[action.unitId]
  const hex = map.resolveHex(action.hex)
  if (!counter || counter.side !== 'axis' || counter.location.kind !== 'map' || !hex ||
    (map.resolveHex(counter.location.hex) ?? counter.location.hex) !== hex) throw new Error('Choose an Axis counter on the target hex')
  if ((state.kampfgruppen ?? []).some((k) => k.id === action.unitId)) throw new Error('This counter already leads a Kampfgruppe')
  if (!kgCreateValid({ movementPhase: true, eligibleUnitStacked: eligible(state, action.unitId) })) {
    throw new Error('The unit must be German with Truck or Track MA to lead a Kampfgruppe')
  }
  return { ...state, kampfgruppen: [...(state.kampfgruppen ?? []), { id: action.unitId, hex }] }
}

/** §2.4e：后续轴心移动阶段自愿解散 KG。 */
export function dissolveCampaignKg(state: Readonly<CampaignTurnState>, side: Side,
  action: Extract<CampaignKgAction, { type: 'dissolve-campaign-kg' }>): CampaignTurnState {
  if (!kgWindowOpen(state, side)) throw new Error('Kampfgruppe markers are dissolved in the Axis movement phase')
  if (!(state.kampfgruppen ?? []).some((k) => k.id === action.id)) throw new Error('Choose an existing Kampfgruppe marker')
  return { ...state, kampfgruppen: (state.kampfgruppen ?? []).filter((k) => k.id !== action.id) }
}

/** §2.4e：最后一个合格单位被消灭/离堆时标记立即回池（战斗损失/移动结算后调用）。 */
export function removeEmptyCampaignKg(state: Readonly<CampaignTurnState>, map: CampaignGroundMap, eligible: KgEligible): CampaignTurnState {
  const kept = (state.kampfgruppen ?? []).filter(({ hex }) => kgMarkerStays(membersAt(state, map, hex, eligible).length))
  return kept.length === (state.kampfgruppen ?? []).length ? state : { ...state, kampfgruppen: kept }
}

function kgReactionWindow(state: Readonly<CampaignTurnState>, side: Side): boolean {
  const cursor = state.cursor
  return 'phasing' in cursor && cursor.phase === 'reaction' && side === 'axis' && actingSide(cursor.phasing, cursor.phase) === 'axis'
}

/** UI 只读投影：本回合反应段是否已掷骰、可行动 KG 数、2T 落点。 */
export function campaignKgReactionOptions(state: Readonly<CampaignTurnState>, side: Side) {
  if (side !== 'axis') return null
  const r = state.kgReaction?.turn === state.turn ? state.kgReaction : undefined
  return { rolled: r !== undefined, die: r?.die ?? null, count: r?.count ?? 0, twoT: r?.twoT ?? null }
}

/** §2.4e：轴心反应段掷 1 骰取半（向下取整）＝可如已释放预备行动的战斗/移动模式 KG 数；每回合一次。 */
export function rollCampaignKgReaction(state: Readonly<CampaignTurnState>, side: Side): CampaignTurnState {
  if (!kgReactionWindow(state, side)) throw new Error('Kampfgruppe reaction is rolled in the Axis reaction phase')
  if (state.kgReaction?.turn === state.turn) throw new Error('Kampfgruppe reaction is rolled once per turn')
  const rolled = rollDie(state.rng)
  return { ...state, rng: rolled.rng, kgReaction: { turn: state.turn, die: rolled.value, count: kgReactionCount(rolled.value), twoT: null } }
}

/** §2.4e：在实际移动/攻击的那个 KG 上放 2T（每反应段仅一个 KG；movedOrAttacked 事实由绑定层注入）。 */
export function placeCampaignKg2T(state: Readonly<CampaignTurnState>, side: Side,
  action: Extract<CampaignKgAction, { type: 'place-campaign-kg-2t' }>, movedOrAttackedThisReaction: boolean): CampaignTurnState {
  if (!kgReactionWindow(state, side)) throw new Error('Kampfgruppe 2T is placed in the Axis reaction phase')
  const reaction = state.kgReaction?.turn === state.turn ? state.kgReaction : undefined
  if (!reaction) throw new Error('Roll the Kampfgruppe reaction first')
  if (!(state.kampfgruppen ?? []).some((k) => k.id === action.id)) throw new Error('Choose an existing Kampfgruppe marker')
  if (!kgPlaces2T({ movedOrAttackedThisReaction })) throw new Error('2T is placed on a Kampfgruppe that actually moved or attacked this reaction')
  if (reaction.twoT !== null) throw new Error('Only one Kampfgruppe receives 2T per reaction')
  return { ...state, kgReaction: { ...reaction, twoT: action.id } }
}