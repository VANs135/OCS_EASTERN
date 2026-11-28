// 进入敌军格的非交互夺取组合：9.14b dump + 9.14e 工事 + 可选 9.14f 机场。
// 9.14c 运输点仍需交互窗口；9.14f 需要玩家提交幸存飞机落点，由调用方把机场板与落点放进 board.airBase。

import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignAirBaseCaptureBoard, CampaignAirBaseCaptureOptions } from './campaign-airbase-capture.ts'
import { captureCampaignAirBase } from './campaign-airbase-capture.ts'
import { captureCampaignDump } from './campaign-dump-capture.ts'
import { captureCampaignHedgehog, type CampaignHedgehog } from './campaign-hedgehogs.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignEntryAirBase {
  board: CampaignAirBaseCaptureBoard
  /** 玩家提交的幸存飞机落点；多基地时缺省会拒绝代选。 */
  options?: CampaignAirBaseCaptureOptions
}

export interface CampaignEntryCaptureBoard {
  attackCapable(state: Readonly<CampaignTurnState>, id: string): boolean
  printedHedgehog?(state: Readonly<CampaignTurnState>, hex: string): CampaignHedgehog | null
  /** 提供时在 dump/工事之后结算 9.14f；缺省保持原样，不自动代选机场。 */
  airBase?: CampaignEntryAirBase
}

/** 按 9.14b → 9.14e →（可选）9.14f 的顺序结算；任一对象不存在时原样返回。 */
export function resolveCampaignEntryCapture(state: Readonly<CampaignTurnState>, side: Side, hex: string,
  ids: readonly string[], board: CampaignEntryCaptureBoard): CampaignTurnState {
  const afterDump = captureCampaignDump(state, side, hex, ids, board)
  const afterHedgehog = captureCampaignHedgehog(afterDump, side, hex, ids, {
    attackCapable: board.attackCapable,
    printed: board.printedHedgehog,
  })
  return board.airBase
    ? captureCampaignAirBase(afterHedgehog, side, hex, ids, board.airBase.board, board.airBase.options)
    : afterHedgehog
}
