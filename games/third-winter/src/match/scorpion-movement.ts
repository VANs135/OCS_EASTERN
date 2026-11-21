import { acceptCommand } from '@ocs-eastern/match-core/command-log'
import type { Command, MatchRecord } from '@ocs-eastern/match-core/command-log'
import type { Mobility } from '@ocs-eastern/series/ground-map'
import { groundModeMovementFactor } from '@ocs-eastern/series/modes'
import type { Side } from '@ocs-eastern/series/state-types'
import { actingSide } from '@ocs-eastern/series/turn'
import type { ScorpionMap } from '../import/scorpion-map.ts'
import { scorpionHexId } from '../import/hex-id.ts'
import { scorpionGroundMode } from '../import/scorpion-mode-face.ts'
import { scorpionStepCost } from '../ttw/scorpion/terrain-cost.ts'
import { scorpionGroundActivity } from './scorpion-ground-activity.ts'
import type { ScorpionGroundActivity } from './scorpion-ground-activity.ts'
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
  extender?: unknown
}
export interface GroundMoveState {
  cursor: PlayerTurn
  units: Readonly<Record<string, Unit>>
  moved: readonly string[]
  groundActivity?: ScorpionGroundActivity
}
export interface MovementBoard {
  map: ScorpionMap
  weather: 'freeze' | 'thaw'
  enemyCombat: (hex: string, side: Side) => boolean
  enemySupplySource: (hex: string, side: Side) => boolean
  unnegatedEnemyZoc: (hex: string, side: Side) => boolean
  trainbustingAt?: (hex: string, side: Side, mobility: Mobility) => boolean
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

  const activity = scorpionGroundActivity(state)
  const handlingAtStart = !state.moved.includes(move.unitId) ||
    (activity.transport?.unitId === move.unitId && !activity.transport.enteredHex)
  if (continuation !== undefined && !handlingAtStart && unit.mobility === 'truck' && board.unnegatedEnemyZoc(unit.hex, side)) {
    throw new Error('Trucks entering enemy ZOC must stop or overrun')
  }
  const airlifted = activity.airlifted.includes(move.unitId)
  const allowance = scorpionGroundMpAvailable(state, move.unitId, continuation)
  if (airlifted && allowance <= 0) throw new Error('No ground movement remains after air transport')
  const { destination, spent } = walkScorpionGroundRoute(unit, move.path, board, allowance,
    continuation === undefined && !airlifted)
  return { ...state, units: { ...state.units, [move.unitId]: { ...unit, hex: destination } },
    groundActivity: { ...activity, spent: { ...activity.spent, [move.unitId]: (activity.spent[move.unitId] ?? 0) + spent } },
    moved: [...new Set([...state.moved, move.unitId])] }
}

export function canMoveInPhase(unit: Unit, phase: PlayerTurn['phase']) {
  return !unit.extender && (phase === 'movement' || (phase === 'reaction' && unit.released) ||
    (phase === 'exploitation' && (unit.released || unit.exploit)))
}

export function scorpionMovementAllowance(unit: Unit, phase: PlayerTurn['phase']) {
  return unit.allowance * groundModeMovementFactor(scorpionGroundMode(unit), phase)
}

export function scorpionAirliftGroundLimit(unit: Unit, phase: PlayerTurn['phase']) {
  return phase === 'movement' || unit.released ? scorpionMovementAllowance(unit, phase) / 2 : 0
}

export function scorpionGroundMpAvailable(state: Readonly<GroundMoveState>, id: string, continuation?: number) {
  const unit = state.units[id]!
  const phase = state.cursor.phase
  const allowance = continuation ?? scorpionMovementAllowance(unit, phase)
  const { airlifted, spent } = scorpionGroundActivity(state)
  return airlifted.includes(id) ? Math.min(allowance, Math.max(0, scorpionAirliftGroundLimit(unit, phase) - (spent[id] ?? 0))) : allowance
}

/** OCS 14.8c. This cost is for moving units, while supply and retreats use the normal terrain costs. */
export function scorpionMovementStepCost(board: MovementBoard, from: string, to: string,
  unit: Pick<Unit, 'mobility' | 'side'>, useRoutes = true) {
  const cost = scorpionStepCost(board.map, from, to, unit.mobility, board.weather === 'freeze' ? 'freeze' : 'dry', useRoutes)
  return typeof cost === 'number' && board.trainbustingAt?.(to, unit.side, unit.mobility) ? cost + 1 : cost
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
    const step = scorpionMovementStepCost(board, from, to, unit)
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
