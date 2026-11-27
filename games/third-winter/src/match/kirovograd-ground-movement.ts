import type { Mobility } from '@ocs-eastern/series/ground-map'
import type { Definition } from '../import/unit-catalog.ts'
import type { BackupUnit } from '../import/unit-backup.ts'
import type { loadKirovogradScenario } from '../import/kirovograd-scenario.ts'
import { ttwOrdinaryTerrainCost } from '../ttw/ground-terrain.ts'
import { campaignControlRecorder } from './campaign-control.ts'
import { campaignHqHooks } from './campaign-hq-boards.ts'
import type { CampaignHqCatalog } from './campaign-hq-boards.ts'
import { createCampaignOrdinaryMovementBoard } from './campaign-movement-board.ts'
import type { CampaignGroundMovementBoard } from './campaign-movement-board.ts'
import { campaignMovementProfiles } from './campaign-movement-profiles.ts'
import type { CampaignRailNetwork } from './campaign-rail-network.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'
import { kirovogradReleaseRule } from './kirovograd-release.ts'

type KirovogradData = Awaited<ReturnType<typeof loadKirovogradScenario>>

/**
 * Scenario 9 ordinary ground movement, assembled from the real map, terrain,
 * catalog and opening rail network. Trace uses the edge supply sources stored in
 * the opening (`edgeSupplySources`) plus the printed rail unloading sites.
 * HQ throw supply is not injected here yet; it must be added when the real HQ
 * facts adapter lands, rather than guessed from the catalog.
 */
export function kirovogradGroundMovementBoard(data: KirovogradData, railNetwork?: CampaignRailNetwork): CampaignGroundMovementBoard {
  const catalog = Object.fromEntries(data.catalog.definitions) as Record<string, Definition<BackupUnit>>
  const profiles = campaignMovementProfiles(catalog)
  const hq = campaignHqHooks(hqCatalog(catalog))
  const city = data.map.resolveHex(data.kirovogradHex) ?? data.kirovogradHex
  const recordCity = campaignControlRecorder(new Set([city]))
  const traceCost = (state: Readonly<CampaignTurnState>, from: string, to: string, mobility: Mobility) => {
    const ground = state.weather?.ground
    if (!ground || ground === 'thaw') return null
    const crossing = data.terrain.crossingAt(from, to)
    const terrain = data.terrain.terrainAt(to)?.filter((item) => item !== 'Village')
    if (!crossing || crossing.barrier === 'volga' || !terrain?.length) return null
    return ttwOrdinaryTerrainCost(terrain, crossing, mobility, ground)
  }
  return createCampaignOrdinaryMovementBoard({
    map: data.map, railNetwork,
    profileOf: profiles.profileOf, moveProfile: profiles.moveProfile,
    terrainAt: (hex) => data.terrain.terrainAt(hex),
    crossingAt: (_state, _id, from, to) => data.terrain.crossingAt(from, to),
    entryRequiresResolution: () => false,
    releases: kirovogradReleaseRule({ map: data.map, definitions: data.catalog.definitions, kirovogradHex: data.kirovogradHex }),
    railOnly: hq.railOnly,
    afterMove: recordCity,
    supply: {
      traceCost,
      facts: (state, side) => ({
        sources: new Set<string>(),
        controlled: new Set(Object.entries(state.hexControl ?? {}).filter(([, owner]) => owner === side).map(([hex]) => hex)),
        headquarters: [], extenders: [],
        detrainable: (hex) => hasPrintedRail(data.map, hex),
      }),
    },
  })
}

function hqCatalog(catalog: Record<string, { kind: string; source: { hqKind?: string; railOnly?: boolean; railCapRe?: number; mustBeCity?: boolean } }>): CampaignHqCatalog {
  return Object.fromEntries(Object.entries(catalog).map(([key, definition]) => [key, {
    hqKind: definition.source.hqKind,
    catalogKind: definition.kind,
    railOnly: definition.source.railOnly,
    railCapRe: definition.source.railCapRe,
    mustBeCity: definition.source.mustBeCity,
  }]))
}

function hasPrintedRail(map: KirovogradData['map'], hex: string) {
  return map.neighbors(hex).some((to) =>
    map.connection(hex, to)?.sourceEdges.some((edge) => edge.rail_present === true) === true)
}
