import type { InternalStocks } from './internal-stocks.ts'

interface GroundConsolidationUnit {
  id: string
  combatFaceKey: string
  moveFaceKey: string
  disorganized: boolean
  internalStocks?: InternalStocks
}

export interface MultiStepConsolidationUnit extends GroundConsolidationUnit {
  locationKey: string
  steps: number
  printedSteps: number
}

function groundRejection(unit: Readonly<GroundConsolidationUnit>) {
  if (typeof unit.combatFaceKey !== 'string' || !unit.combatFaceKey.trim() ||
    typeof unit.moveFaceKey !== 'string' || !unit.moveFaceKey.trim()) return 'missing-printed-face'
  if (unit.disorganized) return 'unit-is-disorganized'
  if (unit.internalStocks) return 'internal-stocks-low-or-exhausted'
  return null
}

// Smolensk 5603e52, rules/consolidation.ts#planConsolidation, OCS 13.9.
// Compare complete normalized face keys instead of the source module's subset of printed values.
export function consolidationUnitRejection(unit: Readonly<MultiStepConsolidationUnit>) {
  if (!Number.isSafeInteger(unit.printedSteps) || unit.printedSteps < 2) return 'not-a-multi-step-unit'
  if (!Number.isSafeInteger(unit.steps) || unit.steps < 1 || unit.steps > unit.printedSteps) return 'invalid-current-steps'
  return groundRejection(unit)
}

export function consolidationGroupKey(unit: Readonly<MultiStepConsolidationUnit>) {
  return JSON.stringify([unit.locationKey, unit.combatFaceKey, unit.moveFaceKey, unit.printedSteps])
}

export interface FormationExchangeUnit extends GroundConsolidationUnit {
  formationId: string | null
  role: 'ground' | 'regular-transport' | 'organic-transport'
  cargoTokens?: number
  cargoCapacityTokens?: number
}

/** OCS 13.9-2/3. The replacement counter is in the friendly dead pile. */
export function formationExchangeRejection(field: Readonly<FormationExchangeUnit>, replacement: Readonly<FormationExchangeUnit>) {
  if (field.id === replacement.id) return 'same-unit'
  const rejection = groundRejection(field) ?? groundRejection(replacement)
  if (rejection) return rejection
  if (field.combatFaceKey !== replacement.combatFaceKey || field.moveFaceKey !== replacement.moveFaceKey) return 'different-printed-faces'
  if (!replacement.formationId) return 'replacement-is-not-a-formation-member'
  if (field.formationId === replacement.formationId) return 'same-formation'
  if (field.role === 'ground') return replacement.role === 'ground' ? null : 'incompatible-transport-role'
  if (replacement.role !== 'organic-transport' || (field.role === 'regular-transport' && field.formationId !== null)) {
    return 'incompatible-transport-role'
  }
  const { cargoTokens } = field
  const { cargoCapacityTokens } = replacement
  if (cargoTokens === undefined || cargoCapacityTokens === undefined || !Number.isSafeInteger(cargoTokens) || cargoTokens < 0 ||
    !Number.isSafeInteger(cargoCapacityTokens) || cargoTokens > cargoCapacityTokens) return 'unverified-or-excess-transport-cargo'
  return null
}

export interface AircraftConsolidationUnit {
  id: string
  locationKey: string
  typeAndValuesKey: string
  active: boolean
  printedSteps: number
  stepsLost: number
}

export function aircraftConsolidationGroupKey(unit: Readonly<AircraftConsolidationUnit>) {
  return JSON.stringify([unit.locationKey, unit.typeAndValuesKey, unit.active])
}

export function aircraftConsolidationRejection(unit: Readonly<AircraftConsolidationUnit>) {
  if (unit.printedSteps !== 2 || unit.stepsLost !== 1) return 'aircraft-is-not-reduced'
  if (typeof unit.active !== 'boolean' || typeof unit.typeAndValuesKey !== 'string' || !unit.typeAndValuesKey.trim()) return 'missing-aircraft-facts'
  return null
}

/** OCS 13.9-4, 14.1b. Two equivalent reduced aircraft produce a full-strength aircraft. */
export function planAircraftConsolidation(keep: Readonly<AircraftConsolidationUnit>, remove: Readonly<AircraftConsolidationUnit>) {
  if (keep.id === remove.id) return { ok: false, reason: 'same-unit' } as const
  const rejection = aircraftConsolidationRejection(keep) ?? aircraftConsolidationRejection(remove)
  if (rejection) return { ok: false, reason: rejection } as const
  if (keep.locationKey !== remove.locationKey) return { ok: false, reason: 'different-location' } as const
  if (keep.active !== remove.active) return { ok: false, reason: 'different-aircraft-status' } as const
  if (aircraftConsolidationGroupKey(keep) !== aircraftConsolidationGroupKey(remove)) {
    return { ok: false, reason: 'different-aircraft-type-or-values' } as const
  }
  return { ok: true, plan: { keepId: keep.id, removeId: remove.id, stepsAfter: 2 } } as const
}

export function planMultiStepConsolidation(keep: Readonly<MultiStepConsolidationUnit>, remove: Readonly<MultiStepConsolidationUnit>) {
  if (keep.id === remove.id) return { ok: false, reason: 'same-unit' } as const
  const rejection = consolidationUnitRejection(keep) ?? consolidationUnitRejection(remove)
  if (rejection) return { ok: false, reason: rejection } as const
  if (keep.locationKey !== remove.locationKey) return { ok: false, reason: 'different-location' } as const
  if (consolidationGroupKey(keep) !== consolidationGroupKey(remove)) return { ok: false, reason: 'different-printed-faces' } as const
  const steps = keep.steps + remove.steps
  const stepsAfter = Math.min(keep.printedSteps, steps)
  return { ok: true, plan: { keepId: keep.id, removeId: remove.id, stepsAfter, overflowLost: steps - stepsAfter } } as const
}
