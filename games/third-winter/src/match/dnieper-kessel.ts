// 剧本 01 的 Kessel 盘面事实：Kessel 识别、放置落点、免费移动的格侧事实与东西向坐标。
// 规则判定仍在 campaign-kessel / campaign-kessel-placement 与 ttw/kessel-hq；本文件只把 01 的真实地图、
// 算子库和当前局面接进去，不复制规则。

import type { Definition } from '../import/unit-catalog.ts'
import type { BackupUnit } from '../import/unit-backup.ts'
import type { Terrain } from '../import/scorpion-map.ts'
import { ttwOrdinaryTerrainCost } from '../ttw/ground-terrain.ts'
import { campaignCounterGroundMode, campaignGroundPosition } from './campaign-ground-position.ts'
import { campaignMovementProfiles } from './campaign-movement-profiles.ts'
import { campaignVolgaBridgeCostState } from './campaign-volga-bridges.ts'
import type { CampaignKesselBoard } from './campaign-kessel.ts'
import type { CampaignKesselPlacementBoard } from './campaign-kessel-placement.ts'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

type PlayableMap = CampaignGroundMap & { terrainAt(hex: string): readonly Terrain[] }
type TerrainFacts = ReturnType<typeof import('../import/campaign-terrain.ts').campaignTerrain>

function columnOf(hex: string): number {
  const dot = hex.lastIndexOf('.')
  return Number(hex.slice(1, dot))
}

function isKessel(state: Readonly<CampaignTurnState>, id: string, definitions: ReadonlyMap<string, Definition<BackupUnit>>, ability: string): boolean {
  const counter = state.counters[id]
  if (!counter) return false
  const source = definitions.get(counter.definition)?.source
  return source?.abilities?.includes(ability) === true
}

/** Same inert-profile fallback as the 01 movement board: fortresses/air HQs print no move face. */
function dnieperProfileOf(definitions: ReadonlyMap<string, Definition<BackupUnit>>,
  profiles: ReturnType<typeof campaignMovementProfiles>) {
  return (state: Readonly<CampaignTurnState>, id: string) => {
    const existing = profiles.profileOf(state, id)
    if (existing) return existing
    const counter = state.counters[id]
    if (!counter) return undefined
    const definition = definitions.get(counter.definition)
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
}

/** §2.3a 放置/移除：真实 Kessel HQ 与 01 地图上的友方战斗单位。 */
export function dnieperKesselPlacementBoard(map: PlayableMap,
  catalog: ReadonlyMap<string, Definition<BackupUnit>>): CampaignKesselPlacementBoard {
  const profiles = campaignMovementProfiles(Object.fromEntries(catalog))
  const profileOf = dnieperProfileOf(catalog, profiles)
  return {
    resolveHex: (hex) => map.resolveHex(hex),
    isKesselHq: (state, id) => isKessel(state, id, catalog, 'kessel_supply'),
    friendlyCombatAt: (state, hex) => Object.entries(state.counters).some(([id, counter]) =>
      counter.side === 'axis' && counter.location.kind === 'map' && counter.location.hex === hex
      && profileOf(state, id)?.combat === true),
  }
}

/** §2.3a B 免费移动：Kessel 识别、当前模式/机动、格侧成本与 EZOC、东西向。 */
export function dnieperKesselBoard(map: PlayableMap, terrain: TerrainFacts,
  catalog: ReadonlyMap<string, Definition<BackupUnit>>): CampaignKesselBoard {
  const profiles = campaignMovementProfiles(Object.fromEntries(catalog))
  const profileOf = dnieperProfileOf(catalog, profiles)
  return {
    isKesselHq: (state, id) => isKessel(state, id, catalog, 'kessel_free_move'),
    unit: (state, id) => {
      const counter = state.counters[id]
      const profile = profileOf(state, id)
      if (!counter || !profile) return undefined
      const mode = counter.mode === 'reserve' || counter.mode === 'strat'
        ? counter.mode
        : campaignCounterGroundMode(counter, profile.inCombatMode).face
      return { mode, mobility: profile.moveMobility }
    },
    step: (state, _id, from, to) => {
      const ground = state.weather?.ground
      const crossing = terrain.crossingAt(from, to)
      const terrains = map.terrainAt(to)
      const cost = crossing && ground ? ttwOrdinaryTerrainCost(terrains, crossing, 'leg', ground) : null
      const adjusted = crossing?.barrier === 'volga'
        ? campaignVolgaBridgeCostState(state, crossing, from, to)
        : crossing
      const position = campaignGroundPosition(state, 'axis', map, profileOf)
      return {
        costAll: cost === null || cost === 'all',
        unbridgedVolga: adjusted?.barrier === 'volga' && adjusted.bridge === 'none',
        unnegatedEzoc: position ? position.unnegatedEnemyZoc.has(to) : true,
      }
    },
    easting: (hex) => columnOf(map.resolveHex(hex) ?? hex),
  }
}
