import { edgeKey } from '@ocs-eastern/series/ground-map'
import type { GroundMap } from '@ocs-eastern/series/ground-map'
import { scorpionHexDistance, scorpionHexId } from './hex-id.ts'

export const terrainKinds = ['Open', 'Hills', 'Woods', 'Forest', 'Rough', 'Mountain', 'Swamp',
  'Village', 'Minor City', 'Major City'] as const
export type Terrain = (typeof terrainKinds)[number]

interface SourceHex {
  hex_id: string
  on_map: boolean
  terrains_present: readonly string[]
  city_level?: string | null
  source_hex_id?: string
}

interface SourceEdge {
  hex_a: string
  hex_b: string
  edge_terrain: string
  river_class?: string | null
  road_subclass?: string | null
  road_present: boolean
  rail_class?: string | null
  rail_present: boolean
  bridge: boolean
}

export interface ScorpionHex {
  terrains: readonly Terrain[]
  city: 'Village' | 'Minor City' | 'Major City' | null
  campaignHex?: string
}

export interface ScorpionEdge {
  river: 'minor' | 'major' | null
  road: 'road' | 'track' | null
  rail: 'single' | 'double' | null
  bridge: boolean
}

export interface ScorpionMap extends GroundMap<ScorpionEdge> {
  hexes: ReadonlyMap<string, ScorpionHex>
  edgeCount: number
}

const terrains = new Set<string>(terrainKinds)
const cities = new Set(['Village', 'Minor City', 'Major City'])

/** The crop already resolves the large-map seams. Index its own S endpoints as published. */
export function scorpionMap(hexRows: readonly SourceHex[], edgeRows: readonly SourceEdge[]): ScorpionMap {
  if (!hexRows.length || !edgeRows.length) throw new Error('The Scorpion terrain database is empty')
  const hexes = new Map<string, ScorpionHex>()
  const adjacent = new Map<string, string[]>()
  for (const row of hexRows) {
    const id = scorpionHexId(row.hex_id)
    if (!row.on_map || hexes.has(id) || !row.terrains_present?.length ||
      row.terrains_present.some((terrain) => !terrains.has(terrain))) {
      throw new Error(`Invalid Scorpion hex: ${id}`)
    }
    const city = row.city_level ?? null
    if (city && (!cities.has(city) || !row.terrains_present.includes(city))) {
      throw new Error(`Invalid Scorpion settlement: ${id}`)
    }
    hexes.set(id, { terrains: [...row.terrains_present] as Terrain[], city: city as ScorpionHex['city'],
      campaignHex: row.source_hex_id })
    adjacent.set(id, [])
  }
  const edges = new Map<string, ScorpionEdge>()
  for (const row of edgeRows) {
    const a = scorpionHexId(row.hex_a)
    const b = scorpionHexId(row.hex_b)
    const key = edgeKey(a, b)
    if (scorpionHexDistance(a, b) !== 1 ||
      !hexes.has(a) || !hexes.has(b) || edges.has(key)) {
      throw new Error(`Invalid Scorpion edge: ${key}`)
    }
    const river = row.river_class ?? null
    if (!(row.edge_terrain === 'none' && river === null ||
      row.edge_terrain === 'river' && (river === 'minor' || river === 'major'))) {
      throw new Error(`Unsupported Scorpion river: ${key}`)
    }
    if (row.road_present !== Boolean(row.road_subclass) ||
      row.road_present && row.road_subclass !== 'Secondary Road' && row.road_subclass !== 'Track') {
      throw new Error(`Invalid Scorpion road: ${key}`)
    }
    const rail = row.rail_class ?? null
    if (row.rail_present !== (rail === 'single' || rail === 'double') || !row.rail_present && rail !== null) {
      throw new Error(`Invalid Scorpion railway: ${key}`)
    }
    edges.set(key, { river: river as ScorpionEdge['river'],
      road: row.road_present ? row.road_subclass === 'Track' ? 'track' : 'road' : null,
      rail: rail as ScorpionEdge['rail'], bridge: row.bridge })
    adjacent.get(a)!.push(b)
    adjacent.get(b)!.push(a)
  }
  return {
    hexes, edgeCount: edges.size,
    neighbors: (hex) => adjacent.get(scorpionHexId(hex)) ?? [],
    edge: (a, b) => edges.get(edgeKey(scorpionHexId(a), scorpionHexId(b))),
  }
}
