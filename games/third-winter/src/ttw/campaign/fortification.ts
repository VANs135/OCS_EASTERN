// TTW 工事/设施专规规则层（批次 7/B10，纯函数；原文 E:\OCS\工作文件\ttw_exclusive_text.txt）。
// 刺猬战斗/炮击 DRM 与奇袭 −1 已在 series tables（ground-combat/barrage）；本模块表达 TTW 专规约束。
// §1.1b：刺猬不得建超 Level-2；被夺取时降一级。
// §2.4a：要塞宣告（轴心控城市＋敌战斗单位 2 格内＋可用池有要塞单位；罗马尼亚要塞仅限境内）。
// §2.2h：简易机场（OCS 15.2）被攻击能力苏军占领即回池，可重建。

/** §1.1b：刺猬建造上限等级。 */
export const TTW_HEDGEHOG_MAX_LEVEL = 2

/** §1.1b：建造目标等级是否合法（1..2）。 */
export function ttwHedgehogBuildLevelValid(level: number): boolean {
  return Number.isInteger(level) && level >= 1 && level <= TTW_HEDGEHOG_MAX_LEVEL
}

/** §1.1b：被夺取后降一级（不低于 0）。 */
export function ttwHedgehogCaptureReducedLevel(level: number): number {
  return Number.isFinite(level) && level > 0 ? Math.max(0, Math.floor(level) - 1) : 0
}

/** §2.4a：宣告要塞时随附的刺猬等级。 */
export const FORTRESS_DECLARATION_HEDGEHOG_LEVEL = 1

/** §2.4a：可放第二要塞单位（无额外刺猬）的城市。 */
export const FORTRESS_SECOND_UNIT_CITIES: readonly string[] = ['Odessa', 'Kiev', 'Poltava']

/** §2.4a：要塞宣告资格。罗马尼亚要塞单位仅限罗马尼亚境内。 */
export function fortressDeclarationEligible(facts: {
  axisControlsCity: boolean
  enemyCombatWithin2: boolean
  fortressInAvailablePool: boolean
  isRumanianFortress?: boolean
  withinRumania?: boolean
}): boolean {
  if (!facts.axisControlsCity || !facts.enemyCombatWithin2 || !facts.fortressInAvailablePool) return false
  if (facts.isRumanianFortress && !facts.withinRumania) return false
  return true
}

/** §2.4a：该城市是否允许第二要塞单位。 */
export function fortressSecondUnitAllowed(city: string): boolean {
  return FORTRESS_SECOND_UNIT_CITIES.includes(city)
}

/** §2.4a：要塞状态终止＝城市每格均苏控。 */
export function fortressStatusEnds(facts: { everyCityHexSovietControlled: boolean }): boolean {
  return facts.everyCityHexSovietControlled
}

/** §2.2h：简易机场被攻击能力苏军占领即回池（可重建）。 */
export function airStripCapturedToPool(facts: { occupiedByAttackCapableSoviet: boolean }): boolean {
  return facts.occupiedByAttackCapableSoviet
}