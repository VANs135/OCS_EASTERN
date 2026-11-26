// TTW §2.4e 轴心 Kampfgruppe 战斗群标记（专规）。模式资格复用 series modes；加油/反应释放复用 series（绑定层）。
// KG 把分散德军单位组成临时多单位编队；本模块表达编成/豁免/反应能力口径。

export const KG_MAX_RE = 3
/** §2.4e：只有实际与标记同堆的单位才在 KG 内；须德军且具卡车/履带移动模式 MA（不必处于该模式）。 */
export function kgUnitEligible(facts: { german: boolean; truckOrTrackMa: boolean; stackedWithMarker: boolean }): boolean {
  return facts.german && facts.truckOrTrackMa && facts.stackedWithMarker
}
/** §2.4e：密度判定最多按 3 RE 计（不足 3 用实际）；另可含一个连。 */
export function kgDensityRe(actualRe: number): number {
  return Math.min(actualRe, KG_MAX_RE)
}
/** §2.4e：移动阶段在合格单位上放标记创建；任何时候至少一个合格单位与标记同堆。 */
export function kgCreateValid(facts: { movementPhase: boolean; eligibleUnitStacked: boolean }): boolean {
  return facts.movementPhase && facts.eligibleUnitStacked
}
export function kgMarkerStays(eligibleUnitsStacked: number): boolean {
  return eligibleUnitsStacked >= 1
}
/** §2.4e：KG 单位豁免 OCS 12.6f（可从与母编队不同的补给源 trace）；可用编队法加油（12.5c-A）。 */
export function kgExempt126f(): boolean {
  return true
}
export function kgFormationFuelingAllowed(): boolean {
  return true
}
/** §2.4e 特殊反应能力：反应阶段掷 1 骰取半（向下取整）＝可按已释放预备行动的战斗/移动模式 KG 数。 */
export function kgReactionCount(die: number): number {
  return Math.floor(die / 2)
}
/** §2.4e：这些单位仅本阶段视为加油（12.5c-C）；实际移动/攻击的那个 KG 放 2T。 */
export function kgReactionFueledThisPhaseOnly(): boolean {
  return true
}
export function kgPlaces2T(facts: { movedOrAttackedThisReaction: boolean }): boolean {
  return facts.movedOrAttackedThisReaction
}