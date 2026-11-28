// 剧本 01 的普通在图铁路运输 board：运力按剧本日期表，路线轨距/连通由 groundMovement 的 railNetwork 判定。
// 剧本未给额外的控制格阻断；敌战斗单位、ZOC 已由 campaign-rail-transport 的 position 检查。

import { inTrainbustingZone } from '@ocs-eastern/series/trainbusting'
import type { CampaignRailBoard } from './campaign-rail-transport.ts'
import { dnieperRailCapacity } from './dnieper-rail-capacity.ts'
import type { TtwCampaignMapIndex } from '../import/campaign-map-index.ts'

export interface DnieperRailBoardInput {
  map: Pick<TtwCampaignMapIndex, 'neighbors'>
  /** TTW §2.4a：城内轴心单位不得自愿铁路出城。 */
  exitRefusal?: (state: import('./campaign-turn-state.ts').CampaignTurnState, id: string, from: string, to: string) => string | null
  /** TTW §2.3b/c：轴心 Army/Army Group HQ 的铁路特例。 */
  hqRail?: (state: import('./campaign-turn-state.ts').CampaignTurnState, id: string) => { railRe: number; waiveDetrainable: boolean } | undefined
}

export function dnieperRailBoard(input: DnieperRailBoardInput): CampaignRailBoard {
  return {
    capacity: (state, side) => dnieperRailCapacity(side, state.turn),
    ordinaryCargo: (state, id) => state.counters[id] !== undefined,
    controlBlocksAt: () => false,
    trainbustingAt: (state, side, hex) =>
      inTrainbustingZone(state.trainbusting ?? [], side, hex, input.map.neighbors, 'rail'),
    ...(input.exitRefusal ? { exitRefusal: input.exitRefusal } : {}),
    ...(input.hqRail ? { hqRail: input.hqRail } : {}),
  }
}
