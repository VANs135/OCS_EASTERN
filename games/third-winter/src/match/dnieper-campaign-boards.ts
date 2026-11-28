// 剧本 01 的最小生产盘面装配：地面移动、道路/HQ/铁路 trace、9.14c 运输点夺取、
// 9.14d 强制崩溃、12.7 延补队、2.4a 要塞铁路限制、4.8a 堆叠、2.3a Kessel 放置/免费移动、3.5a RVGK 标记铁路。战斗、空军、增援等仍由调用方注入，
// 避免用测试夹具冒充完整会话。
import type { Definition } from '../import/unit-catalog.ts'
import type { BackupUnit } from '../import/unit-backup.ts'
import type { TtwCampaignMapIndex } from '../import/campaign-map-index.ts'
import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignTurnContext } from './campaign-turn-state.ts'
import type { CampaignEntryAirBase } from './campaign-entry-capture.ts'
import { dnieperGroundMovementBoard, dnieperStackingBoard } from './dnieper-ground-movement.ts'
import { dnieperTransportCaptureBoard } from './dnieper-transport-capture.ts'
import { dnieperExtenderBoard } from './dnieper-extender.ts'
import { dnieperEdgeSupplySources, dnieperEdgeSupplySourcesForState } from './dnieper-edge-supply.ts'
import { dnieperRailBoard } from './dnieper-rail-board.ts'
import type { DnieperRailhead } from './dnieper-initial-gauge.ts'
import { campaignFortressBoards } from './campaign-fortress-board.ts'
import type { CampaignFortressHooks } from './campaign-fortress-board.ts'
import { campaignHqHooks, type CampaignHqCatalog } from './campaign-hq-boards.ts'
import { dnieperKesselBoard, dnieperKesselPlacementBoard } from './dnieper-kessel.ts'
import { dnieperRvgkMarkerBoard } from './dnieper-rvgk-marker.ts'

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
Pick<CampaignTurnContext, 'groundMovement' | 'transportCapture' | 'extenderWork' | 'stacking' | 'fortressBoard' | 'railTransport' | 'kesselPlacement' | 'kesselBoard' | 'rvgkMarker'> & {
  edgeSupplySourcesForTurn: (turn: number, state?: import('./campaign-turn-state.ts').CampaignTurnState) => Readonly<Record<Side, readonly string[]>>
} {
  const transportCapture = dnieperTransportCaptureBoard(input.playable, input.catalog.definitions)
  const edgeSupplySourcesForTurn = (turn: number, state?: import('./campaign-turn-state.ts').CampaignTurnState) =>
    state ? dnieperEdgeSupplySourcesForState(input.map, { ...state, turn }) : dnieperEdgeSupplySources(input.map, turn)
  let groundMovement: ReturnType<typeof dnieperGroundMovementBoard> | undefined
  const hasTrace = options.hasTrace ?? ((state: import('./campaign-turn-state.ts').CampaignTurnState, side: Side, hex: string) =>
    groundMovement?.traceSupply?.(state, side)?.network.hasTrace(hex, 'truck') === true)
  const extenderWork = dnieperExtenderBoard(input.playable, input.catalog.definitions, { hasTrace })
  groundMovement = dnieperGroundMovementBoard(input.playable, input.terrain, input.catalog.definitions,
    options.airBase, transportCapture, extenderWork, edgeSupplySourcesForTurn, input.railheads)
  const stacking = dnieperStackingBoard(input.playable, input.catalog.definitions)
  const fortressBoard = dnieperFortressBoards(input)
  const railTransport = dnieperRailBoard({
    map: input.playable,
    exitRefusal: fortressBoard.exitRefusal,
    hqRail: dnieperHqHooks(input.catalog.definitions).hqRail,
  })
  const kesselPlacement = dnieperKesselPlacementBoard(input.playable, input.catalog.definitions)
  const kesselBoard = dnieperKesselBoard(input.playable, input.terrain, input.catalog.definitions)
  const rvgkMarker = dnieperRvgkMarkerBoard({ playable: input.playable, terrain: input.terrain,
    groundMovement, railTransport, railheads: input.railheads?.map(({ hex }) => hex) })
  return {
    groundMovement, transportCapture, extenderWork, stacking, fortressBoard, railTransport,
    kesselPlacement, kesselBoard, rvgkMarker, edgeSupplySourcesForTurn,
  }
}

/** 01 真实 HQ 铁路事实：Army HQ 免起止站、Army Group HQ 仍需可卸载格；都按 1 RE。 */
function dnieperHqHooks(definitions: ReadonlyMap<string, Definition<BackupUnit>>) {
  const catalog: CampaignHqCatalog = Object.fromEntries([...definitions].map(([key, definition]) => [key, {
    hqKind: definition.source.hqKind,
    catalogKind: definition.kind,
    railOnly: definition.source.railOnly,
    railCapRe: definition.source.railCapRe,
    mustBeCity: definition.source.mustBeCity,
  }]))
  return campaignHqHooks(catalog)
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
