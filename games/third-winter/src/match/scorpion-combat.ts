import { rollDie } from '@ocs-eastern/series/rng'
import type { Side } from '@ocs-eastern/series/state-types'
import type { CrtLike } from '@ocs-eastern/series/tables/crt'
import { rollRegularCombat } from '@ocs-eastern/series/tables/ground-combat'
import { scorpionHexId } from '../import/hex-id.ts'
import type { ScorpionMap, Terrain } from '../import/scorpion-map.ts'
import { combatRating, combatStrength, combatTerrainCategory } from '../ttw/scorpion/combat-terrain.ts'
import type { AttackTerrain } from '../ttw/scorpion/combat-terrain.ts'
import { scorpionSupplySources } from '../ttw/scorpion/initial-map.ts'
import { scorpionSupplyNetwork } from '../ttw/scorpion/supply-trace.ts'
import { scorpionStepCost } from '../ttw/scorpion/terrain-cost.ts'
import { remainingSteps } from './scorpion-losses.ts'
import { assertScorpionReserveAtMovementEnd } from './scorpion-reserves.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import { usableDump } from './scorpion-supply-phase.ts'
import { scorpionSupplyPosition } from './scorpion-supply-position.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'

export interface ScorpionCombatBoard {
  table: CrtLike
  hedgehogAt?: (hex: string) => number
}

export interface ScorpionCombat {
  target: string
  attacker: Side
  attackers: readonly string[]
  defenders: readonly string[]
  heldAtStart: Readonly<Record<Side, readonly string[]>>
  hedgehog: number
  defenseSupplied?: boolean
  attackerLeader?: string
  defenderLeader?: string
  roll?: ReturnType<typeof rollRegularCombat>
  step: 'defender-supply' | 'attacker-rating' | 'defender-rating' | 'defender-terrain' | 'attacker-result' | 'defender-result' | 'advance'
  defenderMayIgnore?: boolean
  attackerRetreated?: boolean
}

type Payment = { dumpId: string; tokens: number }
export type DeclareCombat = { type: 'declare-combat'; target: string; attackers: readonly string[];
  payments: readonly (Payment & { unitId: string })[] }
export type DefendCombat = { type: 'defend-combat'; payments: readonly Payment[] }
export type ChooseCombatTerrain = { type: 'choose-combat-terrain'; terrain: Terrain;
  attackingTerrain: Readonly<Record<string, AttackTerrain>> }

export function declareScorpionCombat(state: Readonly<ScorpionInPlay>, actor: Side, action: DeclareCombat,
  map: ScorpionMap, board: ScorpionCombatBoard, railroad?: SupplyRailBoard): ScorpionInPlay {
  const { phase, phasing } = state.cursor
  const target = scorpionHexId(action.target)
  if (actor !== phasing || (phase !== 'combat' && phase !== 'exploitation') || state.combat ||
    !map.hexes.has(target) || state.combatTargets?.includes(target) || !action.attackers.length ||
    new Set(action.attackers).size !== action.attackers.length) throw new Error('This regular attack is unavailable')
  if (phase === 'exploitation') assertScorpionReserveAtMovementEnd(state, actor, board.hedgehogAt)

  const enemy = actor === 'axis' ? 'soviet' : 'axis'
  if (scorpionSupplySources[enemy].some((hex) => hex === target)) throw new Error('Enemy map-edge supply sources cannot be entered')
  const weather = state.turn.weather.ground === 'freeze' ? 'freeze' : 'dry'
  for (const id of action.attackers) {
    const unit = Object.hasOwn(state.units, id) ? state.units[id] : undefined
    if (!unit?.attackCapable || unit.side !== actor || unit.reserve || state.combatAttackers?.includes(id) ||
      (phase === 'exploitation' && !unit.exploit && !unit.released) ||
      scorpionStepCost(map, unit.hex, target, unit.mobility, weather) === null) {
      throw new Error('Each attacker must be eligible, unused and able to enter the target hex')
    }
  }
  const all = Object.entries(state.units).filter(([, unit]) => unit.combat)
  const defenders = all.filter(([, unit]) => unit.side === enemy && unit.hex === target).map(([id]) => id)
  if (!defenders.length) throw new Error('Choose a hex containing enemy combat units')
  const hedgehog = board.hedgehogAt?.(target) ?? 0
  if (!Number.isInteger(hedgehog) || hedgehog < 0 || hedgehog > 4) throw new Error('Invalid hedgehog level')

  const network = scorpionSupplyNetwork(map, scorpionSupplyPosition(state, map, actor, railroad))
  const totals = new Map<string, number>()
  const dumps = payDumps(state, actor, action.payments, (payment, hex) => {
    if (!action.attackers.includes(payment.unitId) || !network.canUseDump(state.units[payment.unitId]!.hex, hex)) return false
    totals.set(payment.unitId, (totals.get(payment.unitId) ?? 0) + payment.tokens)
    return true
  })
  if (action.attackers.some((id) => totals.get(id) !== remainingSteps(state.units[id]!))) {
    throw new Error('Each attacker requires one token per surviving step')
  }
  const heldAtStart = { axis: all.filter(([, unit]) => unit.side === 'axis').map(([, unit]) => unit.hex),
    soviet: all.filter(([, unit]) => unit.side === 'soviet').map(([, unit]) => unit.hex) }
  return { ...state, dumps, combat: { target, attacker: actor, attackers: [...action.attackers], defenders,
    hedgehog, heldAtStart, step: 'defender-supply' }, combatTargets: [...(state.combatTargets ?? []), target],
    combatAttackers: [...(state.combatAttackers ?? []), ...action.attackers] }
}

