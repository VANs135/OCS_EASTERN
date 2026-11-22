import type { Mobility } from '@ocs-eastern/series/ground-map'
import type { Terrain } from '../../import/scorpion-map.ts'
import { ttwGroundCellCost, ttwOrdinaryTerrainCost } from '../ground-terrain.ts'
import type { TtwOrdinaryCrossing } from '../ground-terrain.ts'

export interface TtwVolgaCrossing {
  barrier: 'volga'
  bridge: 'none' | 'intact' | 'blown' | 'repaired'
  /** The actual printed road or railway across the bridge. */
  routes: TtwOrdinaryCrossing['routes']
}

export const volgaHexsidePhaseLimitRe = 3

/** TTW 1.4b and 1.5a, Axis Player Booklet p.8. This handles ordinary, non-rail-ferry movement. */
export function ttwVolgaMovementCost(terrain: readonly Terrain[], crossing: TtwVolgaCrossing, mobility: Mobility,
  ground: 'dry' | 'freeze' | 'mud', ice: boolean, friendlyFerry: boolean) {
  if (crossing.bridge === 'intact' || crossing.bridge === 'repaired') {
    return crossing.routes.length ? ttwOrdinaryTerrainCost(terrain, { barrier: 'major', routes: crossing.routes }, mobility, ground) : null
  }
  if (mobility !== 'leg' || !(ice || crossing.bridge === 'blown' || friendlyFerry)) return null
  return ttwGroundCellCost(terrain, mobility, ground) === null ? null : 'all'
}
