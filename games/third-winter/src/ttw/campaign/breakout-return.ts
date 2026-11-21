import type { Side } from '@ocs-eastern/series/state-types'

export interface BreakoutHqFacts {
  nationality: string
  kessel: boolean
  inTrace: boolean
  engineerCapable: boolean
}

/** TTW 1.7a, 2.1b and 3.1b. Caller verifies the HQ is friendly and on the map. */
export function allowsBreakoutReturnHq(side: Side, unit: { nationality: string; alert?: boolean }, hq: BreakoutHqFacts) {
  if (side === 'soviet') return hq.inTrace && hq.engineerCapable
  if (hq.kessel) return unit.alert === true
  return hq.inTrace && hq.nationality === unit.nationality
}
