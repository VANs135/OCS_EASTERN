import type { Mobility, StepCost } from '@ocs-eastern/series/ground-map'
import { mostExpensiveGroundTerrain, selectGroundTerrainCost } from '@ocs-eastern/series/ground-terrain'
import type { Terrain } from '../import/scorpion-map.ts'

type Costs = readonly [StepCost, StepCost, StepCost]
type GroundCondition = 'dry' | 'freeze' | 'mud'
const mobilityIndex = { track: 0, truck: 1, leg: 2 } as const

// TTW Terrain Effects Chart, Axis Player Booklet p.8. Columns are Track, Truck and Leg.
const dry: Record<Terrain, Costs> = {
  Open: [1, 1, 1], Hills: [1, 2, 1], Woods: [2, 3, 1], Forest: [3, 4, 2],
  Rough: [3, 5, 2], Mountain: [null, null, 'all'], Swamp: [null, null, 3],
  Village: [0, 0, 0], 'Minor City': [1, 1, 1], 'Major City': [1, 1, 1],
}
const freeze: Record<Terrain, Costs> = { ...dry, Swamp: [5, 6, 3] }
const mud: Record<Terrain, Costs> = {
  ...dry, Open: [3, 8, 2], Hills: [2, 6, 1], Woods: [6, 'all', 2], Forest: ['all', 'all', 2],
  Rough: [4, 6, 2], Swamp: [null, null, 4],
}
const groundCosts = { dry, freeze, mud }

export interface TtwOrdinaryCrossing {
  barrier: 'none' | 'minor' | 'major' | 'blocked'
  /** Provide only routes that are usable on this hexside, including the bridge state. */
  routes: readonly ('road' | 'track' | 'rail')[]
}

export function ttwGroundCellCost(terrains: readonly Terrain[], mobility: Mobility, ground: GroundCondition): StepCost {
  return mostExpensiveGroundTerrain(terrains.map((terrain) => groundCosts[ground][terrain][mobilityIndex[mobility]]))
}

/** Ordinary hexsides. Volga-class and ferry traffic use separate TTW crossing rules. */
export function ttwOrdinaryTerrainCost(terrains: readonly Terrain[], crossing: TtwOrdinaryCrossing,
  mobility: Mobility, ground: GroundCondition): StepCost {
  const { barrier } = crossing
  const index = mobilityIndex[mobility]
  const minor: Costs = ground === 'freeze' ? [2, 3, 0] : [3, 5, 1]
  const major: Costs = ground === 'freeze' ? [4, 6, 2] : [null, null, 'all']
  const hexside = barrier === 'minor' ? minor[index] : barrier === 'major' ? major[index] : barrier === 'blocked' ? null : 0
  const routes = crossing.routes.map((route) => ground === 'mud' ? (route === 'road' ? (mobility === 'truck' ? 2 : 1)
    : mobility === 'truck' ? 4 : 1) : route === 'road' ? 0.5 : 1)
  return selectGroundTerrainCost(ttwGroundCellCost(terrains, mobility, ground), hexside, routes)
}
