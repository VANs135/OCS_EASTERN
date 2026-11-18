import { rollDie } from '@ocs-eastern/series/rng'
import type { Side } from '@ocs-eastern/series/state-types'
import { barrageColumn, barrageDensity, rollGroundBarrage } from '@ocs-eastern/series/tables/barrage'
import type { BarrageTable, rollFacilityBarrage } from '@ocs-eastern/series/tables/barrage'
import { actingSide } from '@ocs-eastern/series/turn'
import { scorpionHexDistance, scorpionHexId } from '../import/hex-id.ts'
import { scorpionModeFace } from '../import/scorpion-mode-face.ts'
import type { ScorpionMap, Terrain } from '../import/scorpion-map.ts'
import { scorpionBarrageFrontAt, scorpionBarrageFronts } from '../ttw/scorpion/barrage-markers.ts'
import type { ScorpionBarrageFront } from '../ttw/scorpion/barrage-markers.ts'
import { combatTerrainCategory } from '../ttw/scorpion/combat-terrain.ts'
import { scorpionSupplyNetwork } from '../ttw/scorpion/supply-trace.ts'
import { settleScorpionAirfieldBarrage } from './scorpion-airfield-barrage.ts'
import type { AirfieldBarrageResult } from './scorpion-airfield-barrage.ts'
import { scorpionPhaseBarrages, scorpionRegularBarrageTargets } from './scorpion-barrage-timing.ts'
import { applyScorpionCombatLosses } from './scorpion-combat-losses.ts'
import { remainingSteps } from './scorpion-losses.ts'
import { assertScorpionReserveAtMovementEnd } from './scorpion-reserves.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import { scorpionSpPayment, totalTokens } from './scorpion-sp-payment.ts'
import type { SupplyPayment } from './scorpion-sp-payment.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'
import { scorpionSupplyPosition } from './scorpion-supply-position.ts'

type Firing = { unitId: string; re?: number }
type Volley = { target: string; batteries: readonly Firing[] }
type Supply = { kind: 'direct'; payments: readonly SupplyPayment[] }
  | { kind: 'hq'; hqId: string; payments: readonly SupplyPayment[] }
export type BarrageAction = ({ type: 'declare-artillery-barrage'; supply: Supply; targetKind?: 'units' | 'air-base' } & Volley)
  | { type: 'declare-front-barrage'; front: ScorpionBarrageFront; center: string; hqId: string; volleys: readonly Volley[] }
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
  air?: { hipShoot: boolean; shortRange: boolean; tankBuster: boolean }
  roll?: ReturnType<typeof rollGroundBarrage>
  lossesDue?: number
  lossCandidates?: readonly string[]
}

export interface ScorpionFrontBarrage {
  front: ScorpionBarrageFront
  center: string
  remaining: readonly ScorpionBarrage[]
}

export type ScorpionBarrageRecord = ScorpionBarrage & {
  turn: number
  phasing: Side
  phase: ScorpionInPlay['cursor']['phase']
  terrain?: Terrain
  facilityRoll?: AirfieldBarrageResult
  trainbustingRoll?: ReturnType<typeof rollFacilityBarrage> & { placed: boolean }
}

export function applyScorpionBarrage(state: Readonly<ScorpionInPlay>, actor: Side, action: BarrageAction,
  assets: ScorpionSetupAssets, table: BarrageTable, hedgehogAt?: (hex: string) => number,
  rail?: SupplyRailBoard): ScorpionInPlay {
  if (action.type === 'declare-artillery-barrage') {
    return declare(state, actor, action, assets.map, table, hedgehogAt, rail)
  }
  if (action.type === 'declare-front-barrage') {
    return declareFront(state, actor, action, assets.map, table, hedgehogAt, rail)
  }
  const barrage = state.barrage
  if (!barrage || actor !== barrage.defender) throw new Error('The targeted player must respond to the barrage')
  if (action.type === 'choose-barrage-terrain') {
    if (barrage.roll) throw new Error('Barrage terrain is already settled')
    return settleTerrain(state, actor, barrage, action.terrain, assets, table)
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
    if (barrage.lossCandidates && !barrage.lossCandidates.includes(unitId)) {
      throw new Error('Tank-buster loss must be taken by an eligible unit with the highest Combat Mode strength')
    }
  }
  const settled = applyScorpionCombatLosses(state, new Map(action.allocation.map(({ unitId, steps }) => [unitId, steps])), assets, rail)
  return finishBarrage(settled)
}

