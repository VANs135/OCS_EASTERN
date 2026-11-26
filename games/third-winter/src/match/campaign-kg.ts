// TTW §2.4e 轴心 Kampfgruppe 战斗群绑定（判定复用 ttw/kg.ts）。
// KG 成员＝实际与标记同堆的合格单位（德军＋卡车/履带 MA，由调用方注入 eligible）；标记须始终≥1 合格单位同堆。
// 反应能力（掷骰取半＝可行动 KG 数）的规则在 kg.ts，反应阶段掷骰结算另接。

import { kgCreateValid, kgMarkerStays } from '../ttw/kg.ts'
import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export type CampaignKgAction =
  | { type: 'create-campaign-kg'; unitId: string; hex: string }
  | { type: 'dissolve-campaign-kg'; id: string }
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