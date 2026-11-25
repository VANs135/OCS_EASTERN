import type { Side } from '@ocs-eastern/series/state-types'
import type { Mobility } from '@ocs-eastern/series/ground-map'
import { supplyNetwork } from '@ocs-eastern/series/supply-network'
import type { SupplyExtender, SupplyHeadquarter, SupplyTraceOption } from '@ocs-eastern/series/supply-network'
import { scorpionHexId } from '../../import/hex-id.ts'
import type { ScorpionMap } from '../../import/scorpion-map.ts'
import { scorpionStepCost } from './terrain-cost.ts'
import { scorpionPrintedUnloadingSite } from './initial-map.ts'

type Headquarter = Omit<SupplyHeadquarter, 'selfContained'> & { kessel?: boolean }
export type ExtenderLink = SupplyExtender

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
  extenders?: readonly ExtenderLink[]
  weather: 'freeze' | 'thaw'
}

export type TraceOption = Omit<SupplyTraceOption, 'kind'> & { kind: 'direct' | 'hq' | 'kessel' }

export function scorpionTraceOptions(
  map: ScorpionMap, state: TracePosition, location: string, drawMobility: Mobility = 'truck',
): TraceOption[] {
  return scorpionSupplyNetwork(map, state).trace(location, drawMobility)
}

export function scorpionSupplyNetwork(map: ScorpionMap, state: TracePosition) {
  const network = supplyNetwork({
    hasHex: (hex) => map.hexes.has(hex),
    neighbors: map.neighbors,
    detrainable: (hex) => scorpionPrintedUnloadingSite(map, hex) || state.detrainableFacilities.has(hex),
    railCanTrace: (from, to) => Boolean(map.edge(from, to)?.rail) && state.railGauge(from, to) === state.side,
    traceCost: (from, to, mobility) => {
      const normal = scorpionStepCost(map, from, to, mobility, 'dry')
      if (state.weather !== 'freeze') return normal
      const reduced = scorpionStepCost(map, from, to, mobility, 'freeze')
      if (typeof reduced !== 'number') return normal
      return typeof normal === 'number' ? Math.min(normal, reduced) : reduced
    },
  }, { ...state, headquarters: state.headquarters.map(({ kessel, ...hq }) => ({
    ...hq, selfContained: kessel && state.side === 'axis',
  })) })
  return { ...network, hasTrace: (location: string, mobility: Mobility = 'truck') => network.hasTrace(scorpionHexId(location), mobility),
    trace: (location: string, mobility: Mobility = 'truck'): TraceOption[] =>
    network.trace(scorpionHexId(location), mobility).map((option) => ({
      ...option, kind: option.kind === 'self-contained' ? 'kessel' : option.kind,
    })) }
}
