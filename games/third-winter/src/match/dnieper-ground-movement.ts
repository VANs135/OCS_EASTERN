// 剧本 01 普通地面移动板：真实地图、地形、单位机动档与 9.14b/9.14e 进格夺取。
// 09 的工厂把进格夺取固定成“不需要解析”；01 必须保留 resolveEntry，让进格后
// 的 dump/hedgehog 夺取真实发生。补给 trace 已接道路/HQ、边缘源与剧本 01 书明轨距；
// 4.8a 段末堆叠另由调用方补 board。

import type { Definition } from '../import/unit-catalog.ts'
import type { BackupUnit } from '../import/unit-backup.ts'
import type { Mobility } from '@ocs-eastern/series/ground-map'
import { ttwOrdinaryTerrainCost } from '../ttw/ground-terrain.ts'
import { campaignHqHooks } from './campaign-hq-boards.ts'
import type { CampaignHqCatalog } from './campaign-hq-boards.ts'
import { campaignThrowHeadquarters } from './campaign-hq-supply.ts'
import { resolveCampaignEntryCapture, type CampaignEntryAirBase } from './campaign-entry-capture.ts'
import { beginCampaignTransportCapturesForPath } from './campaign-transport-capture.ts'
import type { CampaignTransportCaptureBoard } from './campaign-transport-capture.ts'
import { beginCampaignForcedExtenderCollapsesForPath } from './campaign-extender.ts'
import type { CampaignExtenderBoard } from './campaign-extender.ts'
import { createCampaignOrdinaryMovementBoard } from './campaign-movement-board.ts'
import { campaignMovementProfiles } from './campaign-movement-profiles.ts'
import { dnieperRailNetwork } from './dnieper-initial-gauge.ts'
import type { DnieperRailhead } from './dnieper-initial-gauge.ts'
import type { CampaignStackingBoard } from './campaign-stacking.ts'
import { campaignOverstackedHexes } from './campaign-stacking.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

/** 01 的 4.8a 结算板：真实战斗 profile＋整枚移除进 Dead Pile 的损失事实。 */
export function dnieperStackingBoard(map: ReturnType<typeof import('../ttw/campaign/play-area.ts').campaignMapInPlayArea>,
  catalog: ReadonlyMap<string, Definition<BackupUnit>>): CampaignStackingBoard {
  const profiles = campaignMovementProfiles(Object.fromEntries(catalog))
  return { map,
    combatOf: (state, id) => profiles.profileOf(state, id)?.combat === true,
    losses: { stepsOf: (state, id) => state.counters[id]?.location.kind === 'map'
      ? state.counters[id].currentRe : undefined } }
}

