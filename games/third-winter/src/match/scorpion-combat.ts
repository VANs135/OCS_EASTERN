import { rollDie } from '@ocs-eastern/series/rng'
import type { Side } from '@ocs-eastern/series/state-types'
import type { CrtLike } from '@ocs-eastern/series/tables/crt'
import { rollRegularCombat } from '@ocs-eastern/series/tables/ground-combat'
import { scorpionHexId } from '../import/hex-id.ts'
import type { ScorpionMap, Terrain } from '../import/scorpion-map.ts'
import { combatRating, combatStrength, combatTerrainCategory } from '../ttw/scorpion/combat-terrain.ts'
import type { AttackTerrain } from '../ttw/scorpion/combat-terrain.ts'
import { scorpionSupplySources } from '../ttw/scorpion/initial-map.ts'
import { scorpionStepCost } from '../ttw/scorpion/terrain-cost.ts'
import { attackWithSupply, defendWithSupply } from './scorpion-combat-supply.ts'
import type { AttackSupplyPayment } from './scorpion-combat-supply.ts'
import { scorpionGroundActivity } from './scorpion-ground-activity.ts'
import { assertScorpionMovementEnd } from './scorpion-reserves.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import { scorpionSpPayment } from './scorpion-sp-payment.ts'
import type { SupplyPayment } from './scorpion-sp-payment.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'

export interface ScorpionCombatBoard {
  table: CrtLike
  hedgehogAt?: (hex: string) => number
}

export interface ScorpionCombat {
  kind?: 'overrun'
  target: string
  attacker: Side
  attackers: readonly string[]
  defenders: readonly string[]
  heldAtStart: Readonly<Record<Side, readonly string[]>>
  hedgehog: number
  defenseSupplied?: boolean
  defenseInternalUnits?: readonly string[]
  attackerLeader?: string
  defenderLeader?: string
  roll?: ReturnType<typeof rollRegularCombat>
  step: 'defender-supply' | 'attacker-rating' | 'defender-rating' | 'defender-terrain' | 'attacker-result' | 'defender-result' | 'advance'
  defenderMayIgnore?: boolean
  attackerRetreated?: boolean
}

export type DeclareCombat = { type: 'declare-combat'; target: string; attackers: readonly string[];
  payments: readonly AttackSupplyPayment[]; internalUnitIds?: readonly string[] }
export type ScorpionAttackOrder = Omit<DeclareCombat, 'type'>
export type DefendCombat = { type: 'defend-combat'; payments: readonly SupplyPayment[]; internalUnitIds?: readonly string[] }
export type ChooseCombatTerrain = { type: 'choose-combat-terrain'; terrain: Terrain;
  attackingTerrain: Readonly<Record<string, AttackTerrain>> }

export function declareScorpionCombat(state: Readonly<ScorpionInPlay>, actor: Side, action: DeclareCombat,
  map: ScorpionMap, board: ScorpionCombatBoard, railroad?: SupplyRailBoard): ScorpionInPlay {
  const { phase, phasing } = state.cursor
  const target = scorpionHexId(action.target)
  if (actor !== phasing || (phase !== 'combat' && phase !== 'exploitation') || state.combat ||
    !map.hexes.has(target) || state.combatTargets?.includes(target) || !action.attackers.length ||
    new Set(action.attackers).size !== action.attackers.length) throw new Error('This regular attack is unavailable')
  if (phase === 'exploitation') assertScorpionMovementEnd(state, actor, board.hedgehogAt)

  const enemy = actor === 'axis' ? 'soviet' : 'axis'
  if (scorpionSupplySources[enemy].some((hex) => hex === target)) throw new Error('Enemy map-edge supply sources cannot be entered')
  const weather = state.turn.weather.ground === 'freeze' ? 'freeze' : 'dry'
  const { airlifted } = scorpionGroundActivity(state)
  for (const id of action.attackers) {
    const unit = Object.hasOwn(state.units, id) ? state.units[id] : undefined
    if (!unit?.attackCapable || unit.side !== actor || unit.reserve || state.combatAttackers?.includes(id) ||
      (phase === 'exploitation' && !unit.released && (!unit.exploit || airlifted.includes(id))) ||
      scorpionStepCost(map, unit.hex, target, unit.mobility, weather) === null) {
      throw new Error('Each attacker must be eligible, unused and able to enter the target hex')
    }
  }
  const started = startScorpionCombat(state, actor, action, map, board, railroad)
  return { ...started, overrunMarch: null, combatTargets: [...(state.combatTargets ?? []), target],
    combatAttackers: [...(state.combatAttackers ?? []), ...action.attackers] }
}

export function startScorpionCombat(state: Readonly<ScorpionInPlay>, actor: Side, action: ScorpionAttackOrder,
  map: ScorpionMap, board: ScorpionCombatBoard, railroad?: SupplyRailBoard, kind?: 'overrun'): ScorpionInPlay {
  const target = scorpionHexId(action.target)
  const enemy = actor === 'axis' ? 'soviet' : 'axis'
  const all = Object.entries(state.units).filter(([, unit]) => unit.combat)
  const defenders = all.filter(([, unit]) => unit.side === enemy && unit.hex === target).map(([id]) => id)
  if (!defenders.length) throw new Error('Choose a hex containing enemy combat units')
  const hedgehog = board.hedgehogAt?.(target) ?? 0
  if (!Number.isInteger(hedgehog) || hedgehog < 0 || hedgehog > 4) throw new Error('Invalid hedgehog level')

  const ledger = scorpionSpPayment(state, actor, map, railroad)
  const units = attackWithSupply(state, ledger, action.attackers, action.payments, action.internalUnitIds ?? [])
  const heldAtStart = { axis: all.filter(([, unit]) => unit.side === 'axis').map(([, unit]) => unit.hex),
    soviet: all.filter(([, unit]) => unit.side === 'soviet').map(([, unit]) => unit.hex) }
  return { ...state, ...ledger.settle(units), combat: { kind, target, attacker: actor, attackers: [...action.attackers], defenders,
    hedgehog, heldAtStart, step: 'defender-supply' } }
}

export function defendScorpionCombat(state: Readonly<ScorpionInPlay>, actor: Side, action: DefendCombat,
  map: ScorpionMap, railroad?: SupplyRailBoard): ScorpionInPlay {
  const combat = state.combat
  if (!combat || combat.step !== 'defender-supply' || actor === combat.attacker) throw new Error('The defender must respond')
  const ledger = scorpionSpPayment(state, actor, map, railroad)
  const internal = action.internalUnitIds ?? []
  const { units, supplied } = defendWithSupply(state, ledger, combat.defenders, action.payments, internal)
  return { ...state, ...ledger.settle(units),
    combat: { ...combat, defenseSupplied: supplied, defenseInternalUnits: [...internal], step: 'attacker-rating' } }
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
  const defend = combat.defenders.reduce((sum, id) => sum +
    combatStrength(state.units[id]!, false, action.terrain, frozen,
      combat.defenseSupplied === true || combat.defenseInternalUnits?.includes(id) === true, 0), 0)
  let rng = state.rng
  const result = rollRegularCombat(table, combatTerrainCategory(action.terrain), attack, defend,
    combatRating(state.units[combat.attackerLeader]!) - combatRating(state.units[combat.defenderLeader]!), combat.hedgehog, () => {
      const draw = rollDie(rng)
      rng = draw.rng
      return draw.value
    }, combat.kind === 'overrun')
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
