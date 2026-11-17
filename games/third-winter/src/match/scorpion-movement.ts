import { acceptCommand } from '@ocs-eastern/match-core/command-log'
import type { Command, MatchRecord } from '@ocs-eastern/match-core/command-log'
import type { Mobility } from '@ocs-eastern/series/ground-map'
import type { Side } from '@ocs-eastern/series/state-types'
import type { ScorpionMap } from '../import/scorpion-map.ts'
import { scorpionHexId } from '../import/hex-id.ts'
import { scorpionStepCost } from '../ttw/scorpion/terrain-cost.ts'
import type { PlayerTurn } from './scorpion-player-turn.ts'

interface Unit {
  side: Side
  hex: string
  mobility: Mobility
  /** OCS 12.3a. HQs draw using their throw mobility. */
  traceDrawMobility?: Mobility
  /** Effective allowance for its current mode and weather. Fuel is settled separately. */
  allowance: number
  fueled: boolean
  combat: boolean
}
export interface GroundMoveState {
  cursor: PlayerTurn
  units: Readonly<Record<string, Unit>>
  moved: readonly string[]
}
export interface MovementBoard {
  map: ScorpionMap
  weather: 'freeze' | 'thaw'
  enemyCombat: (hex: string, side: Side) => boolean
  enemySupplySource: (hex: string, side: Side) => boolean
  unnegatedEnemyZoc: (hex: string, side: Side) => boolean
}
export interface MoveCommand {
  unitId: string
  path: readonly string[]
}

/** One normal single-counter ground move; checks the whole route before changing the board. */
export function submitScorpionGroundMove<State extends GroundMoveState>(
  record: Readonly<MatchRecord<State, MoveCommand, Side>>,
  seat: Side,
  command: Readonly<Command<MoveCommand>>,
  board: MovementBoard,
) {
  return acceptCommand<State, MoveCommand, Side>(record, seat, command,
    (state, side, move) => applyScorpionGroundMove<State>(state, side, move, board))
}

export function applyScorpionGroundMove<State extends GroundMoveState>(
  state: Readonly<State>, side: Side, move: MoveCommand, board: MovementBoard,
): State {
  const unit = Object.hasOwn(state.units, move.unitId) ? state.units[move.unitId] : undefined
  if (state.cursor.phase !== 'movement' || state.cursor.phasing !== side ||
    !unit || unit.side !== side || state.moved.includes(move.unitId) || board.weather === 'thaw') {
    throw new Error('Normal ground movement is unavailable')
  }
  if (!Number.isFinite(unit.allowance) || unit.allowance <= 0 || !move.path.length ||
    unit.combat && unit.mobility !== 'leg' && !unit.fueled) {
    throw new Error('Unit must be eligible and fueled to move')
  }

  let from = scorpionHexId(unit.hex)
  let spent = 0
  for (const [index, raw] of move.path.entries()) {
    const to = scorpionHexId(raw)
    const last = index === move.path.length - 1
    if (board.enemyCombat(to, side) || board.enemySupplySource(to, side)) {
      throw new Error('Enemy combat unit or supply source blocks movement')
    }
    const step = scorpionStepCost(board.map, from, to, unit.mobility, board.weather)
    if (step === null) throw new Error('No passable hexside')
    if (step === 'all') {
      if (index !== 0 || !last) throw new Error('This crossing uses the entire allowance')
    } else {
      spent += step
      // OCS 6.1c, minimum move applies to one otherwise legal hex only.
      if (spent > unit.allowance && move.path.length !== 1) throw new Error('Movement allowance exceeded')
    }
    if (!last && unit.mobility === 'truck' && board.unnegatedEnemyZoc(to, side)) {
      throw new Error('Truck movement must stop in enemy ZOC')
    }
    from = to
  }
  return { ...state, units: { ...state.units, [move.unitId]: { ...unit, hex: from } },
    moved: [...state.moved, move.unitId] }
}
