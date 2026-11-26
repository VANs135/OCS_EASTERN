// TTW §2.3b–e 轴心 HQ 本体（专规）。铁路移动结算复用 series rail-transport（绑定层）；
// 本模块表达 HQ 本体的移动/补给/工程/重建/恢复掷骰口径。

export const ARMY_HQ_RAIL_RE = 1
export const ARMY_GROUP_HQ_RAIL_RE = 1
/** §2.3b B：每回合"机场/Army/Army Group HQ"补给中至多 3 SP 可放在每个轴心 Army HQ。 */
export const ARMY_HQ_SUPPLY_CAP_PER_TURN = 3
/** §2.3c D：Army Group HQ 移动时可携带 1 SP。 */
export const ARMY_GROUP_HQ_CARRY_SP = 1
/** §2.3b E：每摧毁一个轴心 Army HQ，苏军 +1 VP。 */
export const SOVIET_VP_PER_ARMY_HQ_DESTROYED = 1

/** §2.3b A / §2.3c A：Army/Army Group HQ 只能铁路移动（各计 1 RE 铁路运量）。 */
export function axisHqRailOnly(byRail: boolean): boolean {
  return byRail
}
/** §2.3b A：Army HQ 铁路移动的起/止格不必可卸载。 */
export function armyHqDetrainableRequired(): boolean {
  return false
}
/** §2.3c A：Army Group HQ 必须位于大/小城市格。 */
export function armyGroupHqValidHex(facts: { majorOrMinorCity: boolean }): boolean {
  return facts.majorOrMinorCity
}
/** §2.3b C / §2.3c C：Army HQ 可工程；Army Group HQ 不可工程。 */
export function armyHqEngineerCapable(): boolean {
  return true
}
export function armyGroupHqEngineerCapable(): boolean {
  return false
}
/** §2.3b D：Army HQ 被迫撤退即毁。 */
export function armyHqDestroyedOnRetreat(forcedRetreat: boolean): boolean {
  return forcedRetreat
}
/** §2.3b E：Army HQ 被毁后下一轴心增援阶段免费重建（回到任意 Army HQ）。 */
export function armyHqRebuildFree(): boolean {
  return true
}

/** §2.3c D：Army Group HQ 战斗模式下每回合一次，把移动阶段开始时与其同格的 1 SP 放到 throw 内任意格（无需运输点）。 */
export function armyGroupSpPlacement(facts: { combatMode: boolean; spStackedAtMovementStart: boolean; withinThrow: boolean }): boolean {
  return facts.combatMode && facts.spStackedAtMovementStart && facts.withinThrow
}
/** §2.3c D：移动模式下不得借此创建特殊补给堆。 */
export function armyGroupMayCreateSpecialDump(mode: 'combat' | 'move'): boolean {
  return mode === 'combat'
}

/** §2.3d：德国 Corps HQ 被消灭掷 1 骰——1-3 下一轴心增援阶段免费重建（任意 Army/Army Group HQ），4-6 入死亡堆。 */
export function corpsHqRecovery(die: number): 'rebuilt' | 'dead' {
  if (!Number.isInteger(die) || die < 1 || die > 6) throw new Error('Corps HQ recovery requires a 1-6 die')
  return die <= 3 ? 'rebuilt' : 'dead'
}

/** §2.3e：德国 HQ 可补给任意轴心单位。 */
export function germanHqMaySupplyAnyAxis(): boolean {
  return true
}