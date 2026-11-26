// TTW §2.2b Luftflotte HQ（轴心航空队 HQ，专规）。距离/几何由调用方注入；本模块表达其性质与一次性空运补给口径。

export const LUFTFLOTTE_MIN_DISTANCE = 10
export const LUFTFLOTTE_AIRLIFT_RANGE = 60
export const LUFTFLOTTE_AIRLIFT_SP_AIRBASE = 2
export const LUFTFLOTTE_AIRLIFT_SP_OTHER = 1

/** §2.2b：须位于村庄/城市格或友军机场，且距在补给苏军战斗单位 ≥10 格。 */
export function luftflotteValidHex(facts: { villageCityOrFriendlyAirBase: boolean; distanceToInSupplySovietCombat: number }): boolean {
  return facts.villageCityOrFriendlyAirBase && facts.distanceToInSupplySovietCombat >= LUFTFLOTTE_MIN_DISTANCE
}

/** §2.2b：苏军战斗单位进入 10 格内必须移动（移到另一满足上条件的格）。 */
export function luftflotteMustMove(facts: { sovietCombatWithin10: boolean }): boolean {
  return facts.sovietCombatWithin10
}

/** §2.2b：被攻击时无步数/零战斗值/无 Flak；若独自在格立即位移。 */
export function luftflotteDisplacedWhenAlone(facts: { attacked: boolean; aloneInHex: boolean }): boolean {
  return facts.attacked && facts.aloneInHex
}
export function luftflotteCombatStrength(): number {
  return 0
}
export function luftflotteFlakDrm(): number {
  return 0
}

/** §2.2b：每局一次在 60 格内友军格放 SP（机场 2 SP／非机场 1 SP）；非空中任务，不受敌空军/EZOC 影响。 */
export function luftflotteAirlift(facts: { usedThisGame: boolean; friendlyHex: boolean; within60: boolean; airBase: boolean }):
  { ok: boolean; sp: number } {
  if (facts.usedThisGame || !facts.friendlyHex || !facts.within60) return { ok: false, sp: 0 }
  return { ok: true, sp: facts.airBase ? LUFTFLOTTE_AIRLIFT_SP_AIRBASE : LUFTFLOTTE_AIRLIFT_SP_OTHER }
}