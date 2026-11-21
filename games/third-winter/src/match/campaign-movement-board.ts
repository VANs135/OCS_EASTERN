import type { Mobility, StepCost } from '@ocs-eastern/series/ground-map'
import type { GroundMoveBoard } from '@ocs-eastern/series/ground-movement'
import type { Side } from '@ocs-eastern/series/state-types'
import type { Terrain } from '../import/scorpion-map.ts'
import { ttwVolgaMovementCost, volgaHexsidePhaseLimitRe } from '../ttw/campaign/volga-movement.ts'
import type { TtwVolgaCrossing } from '../ttw/campaign/volga-movement.ts'
import { ttwOrdinaryTerrainCost } from '../ttw/ground-terrain.ts'
import type { TtwOrdinaryCrossing } from '../ttw/ground-terrain.ts'
import { campaignGroundPosition } from './campaign-ground-position.ts'
import type { CampaignGroundMap, CampaignGroundProfiles } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'
import { campaignVolgaBridgeCostState } from './campaign-volga-bridges.ts'

export interface CampaignGroundMovementBoard {
  map: CampaignGroundMap
  profileOf: CampaignGroundProfiles
  moveProfile(state: Readonly<CampaignTurnState>, id: string):
    { ma: number; mobility: Mobility; fuelReady: boolean } | undefined
  /** Receives canonical endpoints. TTW owns weather, crossings and route availability. */
  cost(state: Readonly<CampaignTurnState>, id: string, from: string, to: string, mobility: Mobility): StepCost
  crossingLimit?(state: Readonly<CampaignTurnState>, id: string, from: string, to: string): number | undefined
  intactVolgaBridgeAt?(state: Readonly<CampaignTurnState>, id: string, from: string, to: string): boolean
  /** True when the step needs capture, a protected site check, or another work-specific resolver. */
  entryRequiresResolution(state: Readonly<CampaignTurnState>, side: Side, hex: string): boolean
  /** Supply facts for the proposed board at the end of the move. */
  inTrace(state: Readonly<CampaignTurnState>, id: string, hex: string): boolean | undefined
  /** Check stacking, Reserve with hedgehogs, and any TTW obligations at the end of this segment. */
  endBlockers?(state: Readonly<CampaignTurnState>, side: Side): readonly string[] | undefined
}

type OrdinaryBoardInputs = Omit<CampaignGroundMovementBoard, 'cost'> & {
  terrainAt(hex: string): readonly Terrain[] | undefined
  /** Use the canonical hexside and current bridge state. Undefined leaves the step unavailable. */
  crossingAt(state: Readonly<CampaignTurnState>, id: string, from: string, to: string): TtwOrdinaryCrossing | TtwVolgaCrossing | undefined
}

/** Bind normalized terrain to the TTW ground movement table and Volga crossing rules. */
export function createCampaignOrdinaryMovementBoard(inputs: OrdinaryBoardInputs): CampaignGroundMovementBoard {
  return { map: inputs.map, profileOf: inputs.profileOf, moveProfile: inputs.moveProfile,
    entryRequiresResolution: inputs.entryRequiresResolution, inTrace: inputs.inTrace, endBlockers: inputs.endBlockers,
    crossingLimit: (state, id, from, to) => inputs.crossingAt(state, id, from, to)?.barrier === 'volga' ? volgaHexsidePhaseLimitRe : undefined,
    intactVolgaBridgeAt(state, id, from, to) {
      const crossing = inputs.crossingAt(state, id, from, to)
      return crossing?.barrier === 'volga' && crossing.bridge === 'intact' && crossing.routes.length > 0
    },
    cost(state, id, from, to, mobility) {
      const ground = state.weather?.ground
      const crossing = inputs.crossingAt(state, id, from, to)
      const terrain = inputs.terrainAt(to)?.filter((item) => item !== 'Village')
      if (!ground || ground === 'thaw' || !crossing || !terrain?.length) return null
      if (crossing.barrier === 'volga') {
        const { ice } = state.weatherHistory
        const side = state.counters[id]?.side
        const ferry = !ice && state.ferries.some((marker) => {
          if (marker.side !== side) return false
          const hex = activeCampaignFerryHex(state, marker, inputs.map)
          return hex === from || hex === to
        })
        return ttwVolgaMovementCost(terrain, campaignVolgaBridgeCostState(state, crossing, from, to), mobility, ground, ice, ferry)
      }
      return ttwOrdinaryTerrainCost(terrain, crossing, mobility, ground)
    },
  }
}

export function activeCampaignFerryHex(state: Readonly<CampaignTurnState>, marker: CampaignTurnState['ferries'][number], map: CampaignGroundMap) {
  if (state.weatherHistory.ice) return undefined
  const pontoon = state.counters[marker.pontoonId]
  const markerHex = map.resolveHex(marker.hex)
  if (markerHex && pontoon?.side === marker.side && pontoon.location.kind === 'map' && map.resolveHex(pontoon.location.hex) === markerHex) {
    return markerHex
  }
}

export function campaignMovementPosition(state: Readonly<CampaignTurnState>, side: Side, board: CampaignGroundMovementBoard) {
  const ground = campaignGroundPosition(state, side, board.map, board.profileOf)
  if (!ground) return undefined
  const stopped = new Set(state.groundMovement?.moved)
  const locked = new Set(state.groundMovement?.zocLocks)
  const ferryPontoons = new Set(state.ferries.flatMap((marker) =>
    marker.side === side && activeCampaignFerryHex(state, marker, board.map) ? [marker.pontoonId] : []))
  const negated = new Set([...ground.friendly].flatMap(([id, { hex, profile }]) =>
    profile.combat && (stopped.has(id) || locked.has(id)) ? [hex] : []))
  return { ...ground, stopped, locked, ferryPontoons,
    stepBoard(id: string, mobility: Mobility, proposed: Readonly<CampaignTurnState>,
      crossingRefusal?: GroundMoveBoard['crossingRefusal']): GroundMoveBoard {
      return {
        neighbors: (hex) => board.map.neighbors(hex),
        cost: (from, to) => board.cost(proposed, id, from, to, mobility),
        crossingRefusal,
        entryAt: (hex) => ground.enemyCombat.has(hex) ? 'enemy-combat'
          : ground.enemyNoncombat.has(hex) || board.entryRequiresResolution(proposed, side, hex) ? 'entry-unresolved' : 'open',
        enemyZocAt: (hex) => ground.enemyZoc.has(hex),
        negatedZocAt: (hex) => negated.has(hex),
      }
    },
  }
}
