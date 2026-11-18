import type { Side } from '@ocs-eastern/series/state-types'
import type { Mobility } from '@ocs-eastern/series/ground-map'
import { traceReach } from '@ocs-eastern/series/trace-path'
import { scorpionHexId } from '../../import/hex-id.ts'
import type { ScorpionMap } from '../../import/scorpion-map.ts'
import { scorpionStepCost } from './terrain-cost.ts'

interface Headquarter {
  id?: string
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
  headquarters: readonly Headquarter[]
  weather: 'freeze' | 'thaw'
}

export interface TraceOption {
  kind: 'direct' | 'hq' | 'kessel'
  from: string
  source: string
  headquarters?: string
}

export function scorpionTraceOptions(
  map: ScorpionMap, state: TracePosition, location: string, drawMobility: Mobility = 'truck',
): TraceOption[] {
  return scorpionSupplyNetwork(map, state).trace(location, drawMobility)
}

export function scorpionSupplyNetwork(map: ScorpionMap, state: TracePosition) {
  const eligible = (id: string) => map.hexes.has(id) && !state.enemyCombat.has(id)
  const railAccessible = (id: string) => eligible(id) && !state.unnegatedEnemyZoc.has(id)
  const sources = [...state.sources].filter(railAccessible)
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

  const ranges = new Map<string, ReadonlyMap<string, number>>()
  function reach(origin: string, range: number, mobility: Mobility) {
    const key = [origin, range, mobility].join(':')
    const stored = ranges.get(key)
    if (stored) return stored
    const result = traceReach(map, origin, range, (id) => eligible(id) &&
      (mobility !== 'truck' || !state.unnegatedEnemyZoc.has(id)), (from, to) => {
      const normal = scorpionStepCost(map, from, to, mobility, 'dry')
      if (state.weather !== 'freeze') return normal
      const reduced = scorpionStepCost(map, from, to, mobility, 'freeze')
      if (typeof reduced !== 'number') return normal
      return typeof normal === 'number' ? Math.min(normal, reduced) : reduced
    })
    ranges.set(key, result)
    return result
  }

  // OCS 12.3c. Adjacency at the recipient/source end ignores the last hexside's terrain.
  const reaches = (within: ReadonlyMap<string, number>, id: string) =>
    within.has(id) || map.neighbors(id).some((near) => within.has(near))
  const canDraw = (origin: string, source: string, mobility: Mobility) => reaches(reach(origin, 5, mobility), source)
  const canThrow = (hq: Headquarter, hex: string) => reaches(reach(hq.hex, hq.throwRange, hq.mobility), hex)

  function trace(location: string, mobility: Mobility = 'truck'): TraceOption[] {
    const hex = scorpionHexId(location)
    if (!eligible(hex)) return []
    const options = sources.filter((source) => canDraw(hex, source, mobility))
      .map((source): TraceOption => ({ kind: 'direct', from: hex, source }))
    for (const hq of state.headquarters) {
      if (!canThrow(hq, hex)) continue
      const headquarters = hq.id ? { headquarters: hq.id } : {}
      if (hq.kessel && state.side === 'axis') options.push({ kind: 'kessel', from: hq.hex, source: hq.hex, ...headquarters })
      else for (const source of sources.filter((id) => canDraw(hq.hex, id, hq.mobility))) {
        options.push({ kind: 'hq', from: hq.hex, source, ...headquarters })
      }
    }
    return options
  }

  function canUseDump(location: string, source: string, mobility: Mobility = 'truck'): boolean {
    if (!eligible(location) || !eligible(source)) return false
    return canDraw(location, source, mobility) || state.headquarters.some((hq) =>
      canDraw(hq.hex, source, hq.mobility) && canThrow(hq, location))
  }
  function canDrawDump(location: string, source: string, mobility: Mobility = 'truck') {
    return eligible(location) && eligible(source) && canDraw(location, source, mobility)
  }

  function canUseDumpVia(hqId: string, location: string, source: string) {
    const hq = state.headquarters.find((candidate) => candidate.id === hqId)
    return Boolean(hq && eligible(hq.hex) && eligible(location) && eligible(source) &&
      canDraw(hq.hex, source, hq.mobility) && canThrow(hq, location))
  }

  function inThrowRange(hqId: string, location: string) {
    const hq = state.headquarters.find((candidate) => candidate.id === hqId)
    return Boolean(hq && canThrow(hq, location))
  }

  return { trace, canUseDump, canDrawDump, canUseDumpVia, inThrowRange }
}
