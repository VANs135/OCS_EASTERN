import type { StepCost } from './ground-map.ts'

// OCS 6.2a–d. From the terrain and hexside selection in Smolensk 5603e52, terrain.ts.
export function mostExpensiveGroundTerrain(costs: readonly StepCost[]): StepCost {
  if (!costs.length || costs.includes(null)) return null
  if (costs.includes('all')) return 'all'
  return Math.max(...costs as readonly number[])
}

export function selectGroundTerrainCost(hex: StepCost, hexside: StepCost, routes: readonly number[]): StepCost {
  if (routes.length) return Math.min(...routes)
  if (hex === null || hexside === null) return null
  if (hex === 'all' || hexside === 'all') return 'all'
  return hex + hexside
}
