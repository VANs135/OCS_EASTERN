import { rollDie } from '@ocs-eastern/series/rng'
import type { Side } from '@ocs-eastern/series/state-types'
import { barrageColumn, barrageDensity, rollGroundBarrage } from '@ocs-eastern/series/tables/barrage'
import type { BarrageTable } from '@ocs-eastern/series/tables/barrage'
import { actingSide } from '@ocs-eastern/series/turn'
import { scorpionHexDistance, scorpionHexId } from '../import/hex-id.ts'
import type { ScorpionMap, Terrain } from '../import/scorpion-map.ts'
import { combatTerrainCategory } from '../ttw/scorpion/combat-terrain.ts'
import { applyScorpionCombatLosses } from './scorpion-combat-losses.ts'
import { remainingSteps } from './scorpion-losses.ts'
import { assertScorpionReserveAtMovementEnd } from './scorpion-reserves.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import { scorpionSpPayment, totalTokens } from './scorpion-sp-payment.ts'
import type { SupplyPayment } from './scorpion-sp-payment.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'

type Firing = { unitId: string; re?: number }
type Supply = { kind: 'direct'; payments: readonly SupplyPayment[] }
  | { kind: 'hq'; hqId: string; payments: readonly SupplyPayment[] }
export type BarrageAction = { type: 'declare-artillery-barrage'; target: string; batteries: readonly Firing[]; supply: Supply }
  | { type: 'choose-barrage-terrain'; terrain: Terrain }
  | { type: 'assign-barrage-loss'; allocation: readonly { unitId: string; steps: number }[] }

export interface ScorpionBarrage {
  target: string
  defender: Side
  batteries: readonly Required<Firing>[]
  strength: number
  initialColumn: number
  cost: number
  hedgehog: number
  roll?: ReturnType<typeof rollGroundBarrage>
  lossesDue?: number
}

export type ScorpionBarrageRecord = ScorpionBarrage & {
  turn: number
  phasing: Side
  phase: ScorpionInPlay['cursor']['phase']
  terrain: Terrain
}

export function scorpionPhaseBarrages(state: Readonly<ScorpionInPlay>) {
  return (state.barrageHistory ?? []).filter(({ turn, phasing, phase }) =>
    turn === state.cursor.turn && phasing === state.cursor.phasing && phase === state.cursor.phase)
}

export function applyScorpionBarrage(state: Readonly<ScorpionInPlay>, actor: Side, action: BarrageAction,
  assets: ScorpionSetupAssets, table: BarrageTable, hedgehogAt?: (hex: string) => number,
  rail?: SupplyRailBoard): ScorpionInPlay {
  if (action.type === 'declare-artillery-barrage') {
    return declare(state, actor, action, assets.map, table, hedgehogAt, rail)
  }
  const barrage = state.barrage
  if (!barrage || actor !== barrage.defender) throw new Error('The targeted player must respond to the barrage')
  if (action.type === 'choose-barrage-terrain') {
    if (barrage.roll) throw new Error('Barrage terrain is already settled')
    return settleTerrain(state, actor, barrage, action.terrain, assets.map, table)
  }
  if (!barrage.lossesDue || new Set(action.allocation.map(({ unitId }) => unitId)).size !== action.allocation.length ||
    action.allocation.reduce((total, { steps }) => total + steps, 0) !== barrage.lossesDue) {
    throw new Error('Assign exactly the mandatory barrage losses')
  }
  const defenders = new Map(targetUnits(state, actor, barrage.target))
  for (const { unitId, steps } of action.allocation) {
    const unit = defenders.get(unitId)
    if (!unit || !Number.isSafeInteger(steps) || steps < 1 || steps > remainingSteps(unit)) {
      throw new Error('Only combat units in the target hex can take barrage losses')
    }
  }
  const settled = applyScorpionCombatLosses(state, new Map(action.allocation.map(({ unitId, steps }) => [unitId, steps])), assets, rail)
  return { ...settled, barrage: null }
}

