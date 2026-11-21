import { edgeKey } from '@ocs-eastern/series/ground-map'
import type { CampaignGroundMovementBoard } from './campaign-movement-board.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

type CrossingCharge = { key: string; totalRe: number } | { reason: 'crossing-capacity' | 'crossing-strength-unavailable' }

/** One stage ledger for both directions and all moving units, keyed by canonical hexside. */
export function campaignCrossingUsage(state: Readonly<CampaignTurnState>, board: CampaignGroundMovementBoard) {
  const usage = new Map(Object.entries(state.groundMovement?.crossedReByHexside ?? {}))

  function charge(id: string, from: string, to: string): CrossingCharge | undefined {
    const limit = board.crossingLimit?.(state, id, from, to)
    if (limit === undefined) return undefined
    const re = state.counters[id]?.currentRe
    if (re === undefined || !Number.isFinite(re) || re <= 0) return { reason: 'crossing-strength-unavailable' }
    const key = edgeKey(from, to)
    const totalRe = (usage.get(key) ?? 0) + re
    return totalRe <= limit ? { key, totalRe } : { reason: 'crossing-capacity' }
  }

  return {
    stepRefusal(id: string) {
      return (from: string, to: string) => {
        const result = charge(id, from, to)
        return result && 'reason' in result ? result.reason : null
      }
    },
    reserveRoute(id: string, origin: string, route: readonly string[]) {
      let from = origin
      for (const to of route) {
        const result = charge(id, from, to)
        if (result && 'reason' in result) return { reason: result.reason, hex: to }
        if (result) usage.set(result.key, result.totalRe)
        from = to
      }
      return null
    },
    settled() { return Object.fromEntries(usage) },
  }
}
