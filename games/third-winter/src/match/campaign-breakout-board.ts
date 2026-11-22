import type { Mobility, StepCost } from '@ocs-eastern/series/ground-map'
import type { Side } from '@ocs-eastern/series/state-types'
import type { SupplyTraceOption } from '@ocs-eastern/series/supply-network'
import type { CampaignBreakoutBoard } from './campaign-breakout.ts'
import { campaignTraceSupply } from './campaign-trace-supply.ts'
import type { CampaignSupplyBoard, CampaignSupplyFacts } from './campaign-trace-supply.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignBreakoutSupply extends CampaignSupplyFacts {
  /** Resolve formation and work-specific supply eligibility. Undefined means the rules or choice are still pending. */
  inTrace(counterId: string, ordinary: readonly SupplyTraceOption[]): boolean | undefined
  /** Includes the 12.8e exclusions for feeding and special supply. */
  firstTurnWithoutTrace(counterId: string): boolean | undefined
}

interface CampaignBreakoutBoardInputs extends CampaignSupplyBoard {
  distance(from: string, to: string): number
  movementCost(state: Readonly<CampaignTurnState>, from: string, to: string, mobility: Mobility): StepCost
  supply(state: Readonly<CampaignTurnState>, side: Side): CampaignBreakoutSupply | undefined
}

/** Bind actual board facts to the breakout command and its read-only projection. */
export function createCampaignBreakoutBoard(inputs: CampaignBreakoutBoardInputs): CampaignBreakoutBoard {
  const { map } = inputs
  const resolveHex = (hex: string) => map.resolveHex(hex)
  const neighbors = (hex: string) => map.neighbors(hex)

  return (state, side) => {
    const position = inputs.supply(state, side)
    const trace = position && campaignTraceSupply(state, side, inputs, position)
    if (!position || !trace) return undefined
    const { ground, network } = trace

    return { resolveHex, neighbors, distance: inputs.distance,
      canCross: (from, to, mobility) => inputs.movementCost(state, from, to, mobility) !== null,
      enemyCombatAt: (hex) => ground.enemyCombat.has(hex), unnegatedEnemyZocAt: (hex) => ground.unnegatedEnemyZoc.has(hex),
      unitFacts(id) {
        const unit = ground.friendly.get(id)
        if (!unit) return undefined
        const { profile, hex } = unit
        const hasTrace = position.inTrace(id, network.trace(hex, profile.drawMobility))
        if (hasTrace === undefined) return undefined
        const firstTurnWithoutTrace = hasTrace ? false : position.firstTurnWithoutTrace(id)
        if (firstTurnWithoutTrace === undefined) return undefined
        return { combat: profile.combat, singleTransportPoint: profile.singleTransportPoint, moveMa: profile.moveMa,
          mobility: profile.moveMobility, hasTrace, firstTurnWithoutTrace }
      },
    }
  }
}
