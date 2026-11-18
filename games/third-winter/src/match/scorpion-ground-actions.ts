import type { Side } from '@ocs-eastern/series/state-types'
import { scorpionHexId } from '../import/hex-id.ts'
import { scorpionSupplySources } from '../ttw/scorpion/initial-map.ts'
import { applyScorpionGroundMove } from './scorpion-movement.ts'
import type { MovementBoard } from './scorpion-movement.ts'
import { assertScorpionReserveCapacity, prepareScorpionReserve } from './scorpion-reserves.ts'
import type { ScorpionReserveFace } from './scorpion-reserves.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'
import { scorpionSupplyPosition } from './scorpion-supply-position.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'
import { moveScorpionWithFuel } from './scorpion-unit-fuel.ts'

type MovingCounter = { unitId: string; fuelDumpId?: string; reserveFace?: ScorpionReserveFace }
export type ScorpionGroundAction = ({ type: 'ground-move'; path: readonly string[] } & MovingCounter)
  | { type: 'reserve-stack-move'; path: readonly string[]; counters: readonly MovingCounter[] }

interface GroundPolicies {
  movement?: (state: Readonly<ScorpionInPlay>) => Omit<MovementBoard, 'map' | 'weather'>
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
  for (const { unitId, reserveFace } of counters) {
    if (reserveFace !== undefined || (stack && !moved.units[unitId]?.reserve)) {
      moved = prepareScorpionReserve(moved, side, unitId, reserveFace ?? 'current', assets)
    }
  }
  const facts = scorpionSupplyPosition(moved, map, side, board.supplyRail, true)
  const movement = board.movement?.(moved) ?? {
    enemyCombat: (hex: string) => facts.enemyCombat.has(hex),
    enemySupplySource: (hex: string) => scorpionSupplySources[side === 'axis' ? 'soviet' : 'axis'].some((source) => source === hex),
    unnegatedEnemyZoc: (hex: string) => facts.unnegatedEnemyZoc.has(hex),
  }
  const rules = { ...movement, map, weather: state.turn.weather.ground }
  for (const { unitId, fuelDumpId } of counters) {
    const move = { unitId, path: action.path }
    moved = fuelDumpId === undefined ? applyScorpionGroundMove(moved, side, move, rules)
      : moveScorpionWithFuel(moved, side, move, fuelDumpId, rules, facts)
  }
  const destination = moved.units[counters[0]!.unitId]!.hex
  if (moved.units[counters[0]!.unitId]!.reserve) {
    assertScorpionReserveCapacity(moved, side)
    if ((board.combat?.hedgehogAt?.(destination) ?? 0) > 0) {
      throw new Error('A Reserve cannot finish its move in a hex with a hedgehog')
    }
  }
  if (!counters.some(({ unitId }) => moved.units[unitId]!.combat)) return moved
  const occupied = Object.fromEntries(action.path.map((hex) => [scorpionHexId(hex), side]))
  return { ...moved, railControl: { ...moved.railControl, ...occupied } }
}