export function dnieperGroundMovementBoard(map: ReturnType<typeof import('../ttw/campaign/play-area.ts').campaignMapInPlayArea>,
  terrain: ReturnType<typeof import('../import/campaign-terrain.ts').campaignTerrain>,
  catalog: ReadonlyMap<string, Definition<BackupUnit>>, airBase?: CampaignEntryAirBase,
  transportCapture?: CampaignTransportCaptureBoard, extenderWork?: CampaignExtenderBoard,
  edgeSourcesForTurn?: (turn: number, state?: Readonly<CampaignTurnState>) => Readonly<Record<'axis' | 'soviet', readonly string[]>>,
  railheads?: readonly DnieperRailhead[]) {
  const definitions: Record<string, Definition<BackupUnit>> = Object.fromEntries(catalog)
  // TTW 1.2b：可卸载点是地图 POI 与剧本书明的 Railhead，不是每条有铁路的格。
  // 普通铁路格只按轨距/敌方单位与 ZOC 判通行，不持久记录逐格控制。
  const detrainableSites = new Set<string>((railheads ?? []).map(({ hex }) => map.resolveHex(hex) ?? hex))
  for (const hex of map.availableHexes) {
    if (map.terrainAt(hex)?.some((terrain) => terrain === 'Minor City' || terrain === 'Major City')) {
      detrainableSites.add(hex)
    }
  }
  const baseRailNetwork = railheads?.length ? dnieperRailNetwork({ map, railAt: terrain.railAt }, railheads) : undefined
  const railNetwork = baseRailNetwork && {
    ...baseRailNetwork,
    // 13.3f：换轨只能由带 rail_repair 能力的铁路工兵执行，普通单位不能改轨距。
    isRepairUnit: (state: Readonly<CampaignTurnState>, id: string) => {
      const counter = state.counters[id]
      return counter !== undefined && definitions[counter.definition]?.source.abilities?.includes('rail_repair') === true
    },
  }
  const profiles = campaignMovementProfiles(definitions)
  const hqCatalog: CampaignHqCatalog = Object.fromEntries(Object.entries(definitions).map(([key, definition]) => [key, {
    hqKind: definition.source.hqKind,
    catalogKind: definition.kind,
    railOnly: definition.source.railOnly,
    railCapRe: definition.source.railCapRe,
    mustBeCity: definition.source.mustBeCity,
  }]))
  const hq = campaignHqHooks(hqCatalog)
  // Air-army and Luftflotte HQ counters are on the map but have no printed ground
  // movement face. Fortresses likewise print no move allowance. They still count
  // for occupancy, so give them an inert profile.
  const profileOf = (state: Parameters<typeof profiles.profileOf>[0], id: string) => {
    const existing = profiles.profileOf(state, id)
    if (existing) return existing
    const counter = state.counters[id]
    if (!counter) return undefined
    const definition = catalog.get(counter.definition)
    if (counter.kind === 'air-army-hq' || counter.kind === 'luftflotte-hq') {
      return { combat: false, pontoon: false, attackCapable: false, inCombatMode: false, outOfSupply: false,
        moveMa: 0, moveMobility: 'leg' as const, drawMobility: 'leg' as const, singleTransportPoint: false }
    }
    if (counter.kind === 'land' && definition?.source.faces.combat?.stats.move === null) {
      return { combat: true, pontoon: false, attackCapable: false, inCombatMode: true, outOfSupply: false,
        moveMa: 0, moveMobility: 'leg' as const, drawMobility: 'leg' as const, singleTransportPoint: false }
    }
    return undefined
  }
  function stackingBlockers(state: Parameters<typeof profiles.profileOf>[0], side: 'axis' | 'soviet') {
    return campaignOverstackedHexes(state, side, dnieperStackingBoard(map, catalog))
      .map(({ hex, re }) => `overstack:${hex}:${re}`)
  }
  return createCampaignOrdinaryMovementBoard({
    map,
    railNetwork,
    profileOf,
    moveProfile: profiles.moveProfile,
    terrainAt: (hex) => terrain.terrainAt(hex),
    crossingAt: (_state, _id, from, to) => terrain.crossingAt(from, to),
    entryRequiresResolution: () => false,
    resolveEntry: (state, side, hex, ids, afterCombat = false) => resolveCampaignEntryCapture(state, side, hex, ids,
      { attackCapable: (current, id) => profiles.profileOf(current, id)?.attackCapable === true, airBase }, afterCombat),
    railOnly: hq.railOnly,
    // 生产补给 trace：2.1a/3.1a 的边缘源已在 `state.edgeSupplySources`，这里补地形成本、
    // 当前控制格、常规 HQ 投送与在图延补队；铁路用 01 书明轨距。D17.01 被苏军攻占后
    // D 图南缘提前转苏，由调用方传入的 `edgeSourcesForTurn` 按当前 `hexControl` 重算。
    supply: {
      traceCost: (state, from, to, mobility) => dnieperTraceCost(terrain, state, from, to, mobility),
      facts: (state, side) => ({
        edgeSources: edgeSourcesForTurn?.(state.turn, state)?.[side],
        sources: new Set<string>(),
        controlled: new Set(Object.entries(state.hexControl ?? {})
          .filter(([, owner]) => owner === side).map(([hex]) => hex)),
        headquarters: campaignThrowHeadquarters(state, definitions)
          .filter((headquarter) => headquarter.id !== undefined && state.counters[headquarter.id]?.side === side),
        detrainable: (hex) => detrainableSites.has(hex),
        railCanTrace: (from, to) => railheads?.length ? terrain.railAt(from, to) !== undefined : false,
        extenders: Object.values(state.counters).flatMap((counter) => counter.side === side &&
          counter.location.kind === 'map' && counter.specialTruckExtender
          ? [{ hex: counter.location.hex, range: counter.specialTruckExtender.range, mobility: 'truck' as const }]
          : []),
      }),
    },
    // OCS 9.14d：同路径先检查敌方延补队，按进入顺序挂起强制崩溃窗口；无合法落点则原地翻面。
    // 9.14c：随后逐格检查敌方运输点，按进入顺序挂起原主选择窗口。两者都不替玩家选择。
    afterMove: transportCapture || extenderWork ? (state, side, move) => {
      const attackCapable = (current: Readonly<Parameters<typeof profiles.profileOf>[0]>, id: string) =>
        profiles.profileOf(current, id)?.attackCapable === true
      const ids = move.movers.map((mover) => mover.id)
      let next = extenderWork
        ? beginCampaignForcedExtenderCollapsesForPath(state, side, move.path, ids, extenderWork, attackCapable)
        : state
      if (transportCapture) next = beginCampaignTransportCapturesForPath(next, side, move.path, ids,
        transportCapture, attackCapable)
      return next
    } : undefined,
    // OCS 4.8a：段末必须满足每格 10 RE 上限；超堆叠返回 blocker，交给调用方整枚
    // 战斗算子移除（本板只报告，不擅自替玩家选择损失）。
    endBlockers: (state, side) => stackingBlockers(state, side),
  })
}

function dnieperTraceCost(terrain: DnieperTerrain, state: Readonly<CampaignTurnState>, from: string, to: string,
  mobility: Mobility) {
  const ground = state.weather?.ground
  if (ground !== 'dry' && ground !== 'freeze' && ground !== 'mud') return null
  const crossing = terrain.crossingAt(from, to)
  const terrains = terrain.terrainAt(to)
  if (!crossing || crossing.barrier === 'volga' || !terrains?.length) return null
  return ttwOrdinaryTerrainCost(terrains, crossing, mobility, ground)
}

type PlayableMap = Parameters<typeof dnieperGroundMovementBoard>[0]
type DnieperTerrain = Parameters<typeof dnieperGroundMovementBoard>[1]
