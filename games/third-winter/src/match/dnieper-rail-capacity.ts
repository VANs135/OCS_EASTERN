// 剧本 01 铁路运力：轴心固定 10，苏军按 TTW_Soviet_OOA 的日期在 6/24/58 回合提高。
// 只提供数值表；路线、货种与占用仍由 campaign-rail-transport 的 railTransport board 结算。

import type { Side } from '@ocs-eastern/series/state-types'

export const DNEPER_RAIL_CAPACITY_AXIS = 10

export function dnieperRailCapacity(side: Side, turn: number): number {
  if (!Number.isInteger(turn) || turn < 1 || turn > 63) throw new Error(`Scenario 01 turn out of range: ${turn}`)
  if (side === 'axis') return DNEPER_RAIL_CAPACITY_AXIS
  if (turn < 6) return 7
  if (turn < 24) return 7.5
  if (turn < 58) return 8
  return 8.5
}
