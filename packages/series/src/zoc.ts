// OCS 4.5. From Smolensk 5aa261d, src/engine/rules/zoc.ts. The caller resolves the effective mode.
export function projectsZoc(unit: { attackCapable: boolean; inCombatMode: boolean; outOfSupply: boolean }): boolean {
  return unit.attackCapable && unit.inCombatMode && !unit.outOfSupply
}

// OCS 4.5a and 9.12e. Adapted from Smolensk 5603e52, src/engine/rules/zoc-effects.ts.
const zocActionPolicies = {
  truckMovement: { negatable: true, rule: '4.5a-A' },
  truckSupply: { negatable: true, rule: '4.5a-B' },
  railTransport: { negatable: false, rule: '4.5a-C' },
  railSupply: { negatable: true, rule: '4.5a-D' },
  railConversion: { negatable: false, rule: '4.5a-E' },
  portSupply: { negatable: true, rule: '4.5a-F' },
  shipping: { negatable: false, rule: '4.5a-G' },
  aircraftRefit: { negatable: true, rule: '4.5a-H' },
  reserveMode: { negatable: false, rule: '4.5a-I' },
  stratMode: { negatable: false, rule: '4.5a-J' },
  stratMovement: { negatable: false, rule: '5.8a' },
  rebuild: { negatable: false, rule: '4.5a-K' },
  retreat: { negatable: false, rule: '9.12e' },
} as const

export type ZocAction = keyof typeof zocActionPolicies

/** Action resolution supplies the raw coverage and whether a friendly unit can negate it. */
export function zocAffectsAction(action: ZocAction, rawEnemyZoc: boolean, negated: boolean): boolean {
  return rawEnemyZoc && !(zocActionPolicies[action].negatable && negated)
}
