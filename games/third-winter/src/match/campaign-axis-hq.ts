// TTW §2.3c D Army Group HQ 放 SP 绑定（判定复用 ttw/axis-hq.ts；几何复用 campaignHexesWithin）。
// 战斗模式下每回合一次，把移动阶段开始时与其同格的 1 SP 放到 throw 内任意格（无需运输点）。
// HQ 识别/战斗模式/移动阶段初同格 SP/throw 半径由调用方注入；每 HQ 每回合一次（账本）。

import { armyGroupSpPlacement, armyGroupMayCreateSpecialDump } from '../ttw/axis-hq.ts'
import { campaignHexesWithin } from '../ttw/campaign/hex-range.ts'
import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export type CampaignAxisHqAction = { type: 'army-group-place-sp'; hqId: string; targetHex: string }
export interface CampaignAxisHqFacts {
  isArmyGroupHq: boolean
  combatMode: boolean
  /** 移动阶段开始时与该 HQ 同格有 ≥1 SP（快照事实）。 */
  spStackedAtMovementStart: boolean
  hqHex: string
  throwRadius: number
}

/** UI 只读投影：在图 Army Group HQ 与本回合是否已放 SP。 */
export function campaignAxisHqOptions(state: Readonly<CampaignTurnState>, side: Side,
  facts: (state: Readonly<CampaignTurnState>, id: string) => CampaignAxisHqFacts | undefined) {
  if (side !== 'axis') return null
  const groups = Object.entries(state.counters)
    .filter(([id, c]) => c.side === 'axis' && c.location.kind === 'map' && facts(state, id)?.isArmyGroupHq)
    .map(([id, c]) => ({ id, hex: (c.location as { hex: string }).hex, placedThisTurn: state.armyGroupSpPlaced?.[id] === state.turn }))
  return { groups }
}

/** §2.3c D：Army Group HQ 战斗模式每回合一次放 1 SP 到 throw 内任意格。 */
export function applyCampaignArmyGroupSp(state: Readonly<CampaignTurnState>, side: Side,
  action: CampaignAxisHqAction, map: CampaignGroundMap,
  facts: (state: Readonly<CampaignTurnState>, id: string) => CampaignAxisHqFacts | undefined): CampaignTurnState {
  const cursor = state.cursor
  if (!('phasing' in cursor) || cursor.phase !== 'movement' || cursor.phasing !== 'axis' || side !== 'axis' ||
    state.movementSegment !== 'movement') throw new Error('Army Group SP placement is in the Axis movement phase')
  const counter = state.counters[action.hqId]
  const info = facts(state, action.hqId)
  if (!counter || counter.side !== 'axis' || counter.location.kind !== 'map' || !info?.isArmyGroupHq) {
    throw new Error('Choose an on-map Axis Army Group HQ')
  }
  if (state.armyGroupSpPlaced?.[action.hqId] === state.turn) throw new Error('This Army Group HQ has already placed SP this turn')
  const target = map.resolveHex(action.targetHex)
  const hqHex = map.resolveHex(info.hqHex)
  if (!target || !hqHex) throw new Error('Choose resolvable HQ and target hexes')
  const withinThrow = campaignHexesWithin(map, hqHex, info.throwRadius).includes(target)
  if (!armyGroupSpPlacement({ combatMode: info.combatMode, spStackedAtMovementStart: info.spStackedAtMovementStart, withinThrow })) {
    throw new Error('Army Group SP placement requires Combat Mode, SP stacked at movement start, and a target within throw')
  }
  if (!armyGroupMayCreateSpecialDump('combat')) throw new Error('Army Group SP placement requires Combat Mode')
  const axisDumps = state.supplyDumps.axis ?? {}
  // supplyDumps 以 token 计（1 SP = 4 token）；放 1 SP 即搬 4 token。
  const tokens = 4
  if ((axisDumps[hqHex] ?? 0) < tokens) throw new Error('The Army Group HQ hex has no SP to place')
  const dumps = { ...axisDumps, [hqHex]: axisDumps[hqHex]! - tokens, [target]: (axisDumps[target] ?? 0) + tokens }
  if (dumps[hqHex] === 0) delete dumps[hqHex]
  return { ...state, supplyDumps: { ...state.supplyDumps, axis: dumps },
    armyGroupSpPlaced: { ...state.armyGroupSpPlaced, [action.hqId]: state.turn } }
}