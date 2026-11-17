import type { Side } from '@ocs-eastern/series/state-types'

export interface VolgaBridge {
  id: string
  ends: readonly [string, string]
  condition: 'intact' | 'destroyed' | 'repaired'
  firstApproach: 'unseen' | 'pending' | 'resolved'
}

export interface BridgeDecision {
  responder: 'axis'
  bridgeId: string
}

export interface MovedUnit {
  side: Side
  combat: boolean
}

/** TTW 1.4a. Pass the destination of one committed movement step. */
export function bridgeDecisionsAt(
  bridges: readonly VolgaBridge[],
  unit: MovedUnit,
  destination: string,
): BridgeDecision[] {
  if (unit.side !== 'soviet' || !unit.combat) return []
  return bridges.filter((bridge) =>
    bridge.condition === 'intact' &&
    bridge.firstApproach === 'unseen' &&
    bridge.ends.includes(destination),
  ).map((bridge) => ({ bridgeId: bridge.id, responder: 'axis' }))
}

/** TTW 1.4a. The first opportunity is consumed for either choice. */
export function resolveBridgeDecision(
  bridge: VolgaBridge,
  answer: 'destroy' | 'decline',
): VolgaBridge {
  if (bridge.condition !== 'intact' || bridge.firstApproach !== 'pending') {
    throw new Error('TTW 1.4a: no active bridge decision')
  }
  if (answer === 'destroy') return { ...bridge, condition: 'destroyed', firstApproach: 'resolved' }
  return { ...bridge, firstApproach: 'resolved' }
}
