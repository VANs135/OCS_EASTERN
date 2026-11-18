import type { Side } from '@ocs-eastern/series/state-types'
import { actingSide } from '@ocs-eastern/series/turn'
import { scorpionHexId } from '../import/hex-id.ts'
import { scorpionRegularBarrageTargets } from './scorpion-barrage-timing.ts'
import { resolveScorpionEntry, resolveScorpionMoveEntries } from './scorpion-capture.ts'
import { startScorpionCombat } from './scorpion-combat.ts'
import type { ScorpionAttackOrder, ScorpionCombat, ScorpionCombatBoard } from './scorpion-combat.ts'
import { scorpionMovementRules } from './scorpion-ground-actions.ts'
import type { GroundPolicies } from './scorpion-ground-actions.ts'
import { canMoveInPhase, scorpionMovementAllowance, scorpionMovementStepCost, walkScorpionGroundRoute } from './scorpion-movement.ts'
import { assertScorpionStacking } from './scorpion-retreat.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'
import { fuelScorpionCounter } from './scorpion-unit-fuel.ts'

const overrunCost = 3

export interface ScorpionOverrunMarch {
  remaining: Readonly<Record<string, number>>
  enteredHex: boolean
}

export type DeclareOverrun = ScorpionAttackOrder & { type: 'declare-overrun'; path?: readonly string[];
  fuel?: readonly { unitId: string; dumpId: string }[] }
export type FinishOverrunMove = { type: 'continue-overrun-move'; path: readonly string[] }

export function declareScorpionOverrun(state: Readonly<ScorpionInPlay>, side: Side, action: DeclareOverrun,
  assets: ScorpionSetupAssets, board: GroundPolicies, combatBoard: ScorpionCombatBoard): ScorpionInPlay {
  const { map } = assets
  assertOverrunWindow(state, side)
  const path = action.path ?? []
  const ids = action.attackers
  const origin = state.units[ids[0] ?? '']?.hex
  const phase = state.cursor.phase
  const previous = state.overrunMarch ?? (state.groundCaptureMove && { remaining: state.groundCaptureMove, enteredHex: true })
  const resumed = Boolean(previous && ids.every((id) => Object.hasOwn(previous.remaining, id)))
  if (!origin || new Set(ids).size !== ids.length || ids.some((id) => {
    const counter = Object.hasOwn(state.units, id) ? state.units[id] : undefined
    return !counter?.attackCapable || counter.side !== side || counter.hex !== origin ||
      counter.reserve || counter.disorganized || !canMoveInPhase(counter, phase) ||
      (!resumed && state.moved.includes(id))
  })) throw new Error('Choose eligible attackers that started the phase stacked and are moving together')
  const target = scorpionHexId(action.target)
  const fuel = action.fuel ?? []
  if (new Set(fuel.map(({ unitId }) => unitId)).size !== fuel.length || fuel.some(({ unitId }) => !ids.includes(unitId))) {
    throw new Error('Fuel payments must identify distinct participants')
  }
  const { facts, rules } = movementRules(state, side, ids, assets, board)
  let fueled = state
  for (const { unitId, dumpId } of fuel) fueled = fuelScorpionCounter(fueled, side, unitId, dumpId, map, facts)
  const remaining = Object.fromEntries(ids.map((id) => [id, resumed ? previous!.remaining[id]!
    : scorpionMovementAllowance(fueled.units[id]!, phase)]))
  const march = { remaining, enteredHex: resumed && previous!.enteredHex }
  const moved = moveStack(fueled, side, ids, path, march, assets, board)
  if (moved.capture) throw new Error('Resolve this entry capture before declaring the overrun')
  const hex = moved.units[ids[0]!]!.hex
  assertScorpionStacking(moved, hex)
  if (!map.neighbors(hex).includes(target) || rules.enemySupplySource(target, side)) {
    throw new Error('Choose an enterable adjacent overrun target')
  }
  for (const id of ids) {
    if (moved.overrunMarch!.remaining[id]! < overrunCost) throw new Error('Each overrunning unit needs at least 3 MP left')
    const cost = scorpionMovementStepCost(rules, hex, target, moved.units[id]!, false)
    if (typeof cost !== 'number' || cost > overrunCost) {
      throw new Error('Overrun entry must cost at most 3 MP before roads, rail or bridges, including any Trainbusting surcharge')
    }
  }
  const started = startScorpionCombat({ ...moved, groundCaptureMove: null }, side, action, map, combatBoard, board.supplyRail, 'overrun')
  return { ...started, overrunMarch: { ...moved.overrunMarch!,
    remaining: Object.fromEntries(ids.map((id) => [id, moved.overrunMarch!.remaining[id]! - overrunCost])) } }
}

