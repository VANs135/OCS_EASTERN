// 剧本 01 的最小生产盘面装配：只装地面移动、运输点夺取、延补队与 4.8a 堆叠。
// 补给 trace、战斗、空军、增援等仍由调用方注入，避免用测试夹具冒充完整会话。
import type { Definition } from '../import/unit-catalog.ts'
import type { BackupUnit } from '../import/unit-backup.ts'
import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignTurnContext } from './campaign-turn-state.ts'
import type { CampaignEntryAirBase } from './campaign-entry-capture.ts'
import { dnieperGroundMovementBoard, dnieperStackingBoard } from './dnieper-ground-movement.ts'
import { dnieperTransportCaptureBoard } from './dnieper-transport-capture.ts'
import { dnieperExtenderBoard } from './dnieper-extender.ts'

type Playable = ReturnType<typeof import('../ttw/campaign/play-area.ts').campaignMapInPlayArea>
type Terrain = ReturnType<typeof import('../import/campaign-terrain.ts').campaignTerrain>

export interface DnieperCampaignBoardsInput {
  playable: Playable
  terrain: Terrain
  catalog: { definitions: ReadonlyMap<string, Definition<BackupUnit>> }
}

export interface DnieperCampaignBoardsOptions {
  airBase?: CampaignEntryAirBase
  hasTrace?: (state: import('./campaign-turn-state.ts').CampaignTurnState, side: Side, hex: string) => boolean
}

/** 01 的移动/后勤生产板集合；返回片段可直接展开进 CampaignTurnContext。 */
export function dnieperCampaignBoards(input: DnieperCampaignBoardsInput, options: DnieperCampaignBoardsOptions = {}):
Pick<CampaignTurnContext, 'groundMovement' | 'transportCapture' | 'extenderWork' | 'stacking'> {
  const transportCapture = dnieperTransportCaptureBoard(input.playable, input.catalog.definitions)
  const extenderWork = dnieperExtenderBoard(input.playable, input.catalog.definitions, { hasTrace: options.hasTrace })
  const groundMovement = dnieperGroundMovementBoard(input.playable, input.terrain, input.catalog.definitions,
    options.airBase, transportCapture)
  const stacking = dnieperStackingBoard(input.playable, input.catalog.definitions)
  return { groundMovement, transportCapture, extenderWork, stacking }
}
