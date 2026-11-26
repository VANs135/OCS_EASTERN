// TTW §2.3a A：Kessel HQ 给 throw 范围内所有轴心战斗单位提供 trace 补给。
// 实现＝把在图轴心 Kessel HQ 作为 selfContained 补给源并入补给网络（series supply-network 已支持 self-contained trace）。
// 例（专规）：Kessel 1 Throw range＋相邻格内的轴心单位可由其补给。

import type { Mobility } from '@ocs-eastern/series/ground-map'
import type { SupplyHeadquarter } from '@ocs-eastern/series/supply-network'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignKesselTraceFacts {
  isKesselHq(state: Readonly<CampaignTurnState>, id: string): boolean
  /** Kessel HQ 印值投递距离（dropRange）。 */
  throwRangeOf(state: Readonly<CampaignTurnState>, id: string): number | undefined
  /** 投递机动类（缺省 truck）。 */
  mobilityOf?(state: Readonly<CampaignTurnState>, id: string): Mobility
}

/** 由在图轴心 Kessel HQ 派生 selfContained 补给源，供并入补给网络 headquarters。 */
export function kesselSupplyHeadquarters(state: Readonly<CampaignTurnState>, facts: CampaignKesselTraceFacts): SupplyHeadquarter[] {
  const headquarters: SupplyHeadquarter[] = []
  for (const [id, counter] of Object.entries(state.counters)) {
    if (counter.side !== 'axis' || counter.location.kind !== 'map') continue
    if (!facts.isKesselHq(state, id)) continue
    const throwRange = facts.throwRangeOf(state, id)
    if (typeof throwRange !== 'number' || !Number.isFinite(throwRange) || throwRange < 0) continue
    headquarters.push({ id, hex: counter.location.hex, throwRange,
      mobility: facts.mobilityOf?.(state, id) ?? 'truck', selfContained: true })
  }
  return headquarters
}