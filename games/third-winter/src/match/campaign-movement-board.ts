import { edgeKey } from '@ocs-eastern/series/ground-map'
import type { Mobility, StepCost } from '@ocs-eastern/series/ground-map'
import type { GroundMoveBoard } from '@ocs-eastern/series/ground-movement'
import type { Side } from '@ocs-eastern/series/state-types'
import type { Terrain } from '../import/scorpion-map.ts'
import { khersonRailFerryHexside } from '../ttw/campaign/kherson-ferry.ts'
import { ttwVolgaMovementCost, volgaHexsidePhaseLimitRe } from '../ttw/campaign/volga-movement.ts'
import type { TtwVolgaCrossing } from '../ttw/campaign/volga-movement.ts'
import { admitsPontoonTrackBridge, ttwOrdinaryTerrainCost } from '../ttw/ground-terrain.ts'
import type { TtwOrdinaryCrossing } from '../ttw/ground-terrain.ts'
import { campaignGroundPosition } from './campaign-ground-position.ts'
import type { CampaignGroundMap, CampaignGroundProfiles } from './campaign-ground-position.ts'
import { campaignPontoonTrackBoard } from './campaign-pontoon-tracks.ts'
import type { CampaignPontoonTrackMarker, PontoonStepPosition } from './campaign-pontoon-tracks.ts'
import type { CampaignRailNetwork } from './campaign-rail-network.ts'
import { campaignTraceSupply } from './campaign-trace-supply.ts'
import type { CampaignSupplyBoard, CampaignSupplyFacts } from './campaign-trace-supply.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'
import { campaignVolgaBridgeCostState } from './campaign-volga-bridges.ts'

export interface CampaignGroundMovementBoard {
  map: CampaignGroundMap
  railNetwork?: CampaignRailNetwork
  profileOf: CampaignGroundProfiles
  moveProfile(state: Readonly<CampaignTurnState>, id: string):
    { ma: number; mobility: Mobility; fuelReady: boolean } | undefined
  /** Receives canonical endpoints. TTW owns weather, crossings and route availability. */
  cost(state: Readonly<CampaignTurnState>, id: string, from: string, to: string, mobility: Mobility, step?: PontoonStepPosition): StepCost
  pontoonTrackMarkers?(state: Readonly<CampaignTurnState>): readonly CampaignPontoonTrackMarker[]
  crossingLimit?(state: Readonly<CampaignTurnState>, id: string, from: string, to: string): number | undefined
  volgaCrossingAt?(state: Readonly<CampaignTurnState>, id: string, from: string, to: string): TtwVolgaCrossing | undefined
  ferryUsedForStep?(state: Readonly<CampaignTurnState>, id: string, from: string, to: string, mobility: Mobility): string | undefined
  /** True when the step needs capture, a protected site check, or another work-specific resolver. */
  entryRequiresResolution(state: Readonly<CampaignTurnState>, side: Side, hex: string): boolean
  /** Supply facts for the proposed board at the end of the move. */
  inTrace(state: Readonly<CampaignTurnState>, id: string, hex: string): boolean | undefined
  traceSupply?(state: Readonly<CampaignTurnState>, side: Side): ReturnType<typeof campaignTraceSupply>
  /** Check stacking, Reserve with hedgehogs, and any TTW obligations at the end of this segment. */
  endBlockers?(state: Readonly<CampaignTurnState>, side: Side): readonly string[] | undefined
  /** Scenario release rules settled once a ground move lands, e.g. TTW Scenario 9. Returns the counters to unhold.
   * `stepsLeft` is how far each mover actually advanced along `path`, so a mover that stops early is not credited with the rest. */
  releases?(settled: Readonly<CampaignTurnState>, side: Side,
    move: { path: readonly string[]; movers: readonly { id: string; combat: boolean; stepsLeft: number }[];
      placements?: readonly { id: string; hex: string }[]; reached?: Readonly<Record<string, number>> }): readonly string[]
  /** TTW §2.3b/c：轴心 Army/Army Group HQ 仅可铁路移动，不得地面 march。该类 HQ 返回 true。 */
  railOnly?(state: Readonly<CampaignTurnState>, id: string): boolean
  /** TTW §2.4a：城内轴心地面单位不得自愿走出城市；返回拒绝原因。 */
  exitRefusal?(state: Readonly<CampaignTurnState>, id: string, from: string, to: string): string | null
  /** TTW §5.0a：移动后的控制点沉降（如最后穿越 VP/城市格的战斗单位归属）。placements 为各 mover 实际落点。 */
  afterMove?(state: Readonly<CampaignTurnState>, side: Side,
    move: { path: readonly string[]; movers: readonly { id: string; combat: boolean; stepsLeft: number }[];
      placements?: readonly { id: string; hex: string }[]; reached?: Readonly<Record<string, number>> }): Readonly<CampaignTurnState>
}

type OrdinaryBoardInputs = Omit<CampaignGroundMovementBoard, 'cost' | 'traceSupply' | 'inTrace'> & {
  terrainAt(hex: string): readonly Terrain[] | undefined
  inTrace?: CampaignGroundMovementBoard['inTrace']
  supply?: Pick<CampaignSupplyBoard, 'traceCost'> & {
    facts(state: Readonly<CampaignTurnState>, side: Side): CampaignSupplyFacts | undefined
  }
  /** Use the canonical hexside and current bridge state. Undefined leaves the step unavailable. */
  crossingAt(state: Readonly<CampaignTurnState>, id: string, from: string, to: string): TtwOrdinaryCrossing | TtwVolgaCrossing | undefined
}

