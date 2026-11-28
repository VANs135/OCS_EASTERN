// OCS 4.8a：移动阶段末每格 10 RE 上限；超堆叠时由玩家选择整枚战斗算子移出。
// 规则本身只判断 RE 与“整枚移除”，具体损失路径交给 campaign-combat-losses。

import type { Side } from '@ocs-eastern/series/state-types'
import { applyCampaignCombatLosses, type CampaignLossBoard } from './campaign-combat-losses.ts'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export const CAMPAIGN_STACKING_LIMIT_RE = 10

export interface CampaignStackingBoard {
  map: CampaignGroundMap
  /** 该算子是否计入地面堆叠（战斗单位；运输/飞机不计）。 */
  combatOf(state: Readonly<CampaignTurnState>, id: string): boolean
  losses: CampaignLossBoard
}

export interface CampaignStackingAction {
  type: 'settle-campaign-stacking'
  hex: string
  /** 玩家选择整枚移出的战斗算子。 */
  unitIds: readonly string[]
}

export interface CampaignStackingHex {
  hex: string
  re: number
  limit: number
  candidates: readonly { unitId: string; re: number }[]
}

function stackRe(state: Readonly<CampaignTurnState>, id: string): number {
  const counter = state.counters[id]
  if (!counter || counter.location.kind !== 'map') return 0
  return Math.max(0, counter.currentRe ?? 0)
}

/** 4.8a：返回该方所有超 10 RE 的格与可整枚移除的候选。 */
export function campaignOverstackedHexes(state: Readonly<CampaignTurnState>, side: Side,
  board: CampaignStackingBoard): CampaignStackingHex[] {
  const hexes = new Map<string, CampaignStackingHex>()
  for (const [unitId, counter] of Object.entries(state.counters)) {
    if (counter.side !== side || counter.location.kind !== 'map' || !board.combatOf(state, unitId)) continue
    const re = stackRe(state, unitId)
    if (re <= 0) continue
    const hex = board.map.resolveHex(counter.location.hex) ?? counter.location.hex
    const stack = hexes.get(hex) ?? { hex, re: 0, limit: CAMPAIGN_STACKING_LIMIT_RE, candidates: [] }
    const next = { ...stack, re: stack.re + re, candidates: [...stack.candidates, { unitId, re }] }
    hexes.set(hex, next)
  }
  return [...hexes.values()].filter((stack) => stack.re > stack.limit)
}

/**
 * 4.8a：从指定超堆叠格移除玩家选择的整枚战斗算子，直到 ≤10 RE。
 * 选择不足或选中非本格候选时拒绝，不改局面。
 */
export function settleCampaignStacking(state: Readonly<CampaignTurnState>, side: Side,
  action: CampaignStackingAction, board: CampaignStackingBoard): CampaignTurnState {
  const hex = board.map.resolveHex(action.hex)
  if (!hex) throw new Error('Choose an on-map overstacked hex')
  const stack = campaignOverstackedHexes(state, side, board).find((candidate) => candidate.hex === hex)
  if (!stack) throw new Error('That hex is not overstacked')
  const ids = new Set(action.unitIds)
  if (!ids.size || ids.size !== action.unitIds.length) throw new Error('Choose distinct whole combat units')
  const chosen = stack.candidates.filter((candidate) => ids.has(candidate.unitId))
  if (chosen.length !== ids.size) throw new Error('Choose combat units from that overstacked hex')
  const removedRe = chosen.reduce((sum, candidate) => sum + candidate.re, 0)
  if (stack.re - removedRe > stack.limit) {
    throw new Error(`Choose enough whole combat units to reach ${stack.limit} RE`)
  }
  const allocation = new Map<string, number>()
  for (const { unitId } of chosen) {
    const steps = board.losses.stepsOf(state, unitId)
    if (steps === undefined || steps < 1) throw new Error('The chosen unit has no removable combat step')
    allocation.set(unitId, steps)
  }
  return applyCampaignCombatLosses(state, allocation, board.losses)
}
