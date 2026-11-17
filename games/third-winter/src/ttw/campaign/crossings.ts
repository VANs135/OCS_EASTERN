import type { Side } from '@ocs-eastern/series/state-types'

export const khersonEnds = ['D14.03', 'D15.03'] as const

interface KhersonTransport {
  from: string
  to: string
  beginsAtEndpoint: boolean
  river: 'normal' | 'ice'
  enemyZoc: boolean
  cargo: 'supply' | 'move-mode-unit' | 'other'
  usedRe: number
  cargoRe: number
}

/** TTW 1.4d / Q02. Usage is shared across both directions in this Movement Phase. */
export function canTransportAtKherson(input: Readonly<KhersonTransport>): boolean {
  return khersonEnds.some((hex, index) => input.from === hex && input.to === khersonEnds[1 - index]) &&
    input.beginsAtEndpoint && input.river === 'normal' && !input.enemyZoc &&
    input.cargo !== 'other' && input.cargoRe > 0 && input.usedRe >= 0 && input.usedRe + input.cargoRe <= 3
}

interface FerryCrossing {
  side: Side
  owner: Side
  river: 'normal' | 'ice'
  mobility: 'leg' | 'track' | 'truck'
  usedReOnHexside: number
  crossingRe: number
  ownDeployingPontoon: boolean
}

/** TTW 1.5a and the p.35 example. The supplied ledger counts both directions. */
export function canMoveAcrossPontoonFerry(input: Readonly<FerryCrossing>): boolean {
  return input.side === input.owner && input.river === 'normal' && input.mobility === 'leg' &&
    !input.ownDeployingPontoon && input.crossingRe > 0 &&
    input.usedReOnHexside >= 0 && input.usedReOnHexside + input.crossingRe <= 3
}
