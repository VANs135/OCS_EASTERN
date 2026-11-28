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
import type { DnieperRailhead } from './dnieper-initial-gauge.ts'
import { campaignFortressBoards } from './campaign-fortress-board.ts'
import type { CampaignFortressHooks } from './campaign-fortress-board.ts'

type Playable = ReturnType<typeof import('../ttw/campaign/play-area.ts').campaignMapInPlayArea>
type Terrain = ReturnType<typeof import('../import/campaign-terrain.ts').campaignTerrain>

export interface DnieperCampaignBoardsInput {
  playable: Playable
  map: TtwCampaignMapIndex
  terrain: Terrain
  catalog: { definitions: ReadonlyMap<string, Definition<BackupUnit>> }
  /** 01 印刷 Railhead；给出时启用书明轨距与铁路 trace。 */
  railheads?: readonly DnieperRailhead[]
}

export interface DnieperCampaignBoardsOptions {
  airBase?: CampaignEntryAirBase
  hasTrace?: (state: import('./campaign-turn-state.ts').CampaignTurnState, side: Side, hex: string) => boolean
}

/** 01 的移动/后勤生产板集合；返回片段可直接展开进 CampaignTurnContext。 */
export function dnieperCampaignBoards(input: DnieperCampaignBoardsInput, options: DnieperCampaignBoardsOptions = {}):
Pick<CampaignTurnContext, 'groundMovement' | 'transportCapture' | 'extenderWork' | 'stacking' | 'fortressBoard'> & {
  edgeSupplySourcesForTurn: (turn: number) => Readonly<Record<Side, readonly string[]>>
} {
  const transportCapture = dnieperTransportCaptureBoard(input.playable, input.catalog.definitions)
  const edgeSupplySourcesForTurn = (turn: number) => dnieperEdgeSupplySources(input.map, turn)
  let groundMovement: ReturnType<typeof dnieperGroundMovementBoard> | undefined
  const hasTrace = options.hasTrace ?? ((state: import('./campaign-turn-state.ts').CampaignTurnState, side: Side, hex: string) =>
    groundMovement?.traceSupply?.(state, side)?.network.hasTrace(hex, 'truck') === true)
  const extenderWork = dnieperExtenderBoard(input.playable, input.catalog.definitions, { hasTrace })
  groundMovement = dnieperGroundMovementBoard(input.playable, input.terrain, input.catalog.definitions,
    options.airBase, transportCapture, extenderWork, edgeSupplySourcesForTurn, input.railheads)
  const stacking = dnieperStackingBoard(input.playable, input.catalog.definitions)
  const fortressBoard = dnieperFortressBoards(input)
  return { groundMovement, transportCapture, extenderWork, stacking, fortressBoard, edgeSupplySourcesForTurn }
}

/** 01 真实要塞池：8 枚德军要塞＋1 枚罗军要塞，已上盘的 4 枚由 `fortressUnit` 自动排除。 */
function dnieperFortressBoards(input: DnieperCampaignBoardsInput): CampaignFortressHooks {
  const fortressUnits: { kind: 'german' | 'rumanian'; definition: string; re: number }[] = []
  for (const [definition, unit] of input.catalog.definitions) {
    if (unit.kind !== 'land' || unit.source.side !== 'axis') continue
    const name = unit.source.name
    const kind = /^Ge Fortress\b/.test(name) ? 'german' as const : /^Rum Fortress\b/.test(name) ? 'rumanian' as const : undefined
    if (!kind) continue
    const re = unit.source.re
    if (typeof re !== 'number' || !Number.isFinite(re) || re <= 0) throw new Error(`Invalid fortress RE: ${definition}`)
    fortressUnits.push({ kind, definition, re })
  }
  return campaignFortressBoards({
    map: input.playable,
    cityOf: (hex) => input.map.cityOf(hex),
    citySites: input.map.cities,
    isCombatUnit: (state, id) => state.counters[id]?.kind === 'land',
    fortressUnits,
    // 01 罗军要塞边界仍待专规图幅判定；缺省 false 会明确拒绝罗军宣告，不伪造境内。
    withinRumania: () => false,
  })
}
