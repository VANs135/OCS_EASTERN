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

/** 计量口径：1 SP = 4 token（放置站点配额以 token 计）。 */
export const TOKENS_PER_SP = 4

/** 放置站点类别（供 supplyPlacementPlan 站点 min/max 配额消费）。 */
export type TtwSupplySiteKind = 'axis-air-base' | 'axis-army-hq' | 'axis-army-group-hq' | 'soviet-front-hq' | 'soviet-fixed-hex'

/**
 * 由站点类别派生放置配额（token）。poolTokens 为该池可放总量，用作无专规上限站点的 max。
 * §2.3b B：轴心 Army HQ 每站 ≤3 SP；§2.3c B：Army Group HQ 得该池余额（无每站上限）；
 * §3.1b：苏军每 Front HQ 强制 ≥2 SP，固定城市格无强制下限。
 */
export function ttwSupplySiteQuota(kind: TtwSupplySiteKind, poolTokens: number): { minTokens: number; maxTokens: number } {
  const pool = Number.isSafeInteger(poolTokens) && poolTokens >= 0 ? poolTokens : 0
  switch (kind) {
    case 'axis-army-hq': return { minTokens: 0, maxTokens: Math.min(AXIS_ARMY_HQ_SP_CAP * TOKENS_PER_SP, pool) }
    case 'soviet-front-hq': return { minTokens: Math.min(SOVIET_FRONT_HQ_MANDATORY_SP * TOKENS_PER_SP, pool), maxTokens: pool }
    case 'axis-air-base':
    case 'axis-army-group-hq':
    case 'soviet-fixed-hex': return { minTokens: 0, maxTokens: pool }
  }
}