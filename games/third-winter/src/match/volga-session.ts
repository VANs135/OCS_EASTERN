import type { Side } from '@ocs-eastern/series/state-types'
import { answerBridgeInterruption, interruptAfterMovementStep } from './bridge-interruption.ts'
import type { BridgeInterruption } from './bridge-interruption.ts'

interface Position {
  side: Side
  combat: boolean
  hex: string
}

export interface VolgaSession {
  interruption: BridgeInterruption
  units: Readonly<Record<string, Position>>
  movementSide: Side
}

export type VolgaAction =
  | { type: 'move-step'; unit: string; to: string }
  | { type: 'bridge-answer'; bridgeId: string; answer: 'destroy' | 'decline' }

/** The movement rules determine legal movement. This module only sequences the response. */
export function applyVolgaAction(
  state: Readonly<VolgaSession>,
  actor: Side,
  action: VolgaAction,
  authorizeMovement: (state: Readonly<VolgaSession>, unit: string, to: string) => boolean,
): VolgaSession {
  if (action.type === 'bridge-answer') {
    const { state: interruption } = answerBridgeInterruption(
      state.interruption, actor, action.bridgeId, action.answer,
    )
    return { ...state, interruption }
  }

  const unit = state.units[action.unit]
  if (!unit || unit.side !== actor || actor !== state.movementSide || state.interruption.queue.length) {
    throw new Error('Movement is not available to this seat')
  }
  if (unit.hex === action.to || !authorizeMovement(state, action.unit, action.to)) {
    throw new Error('Movement step is not legal')
  }
  const interruption = interruptAfterMovementStep(state.interruption, unit, action.to, action.unit)
  const units = { ...state.units, [action.unit]: { ...unit, hex: action.to } }
  return { ...state, units, interruption }
}
