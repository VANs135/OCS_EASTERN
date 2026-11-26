import type { CrtTerrain } from '@ocs-eastern/series/tables/crt'
import type { Terrain } from '../import/scorpion-map.ts'

/** TTW 战斗地形：印刷地形或进攻方选择的河岸。 */
export type AttackTerrain = Terrain | 'minor-river' | 'major-river'
export type CombatClass = 'armor' | 'mech' | 'other'
type Multipliers = readonly [armor: number, mech: number, other: number]
type TerrainCombat = { crt: CrtTerrain; attack: Multipliers; defense?: Multipliers }

// TTW Terrain Effects Chart（战斗倍率）. Parenthesized multipliers apply only to the attacker.
// 本作共用数据层：瓶中蝎与全景战役都从这里取倍率，不再各自维护。
export const terrainCombat: Readonly<Record<Terrain, TerrainCombat>> = {
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

export function combatTerrainCategory(terrain: Terrain): CrtTerrain {
  return terrainCombat[terrain].crt
}

/** 中立战斗强度事实（OCS 9.5/9.11d + TTW TEC/1.6d）。模式系数由调用方从 series/modes 取。 */
export interface CombatStrengthFacts {
  attacking: boolean
  terrain: AttackTerrain
  frozen: boolean
  /** 已付战斗补给（OCS 9.5b）；未付 ×½ */
  supplied: boolean
  /** 守方反坦克值取 max(刺猬>0?2:0, 各守方 antiTank) */
  enemyAntiTank: number
  combatClass: CombatClass
  /** 印刷战斗值（炮兵师防御时改用当前 RE，见 artilleryDivision） */
  strength: number
  printedRe: number
  stepsLost: number
  antiTank: number
  /** 断补（OCS 9.5a）×½ */
  outOfSupply: boolean
  /** TTW 1.6d 苏军炮兵师/卡秋莎师（独立 RE 炮兵）：防御力＝当前 RE，不另按步损减半 */
  artilleryDivision: boolean
  attackFactor: number
  defenseFactor: number
}

/**
 * 战斗强度结算。来源：瓶中蝎已验收实现 scorpion/combat-terrain.ts combatStrength，
 * 上移为本作共用；倍率表与算法不变，只把单位档案改为注入事实。
 */
export function combatStrengthFromFacts(facts: CombatStrengthFacts): number {
  const artilleryDivision = !facts.attacking && facts.artilleryDivision
  const strength = artilleryDivision ? facts.printedRe - facts.stepsLost : facts.strength
  const base = strength * (facts.attacking ? facts.attackFactor : facts.defenseFactor) * (facts.outOfSupply ? 0.5 : 1)
  // OCS 9.11d：进攻有任何步损即减半；防御步损≥印刷一半才减半。炮兵师防御按当前 RE，不叠此减半。
  const steps = !artilleryDivision && ((facts.attacking && facts.stepsLost > 0) ||
    (!facts.attacking && facts.stepsLost > 0 && facts.stepsLost >= facts.printedRe / 2))
  const index = classIndex[facts.combatClass]
  let list: Multipliers | undefined
  if (facts.terrain === 'minor-river') list = facts.frozen ? [0.5, 1, 1] : [0.5, 0.5, 0.5]
  else if (facts.terrain === 'major-river') list = facts.frozen ? [0.5, 0.5, 0.5] : [0.25, 1 / 3, 0.5]
  else list = facts.attacking ? terrainCombat[facts.terrain].attack : terrainCombat[facts.terrain].defense
  const terrainFactor = list?.[index] ?? 1
  // 开阔地装甲/机步 ×2，守方反坦克≥攻方时降为 ×1.5。
  const factor = facts.attacking && terrainFactor === 2 && facts.antiTank > 0 && facts.enemyAntiTank >= facts.antiTank ? 1.5 : terrainFactor
  return base * (steps ? 0.5 : 1) * (facts.supplied ? 1 : 0.5) * factor
}