// TTW 补给额度与落点约束（批次 8 规则层，纯函数；原文 E:\OCS\工作文件\ttw_exclusive_text.txt）。
// §2.3b B：每个轴心 Army HQ 每回合最多放 3 SP（"Air Bases, Army or Army Group HQs" 补给）。
// §2.3c D：集团军群 HQ 移动时可携 1 SP；特殊堆仅战斗模式可放（移动模式禁）。
// §3.1b：每个 Front HQ 必放 2 SP；剩余 SP 任意分配于 Front HQ 格/固定城市格/Map D 南缘道路铁路格（苏控）。

/** §2.3b B：轴心 Army HQ 每回合补给放置上限（SP）。 */
export const AXIS_ARMY_HQ_SP_CAP = 3
/** §3.1b：每个 Front HQ 强制放置（SP）。 */
export const SOVIET_FRONT_HQ_MANDATORY_SP = 2
/** §2.3c D：集团军群 HQ 移动携带上限（SP）。 */
export const ARMY_GROUP_CARRY_SP = 1

/** §3.1b：剩余 SP 的固定合法城市格（Kharkov/Kiev 及所列格）。任意 Front HQ 格另计。 */
export const SOVIET_FIXED_SUPPLY_HEXES: readonly string[] = ['B59.10', 'B5.24', 'B16.35', 'B2.35', 'A50.34', 'A25.35']

/** §2.3b B：放置量是否在上限内。 */
export function axisArmyHqSpWithinCap(sp: number): boolean {
  return Number.isFinite(sp) && sp >= 0 && sp <= AXIS_ARMY_HQ_SP_CAP
}

/** §3.1b：每个 Front HQ 是否都已放足强制 2 SP。 */
export function sovietFrontMandatoryMet(fronts: readonly { sp: number }[]): boolean {
  return fronts.every((front) => front.sp >= SOVIET_FRONT_HQ_MANDATORY_SP)
}

/** §3.1b：剩余 SP 落点合法性＝任意 Front HQ 格、固定城市格、或 Map D 南缘道路/铁路格且苏控。 */
export function sovietRemainingSpValidHex(facts: {
  isFrontHqHex: boolean
  isFixedHex: boolean
  isMapDSouthEdgeRoadRail: boolean
  sovietControl: boolean
}): boolean {
  return facts.isFrontHqHex || facts.isFixedHex || (facts.isMapDSouthEdgeRoadRail && facts.sovietControl)
}

/** §2.3c D：集团军群携带量是否在上限内。 */
export function armyGroupCarryWithinCap(sp: number): boolean {
  return Number.isFinite(sp) && sp >= 0 && sp <= ARMY_GROUP_CARRY_SP
}

/** §2.3c D：特殊堆仅战斗模式可放（移动模式禁）。 */
export function armyGroupSpecialDumpAllowed(mode: 'combat' | 'move'): boolean {
  return mode === 'combat'
}