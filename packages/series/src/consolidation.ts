import type { InternalStocks } from './internal-stocks.ts'

export interface MultiStepConsolidationUnit {
  id: string
  locationKey: string
  combatFaceKey: string
  moveFaceKey: string
  steps: number
  printedSteps: number
  disorganized: boolean
  internalStocks?: InternalStocks
}

// Smolensk 5603e52, rules/consolidation.ts#planConsolidation, OCS 13.9-1.
// Compare complete normalized face keys instead of the source module's subset of printed values.
export function consolidationUnitRejection(unit: Readonly<MultiStepConsolidationUnit>) {
  if (!Number.isSafeInteger(unit.printedSteps) || unit.printedSteps < 2) return 'not-a-multi-step-unit'
  if (!Number.isSafeInteger(unit.steps) || unit.steps < 1 || unit.steps > unit.printedSteps) return 'invalid-current-steps'
  if (typeof unit.combatFaceKey !== 'string' || !unit.combatFaceKey.trim() ||
    typeof unit.moveFaceKey !== 'string' || !unit.moveFaceKey.trim()) return 'missing-printed-face'
  if (unit.disorganized) return 'unit-is-disorganized'
  if (unit.internalStocks) return 'internal-stocks-low-or-exhausted'
  return null
}

export function consolidationGroupKey(unit: Readonly<MultiStepConsolidationUnit>) {
  return JSON.stringify([unit.locationKey, unit.combatFaceKey, unit.moveFaceKey, unit.printedSteps])
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
