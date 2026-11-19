import { acceptCommand } from '@ocs-eastern/match-core/command-log'
import type { Command, MatchRecord } from '@ocs-eastern/match-core/command-log'
import type { RollDie } from '@ocs-eastern/series/dice'
import type { Side } from '@ocs-eastern/series/state-types'
import type { UnitArrival } from '../import/scorpion-arrivals.ts'
import { forfeitScorpionArrivals, forfeitedScorpionArrivals, placeScorpionArrival } from '../ttw/scorpion/arrival.ts'
import type { ScorpionSupplyRoll } from '../ttw/scorpion/reinforcement-supply.ts'
import { scorpionSuddenDeath } from '../ttw/scorpion/victory.ts'
import { advanceScorpionPhase } from './scorpion-player-turn.ts'
import { awardScorpionVariableSupply, enterScorpionReinforcement } from './scorpion-reinforcement-state.ts'
import type { ReinforcementBoard, ReinforcementState, SupplyTarget } from './scorpion-reinforcement-state.ts'
import { deliverScorpionSupply } from './scorpion-reinforcement-supply.ts'

export type ReinforcementCommand =
  | { type: 'complete-refit' }
  | { type: 'place-arrival'; arrivalId: string; hex: string }
  | { type: 'place-supply'; target: SupplyTarget; tokens: number }
  | { type: 'finish-scheduled-arrivals' }
  | { type: 'place-alert'; hex: string }
  | { type: 'pass-alert' }
  | { type: 'complete-reinforcement' }

/** One turn's scheduled reinforcement obligation, split by whether an entry hex is open. */
export interface ScheduledArrivalStatus {
  /** Every non-optional arrival of `turn` that is not on the map yet, regardless of entry hexes. */
  outstanding: readonly UnitArrival[]
  /** Obligations that can be placed right now; placement must finish before the variable award. */
  placeable: readonly UnitArrival[]
  /** Obligations with no legal entry hex: no printed hex left, and OCS 13.6b offers no substitute. */
  blocked: readonly UnitArrival[]
}

/**
 * OCS 13.6: reinforcements are placed in their arrival phase and cannot be delayed, so a scheduled
 * arrival remains an obligation for its whole turn no matter whether an entry hex happens to be
 * open. Only `placed` settles an obligation; entry-hex availability never removes one from this set.
 */
export function scorpionScheduledArrivals(
  state: Readonly<ReinforcementState>, side: Side, board: ReinforcementBoard,
): ScheduledArrivalStatus {
  const outstanding = board.catalog.filter((arrival) =>
    arrival.side === side && arrival.turn === state.cursor.turn && !arrival.optionalForce &&
    !state.arrival.placed.includes(arrival.id) && !forfeitedScorpionArrivals(state.arrival).includes(arrival.id),
  )
  const placeable = outstanding.filter((arrival) => board.arrivalDestinations(arrival).length > 0)
  const blocked = outstanding.filter((arrival) => board.arrivalDestinations(arrival).length === 0)
  return { outstanding, placeable, blocked }
}

export function submitScorpionReinforcement(
  record: Readonly<MatchRecord<ReinforcementState, ReinforcementCommand, Side>>,
  side: Side,
  command: Readonly<Command<ReinforcementCommand>>,
  board: ReinforcementBoard,
  roll: RollDie,
  pickIndex: (size: number) => number,
) {
  return acceptCommand(record, side, command, (state, actor, action) =>
    applyScorpionReinforcement(state, actor, action, board, roll, pickIndex),
  )
}

export function applyScorpionReinforcement(
  state: ReinforcementState,
  side: Side,
  action: ReinforcementCommand,
  board: ReinforcementBoard,
  roll: ScorpionSupplyRoll,
  pickIndex: (size: number) => number,
): ReinforcementState {
  if (state.victory || side !== state.cursor.phasing) {
    throw new Error('This side cannot take a reinforcement action')
  }
  if (action.type === 'complete-refit') return enterScorpionReinforcement(state, side)

  const window = state.window
  if (state.cursor.phase !== 'reinforcement' || !window) throw new Error('Reinforcement is not active')
  if (action.type === 'place-supply') {
    return deliverScorpionSupply(state, window, side, action.target, action.tokens, board)
  }
  if (action.type === 'finish-scheduled-arrivals') {
    const { placeable, blocked } = scorpionScheduledArrivals(state, side, board)
    if (placeable.length) throw new Error('Place the available scheduled arrivals first')
    // OCS 13.6 forbids delaying a reinforcement, and 13.6b substitutes only for blocked map-edge
    // hexes. An arrival whose printed hexes are all enemy-held therefore never arrives; record that
    // outcome instead of dropping the unit without a trace, then let the phase continue.
    const arrival = blocked.length ? forfeitScorpionArrivals(state.arrival, blocked) : state.arrival
    return awardScorpionVariableSupply({ ...state, arrival }, window, side, roll, pickIndex)
  }
  if (action.type === 'place-arrival') {
    if (window.stage !== 'scheduled') throw new Error('Scheduled arrivals are closed')
    const entry = board.catalog.find(({ id }) => id === action.arrivalId)
    if (!entry) throw new Error('Unknown arrival')
    const arrival = placeScorpionArrival(
      state.arrival, entry, state.cursor.turn, side, action.hex, board.arrivalDestinations(entry),
    )
    return {
      ...state,
      arrival,
      arrivalsOnMap: [...state.arrivalsOnMap, { arrival: entry, hex: action.hex }],
      victory: scorpionSuddenDeath(state.cursor.turn, arrival.sovietVp),
    }
  }

  if (action.type === 'place-alert' || action.type === 'pass-alert') {
    const counter = window.pendingAlert
    if (!counter) throw new Error('No Alert award is pending')
    const settled = { ...state, window: { ...window, pendingAlert: null } }
    if (action.type === 'pass-alert') return settled
    if (!board.alertDestinations(counter).includes(action.hex)) {
      throw new Error('Choose an eligible HQ for the Alert')
    }
    return {
      ...settled,
      availableAlerts: state.availableAlerts.filter(({ id }) => id !== counter.id),
      placedAlerts: [...state.placedAlerts, { counter, hex: action.hex }],
    }
  }

  if (action.type !== 'complete-reinforcement') throw new Error('Unknown Scorpion reinforcement action')
  if (window.stage !== 'variable' || window.variableTokens || window.pendingAlert) {
    throw new Error('Complete the variable reinforcement award first')
  }
  const cursor = advanceScorpionPhase(state.cursor, side)
  if (!cursor || cursor.phase !== 'movement') throw new Error('Invalid movement transition')
  return { ...state, cursor, window: null }
}
