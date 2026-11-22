import type { Side } from '@ocs-eastern/series/state-types'

export type TtwRailGauge = 'standard' | 'broad'

// TTW 1.2. National gauge restrictions apply to rail transport and rail trace.
export function ttwRailGauge(side: Side): TtwRailGauge {
  return side === 'axis' ? 'standard' : 'broad'
}
