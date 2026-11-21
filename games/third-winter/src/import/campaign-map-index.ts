import { campaignHexKey } from './hex-id.ts'

interface SourceHex {
  hex_id: string
  seam_twin: string | null
  seam_primary: boolean | null
}

interface SourceEdge {
  edge_key: string
  hex_a: string | null
  hex_b: string | null
  seam_dup_group: string | null
  road_present: boolean
  road_subclass: string | null
  rail_present: boolean
  rail_class: string | null
}

interface CampaignTable<T> {
  items: readonly T[]
  meta?: { count?: number; river_state?: string }
}

function table<T>(raw: unknown, label: string) {
  const source = raw as Partial<CampaignTable<T>> | null
  if (!Array.isArray(source?.items) || (source.meta?.count !== undefined && source.meta.count !== source.items.length)) {
    throw new Error(`Invalid campaign ${label} table or source row count`)
  }
  return source as CampaignTable<T>
}

/** Index printed coordinates and align only confirmed reciprocal seam twins. */
export function indexTtwCampaignMap(hexSource: unknown, edgeSource: unknown) {
  const hexes = table<SourceHex>(hexSource, 'hex')
  const edges = table<SourceEdge>(edgeSource, 'edge')
  const byHex = new Map(hexes.items.map((hex) => [campaignHexKey(hex.hex_id), hex]))
  if (byHex.size !== hexes.items.length) throw new Error('Campaign source hex ID collision')
  const canonicalByHex = new Map<string, string>()
  const mismatchedHexTwins: string[] = []
  for (const [key, hex] of byHex) {
    canonicalByHex.set(key, key)
    if (!hex.seam_twin) continue
    const peerKey = campaignHexKey(hex.seam_twin)
    const peer = byHex.get(peerKey)
    if (!peer?.seam_twin || campaignHexKey(peer.seam_twin) !== key || key === peerKey ||
      typeof hex.seam_primary !== 'boolean' || peer.seam_primary !== !hex.seam_primary) {
      mismatchedHexTwins.push(hex.hex_id)
    } else if (!hex.seam_primary) {
      canonicalByHex.set(key, peerKey)
    }
  }
  const danglingEdges: string[] = []
  const edgeGroups = new Map<string, Set<string>>()
  let openEndedEdges = 0
  for (const edge of edges.items) {
    const endpoints = [edge.hex_a, edge.hex_b]
    if (endpoints.includes(null)) openEndedEdges++
    if (endpoints.some((id) => id !== null && !byHex.has(campaignHexKey(id)))) danglingEdges.push(edge.edge_key)
    if (!edge.seam_dup_group) continue
    const keys = edgeGroups.get(edge.seam_dup_group) ?? new Set<string>()
    keys.add(JSON.stringify([edge.road_present, edge.road_subclass, edge.rail_present, edge.rail_class]))
    edgeGroups.set(edge.seam_dup_group, keys)
  }
  return {
    canonicalByHex,
    diagnostics: {
      sourceHexes: hexes.items.length,
      sourceEdges: edges.items.length,
      indexedHexes: new Set(canonicalByHex.values()).size,
      openEndedEdges,
      danglingEdges,
      mismatchedHexTwins,
      seamTransportDisagreements: [...edgeGroups].filter(([, values]) => values.size > 1).map(([id]) => id),
      riverState: edges.meta?.river_state ?? null,
    },
  }
}
