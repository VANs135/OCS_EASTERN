import type { Side } from '@ocs-eastern/series/state-types'
import { launchScorpionAirMission, respondScorpionAirMission } from './scorpion-air-operations.ts'
import type { LaunchAirMission, RespondAirMission, ScorpionAirMission } from './scorpion-air-operations.ts'
import type { ScorpionAirBarrageBoard } from './scorpion-air-barrage.ts'
import { settleScorpionAirfieldCapacity } from './scorpion-airfield-barrage.ts'
import type { ScorpionCapturePolicy } from './scorpion-capture.ts'
import { applyScorpionDropPlan } from './scorpion-drop-plan.ts'
import type { ScorpionDropPlanAction } from './scorpion-drop-plan.ts'
import { refitScorpionAircraft } from './scorpion-refit.ts'
import type { RefitScorpionAircraft } from './scorpion-refit.ts'
import type { ScorpionInPlay, ScorpionSession } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'

export type ScorpionAirAction = LaunchAirMission | RespondAirMission | ScorpionDropPlanAction | RefitScorpionAircraft
  | { type: 'settle-airfield-capacity'; unitIds: readonly string[] }

type AirDecision =
  | { kind: 'air-mission'; step: Exclude<ScorpionAirMission['step']['kind'], 'barrage'>; actor: Side }
  | { kind: 'barrage'; step: 'terrain' | 'loss'; actor: Side }
  | { kind: 'airfield-capacity'; actor: Side }

/** Choose the next air or fire prompt for local play. Finishing a mission can expose a queued capacity choice. */
export function scorpionPendingAirDecision(state: Readonly<ScorpionInPlay>): AirDecision | null {
  if (state.reroll || state.capture || state.combat?.retreat) return null
  const mission = state.airMission
  if (mission && mission.step.kind !== 'barrage') {
    const actor = mission.step.kind === 'return'
      ? state.pieces.find(({ id }) => mission.returning.includes(id))?.side ?? mission.side : mission.step.actor
    return { kind: 'air-mission', step: mission.step.kind, actor }
  }
  if (state.barrage) return { kind: 'barrage', step: state.barrage.roll ? 'loss' : 'terrain', actor: state.barrage.defender }
  if (state.airfieldCapacityChoice) return { kind: 'airfield-capacity', actor: state.airfieldCapacityChoice.side }
  return null
}

export function applyScorpionAirAction(state: Readonly<ScorpionSession>, actor: Side,
  action: ScorpionAirAction, assets: ScorpionSetupAssets,
  board: ScorpionAirBarrageBoard & ScorpionCapturePolicy): ScorpionSession {
  switch (action.type) {
    case 'plan-air-drop':
    case 'delay-air-drop':
    case 'cancel-air-drop':
      return applyScorpionDropPlan(state, actor, action, assets)
    case 'settle-airfield-capacity':
      if (state.kind !== 'playing') throw new Error('There is no active air base capacity decision')
      return settleScorpionAirfieldCapacity(state, actor, action.unitIds)
    case 'refit-aircraft':
    case 'launch-air-mission':
      if (state.kind !== 'playing') throw new Error('Start the Scorpion match first')
      return action.type === 'refit-aircraft'
        ? refitScorpionAircraft(state, actor, action, assets.map, board.supplyRail)
        : launchScorpionAirMission(state, actor, action, assets, board)
    default:
      if (state.kind !== 'playing') throw new Error('There is no pending air mission')
      return respondScorpionAirMission(state, actor, action, assets, board)
  }
}
