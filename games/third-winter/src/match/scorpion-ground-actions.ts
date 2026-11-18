import type { Side } from '@ocs-eastern/series/state-types'
import type { Mobility } from '@ocs-eastern/series/ground-map'
import { inTrainbustingZone } from '@ocs-eastern/series/trainbusting'
import { scorpionHexId } from '../import/hex-id.ts'
import { scorpionModeFace } from '../import/scorpion-mode-face.ts'
import type { GroundFace } from '../import/scorpion-mode-face.ts'
import { scorpionSupplySources } from '../ttw/scorpion/initial-map.ts'
import { resolveScorpionMoveEntries } from './scorpion-capture.ts'
import { scorpionGroundActivity } from './scorpion-ground-activity.ts'
import { applyScorpionGroundMove, scorpionGroundMpAvailable, scorpionMovementAllowance } from './scorpion-movement.ts'
import type { MovementBoard } from './scorpion-movement.ts'
import { assertScorpionReserveCapacity, prepareScorpionReserve } from './scorpion-reserves.ts'
import type { ScorpionReserveFace } from './scorpion-reserves.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'
import { scorpionSupplyPosition } from './scorpion-supply-position.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'
import { fuelScorpionMovement } from './scorpion-fuel.ts'

type MovingCounter = { unitId: string; fuelDumpId?: string; fuelHeadquartersId?: string; reserveFace?: ScorpionReserveFace }
export type ScorpionGroundAction = ({ type: 'ground-move'; path: readonly string[]; face?: GroundFace } & MovingCounter)
  | { type: 'reserve-stack-move'; path: readonly string[]; counters: readonly MovingCounter[] }

export interface GroundPolicies {
  movement?: (state: Readonly<ScorpionInPlay>) => Omit<MovementBoard, 'map' | 'weather' | 'trainbustingAt'>
  supplyRail?: SupplyRailBoard
  combat?: { hedgehogAt?: (hex: string) => number }
}

export function applyScorpionGroundAction(state: Readonly<ScorpionInPlay>, side: Side, action: ScorpionGroundAction,
  assets: ScorpionSetupAssets, board: GroundPolicies): ScorpionInPlay {
  const { map } = assets
  const stack = action.type === 'reserve-stack-move'
  const counters = stack ? action.counters : [action]
  const origin = state.units[counters[0]?.unitId ?? '']?.hex
  if (stack && (state.cursor.phase !== 'movement' || !counters.length || !origin ||
    new Set(counters.map(({ unitId }) => unitId)).size !== counters.length ||
    counters.some(({ unitId }) => state.units[unitId]?.hex !== origin))) {
    throw new Error('Choose a single friendly Reserve stack in the Movement phase')
  }
  let moved = state
  if (action.type === 'ground-move' && action.face !== undefined) {
    const unit = state.units[action.unitId]
    if (!unit?.combat || unit.side !== side || unit.reserve || action.reserveFace !== undefined || state.cursor.phase !== 'movement' ||
      state.moved.includes(action.unitId) || scorpionGroundActivity(state).airlifted.includes(action.unitId) ||
      (action.face !== 'move' && action.face !== 'combat')) throw new Error('Choose a friendly counter face before beginning its movement')
    moved = { ...state, units: { ...state.units,
      [action.unitId]: scorpionModeFace(unit, assets.catalog.definitions.get(unit.definition), action.face) } }
  }
  for (const { unitId, reserveFace } of counters) {
    if (reserveFace !== undefined || (stack && !moved.units[unitId]?.reserve)) {
      moved = prepareScorpionReserve(moved, side, unitId, reserveFace ?? 'current', assets)
    }
  }
  const entrants = counters.map(({ unitId }) => unitId)
  const prior = state.groundCaptureMove
  const resumed = Boolean(prior && entrants.every((id) => Object.hasOwn(prior, id)))
  const boardState = resumed ? { ...moved, moved: moved.moved.filter((id) => !entrants.includes(id)) } : moved
  const { rules, facts } = scorpionMovementRules(boardState, side, map, board)
  for (const { unitId, fuelDumpId, fuelHeadquartersId } of counters) {
    const move = { unitId, path: action.path }
    const unit = moved.units[unitId]
    const activity = scorpionGroundActivity(moved)
    const continuingTransport = !stack && unit && !unit.combat && activity.transport?.unitId === unitId
    const priorHandling = !state.moved.includes(unitId) && unit && !unit.combat && (activity.spent[unitId] ?? 0) > 0
    const remaining = continuingTransport || priorHandling
      ? scorpionMovementAllowance(unit, state.cursor.phase) - (activity.spent[unitId] ?? 0) : undefined
    if (remaining !== undefined && remaining <= 0) throw new Error('No movement remains for this transport')
    const fueled = fuelScorpionMovement(moved, side, unitId, { dumpId: fuelDumpId, headquartersId: fuelHeadquartersId }, map, facts)
    moved = applyScorpionGroundMove(fueled, side, move, rules, resumed ? prior![unitId] : remaining)
  }
  const entered = action.path.map(scorpionHexId)
  moved = resolveScorpionMoveEntries(moved, side, entered, entrants, assets, board.supplyRail)
  const groundCaptureMove = moved.capture ? Object.fromEntries(entrants.map((id) => {
    const available = scorpionGroundMpAvailable(boardState, id, resumed ? prior![id] : undefined)
    const spent = (scorpionGroundActivity(moved).spent[id] ?? 0) - (scorpionGroundActivity(boardState).spent[id] ?? 0)
    return [id, Math.max(0, available - spent)]
  })) : null
  const transport = !stack && !moved.units[entrants[0]!]!.combat ? { unitId: entrants[0]!, enteredHex: true } : undefined
  moved = { ...moved, groundCaptureMove, groundActivity: { ...scorpionGroundActivity(moved), transport } }
  const destination = moved.units[counters[0]!.unitId]!.hex
  if (moved.units[counters[0]!.unitId]!.reserve) {
    assertScorpionReserveCapacity(moved, side)
    if ((board.combat?.hedgehogAt?.(destination) ?? 0) > 0) {
      throw new Error('A Reserve cannot finish its move in a hex with a hedgehog')
    }
  }
  if (!counters.some(({ unitId }) => moved.units[unitId]!.combat)) return moved
  const occupied = Object.fromEntries(entered.map((hex) => [hex, side]))
  return { ...moved, railControl: { ...moved.railControl, ...occupied } }
}

export function scorpionMovementRules(state: Readonly<ScorpionInPlay>, side: Side, map: MovementBoard['map'], board: GroundPolicies) {
  const facts = scorpionSupplyPosition(state, map, side, board.supplyRail, true)
  const movement = board.movement?.(state) ?? {
    enemyCombat: (hex: string) => facts.enemyCombat.has(hex),
    enemySupplySource: (hex: string) => scorpionSupplySources[side === 'axis' ? 'soviet' : 'axis'].some((source) => source === hex),
    unnegatedEnemyZoc: (hex: string) => facts.unnegatedEnemyZoc.has(hex),
  }
  const trainbusting = state.trainbusting ?? []
  const trainbustingAt = (hex: string, side: Side, mobility: Mobility) =>
    inTrainbustingZone(trainbusting, side, hex, map.neighbors, mobility)
  return { facts, rules: { ...movement, map, weather: state.turn.weather.ground, trainbustingAt } }
}