/** Bind normalized terrain to the TTW ground movement table and Volga crossing rules. */
export function createCampaignOrdinaryMovementBoard(inputs: OrdinaryBoardInputs): CampaignGroundMovementBoard {
  const pontoonTracks = campaignPontoonTrackBoard(inputs.map, inputs.profileOf)
  const supply = inputs.supply
  const traceSupply = supply && ((state: Readonly<CampaignTurnState>, side: Side) => {
    const facts = supply.facts(state, side)
    return facts && campaignTraceSupply(state, side, { ...inputs, traceCost: supply.traceCost }, facts)
  })
  function crossingAt(state: Readonly<CampaignTurnState>, id: string, from: string, to: string): TtwOrdinaryCrossing | TtwVolgaCrossing | undefined {
    if (edgeKey(from, to) === khersonRailFerryHexside) return { barrier: 'volga', bridge: 'none', routes: [] }
    const crossing = inputs.crossingAt(state, id, from, to)
    return crossing?.barrier === 'volga' ? campaignVolgaBridgeCostState(state, crossing, from, to) : crossing
  }
  function volgaCrossingAt(state: Readonly<CampaignTurnState>, id: string, from: string, to: string) {
    const crossing = crossingAt(state, id, from, to)
    if (crossing?.barrier === 'volga') return crossing
  }
  return { map: inputs.map, railNetwork: inputs.railNetwork, profileOf: inputs.profileOf, moveProfile: inputs.moveProfile,
    entryRequiresResolution: inputs.entryRequiresResolution, traceSupply, endBlockers: inputs.endBlockers, volgaCrossingAt,
    releases: inputs.releases,
    railOnly: inputs.railOnly,
    exitRefusal: inputs.exitRefusal,
    afterMove: inputs.afterMove,
    inTrace: inputs.inTrace ?? ((state, id, hex) => {
      const side = state.counters[id]?.side
      const trace = side && traceSupply?.(state, side)
      const unit = trace?.ground.friendly.get(id)
      return trace && unit ? trace.network.hasTrace(hex, unit.profile.drawMobility) : undefined
    }),
    pontoonTrackMarkers: (state) => pontoonTracks.markers(state, (id, from, to) => {
      const crossing = crossingAt(state, id, from, to)
      return crossing?.barrier === 'volga' ? undefined : crossing
    }),
    crossingLimit: (state, id, from, to) => volgaCrossingAt(state, id, from, to) ? volgaHexsidePhaseLimitRe : undefined,
    ferryUsedForStep(state, id, from, to, mobility) {
      if (mobility === 'leg' && !state.weatherHistory.ice && volgaCrossingAt(state, id, from, to)?.bridge === 'none') {
        return crossingFerry(state, inputs.map, state.counters[id]?.side, from, to)
      }
    },
    cost(state, id, from, to, mobility, step) {
      const ground = state.weather?.ground
      const crossing = crossingAt(state, id, from, to)
      const terrain = inputs.terrainAt(to)?.filter((item) => item !== 'Village')
      if (!ground || ground === 'thaw' || !crossing || !terrain?.length) return null
      if (crossing.barrier === 'volga') {
        const { ice } = state.weatherHistory
        const ferry = !ice && crossingFerry(state, inputs.map, state.counters[id]?.side, from, to) !== undefined
        return ttwVolgaMovementCost(terrain, crossing, mobility, ground, ice, ferry)
      }
      if (admitsPontoonTrackBridge(crossing) && pontoonTracks.connects(state, id, from, to, step)) {
        return ttwOrdinaryTerrainCost(terrain, { ...crossing, routes: ['track'] }, mobility, ground)
      }
      return ttwOrdinaryTerrainCost(terrain, crossing, mobility, ground)
    },
  }
}

function crossingFerry(state: Readonly<CampaignTurnState>, map: CampaignGroundMap, side: Side | undefined, from: string, to: string) {
  let ferry: string | undefined
  for (const marker of state.ferries) {
    if (marker.side !== side) continue
    const hex = activeCampaignFerryHex(state, marker, map)
    if ((hex === from || hex === to) && (ferry === undefined || marker.id < ferry)) ferry = marker.id
  }
  return ferry
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
  const work = state.pontoonPhase
  const engineeringPontoons = new Set(work?.side === side && work.turn === state.turn ? Object.keys(work.orders) : [])
  const negated = new Set([...ground.friendly].flatMap(([id, { hex, profile }]) =>
    profile.combat && (stopped.has(id) || locked.has(id)) ? [hex] : []))
  return { ...ground, stopped, locked, ferryPontoons, engineeringPontoons,
    stepBoard(id: string, mobility: Mobility, proposed: Readonly<CampaignTurnState>,
      crossingRefusal?: GroundMoveBoard['crossingRefusal'], ownBridgeDeparture?: string): GroundMoveBoard {
      return {
        neighbors: (hex) => board.map.neighbors(hex),
        cost: (from, to, moverAt, first) => board.cost(proposed, id, from, to, mobility,
          { moverAt, ownDeparture: first && moverAt === ownBridgeDeparture }),
        crossingRefusal,
        entryAt: (hex) => ground.enemyCombat.has(hex) ? 'enemy-combat'
          : ground.enemyNoncombat.has(hex) || board.entryRequiresResolution(proposed, side, hex) ? 'entry-unresolved' : 'open',
        enemyZocAt: (hex) => ground.enemyZoc.has(hex),
        negatedZocAt: (hex) => negated.has(hex),
      }
    },
  }
}
