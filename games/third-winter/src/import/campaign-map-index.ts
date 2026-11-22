import { campaignHexKey } from './hex-id.ts'
import { terrainKinds } from './scorpion-map.ts'
import type { Terrain } from './scorpion-map.ts'

interface SourceHex {
  hex_id: string
  on_map?: boolean
  seam_twin: string | null
  seam_primary: boolean | null
  terrains_present?: readonly string[]
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
  edge_terrain?: string | null
  river_class?: string | null
  river_pending?: boolean | null
  lake_edge?: string | boolean | null
  bridge?: string | boolean | null
  blocked_kind?: string | null
  river_class_status?: string | null
}

const connectionFields = ['road_present', 'road_subclass', 'rail_present', 'rail_class',
  'edge_terrain', 'river_class', 'river_pending', 'lake_edge', 'bridge', 'blocked_kind'] as const
type ConnectionField = (typeof connectionFields)[number]

interface CampaignConnection {
  endpoints: readonly [string, string]
  sourceEdges: readonly Readonly<SourceEdge>[]
  disputedFields: readonly ConnectionField[]
}

const orderedPair = (a: string, b: string): [string, string] => a < b ? [a, b] : [b, a]
const knownTerrains = new Set<string>(terrainKinds)

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
  const onMapHexes: ReadonlySet<string> = new Set([...byHex]
    .filter(([, hex]) => hex.on_map !== false)
    .map(([key]) => canonicalByHex.get(key)!))
  const danglingEdges: string[] = []
  const edgeGroups = new Map<string, Set<string>>()
  const sourceByPair = new Map<string, { endpoints: [string, string]; sourceEdges: SourceEdge[] }>()
  const pairsBySeamGroup = new Map<string, Set<string>>()
  const selfEdges: string[] = []
  let openEndedEdges = 0
  for (const edge of edges.items) {
    const endpoints = [edge.hex_a, edge.hex_b].map((id) => id === null ? null : canonicalByHex.get(campaignHexKey(id)))
    if (endpoints.includes(null)) openEndedEdges++
    if (endpoints.includes(undefined)) danglingEdges.push(edge.edge_key)
    const [a, b] = endpoints
    if (a && b) {
      if (a === b) selfEdges.push(edge.edge_key)
      else {
        const pair = orderedPair(a, b)
        const key = pair.join('|')
        const connection = sourceByPair.get(key) ?? { endpoints: pair, sourceEdges: [] }
        connection.sourceEdges.push(edge)
        sourceByPair.set(key, connection)
        if (edge.seam_dup_group) {
          const pairs = pairsBySeamGroup.get(edge.seam_dup_group) ?? new Set<string>()
          pairs.add(key)
          pairsBySeamGroup.set(edge.seam_dup_group, pairs)
        }
      }
    }
    if (!edge.seam_dup_group) continue
    const keys = edgeGroups.get(edge.seam_dup_group) ?? new Set<string>()
    keys.add(JSON.stringify([edge.road_present, edge.road_subclass, edge.rail_present, edge.rail_class]))
    edgeGroups.set(edge.seam_dup_group, keys)
  }
  const neighborsByHex = new Map([...new Set(canonicalByHex.values())].map((id) => [id, [] as string[]]))
  const connections = new Map<string, CampaignConnection>()
  const disputedConnections = []
  let duplicateConnections = 0
  for (const [key, { endpoints, sourceEdges }] of sourceByPair) {
    const [a, b] = endpoints
    neighborsByHex.get(a)!.push(b)
    neighborsByHex.get(b)!.push(a)
    const disputedFields = connectionFields.filter((field) =>
      sourceEdges.some((row) => (row[field] ?? null) !== (sourceEdges[0]![field] ?? null)))
    if (sourceEdges.length > 1) duplicateConnections++
    if (disputedFields.length) disputedConnections.push({
      endpoints, sourceEdges: sourceEdges.map(({ edge_key }) => edge_key), fields: disputedFields,
    })
    connections.set(key, { endpoints, sourceEdges, disputedFields })
  }
  return {
    canonicalByHex,
    onMapHexes,
    terrainAt(hex: string): readonly Terrain[] | undefined {
      const key = canonicalByHex.get(campaignHexKey(hex))
      const terrains = key && byHex.get(key)?.terrains_present
      return Array.isArray(terrains) && terrains.length > 0 && terrains.every((terrain) => knownTerrains.has(terrain))
        ? terrains as readonly Terrain[] : undefined
    },
    // Geometric neighbors can include rivers, blocked edges and disputes. Movement owns passability.
    neighbors(hex: string): readonly string[] {
      const id = canonicalByHex.get(campaignHexKey(hex))
      return id ? neighborsByHex.get(id) ?? [] : []
    },
    connection(from: string, to: string): CampaignConnection | undefined {
      const a = canonicalByHex.get(campaignHexKey(from))
      const b = canonicalByHex.get(campaignHexKey(to))
      return a && b ? connections.get(orderedPair(a, b).join('|')) : undefined
    },
    diagnostics: {
      sourceHexes: hexes.items.length,
      sourceEdges: edges.items.length,
      indexedHexes: new Set(canonicalByHex.values()).size,
      openEndedEdges,
      danglingEdges,
      selfEdges,
      connections: connections.size,
      duplicateConnections,
      disputedConnections,
      mismatchedHexTwins,
      seamTransportDisagreements: [...edgeGroups].filter(([, values]) => values.size > 1).map(([id]) => id),
      seamGroupsWithDifferentEndpoints: [...pairsBySeamGroup].filter(([, pairs]) => pairs.size > 1)
        .map(([id, pairs]) => ({ id, pairs: [...pairs].map((key) => connections.get(key)!.endpoints) })),
      riverState: edges.meta?.river_state ?? null,
    },
  }
}

export type TtwCampaignMapIndex = ReturnType<typeof indexTtwCampaignMap>
