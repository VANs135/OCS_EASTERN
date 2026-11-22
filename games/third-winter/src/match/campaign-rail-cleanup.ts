import { edgeKey } from '@ocs-eastern/series/ground-map'
import { automaticSovietConversion } from '../ttw/campaign/rail.ts'
import type { CleanupAxisUnit } from '../ttw/campaign/rail.ts'
import { ttwRailGauge } from '../ttw/campaign/rail-gauge.ts'
import type { CampaignGroundMovementBoard } from './campaign-movement-board.ts'
import { campaignRailEdge } from './campaign-rail-network.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignRailCleanupBoard {
  /** Confirmed entries into the Soviet rail network in the opening Cleanup snapshot. */
  sovietNetworkStarts(state: Readonly<CampaignTurnState>): readonly string[] | undefined
  axisSuppliedByKessel(state: Readonly<CampaignTurnState>, id: string): boolean | undefined
  distance(from: string, to: string): number | undefined
}

/** TTW 1.2 and Q01. Discover the network and decide all conversions before updating any edge. */
export function beginCampaignSovietRailCleanup(state: CampaignTurnState, ground?: CampaignGroundMovementBoard,
  cleanup?: CampaignRailCleanupBoard): CampaignTurnState {
  if (state.cursor.phase !== 'cleanup' || state.cursor.phasing !== 'soviet') throw new Error('Soviet Cleanup is not open')
  if (!ground?.railNetwork || !cleanup) throw new Error('Soviet rail cleanup board is unavailable')
  const { map, railNetwork } = ground
  const starts = cleanup.sovietNetworkStarts(state)?.map((hex) => map.resolveHex(hex))
  if (!starts || !starts.every((hex): hex is string => hex !== undefined)) throw new Error('Soviet rail network starts are unavailable')
  const sovietGauge = ttwRailGauge('soviet')
  const axisGauge = ttwRailGauge('axis')
  const reachable = new Set(starts)
  const queue = [...reachable]
  const frontier = new Map<string, string[]>()
  for (let index = 0; index < queue.length; index++) {
    const from = queue[index]!
    for (const to of map.neighbors(from)) {
      const gauge = campaignRailEdge(state, map, railNetwork, from, to)?.gauge
      if (gauge === sovietGauge && !reachable.has(to)) {
        reachable.add(to)
        queue.push(to)
      }
      if (gauge === axisGauge) {
        const links = frontier.get(to) ?? []
        links.push(from)
        frontier.set(to, links)
      }
    }
  }
  if (!frontier.size) return { ...state, cleanup: { sovietConvertedEdges: [] } }

  const axis: CleanupAxisUnit[] = []
  for (const [id, counter] of Object.entries(state.counters)) {
    if (counter.side !== 'axis' || counter.location.kind !== 'map' || counter.kind === 'aircraft' || counter.kind === 'transport') continue
    const profile = ground.profileOf(state, id)
    if (!profile) throw new Error('Axis combat status for Soviet rail cleanup is unavailable')
    if (!profile.combat) continue
    const hex = map.resolveHex(counter.location.hex)
    const suppliedByKessel = cleanup.axisSuppliedByKessel(state, id)
    if (!hex || suppliedByKessel === undefined) throw new Error('Axis position or Kessel supply for Soviet rail cleanup is unavailable')
    axis.push({ hex, suppliedByKessel })
  }
  const converted = automaticSovietConversion([...frontier].map(([id, railNeighbors]) => ({ id, gauge: 'german', railNeighbors })),
    reachable, axis, (from, to) => {
      const distance = cleanup.distance(from, to)
      if (distance === undefined || !Number.isSafeInteger(distance) || distance < 0) throw new Error('Soviet rail cleanup hex distance is unavailable')
      return distance
    })
  const edges = [...new Set(converted.flatMap((hex) => frontier.get(hex)!.map((from) => edgeKey(from, hex))))].sort()
  const railGaugeByEdge = { ...state.railGaugeByEdge }
  for (const edge of edges) railGaugeByEdge[edge] = sovietGauge
  return { ...state, railGaugeByEdge, cleanup: { sovietConvertedEdges: edges } }
}
