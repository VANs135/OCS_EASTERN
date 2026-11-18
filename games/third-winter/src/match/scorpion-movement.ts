import { acceptCommand } from '@ocs-eastern/match-core/command-log'
import type { Command, MatchRecord } from '@ocs-eastern/match-core/command-log'
import type { Mobility } from '@ocs-eastern/series/ground-map'
import { reserveMovementFactor } from '@ocs-eastern/series/reserve'
import type { Side } from '@ocs-eastern/series/state-types'
import { actingSide } from '@ocs-eastern/series/turn'
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
  reserve?: string
  released?: boolean
  exploit?: boolean
  disorganized?: boolean
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
  state: Readonly<State>, side: Side, move: MoveCommand, board: MovementBoard, continuation?: number,
): State {
  const unit = Object.hasOwn(state.units, move.unitId) ? state.units[move.unitId] : undefined
  const phase = state.cursor.phase
  const permitted = unit && canMoveInPhase(unit, phase)
  if (!permitted || actingSide(state.cursor.phasing, phase) !== side ||
    !unit || unit.side !== side || (continuation === undefined && state.moved.includes(move.unitId)) || board.weather === 'thaw') {
    throw new Error('Ground movement is unavailable for this counter in the current phase')
  }
  if (!Number.isFinite(unit.allowance) || unit.allowance <= 0 || !move.path.length ||
    unit.combat && unit.mobility !== 'leg' && !unit.fueled) {
    throw new Error('Unit must be eligible and fueled to move')
  }

  if (continuation !== undefined && unit.mobility === 'truck' && board.unnegatedEnemyZoc(unit.hex, side)) {
    throw new Error('Trucks entering enemy ZOC must stop or overrun')
  }
  const { destination } = walkScorpionGroundRoute(unit, move.path, board,
    continuation ?? scorpionMovementAllowance(unit, phase), continuation === undefined)
  return { ...state, units: { ...state.units, [move.unitId]: { ...unit, hex: destination } },
    moved: [...new Set([...state.moved, move.unitId])] }
}

export function canMoveInPhase(unit: Unit, phase: PlayerTurn['phase']) {
  return phase === 'movement' || (phase === 'reaction' && unit.released) ||
    (phase === 'exploitation' && (unit.released || unit.exploit))
}

export function scorpionMovementAllowance(unit: Unit, phase: PlayerTurn['phase']) {
  return unit.allowance * reserveMovementFactor(phase, Boolean(unit.reserve), Boolean(unit.released)) *
    (unit.disorganized ? 0.5 : 1)
}

export function walkScorpionGroundRoute(unit: Unit, path: readonly string[], board: MovementBoard, allowance: number,
  minimumMove = false) {
  let from = scorpionHexId(unit.hex)
  let spent = 0
  for (const [index, raw] of path.entries()) {
    const to = scorpionHexId(raw)
    const last = index === path.length - 1
    if (board.enemyCombat(to, unit.side) || board.enemySupplySource(to, unit.side)) {
      throw new Error('Enemy combat unit or supply source blocks movement')
    }
    const step = scorpionStepCost(board.map, from, to, unit.mobility, board.weather === 'freeze' ? 'freeze' : 'dry')
    if (step === null) throw new Error('No passable hexside')
    if (step === 'all') {
      if (!minimumMove || index !== 0 || !last) throw new Error('This crossing uses the entire allowance')
      spent = allowance
    } else {
      spent += step
      // OCS 6.1c, minimum move applies to one otherwise legal hex only.
      if (spent > allowance && (!minimumMove || path.length !== 1)) throw new Error('Movement allowance exceeded')
    }
    if (!last && unit.mobility === 'truck' && board.unnegatedEnemyZoc(to, unit.side)) {
      throw new Error('Truck movement must stop in enemy ZOC')
    }
    from = to
  }
  return { destination: from, spent }
}
