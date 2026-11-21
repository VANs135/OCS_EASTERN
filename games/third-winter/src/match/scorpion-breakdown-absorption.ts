import { canAbsorbBreakdown } from '@ocs-eastern/series/breakdown'
import type { Side } from '@ocs-eastern/series/state-types'
import type { ScorpionBreakdownRules } from './scorpion-breakdowns.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'

interface BreakdownPair {
  parentId: string
  breakdownId: string
}

export type AbsorbScorpionBreakdown = BreakdownPair & { type: 'absorb-breakdown' }

export function scorpionBreakdownAbsorptions(state: Readonly<ScorpionInPlay>, rules?: ScorpionBreakdownRules) {
  const bySide: Record<Side, BreakdownPair[]> = { axis: [], soviet: [] }
  if (!rules) return bySide
  const detachedAt = new Map<string, [string, ScorpionInPlay['units'][string]][]>()
  for (const [id, unit] of Object.entries(state.units)) {
    if (!rules.counters.has(unit.definition)) continue
    const at = detachedAt.get(unit.hex) ?? []
    at.push([id, unit])
    detachedAt.set(unit.hex, at)
  }
  for (const [parentId, parent] of Object.entries(state.units)) {
    const pool = rules.parentPools.get(parent.definition)
    if (!pool || !parent.stepsLost) continue
    for (const [breakdownId, detached] of detachedAt.get(parent.hex) ?? []) {
      if (parent.side === detached.side && pool === rules.counters.get(detached.definition)?.pool && canAbsorbBreakdown(parent, detached)) {
        bySide[parent.side].push({ parentId, breakdownId })
      }
    }
  }
  return bySide
}

/** Returns the counter to its pool by removing its physical instance from the map. */
export function absorbScorpionBreakdown(state: Readonly<ScorpionInPlay>, { parentId, breakdownId }: BreakdownPair): ScorpionInPlay {
  const units = { ...state.units }
  const parent = units[parentId]!
  const { definition } = units[breakdownId]!
  const returned = state.breakdownReturns?.[definition] ?? []
  units[parentId] = { ...parent, stepsLost: parent.stepsLost - 1 }
  delete units[breakdownId]
  return { ...state, units, moved: state.moved.filter((id) => id !== breakdownId),
    breakdownReturns: { ...state.breakdownReturns, [definition]: [...new Set([...returned, breakdownId])] } }
}
