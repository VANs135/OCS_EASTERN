// TTW §2.3a Kessel HQ（轴心专属，斯摩棱斯克无对应实现，按英文活规则原文实现）。
// 移动/模式口径复用 series 通规（Leg MA、战斗/移动模式）；几何（东西向、格侧成本）由调用方注入。

export const KESSEL_RETURN_TURNS = 3
export const KESSEL_FREE_MOVE_RADIUS = 2
export const KESSEL_FREE_MOVE_MAX_HEXES = 4
export const KESSEL_FLAK_DRM = 0

/** §2.3a：战斗/摧毁或主动移除后 3 回合可返回。 */
export function kesselReturnTurn(removedTurn: number): number {
  return removedTurn + KESSEL_RETURN_TURNS
}

/** §2.3a：仅在轴心增援阶段放置/移除；放置须与任意友军战斗单位同格（哪怕口袋/EZOC）。 */
export function kesselPlacementValid(facts: { axisReinforcementPhase: boolean; withFriendlyCombatUnit: boolean }): boolean {
  return facts.axisReinforcementPhase && facts.withFriendlyCombatUnit
}

/** §2.3a：防御值战斗模式 2、移动模式 1。 */
export function kesselDefenseStrength(mode: 'combat' | 'move'): number {
  return mode === 'combat' ? 2 : 1
}

/** §2.3a B：享受免费移动的单位须处于战斗/移动模式且用 Leg MA。 */
export function kesselFreeMoveUnitEligible(facts: { mode: 'combat' | 'move' | 'reserve' | 'strat'; mobility: string }): boolean {
  return (facts.mode === 'combat' || facts.mode === 'move') && facts.mobility === 'leg'
}

export interface KesselFreeMoveStep {
  /** 进入该格/格侧的 MP 成本为 All。 */
  costAll: boolean
  /** 未架桥或 Normal 伏尔加级河（不可借此法跨越）。 */
  unbridgedVolga: boolean
  /** 进入未被抵消的 EZOC。 */
  unnegatedEzoc: boolean
}

/**
 * §2.3a B：Kessel 免费移动路径校验（单位资格与"距 Kessel ≤2 格"由调用方先验）。
 * 限制：≤4 格；不得与常规移动/突袭合并（调用方保证独立行动）；遇 All 成本/未架桥伏尔加河/未抵消 EZOC 必须停止
 * （故该类步骤只能出现在路径末尾）；终点不得比起点更偏东。每回合只能从一个 Kessel 获益（账本由绑定层记）。
 */
export function kesselFreeMovePath(steps: readonly KesselFreeMoveStep[],
  facts: { startEast: number; endEast: number }): { ok: boolean; reason?: string } {
  if (steps.length > KESSEL_FREE_MOVE_MAX_HEXES) return { ok: false, reason: 'kessel-free-move-max-4-hexes' }
  for (let i = 0; i < steps.length - 1; i++) {
    const step = steps[i]!
    if (step.costAll || step.unbridgedVolga || step.unnegatedEzoc) return { ok: false, reason: 'kessel-free-move-must-stop' }
  }
  if (steps.some((s) => s.unbridgedVolga)) return { ok: false, reason: 'kessel-free-move-cannot-cross-volga' }
  if (facts.endEast > facts.startEast) return { ok: false, reason: 'kessel-free-move-no-further-east' }
  return { ok: true }
}