import type { Side } from '@ocs-eastern/series/state-types'
import { scorpionModeFace } from '../import/scorpion-mode-face.ts'
import type { ScorpionAirBase } from './scorpion-air-bases.ts'
import { applyScorpionCombatLosses } from './scorpion-combat-losses.ts'
import { scorpionGroundActivity } from './scorpion-ground-activity.ts'
import { remainingSteps } from './scorpion-losses.ts'
import { scorpionAirliftGroundLimit } from './scorpion-movement.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'

export type GroundAirliftCargo = { id: string; tokens: number }

/** OCS 4.7, 5.6 and 14.9c–d. The departure face sets eligibility and transport equivalents. */
export function prepareScorpionGroundAirlift(state: Readonly<ScorpionInPlay>, side: Side, source: ScorpionAirBase,
  ids: readonly string[], assets: ScorpionSetupAssets) {
  if (ids.length === 0) return { cargo: [], units: state.units }
  if (source.kind !== 'hex' || new Set(ids).size !== ids.length) {
    throw new Error('Choose distinct combat units at the on-map departure air base')
  }
  const activity = scorpionGroundActivity(state)
  const units = { ...state.units }
  const phase = state.cursor.phase
  const cargo = ids.map((id): GroundAirliftCargo => {
    const unit = Object.hasOwn(units, id) ? units[id] : undefined
    if (!unit?.combat || unit.side !== side || unit.hex !== source.hex || unit.reserve) {
      throw new Error('Choose friendly combat units at the departure air base in Move Mode')
    }
    if (!unit.moveMode && (phase !== 'movement' || state.moved.includes(id) || activity.airlifted.includes(id))) {
      throw new Error('A unit must already be in Move Mode to load after moving or outside Movement')
    }
    const loaded = scorpionModeFace(unit, assets.catalog.definitions.get(unit.definition), 'move')
    if (loaded.mobility !== 'leg' || loaded.allowance < 0 || loaded.allowance > 10) {
      throw new Error('Air transport requires a Move Mode allowance of 10 or fewer Leg MP')
    }
    if ((state.moved.includes(id) && !Object.hasOwn(activity.spent, id)) ||
      (activity.spent[id] ?? 0) > scorpionAirliftGroundLimit(loaded, phase)) {
      throw new Error('The unit has already used more ground movement than air transport allows')
    }
    units[id] = loaded
    const re = loaded.printedRe - loaded.stepsLost
    const tokens = re * (loaded.allowance >= 1 && loaded.allowance <= 6 ? 2 : 4)
    if (!Number.isFinite(tokens) || tokens <= 0) throw new Error('Missing transport equivalent for ground cargo')
    return { id, tokens }
  })
  return { cargo, units }
}

export function unloadScorpionGroundAirlift(state: Readonly<ScorpionInPlay>, side: Side, hex: string,
  delivered: readonly string[], lost: readonly string[], assets: ScorpionSetupAssets, railroad?: SupplyRailBoard): ScorpionInPlay {
  if (!delivered.length && !lost.length) return state
  const units = { ...state.units }
  for (const id of [...delivered, ...lost]) units[id] = { ...units[id]!, hex }
  const activity = scorpionGroundActivity(state)
  const landed = { ...state, units, railControl: delivered.length ? { ...state.railControl, [hex]: side } : state.railControl,
    moved: state.moved.filter((id) => !delivered.includes(id)),
    groundActivity: { ...activity, airlifted: [...new Set([...activity.airlifted, ...delivered])] } }
  return lost.length ? applyScorpionCombatLosses(landed, new Map(lost.map((id) => [id, remainingSteps(units[id]!)])), assets, railroad)
    : landed
}
