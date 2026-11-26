// TTW §3.6 特殊卡车扩展器 STE（专规）。trace 补给延伸结算复用 series supply-network / OCS 12.7（绑定层）。
// 苏军不得用普通卡车扩展器，改用两个 STE；本模块表达 STE 持有盒流转与限制口径。

export const STE_COUNT = 2
export type SteSection = 'map' | 'moving' | 'ready'

/** §3.6：苏军不得使用普通卡车扩展器（OCS 12.7），只能用 STE。 */
export function sovietNormalExtenderAllowed(): boolean {
  return false
}
/** §3.6：STE 不得转换为卡车运输点。 */
export function steCanConvertToTruckPoints(): boolean {
  return false
}
/** §3.6：移动阶段把在图 STE 取下放入 Moving 区（唯一移动方式）。 */
export function stePickupToMoving(facts: { movementPhase: boolean; onMap: boolean }): boolean {
  return facts.movementPhase && facts.onMap
}
/** §3.6：苏军整理阶段把每个 STE 从 Moving 移到 Ready。 */
export function steCleanupMovingToReady(facts: { sovietCleanupPhase: boolean; section: SteSection }): boolean {
  return facts.sovietCleanupPhase && facts.section === 'moving'
}
/** §3.6：苏军移动阶段，Ready 区 STE 可部署到图上任意位置。 */
export function steDeployFromReady(facts: { sovietMovementPhase: boolean; section: SteSection }): boolean {
  return facts.sovietMovementPhase && facts.section === 'ready'
}
/** §3.6：轴心战斗单位进入含 STE 的格，STE 立即进入 Moving 区。 */
export function steForcedToMoving(facts: { axisCombatEntersHex: boolean }): boolean {
  return facts.axisCombatEntersHex
}