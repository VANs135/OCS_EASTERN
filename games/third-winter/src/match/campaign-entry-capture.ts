// 进入敌军格的非交互夺取组合：9.14b dump + 9.14e 工事。
// 9.14c 运输点、9.14f 机场各自需要交互/机损窗口，不能在此自动结算。

import type { Side } from '@ocs-eastern/series/state-types'
import { captureCampaignDump } from './campaign-dump-capture.ts'
import { captureCampaignHedgehog, type CampaignHedgehog } from './campaign-hedgehogs.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignEntryCaptureBoard {
  attackCapable(state: Readonly<CampaignTurnState>, id: string): boolean
  printedHedgehog?(state: Readonly<CampaignTurnState>, hex: string): CampaignHedgehog | null
}

/** 按 9.14b → 9.14e 的顺序结算；任一对象不存在时原样返回。 */
export function resolveCampaignEntryCapture(state: Readonly<CampaignTurnState>, side: Side, hex: string,
  ids: readonly string[], board: CampaignEntryCaptureBoard): CampaignTurnState {
  const afterDump = captureCampaignDump(state, side, hex, ids, board)
  return captureCampaignHedgehog(afterDump, side, hex, ids, {
    attackCapable: board.attackCapable,
    printed: board.printedHedgehog,
  })
}
