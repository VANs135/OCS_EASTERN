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
export type { BreakdownUnit }

/** OCS 20.0a：创建拆分单位的三个时机（开始移动／战后推进／战后撤退）。 */
export const BREAKDOWN_CREATE_TIMINGS = ['startMove', 'advanceAfterCombat', 'retreatAfterCombat'] as const
export type BreakdownCreateTiming = (typeof BREAKDOWN_CREATE_TIMINGS)[number]

/** OCS 20.0d：吸收的唯一时机——任何阶段／段结束。 */
export const BREAKDOWN_ABSORB_TIMINGS = ['segmentEnd'] as const
export type BreakdownAbsorbTiming = (typeof BREAKDOWN_ABSORB_TIMINGS)[number]

/**
 * OCS 20.0d：阶段末减损母单位必须吸收与之堆叠且合格（20.0b/c）的拆分单位。
 * 返回逐母单位的强制吸收义务；调用方据此在段末阻塞推进直至结清。
 */
export function breakdownAbsorbObligations(parents: readonly (BreakdownUnit & { id: string })[],
  breakdowns: readonly (BreakdownUnit & { id: string })[],
  stacked: (parentId: string, breakdownId: string) => boolean): { parentId: string; breakdownIds: readonly string[] }[] {
  const obligations: { parentId: string; breakdownIds: readonly string[] }[] = []
  for (const parent of parents) {
    if (!parent.combat || parent.combatClass !== 'other' || parent.printedRe <= 1 ||
      parent.stepsLost <= 0 || parent.stepsLost >= parent.printedRe) continue
    const eligible = breakdowns.filter((detached) => stacked(parent.id, detached.id) && canAbsorbBreakdown(parent, detached))
    if (eligible.length) obligations.push({ parentId: parent.id, breakdownIds: eligible.map(({ id }) => id) })
  }
  return obligations
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
