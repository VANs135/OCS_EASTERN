import type { Side } from '@ocs-eastern/series/state-types'
import type { Mobility } from '@ocs-eastern/series/ground-map'
import { traceReach } from '@ocs-eastern/series/trace-path'
import { scorpionHexId } from '../../import/hex-id.ts'
import type { ScorpionMap } from '../../import/scorpion-map.ts'
import { scorpionStepCost } from './terrain-cost.ts'

interface Headquarter {
  hex: string
  throwRange: number
  mobility: Mobility
  kessel?: boolean
}

export interface TracePosition {
  side: Side
  sources: ReadonlySet<string>
  controlled: ReadonlySet<string>
  enemyCombat: ReadonlySet<string>
  unnegatedEnemyZoc: ReadonlySet<string>
  railGauge: (from: string, to: string) => Side
  /** Includes currently engineer-capable HQs and other eligible detraining facilities. */
  detrainableFacilities: ReadonlySet<string>
  /** Friendly HQs eligible to throw, including active Kessel HQs. */
  headquarters: readonly Headquarter[]
  weather: 'freeze' | 'thaw'
}

export interface TraceOption {
  kind: 'direct' | 'hq' | 'kessel'
  from: string
  source: string
}

/** Initial trace pass. Source and rail gauge come from the scenario/board, not the terrain crop. */
export function scorpionTraceOptions(
  map: ScorpionMap, state: TracePosition, location: string, drawMobility: Mobility = 'truck',
): TraceOption[] {
  const hex = scorpionHexId(location)
  if (!map.hexes.has(hex) || state.enemyCombat.has(hex)) return []
  const railAccessible = (id: string) => !state.enemyCombat.has(id) && !state.unnegatedEnemyZoc.has(id)
  const sources = [...state.sources].filter((id) => map.hexes.has(id) && railAccessible(id))
  const railSeen = new Set(sources)
  const queue = [...sources]
  for (const from of queue) {
    for (const to of map.neighbors(from)) {
      if (railSeen.has(to) || !railAccessible(to)) continue
      const detrainable = Boolean(map.hexes.get(to)?.city || state.detrainableFacilities.has(to))
      if (detrainable && !state.controlled.has(to)) continue
      if (!map.edge(from, to)?.rail || state.railGauge(from, to) !== state.side) continue
      railSeen.add(to)
      queue.push(to)
      if (detrainable) sources.push(to)
    }
  }

  const reach = (origin: string, range: number, mobility: Mobility) =>
    traceReach(map, origin, range, (id) => !state.enemyCombat.has(id) &&
      (mobility !== 'truck' || !state.unnegatedEnemyZoc.has(id)), (from, to) => {
      const normal = scorpionStepCost(map, from, to, mobility, 'dry')
      if (state.weather !== 'freeze') return normal
      const reduced = scorpionStepCost(map, from, to, mobility, 'freeze')
      if (typeof reduced !== 'number') return normal
      return typeof normal === 'number' ? Math.min(normal, reduced) : reduced
    })
  // OCS 12.3c. Adjacency at the recipient/source end ignores the last hexside's terrain.
  const drawFrom = (origin: string, mobility: Mobility) => {
    const within = reach(origin, 5, mobility)
    return sources.filter((id) => within.has(id) || map.neighbors(id).some((near) => within.has(near)))
  }
  const result: TraceOption[] = drawFrom(hex, drawMobility).map((source) => ({ kind: 'direct', from: hex, source }))
  const targetNeighbors = map.neighbors(hex)
  for (const hq of state.headquarters) {
    const within = reach(hq.hex, hq.throwRange, hq.mobility)
    if (!within.has(hex) && !targetNeighbors.some((near) => within.has(near))) continue
    if (hq.kessel && state.side === 'axis') result.push({ kind: 'kessel', from: hq.hex, source: hq.hex })
    else for (const source of drawFrom(hq.hex, hq.mobility)) result.push({ kind: 'hq', from: hq.hex, source })
  }
  return result
}
