// 剧本 01 普通地面移动板：真实地图、地形、单位机动档与 9.14b/9.14e 进格夺取。
// 09 的工厂把进格夺取固定成“不需要解析”；01 必须保留 resolveEntry，让进格后
// 的 dump/hedgehog 夺取真实发生。补给 trace 与 4.8a 段末堆叠另由调用方补 board。

import type { Definition } from '../import/unit-catalog.ts'
import type { BackupUnit } from '../import/unit-backup.ts'
import { campaignHqHooks } from './campaign-hq-boards.ts'
import type { CampaignHqCatalog } from './campaign-hq-boards.ts'
import { resolveCampaignEntryCapture, type CampaignEntryAirBase } from './campaign-entry-capture.ts'
import { createCampaignOrdinaryMovementBoard } from './campaign-movement-board.ts'
import { campaignMovementProfiles } from './campaign-movement-profiles.ts'
import type { CampaignStackingBoard } from './campaign-stacking.ts'
import { campaignOverstackedHexes } from './campaign-stacking.ts'

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
  catalog: ReadonlyMap<string, Definition<BackupUnit>>, airBase?: CampaignEntryAirBase) {
  const definitions: Record<string, Definition<BackupUnit>> = Object.fromEntries(catalog)
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
    profileOf,
    moveProfile: profiles.moveProfile,
    terrainAt: (hex) => terrain.terrainAt(hex),
    crossingAt: (_state, _id, from, to) => terrain.crossingAt(from, to),
    entryRequiresResolution: () => false,
    resolveEntry: (state, side, hex, ids) => resolveCampaignEntryCapture(state, side, hex, ids,
      { attackCapable: (current, id) => profiles.profileOf(current, id)?.attackCapable === true, airBase }),
    railOnly: hq.railOnly,
    // OCS 4.8a：段末必须满足每格 10 RE 上限；超堆叠返回 blocker，交给调用方整枚
    // 战斗算子移除（本板只报告，不擅自替玩家选择损失）。
    endBlockers: (state, side) => stackingBlockers(state, side),
  })
}
