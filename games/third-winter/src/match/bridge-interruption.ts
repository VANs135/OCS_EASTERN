import type { Side } from '@ocs-eastern/series/state-types'
import { bridgeDecisionsAt, resolveBridgeDecision } from '../ttw/campaign/bridge.ts'
import type { BridgeDecision, MovedUnit, VolgaBridge } from '../ttw/campaign/bridge.ts'

export interface BridgeInterruption {
  bridges: readonly VolgaBridge[]
  queue: readonly BridgeDecision[]
  // The movement caller supplies the opaque continuation for the interrupted command.
  continuation: string | null
}

export function interruptAfterMovementStep(
  state: Readonly<BridgeInterruption>, unit: MovedUnit, destination: string, continuation: string,
): BridgeInterruption {
  if (state.queue.length) throw new Error('Resolve the current bridge decision before moving')
  const queue = bridgeDecisionsAt(state.bridges, unit, destination)
  if (queue.length === 0) return state
  const pending = new Set(queue.map(({ bridgeId }) => bridgeId))
  const bridges = state.bridges.map((bridge): VolgaBridge =>
    pending.has(bridge.id) ? { ...bridge, firstApproach: 'pending' } : bridge,
  )
  return { bridges, queue, continuation }
}

export function answerBridgeInterruption(
  state: Readonly<BridgeInterruption>, actor: Side, bridgeId: string, answer: 'destroy' | 'decline',
): { state: BridgeInterruption; resume: string | null } {
  const next = state.queue[0]
  if (actor !== next?.responder || bridgeId !== next.bridgeId) {
    throw new Error('This seat cannot answer the current bridge decision')
  }
  const bridges = state.bridges.map((bridge) =>
    bridge.id === bridgeId ? resolveBridgeDecision(bridge, answer) : bridge,
  )
  const queue = state.queue.slice(1)
  if (queue.length) return { state: { ...state, bridges, queue }, resume: null }
  return { state: { bridges, queue, continuation: null }, resume: state.continuation }
}
