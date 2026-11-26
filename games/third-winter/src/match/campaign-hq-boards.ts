// 会话装配层：由 catalog（definition→HQ 事实）派生各盘面 HQ 钩子，供真实对局消费（替代合成测试注入）。
// 分类复用 ttw/hq-classify.ts 数据驱动 API；铁路读 rail_only/rail_cap_RE/must_be_city，不脑补。

import { axisHqDestroyedOnRetreat, axisLossHqKind, campaignHqClass, hqRailFacts, hqRailOnly,
  type CampaignHqClass } from '../ttw/hq-classify.ts'
import { applyCampaignCombatLosses, type CampaignLossBoard } from './campaign-combat-losses.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

/** 一个算子定义里与 HQ 钩子相关的事实（来自 v2 库 hq_kind / 拆分库种别 / 铁路字段）。 */
export interface CampaignHqDefinition {
  hqKind?: string
  catalogKind?: string
  railOnly?: boolean
  railCapRe?: number
  mustBeCity?: boolean
}
export type CampaignHqCatalog = Readonly<Record<string, CampaignHqDefinition>>

export interface CampaignHqHooks {
  hqKindOf(state: Readonly<CampaignTurnState>, id: string): 'army' | 'army-group' | 'corps' | undefined
  isKesselHq(state: Readonly<CampaignTurnState>, id: string): boolean
  retreatDestroyed(state: Readonly<CampaignTurnState>, id: string): boolean
  railOnly(state: Readonly<CampaignTurnState>, id: string): boolean
  hqRail(state: Readonly<CampaignTurnState>, id: string): { railRe: number; waiveDetrainable: boolean } | undefined
}

/** 由 catalog 派生 HQ 钩子。算子经 definition 键查定义；类别经 campaignHqClass，歼灭/撤退仅限轴心。 */
export function campaignHqHooks(catalog: CampaignHqCatalog): CampaignHqHooks {
  const defOf = (state: Readonly<CampaignTurnState>, id: string): CampaignHqDefinition | undefined =>
    catalog[state.counters[id]?.definition ?? '']
  const classOf = (state: Readonly<CampaignTurnState>, id: string): CampaignHqClass | undefined => {
    const counter = state.counters[id]
    if (!counter || counter.kind !== 'hq') return undefined
    const def = defOf(state, id)
    return campaignHqClass(def?.hqKind, def?.catalogKind)
  }
  return {
    hqKindOf: (state, id) => state.counters[id]?.side === 'axis' ? axisLossHqKind(classOf(state, id)) : undefined,
    isKesselHq: (state, id) => classOf(state, id) === 'kessel',
    retreatDestroyed: (state, id) => state.counters[id]?.side === 'axis' && axisHqDestroyedOnRetreat(classOf(state, id)),
    railOnly: (state, id) => hqRailOnly(defOf(state, id)),
    hqRail: (state, id) => hqRailFacts(defOf(state, id)),
  }
}

/** §2.3b D：被迫撤退即毁的组合——按全额步数走共享损失入口（死堆＋免费重建记录＋歼灭 VP）。 */
export function campaignDestroyOnRetreat(lossBoard: CampaignLossBoard) {
  return (state: Readonly<CampaignTurnState>, ids: readonly string[]): CampaignTurnState => {
    const allocation = new Map<string, number>()
    for (const id of ids) {
      const steps = lossBoard.stepsOf(state, id)
      if (steps !== undefined && steps >= 1) allocation.set(id, steps)
    }
    return allocation.size > 0 ? applyCampaignCombatLosses(state, allocation, lossBoard) : state
  }
}