export function defendScorpionCombat(state: Readonly<ScorpionInPlay>, actor: Side, action: DefendCombat,
  map: ScorpionMap, railroad?: SupplyRailBoard): ScorpionInPlay {
  const combat = state.combat
  if (!combat || combat.step !== 'defender-supply' || actor === combat.attacker) throw new Error('The defender must respond')
  const cost = combat.defenders.reduce((total, id) => total + state.units[id]!.printedRe - state.units[id]!.stepsLost, 0) <= 1 ? 1 : 2
  const supplied = action.payments.length > 0
  if (supplied && action.payments.reduce((sum, payment) => sum + payment.tokens, 0) !== cost) {
    throw new Error('Pay the defensive stack cost or defend without combat supply')
  }
  const network = scorpionSupplyNetwork(map, scorpionSupplyPosition(state, map, actor, railroad))
  const dumps = payDumps(state, actor, action.payments, (_, hex) =>
    combat.defenders.every((id) => network.canUseDump(combat.target, hex, state.units[id]!.traceDrawMobility)))
  return { ...state, dumps, combat: { ...combat, defenseSupplied: supplied, step: 'attacker-rating' } }
}

function payDumps<Row extends Payment>(state: Readonly<ScorpionInPlay>, side: Side, payments: readonly Row[],
  permitted: (payment: Row, hex: string) => boolean) {
  const dumps = { ...state.dumps }
  for (const payment of payments) {
    const { dump, hex } = usableDump({ ...state, dumps }, side, payment.dumpId)
    if (!Number.isSafeInteger(payment.tokens) || payment.tokens < 1 || payment.tokens > dump.tokens || !permitted(payment, hex)) {
      throw new Error('Combat supply must come from a reachable friendly dump with sufficient tokens')
    }
    dumps[payment.dumpId] = { ...dump, tokens: dump.tokens - payment.tokens }
  }
  return dumps
}

export function selectScorpionCombatRating(state: Readonly<ScorpionInPlay>, actor: Side, id: string): ScorpionInPlay {
  const combat = state.combat
  if (combat?.step === 'attacker-rating' && combat.attacker === actor && combat.attackers.includes(id)) {
    return { ...state, combat: { ...combat, attackerLeader: id, step: 'defender-rating' } }
  }
  if (combat?.step !== 'defender-rating' || actor === combat.attacker || !combat.defenders.includes(id)) {
    throw new Error('Choose an eligible Action Rating unit in the correct order')
  }
  return { ...state, combat: { ...combat, defenderLeader: id, step: 'defender-terrain' } }
}

export function chooseScorpionCombatTerrain(state: Readonly<ScorpionInPlay>, actor: Side, action: ChooseCombatTerrain,
  map: ScorpionMap, table: CrtLike): ScorpionInPlay {
  const combat = state.combat
  if (combat?.step !== 'defender-terrain' || actor === combat.attacker || !combat.attackerLeader || !combat.defenderLeader) {
    throw new Error('The defender chooses terrain after both sides select their Action Rating')
  }
  const terrains = map.hexes.get(combat.target)!.terrains
  if (!terrains.includes(action.terrain)) throw new Error('Choose a printed defensive hex terrain')
  const attackingTerrain = Object.fromEntries([...new Set(combat.attackers.map((id) => state.units[id]!.hex))].map((from) => {
    const selected = action.attackingTerrain[from]
    const river = map.edge(from, combat.target)?.river
    if (!selected || (!terrains.some((terrain) => terrain === selected) && (!river || selected !== `${river}-river`))) {
      throw new Error(`Choose a terrain or river for the attacking stack at ${from}`)
    }
    return [from, selected]
  }))
  const frozen = state.turn.weather.ground === 'freeze'
  const defenders = combat.defenders.map((unitId) => state.units[unitId]!)
  const antiTank = Math.max(combat.hedgehog > 0 ? 2 : 0, ...defenders.map((unit) => unit.antiTank))
  const attack = combat.attackers.map((unitId) => state.units[unitId]!).reduce((sum, unit) => sum +
    combatStrength(unit, true, attackingTerrain[unit.hex]!, frozen, true, antiTank), 0)
  const defend = defenders.reduce((sum, unit) => sum +
    combatStrength(unit, false, action.terrain, frozen, combat.defenseSupplied === true, 0), 0)
  let rng = state.rng
  const result = rollRegularCombat(table, combatTerrainCategory(action.terrain), attack, defend,
    combatRating(state.units[combat.attackerLeader]!) - combatRating(state.units[combat.defenderLeader]!), combat.hedgehog, () => {
      const draw = rollDie(rng)
      rng = draw.rng
      return draw.value
    })
  const units = { ...state.units }
  const removeReserve = result.defender.loss > 0 || result.defender.option > 0 || result.disorganize
  for (const unitId of combat.defenders) {
    // OCS 5.7d and 9.12a. Resolve DG before selecting losses or retreats.
    units[unitId] = { ...units[unitId]!, reserve: removeReserve ? undefined : units[unitId]!.reserve,
      disorganized: units[unitId]!.disorganized || result.disorganize }
  }
  if (result.disorganize) {
    for (const [id, unit] of Object.entries(units)) {
      if (unit.side === actor && unit.hex === combat.target && unit.organicTruck !== undefined && unit.reserve) {
        units[id] = { ...unit, reserve: undefined }
      }
    }
  }
  return { ...state, rng, units, combat: { ...combat, roll: result, step: 'attacker-result' } }
}
