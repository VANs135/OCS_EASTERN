// 通规 12.3b：由数据驱动的常规 HQ 投送事实。
// 只读取算子库当前面的印刷 drop range 和 HQ 类别，不猜未印数值、不改 Kessel 的 self-contained 特例。
// 专规 2.3b/c 的轴心 HQ 额度与 §3.3b 方面军边界不在本文件；那些是 TTW 专规闸门，由调用方叠加。

import type { SupplyHeadquarter } from '@ocs-eastern/series/supply-network'
import type { BackupUnit } from '../import/unit-backup.ts'
import type { Definition } from '../import/unit-catalog.ts'
import { campaignCounterGroundMode } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export type CampaignSupplyHqCatalog = Readonly<Record<string, Definition<BackupUnit>>>

/**
 * 在图、非战略模式、非 Kessel 的常规 HQ 投送源。
 *
 * - `throwRange` 取当前面（combat/move）的 `dropRange`；换面后由调用方重算，不能缓存成固定值。
 * - 12.3b-C：战略模式 HQ 不能投送，故不进入本清单。
 * - Kessel HQ 走 `campaign-kessel-trace.ts` 的 `selfContained` 源，本函数跳过，避免重复。
 * - 只返回事实，不判断 HQ 自身是否已获得补给；12.3b 的这一前置由 `supply-network` 统一裁定。
 */
export function campaignThrowHeadquarters(
  state: Readonly<CampaignTurnState>,
  catalog: CampaignSupplyHqCatalog,
): SupplyHeadquarter[] {
  const headquarters: SupplyHeadquarter[] = []
  for (const [id, counter] of Object.entries(state.counters)) {
    if (counter.kind !== 'hq' || counter.location.kind !== 'map') continue
    // 12.3b-C：战略模式的指挥部不能投递补给。
    if (counter.mode === 'strat') continue
    const definition = catalog[counter.definition]
    if (!definition || definition.kind !== 'hq') continue
    // Kessel 的补给是 selfContained 源，不是普通 12.3b 投送。
    if (definition.source.abilities?.includes('kessel_supply') === true) continue
    const face = campaignCounterGroundMode(counter, true).face
    const range = definition.source.faces[face]?.stats.dropRange
    if (typeof range !== 'number' || !Number.isFinite(range) || range <= 0) continue
    headquarters.push({ id, hex: counter.location.hex, throwRange: range, mobility: 'truck' })
  }
  return headquarters
}