export function continueScorpionOverrunMove(state: Readonly<ScorpionInPlay>, side: Side, action: FinishOverrunMove,
  assets: ScorpionSetupAssets, board: GroundPolicies): ScorpionInPlay {
  assertOverrunWindow(state, side)
  const march = state.overrunMarch
  if (!march || !action.path.length) throw new Error('Choose a path for the current overrun stack')
  const ids = Object.keys(march.remaining)
  const moved = moveStack(state, side, ids, action.path, march, assets, board)
  return moved.capture ? moved : { ...moved, overrunMarch: null }
}

export function finishScorpionOverrun(state: Readonly<ScorpionInPlay>, combat: ScorpionCombat, vacant: boolean,
  assets: ScorpionSetupAssets): ScorpionInPlay {
  const { attackers, target, attacker, attackerRetreated } = combat
  if (!state.overrunMarch || attackerRetreated) return { ...state, combat: null, overrunMarch: null }
  const survivors = attackers.filter((id) => Object.hasOwn(state.units, id))
  if (!survivors.length) return { ...state, combat: null, overrunMarch: null }
  const march = { enteredHex: state.overrunMarch.enteredHex || vacant,
    remaining: Object.fromEntries(survivors.map((id) => [id, state.overrunMarch!.remaining[id]!])) }
  if (!vacant) return { ...state, combat: null, overrunMarch: march }
  const advanced = { ...state, combat: null, overrunMarch: march,
    units: { ...state.units, ...Object.fromEntries(survivors.map((id) => [id, { ...state.units[id]!, hex: target }])) },
    railControl: { ...state.railControl, [target]: attacker } }
  assertScorpionStacking(advanced, target)
  return resolveScorpionEntry(advanced, attacker, target, survivors, assets, true)
}

function assertOverrunWindow(state: Readonly<ScorpionInPlay>, side: Side) {
  const { phase, phasing } = state.cursor
  if (state.combat || state.barrage || state.combatTargets?.length || scorpionRegularBarrageTargets(state).size ||
    state.turn.weather.ground === 'thaw' || actingSide(phasing, phase) !== side ||
    (phase !== 'movement' && phase !== 'reaction' && phase !== 'exploitation')) {
    throw new Error('Overrun movement requires the active Movement Segment')
  }
}

function movementRules(state: Readonly<ScorpionInPlay>, side: Side, ids: readonly string[],
  assets: ScorpionSetupAssets, board: GroundPolicies) {
  return scorpionMovementRules({ ...state, moved: state.moved.filter((id) => !ids.includes(id)) }, side, assets.map, board)
}

function moveStack(state: Readonly<ScorpionInPlay>, side: Side, ids: readonly string[], path: readonly string[],
  march: ScorpionOverrunMarch, assets: ScorpionSetupAssets, board: GroundPolicies): ScorpionInPlay {
  const { rules } = movementRules(state, side, ids, assets, board)
  const units = { ...state.units }
  const remaining = { ...march.remaining }
  for (const id of ids) {
    const counter = units[id]!
    const allowance = remaining[id]!
    if (!Number.isFinite(allowance) || counter.disorganized || (counter.mobility !== 'leg' && !counter.fueled)) {
      throw new Error('Overrun movement requires eligible fueled units')
    }
    if (path.length && march.enteredHex && counter.mobility === 'truck' && rules.unnegatedEnemyZoc(counter.hex, side)) {
      throw new Error('Trucks entering an enemy ZOC must stop or overrun again from their current hex')
    }
    const route = walkScorpionGroundRoute(counter, path, rules, allowance)
    remaining[id] = allowance - route.spent
    units[id] = { ...counter, hex: route.destination }
  }
  const hexes = path.map(scorpionHexId)
  const occupied = Object.fromEntries(hexes.map((hex) => [hex, side]))
  const moved = { ...state, units, overrunMarch: { remaining, enteredHex: march.enteredHex || path.length > 0 },
    moved: [...new Set([...state.moved, ...ids])], railControl: { ...state.railControl, ...occupied } }
  return resolveScorpionMoveEntries(moved, side, hexes, ids, assets)
}
