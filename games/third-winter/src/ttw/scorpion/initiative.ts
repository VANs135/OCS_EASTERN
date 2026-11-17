import type { Side } from '@ocs-eastern/series/state-types'

export type Retention = 'soviet' | 'axis' | 'closed'

/** Scenario Book p.53. The initiative winner may choose either player to act first. */
export function retentionAfterRoll(current: Retention, winner: Side): Retention {
  if (current === 'axis') return 'closed'
  if (current === 'soviet' && winner === 'axis') return 'axis'
  return current
}

/** Turn 1 is prescribed. A later retention requires 1 SP from an on-map dump. */
export function mayRetainInitiative(
  turn: number, current: Retention, side: Side, onMapAvailableSp: number,
): boolean {
  return turn > 1 && current === side && onMapAvailableSp >= 1
}
