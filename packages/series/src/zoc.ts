// OCS 4.5. From Smolensk 5aa261d, src/engine/rules/zoc.ts. The caller resolves the effective mode.
export function projectsZoc(unit: { attackCapable: boolean; inCombatMode: boolean; outOfSupply: boolean }): boolean {
  return unit.attackCapable && unit.inCombatMode && !unit.outOfSupply
}
