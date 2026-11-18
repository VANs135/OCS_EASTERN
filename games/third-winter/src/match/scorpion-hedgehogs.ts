import type { Side } from '@ocs-eastern/series/state-types'
import { scorpionHexDistance, scorpionHexId } from '../import/hex-id.ts'
import { scorpionStepCost } from '../ttw/scorpion/terrain-cost.ts'
import { scorpionGroundActivity } from './scorpion-ground-activity.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'
import { scorpionSpPayment, totalTokens } from './scorpion-sp-payment.ts'
import type { SupplyPayment } from './scorpion-sp-payment.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'

export interface ScorpionHedgehog {
  side: Side
  level: 1 | 2
}

export type HedgehogWork = { type: 'work-hedgehog'; operation: 'build' | 'reduce'; hex: string;
  unitIds: readonly string[]; payments?: readonly SupplyPayment[] }

export function scorpionHedgehogLevel(state: Readonly<ScorpionInPlay>, hex: string, fallback?: (hex: string) => number): number {
  if (state.hedgehogs && Object.hasOwn(state.hedgehogs, hex)) return state.hedgehogs[hex]?.level ?? 0
  return fallback?.(hex) ?? 0
}

/** OCS 13.8d, 16.0b–c and TTW 1.1b. */
export function workScorpionHedgehog(state: Readonly<ScorpionInPlay>, side: Side, action: HedgehogWork,
  { map }: ScorpionSetupAssets, rail?: SupplyRailBoard, fallback?: (hex: string) => number): ScorpionInPlay {
  if (state.cursor.phase !== 'movement' || state.cursor.phasing !== side) {
    throw new Error('Hedgehog work is available in your Movement Phase')
  }
  const { operation, unitIds, payments = [] } = action
  const hex = scorpionHexId(action.hex)
  const current = state.hedgehogs?.[hex]
  const level = scorpionHedgehogLevel(state, hex, fallback)
  const building = operation === 'build'
  if ((operation !== 'build' && operation !== 'reduce') || !map.hexes.has(hex) ||
    (current ? current.side !== side : level > 0) || (!building && !current) || (building && level >= 2) ||
    Object.values(state.units).some((unit) => unit.side !== side && unit.hex === hex)) {
    throw new Error('Choose a legal hex for this hedgehog work')
  }
  const log = building ? state.hedgehogBuiltAt : state.hedgehogReducedAt
  if (log?.[hex] === state.cursor.turn) throw new Error('The level can change this way only once per turn')
  if (!unitIds.length || new Set(unitIds).size !== unitIds.length) throw new Error('Choose the distinct units doing the work')
  const airlifted = scorpionGroundActivity(state).airlifted
  const workers = unitIds.map((id) => {
    const unit = Object.hasOwn(state.units, id) ? state.units[id] : undefined
    if (!unit?.combat || unit.side !== side || unit.moveMode || unit.reserve || state.moved.includes(id) || airlifted.includes(id)) {
      throw new Error('Hedgehog work requires eligible stationary units in Combat Mode')
    }
    return unit
  })
  const engineer = workers[0]!
  // Scorpion's Engineer-Capable units are its regular HQs. TTW Kessel HQs cannot perform engineering functions.
  const canEngineer = workers.length === 1 && engineer.headquarters && !engineer.headquarters.kessel
  const local = workers.every((unit) => unit.hex === hex && !unit.disorganized) &&
    workers.reduce((re, unit) => re + unit.printedRe - unit.stepsLost, 0) >= 1
  if (!local) {
    const distance = scorpionHexDistance(engineer.hex, hex)
    const weather = state.turn.weather.ground === 'freeze' ? 'freeze' : 'dry'
    const passable = (from: string, to: string) => scorpionStepCost(map, from, to, 'leg', weather) !== null
    const blocked = new Set(Object.values(state.units).filter((unit) => unit.side !== side).map((unit) => unit.hex))
    const reachable = distance <= 2 && (distance === 0 || passable(engineer.hex, hex) ||
      map.neighbors(engineer.hex).some((near) => !blocked.has(near) && passable(engineer.hex, near) && passable(near, hex)))
    if (!canEngineer || !reachable) throw new Error('Choose one local RE or an Engineer-Capable unit within two hexes')
  }
  const cost = building ? 8 : 0
  if (totalTokens(payments) !== cost) throw new Error(`Hedgehog work requires exactly ${cost}T`)
  const payment = payments.length ? scorpionSpPayment(state, side, map, rail) : undefined
  payment?.spend(payments, ({ dumpId }) => workers.every((unit) => payment.canUse(unit, dumpId)))
  const next = building ? (level === 1 ? 2 : 1) : level === 2 ? 1 : 0
  return { ...state, ...payment?.settle(), moved: [...state.moved, ...unitIds],
    hedgehogs: { ...state.hedgehogs, [hex]: next === 0 ? null : { side, level: next } },
    [building ? 'hedgehogBuiltAt' : 'hedgehogReducedAt']: { ...log, [hex]: state.cursor.turn } }
}
