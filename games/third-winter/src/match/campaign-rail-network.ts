import { edgeKey } from '@ocs-eastern/series/ground-map'
import { khersonRailFerryHexside } from '../ttw/campaign/kherson-ferry.ts'
import type { TtwRailGauge } from '../ttw/campaign/rail-gauge.ts'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

interface CampaignRailEdge {
  gauge: TtwRailGauge
  multiTrack: boolean
}

export interface CampaignRailNetwork {
  /** Printed rail, using canonical endpoints and a shared value in either direction. */
  edge(from: string, to: string): CampaignRailEdge | undefined
  /** Optional printed junctions where initial track gauges meet. */
  initialGaugeJunctions?: readonly string[]
  isRepairUnit?(state: Readonly<CampaignTurnState>, id: string): boolean
}

export function campaignRailheads(state: Readonly<CampaignTurnState>, map: CampaignGroundMap, network?: CampaignRailNetwork) {
  if (!network) return []
  const junctions = new Set([...(network.initialGaugeJunctions ?? []), ...Object.keys(state.railGaugeByEdge ?? {}).flatMap((edge) => edge.split('|'))])
  return [...junctions].flatMap((hex) => {
    const tracks = map.neighbors(hex).flatMap((to) => {
      const edge = campaignRailEdge(state, map, network, hex, to)
      return edge ? [{ to, gauge: edge.gauge }] : []
    })
    return new Set(tracks.map(({ gauge }) => gauge)).size > 1 ? [{ hex, tracks }] : []
  })
}

export function campaignRailEdge(state: Readonly<CampaignTurnState>, map: CampaignGroundMap, network: CampaignRailNetwork | undefined,
  from: string, to: string): CampaignRailEdge | undefined {
  const key = edgeKey(from, to)
  if (!network || key === khersonRailFerryHexside || !map.neighbors(from).includes(to)) return undefined
  const printed = from < to ? network.edge(from, to) : network.edge(to, from)
  if (!printed) return undefined
  return { ...printed, gauge: state.railGaugeByEdge?.[key] ?? printed.gauge }
}
