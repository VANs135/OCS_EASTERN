// 会话装配层：由算子库（abilities/RE/种别）派生工事与机场施工盘面的事实钩子。
// 工程能力读数据层 abilities 的 `engineering`（AGS 等 Army Group HQ 在库中无此标记，正好对应 §2.3c B 不可工程）；
// 静止劳动＝战斗模式＋本阶段未移动＋非预备/战略/露械；RE 取 currentRe（步损折减）回退印刷 re；
// 13.8d 的"路径可通行"由调用方注入 passable（地形/天气代价），未注入时只有同格算作可任工程。

import { TTW_HEDGEHOG_MAX_LEVEL } from '../ttw/campaign/fortification.ts'
import type { CampaignAirfieldBoard } from './campaign-airfield.ts'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignHedgehog, CampaignHedgehogBoard, CampaignHedgehogWorker } from './campaign-hedgehogs.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignEngineeringDefinition {
  combat: boolean
  engineer: boolean
  re: number
}
export type CampaignEngineeringCatalog = Readonly<Record<string, CampaignEngineeringDefinition>>

export interface CampaignEngineeringSources {
  catalog: CampaignEngineeringCatalog
  map: CampaignGroundMap & { neighbors(hex: string): readonly string[] }
  /** OCS 13.8d：工人到目标格的路径可通行（地形/天气代价注入）。 */
  passable?(state: Readonly<CampaignTurnState>, from: string, to: string): boolean
  printed?(state: Readonly<CampaignTurnState>, hex: string): CampaignHedgehog | null
  canPay?(state: Readonly<CampaignTurnState>, unitIds: readonly string[], hex: string): boolean
  /** 池中剩余跑道标记 key。 */
  airstripPool?(state: Readonly<CampaignTurnState>): readonly string[]
  maxLevel?: number
}

function engineerWorker(sources: CampaignEngineeringSources) {
  return (state: Readonly<CampaignTurnState>, id: string): CampaignHedgehogWorker | undefined => {
    const counter = state.counters[id]
    if (!counter || counter.location.kind !== 'map') return undefined
    const def = sources.catalog[counter.definition]
    if (!def) return undefined
    const hex = counter.location.hex
    const moved = state.groundMovement?.moved ?? []
    const stationary = (counter.mode ?? 'combat') === 'combat' && !moved.includes(id) &&
      counter.released !== true && counter.exploiting !== true
    const re = counter.currentRe ?? def.re
    return {
      hex, combat: def.combat, stationary, re,
      engineerAt(target: string): boolean {
        if (!def.engineer) return false
        const resolved = sources.map.resolveHex(target) ?? target
        if (sources.map.resolveHex(hex) === resolved) return true
        if (!sources.passable) return false
        let frontier: readonly string[] = [hex]
        const seen = new Set(frontier)
        for (let step = 0; step < 2; step++) {
          const next: string[] = []
          for (const from of frontier) for (const neighbor of sources.map.neighbors(from)) {
            if (seen.has(neighbor) || !sources.passable(state, from, neighbor)) continue
            if (neighbor === resolved) return true
            seen.add(neighbor)
            next.push(neighbor)
          }
          frontier = next
        }
        return false
      },
    }
  }
}

/** 由算子库派生工事/机场施工盘面（同一工人事实，两类劳动共用）。 */
export function campaignEngineeringBoards(sources: CampaignEngineeringSources):
  { hedgehogWork: CampaignHedgehogBoard; airfieldWork: CampaignAirfieldBoard } {
  const worker = engineerWorker(sources)
  return {
    hedgehogWork: { map: sources.map, worker,
      ...(sources.printed ? { printed: sources.printed } : {}),
      ...(sources.canPay ? { canPay: sources.canPay } : {}),
      maxLevel: sources.maxLevel ?? TTW_HEDGEHOG_MAX_LEVEL },
    airfieldWork: { map: sources.map, worker,
      ...(sources.airstripPool ? { airstripPool: sources.airstripPool } : {}),
      ...(sources.canPay ? { canPay: sources.canPay } : {}) },
  }
}
