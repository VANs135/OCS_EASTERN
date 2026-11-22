import type { Side } from '@ocs-eastern/series/state-types'

// TTW 1.3. The Romania Air Box is an Axis off-map base with free refit.
export function romaniaAirRefitAllowed(side: Side, stationed: number) {
  return side === 'axis' && stationed <= 4
}
