import type { Side } from '@ocs-eastern/series/state-types'
import { actingSide } from '@ocs-eastern/series/turn'
import { scorpionHexId } from '../import/hex-id.ts'
import { applyScorpionCombatLosses } from './scorpion-combat-losses.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'

const limit = 10
const stackingRe = (unit: ScorpionInPlay['units'][string]) => unit.combat ? unit.printedRe - unit.stepsLost : 0

export type SettleScorpionStacking = { type: 'settle-stacking'; hex: string; unitIds: readonly string[] }

export function scorpionOverstackedHexes(state: Readonly<ScorpionInPlay>, side: Side) {
  const hexes = new Map<string, { hex: string; re: number; limit: number; candidates: { unitId: string; re: number }[] }>()
  for (const [unitId, unit] of Object.entries(state.units)) {
    if (!unit.combat || unit.side !== side) continue
    const re = stackingRe(unit)
    const stack = hexes.get(unit.hex) ?? { hex: unit.hex, re: 0, limit, candidates: [] }
    stack.re += re
    if (re > 0) stack.candidates.push({ unitId, re })
    hexes.set(unit.hex, stack)
  }
  return [...hexes.values()].filter((stack) => stack.re > limit)
}

export function scorpionStackingChoices(state: Readonly<ScorpionInPlay>, side: Side) {
  const { phase, phasing } = state.cursor
  if (phase === 'reinforcement' || state.turn.step.kind !== 'player-turn' || actingSide(phasing, phase) !== side ||
    state.victory || state.combat || state.airfieldCapacityChoice || state.reroll || state.capture || state.airMission || state.barrage) return []
  return scorpionOverstackedHexes(state, side)
}

export function assertScorpionPhaseStacking(state: Readonly<ScorpionInPlay>, side: Side) {
  const illegal = scorpionOverstackedHexes(state, side)[0]
  if (illegal) throw new Error(`Ground stacking limit exceeded at ${illegal.hex} (${illegal.re}/${illegal.limit} RE)`)
}

export function assertScorpionStacking(state: Readonly<ScorpionInPlay>, hex: string) {
  const re = Object.values(state.units).reduce((sum, unit) => sum + (unit.hex === hex ? stackingRe(unit) : 0), 0)
  if (re > limit) throw new Error('Position exceeds stacking limit')
}

export function settleScorpionStacking(state: Readonly<ScorpionInPlay>, side: Side, action: SettleScorpionStacking,
  assets: ScorpionSetupAssets, railroad?: SupplyRailBoard): ScorpionInPlay {
  const stack = scorpionStackingChoices(state, side).find(({ hex }) => hex === scorpionHexId(action.hex))
  const ids = new Set(action.unitIds)
  if (!stack || ids.size !== action.unitIds.length || !ids.size) throw new Error('Choose units from one friendly overstacked hex')
  const chosen = stack.candidates.filter(({ unitId }) => ids.has(unitId))
  if (chosen.length !== ids.size || stack.re - chosen.reduce((sum, { re }) => sum + re, 0) > stack.limit) {
    throw new Error('Choose enough whole combat units from that hex to meet the stacking limit')
  }
  // 4.8a eliminates entire counters. Use the scenario loss path for box destinations and VP.
  const losses = new Map(chosen.map(({ unitId, re }) => [unitId, re]))
  return applyScorpionCombatLosses({ ...state, overrunMarch: null, groundCaptureMove: null }, losses, assets, railroad)
}
