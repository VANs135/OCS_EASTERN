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

/** OCS 20.0. Only an eligible multi-step unit can detach, and its last step stays with it. */
export function canDetachBreakdownSteps(parent: Readonly<BreakdownUnit>, count: number) {
  return parent.combat && parent.combatClass === 'other' && parent.printedRe > 1 &&
    Number.isSafeInteger(count) && count > 0 && parent.printedRe - parent.stepsLost > count
}

/** OCS 20.0 and 20.0f. The scenario supplies the roster of actual breakdown counters. */
export function isBreakdownCounter(unit: Readonly<BreakdownUnit>) {
  return unit.combat && unit.combatClass === 'other' && unit.printedRe === 1 && unit.stepsLost === 0
}

/** OCS 20.0b–d and 20.0f. The caller checks the stack, pool and phase boundary. */
export function canAbsorbBreakdown(parent: Readonly<BreakdownUnit>, detached: Readonly<BreakdownUnit>) {
  if (!parent.combat || parent.combatClass !== 'other' || parent.printedRe <= 1 ||
    parent.stepsLost <= 0 || parent.stepsLost >= parent.printedRe || !isBreakdownCounter(detached) ||
    detached.actionRating < parent.actionRating) return false
  return Boolean(parent.moveMode) === Boolean(detached.moveMode) && Boolean(parent.reserve) === Boolean(detached.reserve) &&
    Boolean(parent.released) === Boolean(detached.released) && Boolean(parent.disorganized) === Boolean(detached.disorganized) &&
    Boolean(parent.outOfSupply) === Boolean(detached.outOfSupply) &&
    (parent.exploit ? parent.exploitRating ?? true : false) === (detached.exploit ? detached.exploitRating ?? true : false) &&
    parent.internalStocks === detached.internalStocks
}
