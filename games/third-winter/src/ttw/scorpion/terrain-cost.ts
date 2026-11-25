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

// The normalized map is immutable. Each weather/mobility/direction has its own static cost.
const supplyCosts = new WeakMap<ScorpionMap, Map<string, StepCost>>()

export function scorpionTraceStepCost(map: ScorpionMap, from: string, to: string, mobility: Mobility, weather: 'freeze' | 'thaw'): StepCost {
  let costs = supplyCosts.get(map)
  if (!costs) {
    costs = new Map()
    supplyCosts.set(map, costs)
  }
  const key = `${weather}:${mobility}:${from}:${to}`
  const cached = costs.get(key)
  if (cached !== undefined) return cached
  const normal = scorpionStepCost(map, from, to, mobility, 'dry')
  let cost = normal
  if (weather === 'freeze') {
    const reduced = scorpionStepCost(map, from, to, mobility, 'freeze')
    if (typeof reduced === 'number') cost = typeof normal === 'number' ? Math.min(normal, reduced) : reduced
  }
  costs.set(key, cost)
  return cost
}
