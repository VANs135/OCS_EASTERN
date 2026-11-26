// TTW §3.5b RVGK 最低编成数据层计数。两盒合计：坦克/机械化军 6、骑兵军 1、炮兵/喀秋莎师 2、步兵师 3、坦克集团军 HQ 1。
// 归类（单位→类别）与多单位编队计入判定由 catalog/绑定层注入；聚合与最低编成校验复用 ttw/rvgk.ts。

import { rvgkMinimumsMet, type RvgkCounts } from '../ttw/rvgk.ts'
import type { CampaignCounter } from './campaign-reinforcement-state.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export type RvgkClass = keyof RvgkCounts

export interface CampaignRvgkFormationBoard {
  /** 把一个盒内单位归入最低编成类别；不属任何类返回 null（由 catalog 的 unit_class/unit_size/hq_kind 判定）。 */
  classify(state: Readonly<CampaignTurnState>, counter: CampaignCounter): RvgkClass | null
  /** 多单位编队是否计入：至少 1 单位在盒、其余在盒或死亡堆、无人在图（独立单位恒 true）。 */
  formationCounts(state: Readonly<CampaignTurnState>, counter: CampaignCounter): boolean
}

const RVGK_BOXES = new Set(['rvgk-1', 'rvgk-2'])

/** §3.5b：统计两盒内计入最低编成的单位数并校验。 */
export function campaignRvgkMinimums(state: Readonly<CampaignTurnState>, board: CampaignRvgkFormationBoard):
  { counts: RvgkCounts; ok: boolean; missing: readonly string[] } {
  const counts: RvgkCounts = { tankMechCorps: 0, cavalryCorps: 0, artyKatyDivisions: 0, infantryDivisions: 0, tankArmyHq: 0 }
  for (const counter of Object.values(state.counters)) {
    if (counter.location.kind !== 'box' || !RVGK_BOXES.has(counter.location.box)) continue
    if (!board.formationCounts(state, counter)) continue
    const cls = board.classify(state, counter)
    if (cls) counts[cls] += 1
  }
  const { ok, missing } = rvgkMinimumsMet(counts)
  return { counts, ok, missing }
}