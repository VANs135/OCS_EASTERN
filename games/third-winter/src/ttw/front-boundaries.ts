// TTW §3.3b 方面军边界与 Army HQ 编属（专规）。边界几何（哪些格属哪个方面军）属剧本数据
// （Q07 留交互设计），本模块只表达编属/最低编成/补给越界的判定口径，几何以谓词/事实注入。

export const FRONT_MIN_ARMY_HQS = 4

/** §3.3b C：每方面军最低编成——≥4 个已编属且在边界内的 Army HQ，且各有一个坦克军、机步/骑兵军、炮兵/喀秋莎师
 *  位于"指挥半径内已编属 Army HQ"的 throw 范围内。无上限。 */
export interface FrontMinimumFacts {
  assignedArmyHqsInBoundary: number
  tankCorpsInThrow: boolean
  mechOrCavCorpsInThrow: boolean
  artyOrKatyDivisionInThrow: boolean
}
export function frontMinimumComposition(facts: FrontMinimumFacts): { ok: boolean; missing: readonly string[] } {
  const missing: string[] = []
  if (facts.assignedArmyHqsInBoundary < FRONT_MIN_ARMY_HQS) missing.push('army-hqs')
  if (!facts.tankCorpsInThrow) missing.push('tank-corps')
  if (!facts.mechOrCavCorpsInThrow) missing.push('mech-or-cav-corps')
  if (!facts.artyOrKatyDivisionInThrow) missing.push('arty-or-katy-division')
  return { ok: missing.length === 0, missing }
}

/** §3.3b B：增援阶段所有 Army HQ 必须编属某方面军；编属固定到下一增援阶段。 */
export function armyHqAssignmentComplete(armyHqs: readonly { assigned: boolean }[]): boolean {
  return armyHqs.every((hq) => hq.assigned)
}

/** §3.3b E：位于 Front HQ 指挥半径内的补给不得运出方面军边界；例外＝随编队行动的编内卡车 ≤1 SP。 */
export function frontBoundarySupplyMayLeave(facts: {
  sourceWithinCommandRadius: boolean
  crossesBoundary: boolean
  organicTruckWithFormation: boolean
  tokens: number
}): boolean {
  if (!facts.crossesBoundary) return true
  if (!facts.sourceWithinCommandRadius) return true
  return facts.organicTruckWithFormation && facts.tokens <= 1
}

/** §3.3b E：已编属 HQ 不得越边界 draw/throw 补给（trace 本身不受边界影响，另行判定）。 */
export function assignedHqMayDrawAcrossBoundary(): boolean {
  return false
}