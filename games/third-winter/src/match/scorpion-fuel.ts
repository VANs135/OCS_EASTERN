import { bulkFuelCost, isIndependent, singleUnitFuelCost } from '@ocs-eastern/series/ground-logistics'
import type { Side } from '@ocs-eastern/series/state-types'
import { actingSide } from '@ocs-eastern/series/turn'
import type { ScorpionMap } from '../import/scorpion-map.ts'
import type { TracePosition } from '../ttw/scorpion/supply-trace.ts'
import { inScorpionPhase, scorpionRegularBarrageTargets } from './scorpion-barrage-timing.ts'
import { scorpionGroundActivity } from './scorpion-ground-activity.ts'
import type { PlayerTurn } from './scorpion-player-turn.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import { scorpionSpPayment, totalTokens } from './scorpion-sp-payment.ts'
import type { SupplyPayment } from './scorpion-sp-payment.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'

type FuelThrow = Pick<PlayerTurn, 'turn' | 'phasing' | 'phase'> & { hex: string }
export type FormationFuel = { side: Side; formation: string; recipients: readonly string[] }
export type HeadquartersFuel = { side: Side; id: string; used?: FuelThrow }
export type ScorpionFuelAction =
  | { type: 'fuel-formation'; formation: string; headquartersId?: string; payments: readonly SupplyPayment[] }
  | { type: 'fuel-headquarters'; headquartersId: string; payments: readonly SupplyPayment[] }
  | { type: 'fuel-from-paused-transport'; unitId: string; transportId: string }

/** OCS 12.5c(A–B). Bulk payments survive phase changes until friendly Cleanup. */
export function buyScorpionFuel(state: Readonly<ScorpionInPlay>, side: Side, action: ScorpionFuelAction,
  map: ScorpionMap, rail?: SupplyRailBoard): ScorpionInPlay {
  const { phase, phasing } = state.cursor
  if (state.turn.step.kind !== 'player-turn' || side !== actingSide(phasing, phase) || state.combat ||
    !['movement', 'reaction', 'exploitation'].includes(phase) || state.turn.weather.ground === 'thaw' ||
    scorpionRegularBarrageTargets(state).size || (phase === 'exploitation' && state.combatTargets.length)) {
    throw new Error('Fuel is paid in the active Movement Segment')
  }
  const ledger = scorpionSpPayment(state, side, map, rail)
  if (action.type === 'fuel-from-paused-transport') {
    if (scorpionGroundActivity(state).transport?.unitId !== action.transportId || !ledger.source(action.transportId).truck) {
      throw new Error('Choose the transport that is currently paused')
    }
    return fuelScorpionMovement(state, side, action.unitId, { dumpId: action.transportId }, map, ledger.position)
  }
  if (totalTokens(action.payments) !== bulkFuelCost) throw new Error('Bulk fuel costs 1 SP')
  const hq = action.headquartersId ? state.units[action.headquartersId] : undefined
  if (action.headquartersId !== undefined && (!hq?.headquarters || hq.side !== side)) throw new Error('Choose a friendly HQ')
  if (action.type === 'fuel-headquarters') {
    if (!hq || state.headquartersFuel?.some(({ id }) => id === action.headquartersId)) throw new Error('Choose an unfueled friendly HQ')
    ledger.spend(action.payments, ({ dumpId }) => ledger.canUse(hq, dumpId, {}))
    return { ...state, ...ledger.settle(), headquartersFuel: [...(state.headquartersFuel ?? []), { side, id: action.headquartersId }] }
  }
  if (!action.formation || state.formationFuel?.some((fuel) => fuel.formation === action.formation && fuel.side === side)) {
    throw new Error('Choose a formation without an active formation fuel marker')
  }
  if (!hq && new Set(action.payments.map(({ dumpId }) => dumpId)).size !== 1) {
    throw new Error('Formation fuel requires one common direct draw source or one throwing HQ')
  }
  const method = { headquartersId: action.headquartersId }
  const recipients = Object.entries(state.units).filter(([, unit]) => unit.combat && unit.side === side && unit.formation === action.formation &&
    action.payments.every(({ dumpId }) => ledger.canUse(unit, dumpId, method))).map(([id]) => id)
  if (!recipients.length) throw new Error('No member of the formation can receive fuel from that source')
  ledger.spend(action.payments, () => true)
  return { ...state, ...ledger.settle(), formationFuel: [...(state.formationFuel ?? []), { side, formation: action.formation, recipients }] }
}

export function hasScorpionBulkFuel(state: Pick<ScorpionInPlay, 'formationFuel' | 'headquartersFuel'>, unitId: string) {
  return state.formationFuel?.some(({ recipients }) => recipients.includes(unitId)) ||
    state.headquartersFuel?.some(({ id }) => id === unitId)
}

/** OCS 12.5c(C), 12.5e. Check the throw at departure and lock its origin for this phase. */
export function fuelScorpionMovement(state: Readonly<ScorpionInPlay>, side: Side, unitId: string,
  payment: { dumpId?: string; headquartersId?: string }, map: ScorpionMap, facts: TracePosition): ScorpionInPlay {
  const { dumpId, headquartersId } = payment
  const unit = Object.hasOwn(state.units, unitId) ? state.units[unitId] : undefined
  const needsFuel = unit?.combat && unit.side === side && unit.mobility !== 'leg' && !unit.fueled
  if (!needsFuel || hasScorpionBulkFuel(state, unitId)) {
    if (dumpId !== undefined || headquartersId !== undefined) throw new Error('This counter does not require a fuel payment')
    return needsFuel ? markFueled(state, unitId) : state
  }
  if (dumpId === undefined && headquartersId === undefined) return state
  if (dumpId !== undefined && headquartersId !== undefined) throw new Error('Choose only one fuel source for the counter')
  const ledger = scorpionSpPayment(state, side, map, undefined, facts)
  if (dumpId !== undefined) {
    if (!ledger.canUse(unit, dumpId)) throw new Error('The selected fuel source is outside draw or throw range')
    ledger.spend([{ dumpId, tokens: singleUnitFuelCost }], () => true)
    return markFueled({ ...state, ...ledger.settle() }, unitId)
  }
  const hq = state.units[headquartersId!]
  const markers = state.headquartersFuel ?? []
  const marker = markers.find(({ id, side: owner }) => id === headquartersId && owner === side)
  if (!isIndependent(unit.formation, unit.printedRe) || !hq?.headquarters || !marker ||
    !ledger.network.inThrowRange(headquartersId!, unit.hex)) throw new Error('Choose a fueled HQ in range of this independent unit')
  if (marker.used && inScorpionPhase(state.cursor, marker.used) && marker.used.hex !== hq.hex) {
    throw new Error('The HQ already threw fuel from another hex this phase')
  }
  const { turn, phasing, phase } = state.cursor
  return markFueled({ ...state, headquartersFuel: markers.map((item) => item === marker
    ? { ...marker, used: { turn, phasing, phase, hex: hq.hex } } : item) }, unitId)
}

function markFueled(state: Readonly<ScorpionInPlay>, unitId: string): ScorpionInPlay {
  return { ...state, units: { ...state.units, [unitId]: { ...state.units[unitId]!, fueled: true } } }
}
