import type { Mobility, StepCost } from '@ocs-eastern/series/ground-map'
import type { ScorpionMap, Terrain } from '../../import/scorpion-map.ts'
import { scorpionHexId } from '../../import/hex-id.ts'

type Costs = readonly [StepCost, StepCost, StepCost]
const mobilityIndex = { track: 0, truck: 1, leg: 2 } as const

// TTW TEC, Axis Player Booklet p.8. Freeze matches Dry except Swamp and rivers.
const dry: Readonly<Record<Terrain, Costs>> = {
  Open: [1, 1, 1], Hills: [1, 2, 1], Woods: [2, 3, 1], Forest: [3, 4, 2],
  Rough: [3, 5, 2], Mountain: [null, null, 'all'], Swamp: [null, null, 3],
  Village: [0, 0, 0], 'Minor City': [1, 1, 1], 'Major City': [1, 1, 1],
}

function hexCost(terrains: readonly Terrain[], index: number, freeze: boolean): StepCost {
  let highest: StepCost = 0
  for (const terrain of terrains) {
    const cost = (freeze && terrain === 'Swamp' ? [5, 6, 3] : dry[terrain])[index]!
    if (cost === null) return null
    if (cost === 'all') highest = 'all'
    else if (highest !== 'all') highest = Math.max(highest, cost)
  }
  return highest
}

/** OCS 6.1d and 6.2. Supply callers can ask for Normal costs separately. */
export function scorpionStepCost(
  map: ScorpionMap, from: string, to: string, mobility: Mobility, weather: 'dry' | 'freeze', useRoutes = true,
): StepCost {
  const edge = map.edge(from, to)
  if (!edge) return null
  if (useRoutes && (!edge.river || edge.bridge) && (edge.road || edge.rail)) {
    return edge.road === 'road' ? 0.5 : 1
  }
  const a = map.hexes.get(scorpionHexId(from))
  const b = map.hexes.get(scorpionHexId(to))
  if (!a || !b) return null
  const index = mobilityIndex[mobility]
  const freeze = weather === 'freeze'
  const cost = hexCost(b.terrains, index, freeze)
  if (cost === null || hexCost(a.terrains, index, freeze) === null) return null
  if (!edge.river) return cost
  if (edge.river === 'major' && !freeze) return mobility === 'leg' ? 'all' : null
  const riverCost: readonly [number, number, number] = edge.river === 'major' ? [4, 6, 2] :
    freeze ? [2, 3, 0] : [3, 5, 1]
  return cost === 'all' ? cost : cost + riverCost[index]
}
