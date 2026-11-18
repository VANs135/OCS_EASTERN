import type { Side } from '@ocs-eastern/series/state-types'
import { scorpionHexId } from '../import/hex-id.ts'
import { mayPlanTtwCombatAirDrop } from '../ttw/air/airdrop-eligibility.ts'
import { scorpionAxisSources } from '../ttw/scorpion/initial-map.ts'
import { scorpionDates } from '../ttw/scorpion/weather.ts'
import type { ScorpionSession } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'

export interface ScorpionDropPlan {
  unitId: string
  target: string
  turn: number
}

export type ScorpionDropPlanAction =
  | { type: 'plan-air-drop'; unitId: string; target: string; turn: number }
  | { type: 'delay-air-drop' }
  | { type: 'cancel-air-drop' }

/** OCS 14.10b–c and TTW 2.2d/3.2e. The only eligible counter can have one current plan. */
export function applyScorpionDropPlan(state: Readonly<ScorpionSession>, side: Side, action: ScorpionDropPlanAction,
  { map, catalog }: ScorpionSetupAssets): ScorpionSession {
  const setup = state.kind === 'setup'
  if (side !== 'soviet' || (setup ? state.opening.seat !== side
    : state.turn.step.kind !== 'player-turn' || state.cursor.phasing !== side || state.cursor.phase !== 'aircraft-refit')) {
    throw new Error('The Soviet player plans drops during its setup or Aircraft Refit Phase')
  }
  const position = setup ? state.opening : state
  const currentTurn = setup ? 0 : state.cursor.turn
  const plan = position.dropPlan
  const pending = Boolean(plan && plan.turn >= currentTurn && position.units[plan.unitId])
  let next: ScorpionDropPlan | null
  if (action.type === 'plan-air-drop') {
    const unit = Object.hasOwn(position.units, action.unitId) ? position.units[action.unitId] : undefined
    if (unit?.side !== side || !mayPlanTtwCombatAirDrop(catalog.definitions.get(unit.definition))) {
      throw new Error('TTW permits only the Soviet 1st Guards Airborne Brigade to plan a combat-unit drop')
    }
    if (pending) throw new Error('Cancel the existing drop plan before making another')
    const target = scorpionHexId(action.target)
    if (!map.hexes.has(target) || scorpionAxisSources.some((hex) => hex === target)) {
      throw new Error('Choose a legal on-map drop hex')
    }
    const earliest = setup ? 1 : currentTurn + 2
    if (!Number.isSafeInteger(action.turn) || action.turn < earliest || action.turn > scorpionDates.length) {
      throw new Error('Choose a scenario turn at least two turns ahead, or plan before play')
    }
    next = { unitId: action.unitId, target, turn: action.turn }
  } else {
    if (!pending || !plan || setup) throw new Error('Change a pending drop plan during the Aircraft Refit Phase')
    if (action.type === 'delay-air-drop' && plan.turn >= scorpionDates.length) throw new Error('The delayed drop must fall within the scenario')
    next = action.type === 'delay-air-drop' ? { ...plan, turn: plan.turn + 1 } : null
  }
  return setup ? { ...state, opening: { ...state.opening, dropPlan: next } } : { ...state, dropPlan: next }
}
