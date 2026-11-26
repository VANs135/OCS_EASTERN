// 瓶中蝎适配层：倍率表与强度算法已上移本作共用 ttw/combat-terrain.ts，
// 这里只把 DeployedCounter 映射为中立事实。
import { groundModeEffect } from '@ocs-eastern/series/modes'
import type { DeployedCounter } from '../../import/scorpion-deployment.ts'
import { scorpionGroundMode } from '../../import/scorpion-mode-face.ts'
import { combatStrengthFromFacts } from '../combat-terrain.ts'
import type { AttackTerrain } from '../combat-terrain.ts'

export type { AttackTerrain } from '../combat-terrain.ts'
export { combatTerrainCategory } from '../combat-terrain.ts'

export function combatStrength(unit: DeployedCounter, attacking: boolean, terrain: AttackTerrain,
  frozen: boolean, supplied: boolean, enemyAntiTank: number): number {
  const mode = groundModeEffect(scorpionGroundMode(unit))
  return combatStrengthFromFacts({
    attacking, terrain, frozen, supplied, enemyAntiTank,
    combatClass: unit.combatClass, strength: unit.strength, printedRe: unit.printedRe, stepsLost: unit.stepsLost,
    antiTank: unit.antiTank, outOfSupply: unit.outOfSupply === true,
    artilleryDivision: unit.artillery?.independentRe === true,
    attackFactor: mode.attackFactor, defenseFactor: mode.defenseFactor,
  })
}

export function combatRating(unit: DeployedCounter) {
  const mode = groundModeEffect(scorpionGroundMode(unit))
  return unit.actionRating * mode.actionRatingFactor + mode.actionRatingModifier
}