import type { VolgaBridge } from './bridge.ts'

const requiredMovementPhases = 4

export interface RepairWork {
  completedMovementPhases: number
  combatModePontoonAtEndpointThroughout: boolean
  enemyCombatAdjacentToPontoon: boolean
  enemyAttackCapableAtEndpoint: boolean
}

/** TTW 1.5b. Call once per qualifying side's completed Movement Phase. */
export function bridgeRepairProgress(bridge: Pick<VolgaBridge, 'condition'>, work: Readonly<RepairWork>): number {
  if (bridge.condition !== 'destroyed' || work.enemyAttackCapableAtEndpoint) return 0
  if (!work.combatModePontoonAtEndpointThroughout || work.enemyCombatAdjacentToPontoon) {
    return work.completedMovementPhases
  }
  return Math.min(work.completedMovementPhases + 1, requiredMovementPhases)
}

/** TTW 1.5b. Enemy occupation resets progress whenever it occurs, including between phases. */
export function resetBridgeRepairOnEnemyOccupation(
  progress: number, enemyAttackCapableAtEndpoint: boolean,
): number {
  return enemyAttackCapableAtEndpoint ? 0 : progress
}

/** TTW 1.5b. Four full phases of work take effect at the start of the next Movement Phase. */
export function completeBridgeRepair(
  bridge: Readonly<VolgaBridge>, completedMovementPhases: number,
): VolgaBridge {
  if (bridge.condition !== 'destroyed' || !bridgeRepairReady(completedMovementPhases)) return bridge
  return { ...bridge, condition: 'repaired', firstApproach: 'resolved' }
}

export function bridgeRepairReady(completedMovementPhases: number): boolean {
  return completedMovementPhases >= requiredMovementPhases
}
