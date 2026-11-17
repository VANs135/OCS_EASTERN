import type { Side } from '@ocs-eastern/series/state-types'

export interface ScorpionArrival {
  id: string
  side: Side
  turn: number
  destinations: readonly string[]
  optionalForce?: 'axis-24-panzer' | 'soviet-5-guards-cavalry'
}

export interface ScorpionArrivalState {
  placed: readonly string[]
  mobilized: readonly NonNullable<ScorpionArrival['optionalForce']>[]
  sovietVp: number
}

const forceOwner = {
  'axis-24-panzer': 'axis',
  'soviet-5-guards-cavalry': 'soviet',
} as const

/** Scenario Book pp.53, 55–56. The caller obtains arrivals from its own scenario catalog. */
export function placeScorpionArrival(
  state: Readonly<ScorpionArrivalState>,
  arrival: Readonly<ScorpionArrival>,
  turn: number,
  side: Side,
  destination: string,
  destinationIsLegal: (hex: string) => boolean,
): ScorpionArrivalState {
  if (side !== arrival.side || state.placed.includes(arrival.id)) {
    throw new Error('Arrival is unavailable to this side')
  }
  const force = arrival.optionalForce
  const onTime = force ? turn >= arrival.turn : turn === arrival.turn
  if (!onTime || (force && forceOwner[force] !== side)) {
    throw new Error('Arrival is unavailable on this turn')
  }
  if (!arrival.destinations.includes(destination) || !destinationIsLegal(destination)) {
    throw new Error('Arrival destination is not legal')
  }

  const placed = [...state.placed, arrival.id]
  if (!force || state.mobilized.includes(force)) return { ...state, placed }
  return {
    placed,
    mobilized: [...state.mobilized, force],
    sovietVp: state.sovietVp + (side === 'axis' ? 5 : -5),
  }
}
