// From Smolensk 447d4a6, src/engine/rules/supply-phase-progress.ts.
// OCS 12.10e, 12.6, 12.8. Advance within supply after each obligation settles.
export interface SupplyPhaseProgress {
  recoverySettled: boolean
  feedingSettled: boolean
  pendingAttrition: readonly string[]
}

export type SupplyPhaseObligation =
  | { kind: 'recovery' }
  | { kind: 'feeding' }
  | { kind: 'attrition'; hex: string }
  | { kind: 'complete' }

export function nextSupplyPhaseObligation(progress: SupplyPhaseProgress): SupplyPhaseObligation {
  if (!progress.recoverySettled) return { kind: 'recovery' }
  if (!progress.feedingSettled) return { kind: 'feeding' }
  const hex = progress.pendingAttrition[0]
  return hex === undefined ? { kind: 'complete' } : { kind: 'attrition', hex }
}
