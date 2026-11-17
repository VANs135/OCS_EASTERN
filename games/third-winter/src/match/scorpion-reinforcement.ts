import { acceptCommand } from '@ocs-eastern/match-core/command-log'
import type { Command, MatchRecord } from '@ocs-eastern/match-core/command-log'
import type { RollDie } from '@ocs-eastern/series/dice'
import type { Side } from '@ocs-eastern/series/state-types'
import { placeScorpionArrival } from '../ttw/scorpion/arrival.ts'
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

export function submitScorpionReinforcement(
  record: Readonly<MatchRecord<ReinforcementState, ReinforcementCommand, Side>>,
  side: Side,
  command: Readonly<Command<ReinforcementCommand>>,
  board: ReinforcementBoard,
  roll: RollDie,
  pickIndex: (size: number) => number,
) {
  return acceptCommand(record, side, command, (state, actor, action) =>
    applyReinforcement(state, actor, action, board, roll, pickIndex),
  )
}

function applyReinforcement(
  state: ReinforcementState,
  side: Side,
  action: ReinforcementCommand,
  board: ReinforcementBoard,
  roll: RollDie,
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
    const outstanding = board.catalog.some((arrival) =>
      arrival.side === side && arrival.turn === state.cursor.turn && !arrival.optionalForce &&
      !state.arrival.placed.includes(arrival.id) && board.arrivalDestinations(arrival).length > 0,
    )
    if (outstanding) throw new Error('Place the available scheduled arrivals first')
    return awardScorpionVariableSupply(state, window, side, roll, pickIndex)
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

  if (window.stage !== 'variable' || window.variableTokens || window.pendingAlert) {
    throw new Error('Complete the variable reinforcement award first')
  }
  const cursor = advanceScorpionPhase(state.cursor, side)
  if (!cursor || cursor.phase !== 'movement') throw new Error('Invalid movement transition')
  return { ...state, cursor, window: null }
}
