// OCS 9.14b：战斗/移动单位进入敌军补给堆格时的立即夺取。
// 本文件只结清 dump；9.14c 的运输点需要原主选择余部位移，属于交互窗口，不能用自动猜测代替。

import { rollDie } from '@ocs-eastern/series/rng'
import type { Side } from '@ocs-eastern/series/state-types'
import { capturedAmount } from '@ocs-eastern/series/tables/capture'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignDumpCaptureBoard {
  /** 进入方是否至少有一个可攻击单位（9.14b 的资格条件）。 */
  attackCapable(state: Readonly<CampaignTurnState>, id: string): boolean
}

const opposite = (side: Side): Side => side === 'axis' ? 'soviet' : 'axis'

/**
 * 结算 9.14b 的敌方 dump 夺取。
 *
 * - 只读取 `state.supplyDumps[owner][hex]`；没有 dump 时不消耗 RNG。
 * - 夺取比例走 series 的 9.14b 向量表；余数摧毁，不退回原主。
 * - 不改 hexControl；控制点沉降仍由剧本 §5.0a 的 afterMove 处理。
 * - 9.14c 运输点、9.14e 工事和 9.14f 机场不在本文件；它们各自有交互/位移窗口。
 */
export function captureCampaignDump(state: Readonly<CampaignTurnState>, side: Side, hex: string,
  ids: readonly string[], board: CampaignDumpCaptureBoard): CampaignTurnState {
  const owner = opposite(side)
  const tokens = state.supplyDumps?.[owner]?.[hex] ?? 0
  if (!tokens) return state
  if (!ids.some((id) => board.attackCapable(state, id))) {
    throw new Error(`Entry into ${hex} with an enemy dump needs an attack-capable unit`)
  }
  const draw = rollDie(state.rng)
  const taken = capturedAmount(tokens, 'dump', draw.value)
  const ownerDumps = { ...(state.supplyDumps[owner] ?? {}) }
  delete ownerDumps[hex]
  const supplyDumps = { ...state.supplyDumps, [owner]: ownerDumps }
  if (taken) supplyDumps[side] = { ...supplyDumps[side], [hex]: (supplyDumps[side]?.[hex] ?? 0) + taken }
  return { ...state, rng: draw.rng, supplyDumps }
}
