import type { InternalStocks } from './internal-stocks.ts'

interface BreakdownUnit {
  combat: boolean
  combatClass: 'armor' | 'mech' | 'other'
  printedRe: number
  stepsLost: number
  actionRating: number
  moveMode?: boolean
  reserve?: string
  released?: boolean
  disorganized?: boolean
  exploit?: boolean
  exploitRating?: number
  outOfSupply?: boolean
  internalStocks?: InternalStocks
}

/** OCS 20.0b–d and 20.0f. The caller checks the stack, pool and phase boundary. */
export function canAbsorbBreakdown(parent: Readonly<BreakdownUnit>, detached: Readonly<BreakdownUnit>) {
  if (!parent.combat || parent.combatClass !== 'other' || parent.printedRe <= 1 ||
    parent.stepsLost <= 0 || parent.stepsLost >= parent.printedRe || !detached.combat ||
    detached.combatClass !== 'other' || detached.printedRe !== 1 || detached.stepsLost !== 0 ||
    detached.actionRating < parent.actionRating) return false
  return Boolean(parent.moveMode) === Boolean(detached.moveMode) && Boolean(parent.reserve) === Boolean(detached.reserve) &&
    Boolean(parent.released) === Boolean(detached.released) && Boolean(parent.disorganized) === Boolean(detached.disorganized) &&
    Boolean(parent.outOfSupply) === Boolean(detached.outOfSupply) &&
    (parent.exploit ? parent.exploitRating ?? true : false) === (detached.exploit ? detached.exploitRating ?? true : false) &&
    parent.internalStocks === detached.internalStocks
}