function declare(state: Readonly<ScorpionInPlay>, actor: Side,
  action: Extract<BarrageAction, { type: 'declare-artillery-barrage' }>, map: ScorpionMap,
  table: BarrageTable, hedgehogAt?: (hex: string) => number, rail?: SupplyRailBoard): ScorpionInPlay {
  const { phasing, phase } = state.cursor
  const history = scorpionPhaseBarrages(state)
  const target = scorpionHexId(action.target)
  const defender = actor === 'axis' ? 'soviet' : 'axis'
  const facility = action.targetKind === 'air-base'
  if (!facility && action.targetKind !== undefined && action.targetKind !== 'units') throw new Error('Invalid barrage target kind')
  const targetExists = facility ? state.airBases.some((base) => base.side === defender && base.hex === target)
    : targetUnits(state, defender, target).length > 0
  if (state.barrage || state.combat || state.combatTargets?.length || actingSide(phasing, phase) !== actor ||
    (phase !== 'reaction' && phase !== 'combat' && phase !== 'exploitation') ||
    !map.hexes.has(target) || !targetExists || scorpionRegularBarrageTargets(state).has(target)) {
    throw new Error('Artillery may barrage an enemy target once per phase before regular combat')
  }
  if (phase !== 'combat') assertScorpionReserveAtMovementEnd(state, actor, hedgehogAt)
  const barrage = prepareBarrage(state, actor, action, table,
    history.flatMap((event) => event.batteries), facility ? undefined : hedgehogAt)
  const { cost, batteries } = barrage
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
  const paid = { ...state, dumps: ledger.dumps }
  return facility ? settleScorpionAirfieldBarrage(paid, barrage, table) : { ...paid, barrage }
}

function declareFront(state: Readonly<ScorpionInPlay>, actor: Side,
  action: Extract<BarrageAction, { type: 'declare-front-barrage' }>, map: ScorpionMap,
  table: BarrageTable, hedgehogAt?: (hex: string) => number, rail?: SupplyRailBoard): ScorpionInPlay {
  const { front, hqId, volleys } = action
  const { cursor } = state
  if (!scorpionBarrageFronts.includes(front) || actor !== 'soviet' || cursor.phasing !== actor || cursor.turn !== 1 ||
    cursor.phase !== 'movement' || state.barrage || state.barrageRecovery?.[front]) {
    throw new Error('Scorpion artillery markers are available once per front during Soviet turn-one Movement')
  }
  const hq = Object.hasOwn(state.units, hqId) ? state.units[hqId] : undefined
  if (!hq?.headquarters || hq.side !== actor || hq.headquarters.kessel) {
    throw new Error('Choose a Soviet Army HQ to support the front barrage')
  }
  assertScorpionReserveAtMovementEnd(state, actor, hedgehogAt)
  const center = scorpionHexId(action.center)
  if (scorpionBarrageFrontAt(center) !== front) throw new Error('Place the artillery marker in its Scorpion sector')
  const near = map.neighbors(center)
  const network = scorpionSupplyNetwork(map, scorpionSupplyPosition(state, map, actor, rail))
  if (!map.hexes.has(center) || !network.inThrowRange(hqId, center) ||
    !Object.values(state.units).some((unit) => unit.side === actor && unit.combat && near.includes(unit.hex))) {
    throw new Error('Place the marker within the Army HQ throw range and adjacent to a Soviet combat unit')
  }
  const targets = volleys.map((volley) => scorpionHexId(volley.target))
  const history = scorpionPhaseBarrages(state)
  const firedAt = scorpionRegularBarrageTargets(state)
  if (volleys.length < 1 || volleys.length > 3 || !targets.includes(center) || new Set(targets).size !== targets.length ||
    targets.some((hex) => (hex !== center && !near.includes(hex)) ||
      !targetUnits(state, 'axis', hex).length || firedAt.has(hex))) {
    throw new Error('Choose the marker hex and up to two adjacent unbarraged enemy stacks')
  }
  const used = history.flatMap((event) => event.batteries)
  const barrages = volleys.map((volley) => {
    const barrage = prepareBarrage(state, actor, volley, table, used, hedgehogAt)
    used.push(...barrage.batteries)
    return { ...barrage, cost: 0 }
  })
  const firingHexes = new Set(barrages.flatMap(({ batteries }) => batteries.map(({ unitId }) => state.units[unitId]!.hex)))
  const connected = new Set([firingHexes.values().next().value!])
  for (const hex of connected) for (const neighbor of map.neighbors(hex)) if (firingHexes.has(neighbor)) connected.add(neighbor)
  if (connected.size !== firingHexes.size) throw new Error('Front artillery must occupy the same or contiguous hexes')
  const [barrage, ...remaining] = barrages
  return { ...state, barrage: barrage!, frontBarrage: { front, center, remaining } }
}

