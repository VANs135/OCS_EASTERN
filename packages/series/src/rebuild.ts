// Smolensk 5603e52, rules/rebuild.ts#planRebuild, OCS v4.3 13.5.
// Neutral rebuild eligibility, step restoration and balance arithmetic. Point types, banking,
// per-unit costs and legal destinations are game-specific; Third Winter abstract points live in ttw.

/** OCS 13.5b-c. Normalized facts about a counter offered for rebuild. */
export interface RebuildCandidate {
  id: string
  /** 13.5c: a yellow dot after the AR makes the counter permanently unrebuildable. */
  rebuildable: boolean
  /** 13.5b: a breakdown unit returns to its pool instead of rebuilding. */
  isBreakdown: boolean
  /** 13.5b: true in the dead pile, false for a reduced unit still on the map. */
  inDeadPile: boolean
  steps: number
  printedSteps: number
}

/** OCS 13.5b-c. Only a rebuildable dead-pile or reduced non-breakdown counter may rebuild. */
export function rebuildRejection(candidate: Readonly<RebuildCandidate>): string | null {
  if (!Number.isSafeInteger(candidate.printedSteps) || candidate.printedSteps < 1) return 'invalid-printed-steps'
  if (!Number.isSafeInteger(candidate.steps) || candidate.steps < 0 || candidate.steps > candidate.printedSteps) return 'invalid-current-steps'
  if (!candidate.rebuildable) return 'unit-not-rebuildable'
  if (candidate.isBreakdown) return 'breakdown-returns-to-pool'
  if (!candidate.inDeadPile && candidate.steps >= candidate.printedSteps) return 'unit-not-reduced'
  return null
}

/** OCS 13.5b. A dead-pile counter returns to printed strength; a reduced one restores up to printed. */
export function rebuildRestoredSteps(candidate: Readonly<RebuildCandidate>, stepsToRestore?: number): number {
  if (candidate.inDeadPile) return candidate.printedSteps
  const want = Math.max(0, Math.trunc(stepsToRestore ?? candidate.printedSteps - candidate.steps))
  return Math.min(candidate.printedSteps, candidate.steps + want)
}

/** Neutral replacement balance. Resource keys are game-specific; the arithmetic is shared. */
export type ReplLedger = Readonly<Record<string, number>>

export function canAffordRepl(ledger: ReplLedger, cost: ReplLedger): boolean {
  return Object.keys(cost).every((key) => (ledger[key] ?? 0) >= (cost[key] ?? 0))
}

export function addRepl(ledger: ReplLedger, credit: ReplLedger): ReplLedger {
  const result: Record<string, number> = { ...ledger }
  for (const [key, amount] of Object.entries(credit)) result[key] = (result[key] ?? 0) + amount
  return result
}

export function subtractRepl(ledger: ReplLedger, cost: ReplLedger): ReplLedger {
  if (!canAffordRepl(ledger, cost)) throw new RangeError('Insufficient replacement points')
  const result: Record<string, number> = { ...ledger }
  for (const [key, amount] of Object.entries(cost)) result[key] = (result[key] ?? 0) - amount
  return result
}