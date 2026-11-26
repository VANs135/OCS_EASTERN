import { traceReach } from '@ocs-eastern/series/trace-path'

// TTW §3.3a Front HQ 性质（专规），几何判定复用 series 通规 trace（traceReach，改编自斯摩棱斯克）。
// 指挥半径＝10 格泛洪，遇前线/不可通行/未抵消 EZOC/卡车不可入格即止（§3.3a E）；
// 与"几何距离"（空军任务限距，campaignHexesWithin）不同——后者无阻挡。

export const FRONT_COMMAND_RADIUS = 10
/** §3.3a C：Front HQ 防空 DRM +2（印在算子上）。 */
export const FRONT_HQ_FLAK_DRM = 2
/** §3.3a D：被迫位移时至少移 5 格。 */
export const FRONT_HQ_DISPLACE_MIN = 5

export interface FrontCommandBlockers {
  enemyCombatHexes: ReadonlySet<string>
  unnegatedEzocHexes: ReadonlySet<string>
  impassableHexes: ReadonlySet<string>
  truckImpassableHexes: ReadonlySet<string>
}

/** §3.3a E：指挥半径阻挡谓词（时点天气下的卡车可入性由调用方算入 truckImpassableHexes）。 */
export function frontCommandAllows(blockers: FrontCommandBlockers): (hex: string) => boolean {
  return (hex) => !blockers.enemyCombatHexes.has(hex) && !blockers.unnegatedEzocHexes.has(hex) &&
    !blockers.impassableHexes.has(hex) && !blockers.truckImpassableHexes.has(hex)
}

/** §3.3a E：Front HQ 指挥半径覆盖格（含本格，10 格内、不被阻挡）。复用通规 traceReach。 */
export function frontCommandRadius(map: { neighbors(hex: string): readonly string[] }, origin: string,
  allows: (hex: string) => boolean): ReadonlySet<string> {
  return new Set(traceReach(map, origin, FRONT_COMMAND_RADIUS, allows, () => 1).keys())
}

/** §3.3a A：Front HQ 只能停在有连续苏轨通往苏军补给源的铁路格。 */
export function frontHqValidHex(facts: { railHex: boolean; sovietGaugeConnected: boolean }): boolean {
  return facts.railHex && facts.sovietGaugeConnected
}

/** §3.3a D：敌战斗单位进格或失去铁路连接即被迫位移（≥5 格至另一可停格）。 */
export function frontHqMustDisplace(facts: { enemyCombatInHex: boolean; railConnected: boolean }): boolean {
  return facts.enemyCombatInHex || !facts.railConnected
}

/** §3.3a E：已编属且在本 Front HQ 指挥半径内的 Army HQ 可从 Front HQ 格 Draw（含 trace）；仅 HQ 可 Draw。 */
export function assignedArmyHqCanDraw(facts: { assigned: boolean; withinRadius: boolean; isHq: boolean }): boolean {
  return facts.assigned && facts.withinRadius && facts.isHq
}