function declare(state: Readonly<ScorpionInPlay>, actor: Side,
  action: Extract<BarrageAction, { type: 'declare-artillery-barrage' }>, map: ScorpionMap,
  table: BarrageTable, hedgehogAt?: (hex: string) => number, rail?: SupplyRailBoard): ScorpionInPlay {
  const { phasing, phase } = state.cursor
  const history = scorpionPhaseBarrages(state)
  const target = scorpionHexId(action.target)
  const defender = actor === 'axis' ? 'soviet' : 'axis'
  if (state.barrage || state.combat || state.combatTargets?.length || actingSide(phasing, phase) !== actor ||
    (phase !== 'reaction' && phase !== 'combat' && phase !== 'exploitation') ||
    !map.hexes.has(target) || !targetUnits(state, defender, target).length || history.some((event) => event.target === target)) {
    throw new Error('Artillery may barrage an enemy stack once per phase before regular combat')
  }
  if (phase !== 'combat') assertScorpionReserveAtMovementEnd(state, actor, hedgehogAt)
  if (!action.batteries.length || new Set(action.batteries.map(({ unitId }) => unitId)).size !== action.batteries.length) {
    throw new Error('Select one or more distinct artillery counters')
  }
  let strength = 0
  const batteries = action.batteries.map(({ unitId, re }) => {
    const unit = Object.hasOwn(state.units, unitId) ? state.units[unitId] : undefined
    const face = unit?.artillery
    if (!unit || unit.side !== actor || unit.reserve || !face?.strength || !face.range || unit.hex === target ||
      scorpionHexDistance(unit.hex, target) > face.range || (phase === 'reaction' && !unit.released) ||
      (phase === 'exploitation' && !unit.released && !unit.exploit)) throw new Error('Select eligible artillery within printed range')
    const used = history.flatMap((event) => event.batteries).filter((battery) => battery.unitId === unitId)
      .reduce((total, battery) => total + battery.re, 0)
    const remaining = (face.independentRe ? remainingSteps(unit) : 1) - used
    const firing = re ?? remaining
    if (!Number.isSafeInteger(firing) || firing < 1 || firing > remaining) throw new Error('Select eligible unused artillery RE')
    strength += face.strength * firing / (face.independentRe ? unit.printedRe : 1) * (unit.disorganized ? 0.5 : 1)
    return { unitId, re: firing }
  })
  const { initialColumn, cost } = barrageColumn(table, strength)
  const { supply } = action
  if (totalTokens(supply.payments) !== cost || (supply.kind === 'direct' && batteries.length > 1 &&
    new Set(supply.payments.map(({ dumpId }) => dumpId)).size !== 1)) {
    throw new Error('Pay the initial column cost through a common HQ or a single shared dump')
  }
  const ledger = scorpionSpPayment(state, actor, map, rail)
  ledger.spend(supply.payments, (_, hex) => batteries.every(({ unitId }) => {
    const unit = state.units[unitId]!
    return supply.kind === 'hq' ? ledger.network.canUseDumpVia(supply.hqId, unit.hex, hex)
      : ledger.network.canDrawDump(unit.hex, hex, unit.traceDrawMobility)
  }))
  const hedgehog = hedgehogAt?.(target) ?? 0
  if (!Number.isInteger(hedgehog) || hedgehog < 0 || hedgehog > 4) throw new Error('Invalid hedgehog level')
  return { ...state, dumps: ledger.dumps, barrage: { target, defender, batteries, strength, initialColumn, cost, hedgehog } }
}

function settleTerrain(state: Readonly<ScorpionInPlay>, actor: Side, barrage: ScorpionBarrage, terrain: Terrain,
  map: ScorpionMap, table: BarrageTable): ScorpionInPlay {
  if (!map.hexes.get(barrage.target)?.terrains.includes(terrain)) throw new Error('Choose a printed terrain in the target hex')
  const defenders = targetUnits(state, actor, barrage.target)
  const density = barrageDensity(defenders.map(([, unit]) => ({ re: unit.printedRe - unit.stepsLost, formation: unit.formation })))
  const spotter = Object.values(state.units).some((unit) => unit.combat && unit.side !== actor &&
    map.neighbors(barrage.target).includes(unit.hex))
  let rng = state.rng
  const roll = rollGroundBarrage(table, barrage.initialColumn, { density, hedgehog: barrage.hedgehog,
    terrain: combatTerrainCategory(terrain), spotter }, () => {
    const draw = rollDie(rng)
    rng = draw.rng
    return draw.value
  })
  const units = { ...state.units }
  if (roll.disorganize) for (const [id, unit] of Object.entries(units)) {
    if (unit.side !== actor || unit.hex !== barrage.target) continue
    if (unit.combat) units[id] = { ...unit, disorganized: true, reserve: undefined, exploit: false }
    else if (unit.organicTruck !== undefined && unit.reserve) units[id] = { ...unit, reserve: undefined }
  }
  const lossesDue = Math.min(roll.loss, defenders.reduce((sum, [, unit]) => sum + remainingSteps(unit), 0))
  const result = { ...barrage, roll, lossesDue }
  const { turn, phasing, phase } = state.cursor
  return { ...state, units, rng, barrage: lossesDue ? result : null,
    barrageHistory: [...(state.barrageHistory ?? []), { ...result, turn, phasing, phase, terrain }] }
}

function targetUnits(state: Readonly<ScorpionInPlay>, side: Side, at: string) {
  return Object.entries(state.units).filter(([, unit]) => unit.combat && unit.side === side && unit.hex === at)
}
