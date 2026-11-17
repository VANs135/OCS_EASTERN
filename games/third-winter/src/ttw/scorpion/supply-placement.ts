import type { Side } from '@ocs-eastern/series/state-types'

export type ScorpionSupplyDestination =
  | { kind: 'hex'; id: string; controlledBy: Side | null }
  | { kind: 'air-box'; side: Side }

export interface ScorpionSupplyPool {
  side: Side
  tokensLeft: number
}

/** Scenario Book p.53. The scenario supplies the actual map-edge entry set. */
export function placeScorpionSupply(
  pool: Readonly<ScorpionSupplyPool>,
  destination: Readonly<ScorpionSupplyDestination>,
  tokens: number,
  supplySourceHexes: ReadonlySet<string>,
): ScorpionSupplyPool {
  if (!Number.isSafeInteger(tokens) || tokens <= 0 || tokens > pool.tokensLeft) {
    throw new Error('Requested supply exceeds the available award or is not a whole number of tokens')
  }
  const legal = destination.kind === 'air-box'
    ? destination.side === pool.side
    : destination.controlledBy !== (pool.side === 'axis' ? 'soviet' : 'axis') &&
      supplySourceHexes.has(destination.id)
  if (!legal) throw new Error('Supply must be placed at a supply source or the side’s off-map air box')

  return { ...pool, tokensLeft: pool.tokensLeft - tokens }
}
