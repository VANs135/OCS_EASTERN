// 剧本 01 的最小生产盘面装配：只装地面移动、道路/HQ 补给 trace、9.14c 运输点夺取、
// 9.14d 强制崩溃、12.7 延补队与 4.8a 堆叠。战斗、空军、增援等仍由调用方注入，
// 避免用测试夹具冒充完整会话；铁路 trace 因 01 尚无核准轨距台账暂未开。
import type { Definition } from '../import/unit-catalog.ts'
import type { BackupUnit } from '../import/unit-backup.ts'
import type { TtwCampaignMapIndex } from '../import/campaign-map-index.ts'
import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignTurnContext } from './campaign-turn-state.ts'
import type { CampaignEntryAirBase } from './campaign-entry-capture.ts'
import { dnieperGroundMovementBoard, dnieperStackingBoard } from './dnieper-ground-movement.ts'
import { dnieperTransportCaptureBoard } from './dnieper-transport-capture.ts'
import { dnieperExtenderBoard } from './dnieper-extender.ts'
import { dnieperEdgeSupplySources } from './dnieper-edge-supply.ts'

type Playable = ReturnType<typeof import('../ttw/campaign/play-area.ts').campaignMapInPlayArea>
type Terrain = ReturnType<typeof import('../import/campaign-terrain.ts').campaignTerrain>

export interface DnieperCampaignBoardsInput {
  playable: Playable
  map: TtwCampaignMapIndex
  terrain: Terrain
  catalog: { definitions: ReadonlyMap<string, Definition<BackupUnit>> }
}

export interface DnieperCampaignBoardsOptions {
  airBase?: CampaignEntryAirBase
  hasTrace?: (state: import('./campaign-turn-state.ts').CampaignTurnState, side: Side, hex: string) => boolean
}

/** 01 的移动/后勤生产板集合；返回片段可直接展开进 CampaignTurnContext。 */
export function dnieperCampaignBoards(input: DnieperCampaignBoardsInput, options: DnieperCampaignBoardsOptions = {}):
Pick<CampaignTurnContext, 'groundMovement' | 'transportCapture' | 'extenderWork' | 'stacking'> & {
  edgeSupplySourcesForTurn: (turn: number) => Readonly<Record<Side, readonly string[]>>
} {
  const transportCapture = dnieperTransportCaptureBoard(input.playable, input.catalog.definitions)
  const edgeSupplySourcesForTurn = (turn: number) => dnieperEdgeSupplySources(input.map, turn)
  let groundMovement: ReturnType<typeof dnieperGroundMovementBoard> | undefined
  const hasTrace = options.hasTrace ?? ((state: import('./campaign-turn-state.ts').CampaignTurnState, side: Side, hex: string) =>
    groundMovement?.traceSupply?.(state, side)?.network.hasTrace(hex, 'truck') === true)
  const extenderWork = dnieperExtenderBoard(input.playable, input.catalog.definitions, { hasTrace })
  groundMovement = dnieperGroundMovementBoard(input.playable, input.terrain, input.catalog.definitions,
    options.airBase, transportCapture, extenderWork, edgeSupplySourcesForTurn)
  const stacking = dnieperStackingBoard(input.playable, input.catalog.definitions)
  return { groundMovement, transportCapture, extenderWork, stacking, edgeSupplySourcesForTurn }
}
