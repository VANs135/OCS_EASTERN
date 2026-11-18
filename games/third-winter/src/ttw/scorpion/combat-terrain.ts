import type { CrtTerrain } from '@ocs-eastern/series/tables/crt'
import type { DeployedCounter } from '../../import/scorpion-deployment.ts'
import type { Terrain } from '../../import/scorpion-map.ts'

export type AttackTerrain = Terrain | 'minor-river' | 'major-river'
type Multipliers = readonly [armor: number, mech: number, other: number]
type TerrainCombat = { crt: CrtTerrain; attack: Multipliers; defense?: Multipliers }

// TTW Terrain Effects Chart. Parenthesized multipliers apply only to the attacker.
const terrainCombat: Readonly<Record<Terrain, TerrainCombat>> = {
  Open: { crt: 'Open', attack: [2, 2, 1] },
  Hills: { crt: 'Close', attack: [1, 1, 1] },
  Woods: { crt: 'Close', attack: [1, 1, 1] },
  Forest: { crt: 'Close', attack: [1 / 2, 1, 1], defense: [1 / 2, 1, 1] },
  Rough: { crt: 'Very Close', attack: [1 / 2, 1 / 2, 1] },
  Mountain: { crt: 'Extr Close', attack: [1 / 3, 1 / 2, 1], defense: [1 / 3, 1, 1] },
  Swamp: { crt: 'Very Close', attack: [1 / 2, 1 / 2, 1], defense: [1 / 2, 1 / 2, 1] },
  Village: { crt: 'Close', attack: [1, 1, 1] },
  'Minor City': { crt: 'Very Close', attack: [1 / 2, 1 / 2, 1], defense: [1 / 2, 1, 1] },
  'Major City': { crt: 'Extr Close', attack: [1 / 3, 1 / 2, 1], defense: [1 / 3, 1, 1] },
}

const classIndex = { armor: 0, mech: 1, other: 2 } as const

export function combatTerrainCategory(terrain: Terrain) {
  return terrainCombat[terrain].crt
}

export function combatStrength(unit: DeployedCounter, attacking: boolean, terrain: AttackTerrain,
  frozen: boolean, supplied: boolean, enemyAntiTank: number): number {
  const artilleryDivision = !attacking && unit.artillery?.independentRe
  const strength = artilleryDivision ? unit.printedRe - unit.stepsLost : unit.strength
  const base = strength * (unit.disorganized ? 0.5 : 1) * (unit.outOfSupply ? 0.5 : 1) *
    (!attacking && unit.reserve ? 0.5 : 1)
  const steps = !artilleryDivision && ((attacking && unit.stepsLost > 0) ||
    (!attacking && unit.stepsLost > 0 && unit.stepsLost >= unit.printedRe / 2))
  const index = classIndex[unit.combatClass]
  let list: Multipliers | undefined
  if (terrain === 'minor-river') list = frozen ? [0.5, 1, 1] : [0.5, 0.5, 0.5]
  else if (terrain === 'major-river') list = frozen ? [0.5, 0.5, 0.5] : [0.25, 1 / 3, 0.5]
  else list = attacking ? terrainCombat[terrain].attack : terrainCombat[terrain].defense
  const terrainFactor = list?.[index] ?? 1
  const factor = attacking && terrainFactor === 2 && unit.antiTank > 0 && enemyAntiTank >= unit.antiTank ? 1.5 : terrainFactor
  return base * (steps ? 0.5 : 1) * (supplied ? 1 : 0.5) * factor
}

export function combatRating(unit: DeployedCounter) {
  return unit.actionRating - (unit.disorganized ? 1 : 0)
}
