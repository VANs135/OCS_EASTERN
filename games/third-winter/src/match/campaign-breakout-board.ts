import type { Mobility, StepCost } from '@ocs-eastern/series/ground-map'
import type { Side } from '@ocs-eastern/series/state-types'
import { supplyNetwork } from '@ocs-eastern/series/supply-network'
import type { SupplyNetworkBoard, SupplyNetworkPosition, SupplyTraceOption } from '@ocs-eastern/series/supply-network'
import type { CampaignBreakoutBoard } from './campaign-breakout.ts'
import { campaignGroundPosition } from './campaign-ground-position.ts'
import type { CampaignGroundMap, CampaignGroundProfiles } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignBreakoutSupply extends Pick<SupplyNetworkPosition, 'sources' | 'controlled' | 'headquarters' | 'extenders'>,
  Pick<SupplyNetworkBoard, 'railCanTrace' | 'detrainable'> {
  /** Resolve formation and work-specific supply eligibility. Undefined means the rules or choice are still pending. */
  inTrace(counterId: string, ordinary: readonly SupplyTraceOption[]): boolean | undefined
  /** Includes the 12.8e exclusions for feeding and special supply. */
  firstTurnWithoutTrace(counterId: string): boolean | undefined
}

interface CampaignBreakoutBoardInputs {
  map: CampaignGroundMap
  profileOf: CampaignGroundProfiles
  distance(from: string, to: string): number
  movementCost(state: Readonly<CampaignTurnState>, from: string, to: string, mobility: Mobility): StepCost
  traceCost(state: Readonly<CampaignTurnState>, from: string, to: string, mobility: Mobility): StepCost
  supply(state: Readonly<CampaignTurnState>, side: Side): CampaignBreakoutSupply | undefined
}

/** Bind actual board facts to the breakout command and its read-only projection. */
export function createCampaignBreakoutBoard(inputs: CampaignBreakoutBoardInputs): CampaignBreakoutBoard {
  const { map } = inputs
  const resolveHex = (hex: string) => map.resolveHex(hex)
  const neighbors = (hex: string) => map.neighbors(hex)

  return (state, side) => {
    const ground = campaignGroundPosition(state, side, map, inputs.profileOf)
    const position = inputs.supply(state, side)
    if (!ground || !position) return undefined

    const sources = [...position.sources].map(resolveHex)
    const controlled = [...position.controlled].map(resolveHex)
    const headquarters = position.headquarters.map((hq) => ({ ...hq, hex: resolveHex(hq.hex) }))
    const extenders = position.extenders?.map((unit) => ({ ...unit, hex: resolveHex(unit.hex) }))
    if (!sources.every(knownHex) || !controlled.every(knownHex) || !headquarters.every(hasHex) || extenders && !extenders.every(hasHex)) {
      return undefined
    }
    const network = supplyNetwork({ hasHex: (hex) => resolveHex(hex) === hex, neighbors,
      traceCost: (from, to, mobility) => inputs.traceCost(state, from, to, mobility),
      railCanTrace: (from, to) => position.railCanTrace(from, to), detrainable: (hex) => position.detrainable(hex),
    }, { sources: new Set(sources), controlled: new Set(controlled), headquarters, extenders,
      enemyCombat: ground.enemyCombat, unnegatedEnemyZoc: ground.unnegatedEnemyZoc })

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

function knownHex(hex: string | undefined): hex is string {
  return hex !== undefined
}

function hasHex<T extends { hex: string | undefined }>(value: T): value is T & { hex: string } {
  return knownHex(value.hex)
}
