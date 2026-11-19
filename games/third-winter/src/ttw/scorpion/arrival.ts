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
  /**
   * Record of scheduled arrivals whose printed entry hexes were all enemy-held at their own
   * reinforcement phase and OCS 13.6b offered no map-edge substitute. OCS 13.6 forbids delaying
   * reinforcements, so such a unit never enters the game; this list is the explicit record of that
   * outcome so it can be reported, audited and scored instead of vanishing silently.
   */
  forfeited?: readonly string[]
  mobilized: readonly NonNullable<ScorpionArrival['optionalForce']>[]
  sovietVp: number
}

const forceOwner = {
  'axis-24-panzer': 'axis',
  'soviet-5-guards-cavalry': 'soviet',
} as const

/** Saves written before the forfeiture record existed simply have nothing recorded. */
export function forfeitedScorpionArrivals(state: Readonly<ScorpionArrivalState>): readonly string[] {
  return state.forfeited ?? []
}

/**
 * Scenario Book pp.53, 55–56. The caller obtains arrivals from its own scenario catalog.
 *
 * OCS 13.6: a scheduled arrival is placed in its own reinforcement phase and the player cannot
 * delay it, so a non-optional arrival stays tied to `arrival.turn`. Optional formations keep their
 * window of any turn at or after arrival.
 */
export function placeScorpionArrival(
  state: Readonly<ScorpionArrivalState>,
  arrival: Readonly<ScorpionArrival>,
  turn: number,
  side: Side,
  destination: string,
  eligibleDestinations: readonly string[],
): ScorpionArrivalState {
  if (side !== arrival.side || state.placed.includes(arrival.id)) {
    throw new Error('Arrival is unavailable to this side')
  }
  // OCS 13.6. A forfeited arrival never entered the game; it cannot be placed afterwards.
  if (forfeitedScorpionArrivals(state).includes(arrival.id)) {
    throw new Error('Arrival was forfeited for this phase')
  }
  const force = arrival.optionalForce
  const onTime = force ? turn >= arrival.turn : turn === arrival.turn
  if (!onTime || (force && forceOwner[force] !== side)) {
    throw new Error('Arrival is unavailable on this turn')
  }
  if (!eligibleDestinations.includes(destination)) {
    throw new Error('Arrival destination is not legal')
  }

  const placed = [...state.placed, arrival.id]
  if (!force || state.mobilized.includes(force)) return { ...state, placed }
  return {
    ...state,
    placed,
    mobilized: [...state.mobilized, force],
    sovietVp: state.sovietVp + (side === 'axis' ? 5 : -5),
  }
}

/**
 * OCS 13.6 consequence: an arrival that cannot be placed in its own phase never arrives. Recording
 * it is the only observable outcome the rules leave, so every blocked arrival must pass through
 * here exactly once. Repeats are ignored; an already placed arrival is an invariant violation.
 */
export function forfeitScorpionArrivals(
  state: Readonly<ScorpionArrivalState>, arrivals: readonly Readonly<ScorpionArrival>[],
): ScorpionArrivalState {
  if (!arrivals.length) return { placed: state.placed, forfeited: forfeitedScorpionArrivals(state),
    mobilized: state.mobilized, sovietVp: state.sovietVp }
  const placedConflict = arrivals.find(({ id }) => state.placed.includes(id))
  if (placedConflict) throw new Error(`Arrival is already on the map: ${placedConflict.id}`)
  const recorded = forfeitedScorpionArrivals(state)
  const added = arrivals.map(({ id }) => id).filter((id) => !recorded.includes(id))
  if (!added.length) return { ...state, forfeited: recorded }
  return { ...state, forfeited: [...recorded, ...added] }
}
