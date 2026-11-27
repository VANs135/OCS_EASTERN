import { edgeKey } from '@ocs-eastern/series/ground-map'
import { khersonRailFerryHexside } from '../ttw/campaign/kherson-ferry.ts'
import type { TtwRailGauge } from '../ttw/campaign/rail-gauge.ts'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

interface CampaignRailEdge {
  gauge: TtwRailGauge
  multiTrack: boolean
}

interface CampaignRailTrack {
  to: string
  gauge: TtwRailGauge
}

export interface CampaignRailNetwork {
  /** Printed rail, using canonical endpoints and a shared value in either direction. */
  edge(from: string, to: string): CampaignRailEdge | undefined
  /** Optional printed junctions where initial track gauges meet. */
  initialGaugeJunctions?: readonly string[]
  isRepairUnit?(state: Readonly<CampaignTurnState>, id: string): boolean
}

/**
 * Current railhead markers are boundary displays, not counters stored in state.
 *
 * Smolensk's `deriveRailheads` derives every marker from the gauge ledger after each
 * conversion. TTW has edge-level gauges instead of a converted-hex list, so the same
 * idea is applied to the rail graph: a hex is a head when it touches both gauges and
 * at least one of those gauges reaches the hex through only one rail edge. That keeps
 * branch ends (each gets its own marker) and drops mid-line or junction hexes where
 * both gauges continue past the hex. Opening markers only seed the initial gauge;
 * they are never used as the current position.
 */
export function campaignRailheads(state: Readonly<CampaignTurnState>, map: CampaignGroundMap, network?: CampaignRailNetwork) {
  if (!network) return []
  const adjacency = campaignRailAdjacency(state, map, network)
  const heads = [...adjacency].flatMap(([hex, tracks]) => {
    const counts = new Map<TtwRailGauge, number>()
    for (const { gauge } of tracks) counts.set(gauge, (counts.get(gauge) ?? 0) + 1)
    // A pure single-gauge run has no boundary; a hex where both gauges have more
    // than one continuation is a junction, not a railhead end.
    if (counts.size < 2 || ![...counts.values()].some((count) => count === 1)) return []
    return [{ hex, tracks: tracks.map(({ to, gauge }) => ({ to, gauge })) }]
  })
  return heads.sort((a, b) => a.hex.localeCompare(b.hex))
}

/** Enumerate the connected printed rail graph from the current gauge ledger and opening junctions. */
function campaignRailAdjacency(state: Readonly<CampaignTurnState>, map: CampaignGroundMap, network: CampaignRailNetwork) {
  const adjacency = new Map<string, CampaignRailTrack[]>()
  const queued = new Set<string>()
  const queue: string[] = []
  const enqueue = (hex: string) => {
    if (queued.has(hex)) return
    queued.add(hex)
    queue.push(hex)
  }
  for (const key of Object.keys(state.railGaugeByEdge ?? {})) {
    const [from, to] = key.split('|')
    if (from) enqueue(from)
    if (to) enqueue(to)
  }
  for (const hex of network.initialGaugeJunctions ?? []) enqueue(hex)

  const addTrack = (from: string, to: string, gauge: TtwRailGauge) => {
    const tracks = adjacency.get(from)
    if (!tracks) {
      adjacency.set(from, [{ to, gauge }])
    } else if (!tracks.some((track) => track.to === to)) {
      tracks.push({ to, gauge })
    }
  }
  for (let index = 0; index < queue.length; index++) {
    const hex = queue[index]!
    for (const to of map.neighbors(hex)) {
      const edge = campaignRailEdge(state, map, network, hex, to)
      if (!edge) continue
      enqueue(to)
      addTrack(hex, to, edge.gauge)
    }
  }
  return adjacency
}

export function campaignRailEdge(state: Readonly<CampaignTurnState>, map: CampaignGroundMap, network: CampaignRailNetwork | undefined,
  from: string, to: string): CampaignRailEdge | undefined {
  const key = edgeKey(from, to)
  if (!network || key === khersonRailFerryHexside || !map.neighbors(from).includes(to)) return undefined
  const printed = from < to ? network.edge(from, to) : network.edge(to, from)
  if (!printed) return undefined
  return { ...printed, gauge: state.railGaugeByEdge?.[key] ?? printed.gauge }
}
