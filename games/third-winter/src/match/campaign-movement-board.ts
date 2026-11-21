import type { Mobility, StepCost } from '@ocs-eastern/series/ground-map'
import type { GroundMoveBoard } from '@ocs-eastern/series/ground-movement'
import type { Side } from '@ocs-eastern/series/state-types'
import type { Terrain } from '../import/scorpion-map.ts'
import { ttwOrdinaryTerrainCost } from '../ttw/ground-terrain.ts'
import type { TtwOrdinaryCrossing } from '../ttw/ground-terrain.ts'
import { campaignGroundPosition } from './campaign-ground-position.ts'
import type { CampaignGroundMap, CampaignGroundProfiles } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignGroundMovementBoard {
  map: CampaignGroundMap
  profileOf: CampaignGroundProfiles
  moveProfile(state: Readonly<CampaignTurnState>, id: string):
    { ma: number; mobility: Mobility; fuelReady: boolean } | undefined
  /** Receives canonical endpoints. TTW owns weather, crossings and route availability. */
  cost(state: Readonly<CampaignTurnState>, id: string, from: string, to: string, mobility: Mobility): StepCost
  /** True when the step needs capture, a protected site check, or another work-specific resolver. */
  entryRequiresResolution(state: Readonly<CampaignTurnState>, side: Side, hex: string): boolean
  /** Supply facts for the proposed board at the end of the move. */
  inTrace(state: Readonly<CampaignTurnState>, id: string, hex: string): boolean | undefined
  /** Check stacking, Reserve with hedgehogs, and any TTW obligations at the end of this segment. */
  endBlockers?(state: Readonly<CampaignTurnState>, side: Side): readonly string[] | undefined
}

type OrdinaryBoardInputs = Omit<CampaignGroundMovementBoard, 'cost'> & {
  terrainAt(hex: string): readonly Terrain[] | undefined
  /** Undefined for unknown or dedicated crossings such as a Volga-class hexside. */
  crossingAt(state: Readonly<CampaignTurnState>, id: string, from: string, to: string): TtwOrdinaryCrossing | undefined
}

/** Bind normalized terrain to the TTW Dry, Freeze and Mud ground movement table. */
export function createCampaignOrdinaryMovementBoard(inputs: OrdinaryBoardInputs): CampaignGroundMovementBoard {
  return { map: inputs.map, profileOf: inputs.profileOf, moveProfile: inputs.moveProfile,
    entryRequiresResolution: inputs.entryRequiresResolution, inTrace: inputs.inTrace, endBlockers: inputs.endBlockers,
    cost(state, id, from, to, mobility) {
      const ground = state.weather?.ground
      const crossing = inputs.crossingAt(state, id, from, to)
      const terrain = inputs.terrainAt(to)?.filter((item) => item !== 'Village')
      if (!ground || ground === 'thaw' || !crossing || !terrain?.length) return null
      return ttwOrdinaryTerrainCost(terrain, crossing, mobility, ground)
    },
  }
}

export function campaignMovementPosition(state: Readonly<CampaignTurnState>, side: Side, board: CampaignGroundMovementBoard) {
  const ground = campaignGroundPosition(state, side, board.map, board.profileOf)
  if (!ground) return undefined
  const stopped = new Set(state.groundMovement?.moved)
  const locked = new Set(state.groundMovement?.zocLocks)
  const negated = new Set([...ground.friendly].flatMap(([id, { hex, profile }]) =>
    profile.combat && (stopped.has(id) || locked.has(id)) ? [hex] : []))
  return { ...ground, stopped, locked,
    stepBoard(id: string, mobility: Mobility, proposed: Readonly<CampaignTurnState>): GroundMoveBoard {
      return {
        neighbors: (hex) => board.map.neighbors(hex),
        cost: (from, to) => board.cost(proposed, id, from, to, mobility),
        entryAt: (hex) => ground.enemyCombat.has(hex) ? 'enemy-combat'
          : ground.enemyNoncombat.has(hex) || board.entryRequiresResolution(proposed, side, hex) ? 'entry-unresolved' : 'open',
        enemyZocAt: (hex) => ground.enemyZoc.has(hex),
        negatedZocAt: (hex) => negated.has(hex),
      }
    },
  }
}
