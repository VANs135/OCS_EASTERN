// TTW §2.2b Luftflotte HQ 一次性空运补给绑定（判定复用 ttw/luftflotte-hq.ts；几何复用 campaignHexesWithin）。
// 每局一次在 60 格内友军格放 SP（机场 2／非机场 1），非空中任务、不受敌空军/EZOC 影响。
// HQ 当前格与目标格分类（友军/机场）由调用方注入；空运时点窗口由绑定层按专规收紧。

import { LUFTFLOTTE_AIRLIFT_RANGE, luftflotteAirlift } from '../ttw/luftflotte-hq.ts'
import { campaignHexesWithin } from '../ttw/campaign/hex-range.ts'
import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export type CampaignLuftflotteAction = { type: 'airlift-campaign-luftflotte'; targetHex: string }
export type LuftflotteFacts = (state: Readonly<CampaignTurnState>, targetHex: string) =>
  { hqHex: string; friendlyHex: boolean; airBase: boolean } | undefined

/** UI 只读投影：本局空运是否已用。 */
export function campaignLuftflotteOptions(state: Readonly<CampaignTurnState>, side: Side) {
  if (side !== 'axis') return null
  return { airliftUsed: state.luftflotteAirliftUsed === true, available: state.luftflotteAirliftUsed !== true }
}

/** §2.2b：每局一次空运补给到 60 格内友军格。 */
export function applyCampaignLuftflotteAirlift(state: Readonly<CampaignTurnState>, side: Side,
  action: CampaignLuftflotteAction, map: CampaignGroundMap, facts: LuftflotteFacts): CampaignTurnState {
  const cursor = state.cursor
  if (!('phasing' in cursor) || cursor.phasing !== 'axis' || side !== 'axis') throw new Error('Luftflotte airlift is an Axis action')
  const target = map.resolveHex(action.targetHex)
  const info = facts(state, action.targetHex)
  if (!target || !info) throw new Error('Choose a resolvable target hex with Luftflotte facts')
  const within60 = campaignHexesWithin(map, info.hqHex, LUFTFLOTTE_AIRLIFT_RANGE).includes(target)
  const verdict = luftflotteAirlift({ usedThisGame: state.luftflotteAirliftUsed === true, friendlyHex: info.friendlyHex, within60, airBase: info.airBase })
  if (!verdict.ok) throw new Error('The airlift is already used, or the target is not a friendly hex within 60 hexes')
  const axisDumps = state.supplyDumps.axis ?? {}
  const dumps = { ...axisDumps, [target]: (axisDumps[target] ?? 0) + verdict.sp }
  return { ...state, supplyDumps: { ...state.supplyDumps, axis: dumps }, luftflotteAirliftUsed: true }
}