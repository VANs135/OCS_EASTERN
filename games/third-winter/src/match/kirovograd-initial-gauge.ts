import { edgeKey } from '@ocs-eastern/series/ground-map'
import type { Side } from '@ocs-eastern/series/state-types'
import type { TtwRailGauge } from '../ttw/campaign/rail-gauge.ts'
import type { CampaignRailNetwork } from './campaign-rail-network.ts'
import type { CampaignGroundMap } from './campaign-ground-position.ts'

export interface KirovogradRailhead {
  ref: string
  side: Side
  hex: string | null | undefined
  count?: number
}

/** `campaignTerrain.railAt` returns single/double/undefined; tests may pass a boolean. */
type RailAt = string | boolean | undefined

export interface KirovogradRailMap extends CampaignGroundMap {
  availableHexes?: ReadonlySet<string>
}

/**
 * Scenario 9 initial gauge, read from the printed Soviet railhead markers.
 *
 * A Soviet railhead is the boundary of the converted line: follow the railway
 * east from it (larger map column), and every reached edge is Soviet broad gauge.
 * Any edge not reached by an eastward trace from a Soviet railhead stays German
 * standard gauge. Same-column steps are allowed because a railhead can sit just
 * before a line that bends north or south before continuing east.
 */
export function kirovogradInitialRailGauge(input: {
  map: KirovogradRailMap
  railAt(hex: string, to: string): RailAt
  railheads: readonly KirovogradRailhead[]
  /** Optional opening-front check; rails outside the Soviet side never enter the broad component. */
  onSovietSide?: (hex: string) => boolean
}): Record<string, TtwRailGauge> | undefined {
  const { map, railAt, onSovietSide } = input
  const available = map.availableHexes
  if (!available?.size) return undefined
  const railheads = input.railheads.filter((marker) => marker.ref === 'Railhead' && marker.side === 'soviet')
  if (!railheads.length) return undefined
  const railheadHexes = railheads.map((marker) => {
    if (!marker.hex) throw new Error('A Soviet railhead marker is missing its hex')
    const hex = map.resolveHex(marker.hex)
    if (!hex) throw new Error(`Kirovograd railhead is outside the play area: ${marker.hex}`)
    return hex
  })

  const railEdges = new Set<string>()
  for (const from of available) {
    for (const to of map.neighbors(from)) {
      if (from === to || !available.has(to)) continue
      if (railAt(from, to)) railEdges.add(edgeKey(from, to))
    }
  }
  if (!railEdges.size) throw new Error('Scenario 9 has railheads but no on-map railway')

  const broad = new Set<string>()
  // A railhead cuts its line: the incident western edge remains German, while
  // the eastern side (including local branches that later bend west) is the
  // connected Soviet component beyond the marker.
  const blocked = new Set<string>()
  for (const hex of railheadHexes) {
    for (const to of map.neighbors(hex)) {
      if (!railEdges.has(edgeKey(hex, to)) || columnOf(to) >= columnOf(hex)) continue
      blocked.add(edgeKey(hex, to))
    }
  }
  const seen = new Set(railheadHexes.filter((hex) => !onSovietSide || onSovietSide(hex)))
  const pending = [...seen]
  while (pending.length) {
    const from = pending.pop()!
    for (const to of map.neighbors(from)) {
      const key = edgeKey(from, to)
      if (!railEdges.has(key) || blocked.has(key) || (onSovietSide && !onSovietSide(to))) continue
      broad.add(key)
      if (!seen.has(to)) {
        seen.add(to)
        pending.push(to)
      }
    }
  }

  const result: Record<string, TtwRailGauge> = {}
  for (const key of railEdges) result[key] = broad.has(key) ? 'broad' : 'standard'
  return result
}

/** Scenario 9 printed rail network, with the initial gauge read from its railheads. */
export function kirovogradRailNetwork(input: {
  map: KirovogradRailMap
  railAt(hex: string, to: string): RailAt
  railheads: readonly KirovogradRailhead[]
  onSovietSide?: (hex: string) => boolean
}): CampaignRailNetwork | undefined {
  const gauges = kirovogradInitialRailGauge(input)
  if (!gauges) return undefined
  const railEdges = new Set(Object.keys(gauges))
  return {
    edge(from, to) {
      const key = edgeKey(from, to)
      const gauge = gauges[key]
      // TTW's map library records every printed railway as single track; keep
      // double-track support here for future maps that actually print it.
      return railEdges.has(key) && gauge
        ? { gauge, multiTrack: input.railAt(from, to) === 'double' } : undefined
    },
    initialGaugeJunctions: input.railheads.filter((marker) => marker.ref === 'Railhead' && marker.side === 'soviet')
      .flatMap((marker) => marker.hex ? [marker.hex] : []),
  }
}

function columnOf(hex: string): number {
  const dot = hex.lastIndexOf('.')
  const column = Number(hex.slice(1, dot))
  if (dot < 0 || !Number.isSafeInteger(column) || column < 0) throw new Error(`Invalid campaign hex column: ${hex}`)
  return column
}
