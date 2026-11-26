// TTW §3.5 RVGK（最高统帅部战略预备队盒，专规）。铁路/trace 结算复用 series rail-transport / supply-network（绑定层）；
// 重建目的地路由已在 ttw/campaign/rebuild.ts（苏军→rvgk）。本模块表达盒/标记/最低编成/出入盒判定口径。

export const RVGK_MARKER_RAIL_RE = 5
export const RVGK_MARKER_AXIS_DISTANCE = 10
export const RVGK_ENTER_DISTANCE = 20
export const RVGK_FORCED_EXIT_DISTANCE = 5
export const RVGK_FORCED_EXIT_PLACE_RADIUS = 3
export const RVGK_RELEASE_DISTANCE = 5
export const RVGK_INDEPENDENT_RE_PER_TANK_HQ = 5

export type RvgkBox = 'rvgk-1' | 'rvgk-2'
/** §3.5a：RVGK-1 标记始终在 Map C/D，RVGK-2 在 Map A/B。 */
export function rvgkMarkerMaps(box: RvgkBox): readonly string[] {
  return box === 'rvgk-1' ? ['C', 'D'] : ['A', 'B']
}

/** §3.5b：两盒合计最低编成。 */
export const RVGK_MINIMUMS = { tankMechCorps: 6, cavalryCorps: 1, artyKatyDivisions: 2, infantryDivisions: 3, tankArmyHq: 1 } as const
export type RvgkCounts = Record<keyof typeof RVGK_MINIMUMS, number>
export function rvgkMinimumsMet(counts: RvgkCounts): { ok: boolean; missing: readonly string[] } {
  const missing = (Object.keys(RVGK_MINIMUMS) as (keyof typeof RVGK_MINIMUMS)[])
    .filter((key) => counts[key] < RVGK_MINIMUMS[key])
  return { ok: missing.length === 0, missing }
}
/** §3.5b：多单位编队计入最低编成的条件——至少 1 单位在盒（哪怕编内卡车），其余在盒或死亡堆，无人在图。 */
export function rvgkFormationCounts(facts: { anyUnitInBox: boolean; restInBoxOrDead: boolean; noneOnMap: boolean }): boolean {
  return facts.anyUnitInBox && facts.restInBoxOrDead && facts.noneOnMap
}

/** §3.5a：标记仅铁路移动、止于可卸载格、不得进入/穿过距轴心战斗单位 10 格内（Kessel 补给者忽略，由调用方筛）。 */
export function rvgkMarkerRailValid(facts: { detrainableEnd: boolean; within10AxisCombat: boolean }): boolean {
  return facts.detrainableEnd && !facts.within10AxisCombat
}

/** §3.5c：苏军增援阶段，距标记 ≤20 格且能以战略模式抵达的在图单位可入盒（无燃油消耗）。 */
export function rvgkEnterEligible(facts: { sovietReinforcementPhase: boolean; within20: boolean; stratReachable: boolean }): boolean {
  return facts.sovietReinforcementPhase && facts.within20 && facts.stratReachable
}
/** §3.5c：盒内单位自动 trace 补给；盒内不得合并（OCS 13.9）。 */
export function rvgkAutoTraceSupply(): boolean {
  return true
}
export function rvgkConsolidationAllowed(): boolean {
  return false
}

/** §3.5d A：轴心战斗单位进入标记 5 格内，盒内全部单位立即放到标记 3 格内（Kessel 补给者忽略）。 */
export function rvgkForcedExit(facts: { axisCombatWithin5: boolean }): boolean {
  return facts.axisCombatWithin5
}

/** §3.5d B：苏军移动阶段开始释放——距标记 ≤5 格、维持最低编成、军/多步单位满编、本回合未入盒；
 *  独立单位须与一个同时出盒的坦克集团军 HQ 一起（每 HQ ≤5 RE）。 */
export function rvgkReleaseEligible(facts: {
  sovietMovementStart: boolean
  within5: boolean
  minimumsMaintained: boolean
  fullStrength: boolean
  enteredThisTurn: boolean
  independent: boolean
  withTankArmyHq: boolean
  independentRe: number
}): boolean {
  if (!facts.sovietMovementStart || !facts.within5 || !facts.minimumsMaintained || facts.enteredThisTurn) return false
  if (!facts.fullStrength) return false
  if (facts.independent) return facts.withTankArmyHq && facts.independentRe <= RVGK_INDEPENDENT_RE_PER_TANK_HQ
  return true
}