import type { Mobility, StepCost } from '@ocs-eastern/series/ground-map'
import type { ScorpionMap } from '../../import/scorpion-map.ts'
import { scorpionHexId } from '../../import/hex-id.ts'
import { ttwGroundCellCost, ttwOrdinaryTerrainCost } from '../ground-terrain.ts'

/** OCS 6.1d and 6.2. Supply callers can ask for Normal costs separately. */
export function scorpionStepCost(
  map: ScorpionMap, from: string, to: string, mobility: Mobility, weather: 'dry' | 'freeze', useRoutes = true,
): StepCost {
  const edge = map.edge(from, to)
  if (!edge) return null
  const a = map.hexes.get(scorpionHexId(from))
  const b = map.hexes.get(scorpionHexId(to))
  if (!a || !b) return null
  const route = useRoutes && (!edge.river || edge.bridge) ? edge.road ?? (edge.rail && 'rail') : null
  if (!route && ttwGroundCellCost(a.terrains, mobility, weather) === null) return null
  return ttwOrdinaryTerrainCost(b.terrains, { barrier: edge.river ?? 'none', routes: route ? [route] : [] }, mobility, weather)
}