function prepareBarrage(state: Readonly<ScorpionInPlay>, actor: Side, volley: Volley, table: BarrageTable,
  fired: readonly Required<Firing>[], hedgehogAt?: (hex: string) => number): ScorpionBarrage {
  const target = scorpionHexId(volley.target)
  const phase = state.cursor.phase
  if (!volley.batteries.length || new Set(volley.batteries.map(({ unitId }) => unitId)).size !== volley.batteries.length) {
    throw new Error('Select one or more distinct artillery counters')
  }
  let strength = 0
  const batteries = volley.batteries.map(({ unitId, re }) => {
    const unit = Object.hasOwn(state.units, unitId) ? state.units[unitId] : undefined
    const face = unit?.artillery
    if (!unit || unit.side !== actor || unit.reserve || !face?.strength || !face.range || unit.hex === target ||
      scorpionHexDistance(unit.hex, target) > face.range || (phase === 'reaction' && !unit.released) ||
      (phase === 'exploitation' && !unit.released && !unit.exploit) || (phase === 'movement' && (unit.moveMode || unit.disorganized))) {
      throw new Error('Select eligible artillery within printed range')
    }
    const used = fired.filter((battery) => battery.unitId === unitId)
      .reduce((total, battery) => total + battery.re, 0)
    const remaining = (face.independentRe ? remainingSteps(unit) : 1) - used
    const firing = re ?? remaining
    if (!Number.isSafeInteger(firing) || firing < 1 || firing > remaining) throw new Error('Select eligible unused artillery RE')
    strength += face.strength * firing / (face.independentRe ? unit.printedRe : 1) * (unit.disorganized ? 0.5 : 1)
    return { unitId, re: firing }
  })
  const { initialColumn, cost } = barrageColumn(table, strength)
  const hedgehog = hedgehogAt?.(target) ?? 0
  if (!Number.isInteger(hedgehog) || hedgehog < 0 || hedgehog > 4) throw new Error('Invalid hedgehog level')
  return { target, defender: actor === 'axis' ? 'soviet' : 'axis', batteries, strength, initialColumn, cost, hedgehog }
}

function settleTerrain(state: Readonly<ScorpionInPlay>, actor: Side, barrage: ScorpionBarrage, terrain: Terrain,
  { map, catalog }: ScorpionSetupAssets, table: BarrageTable): ScorpionInPlay {
  if (!map.hexes.get(barrage.target)?.terrains.includes(terrain)) throw new Error('Choose a printed terrain in the target hex')
  const defenders = targetUnits(state, actor, barrage.target)
  const density = barrageDensity(defenders.map(([, unit]) => ({ re: unit.printedRe - unit.stepsLost, formation: unit.formation })))
  const spotter = hasScorpionBarrageSpotter(state, actor === 'axis' ? 'soviet' : 'axis', barrage.target, map)
  let rng = state.rng
  // TTW 2.2f. Override the printed result before any half-loss die is rolled.
  const tankBuster = barrage.air?.tankBuster
  const roll = rollGroundBarrage(table, barrage.initialColumn, { density, hedgehog: barrage.hedgehog,
    terrain: combatTerrainCategory(terrain), spotter, air: barrage.air, dieModifier: tankBuster ? 1 : 0,
    resultOverrides: tankBuster ? { '[1/2]': '1', '1/2': '1', '2': '1', '3': '1' } : undefined }, () => {
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
  const eligible = barrage.air?.tankBuster && lossesDue ? defenders.filter(([, unit]) => unit.combatClass !== 'other')
    .map(([id, unit]) => ({ id, strength: scorpionModeFace(unit, catalog.definitions.get(unit.definition), 'combat').strength })) : null
  const strongest = eligible && Math.max(...eligible.map(({ strength }) => strength))
  const candidates = eligible?.filter(({ strength }) => strength === strongest).map(({ id }) => id)
  const result = { ...barrage, roll, lossesDue, ...(candidates ? { lossCandidates: candidates } : {}) }
  const { turn, phasing, phase } = state.cursor
  const settled = { ...state, units, rng, barrage: result,
    barrageHistory: [...(state.barrageHistory ?? []), { ...result, turn, phasing, phase, terrain }] }
  return lossesDue ? settled : finishBarrage(settled)
}

function finishBarrage(state: Readonly<ScorpionInPlay>): ScorpionInPlay {
  const plan = state.frontBarrage
  if (!plan) return { ...state, barrage: null }
  const [next, ...remaining] = plan.remaining
  if (!state.victory && next) return { ...state, barrage: next, frontBarrage: { ...plan, remaining } }
  return { ...state, barrage: null, frontBarrage: null, barrageRecovery: { ...state.barrageRecovery, [plan.front]: 1 } }
}

export function targetUnits(state: Readonly<ScorpionInPlay>, side: Side, at: string) {
  return Object.entries(state.units).filter(([, unit]) => unit.combat && unit.side === side && unit.hex === at)
}

export function hasScorpionBarrageSpotter(state: Readonly<ScorpionInPlay>, side: Side, target: string, map: ScorpionMap) {
  const adjacent = map.neighbors(target)
  return Object.values(state.units).some((unit) => unit.combat && unit.side === side && adjacent.includes(unit.hex))
}
