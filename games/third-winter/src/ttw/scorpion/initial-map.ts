import { edgeKey } from '@ocs-eastern/series/ground-map'
import type { Side } from '@ocs-eastern/series/state-types'
import { scorpionHexId } from '../../import/hex-id.ts'
import type { ScorpionMap } from '../../import/scorpion-map.ts'

// Scorpion Axis setup, TTW Scenarios p.55.
export const scorpionAxisSources = ['s1.03', 's1.06', 's7.01', 's15.01'] as const

// TTW Scenarios p.54 and the printed Scorpion perimeter, clockwise from s1.14 to s20.01.
export const scorpionSovietSources = [
  's1.14', 's1.16', 's2.17', 's3.17', 's4.17', 's8.17', 's20.17',
  's22.13', 's22.11', 's22.09', 's22.07', 's22.02', 's20.01',
] as const

export const scorpionSupplySources = { axis: scorpionAxisSources, soviet: scorpionSovietSources } as const

// TTW Scenarios p.53. The two branches from s22.13 end at s21.13 and s21.09.
const sovietRails = [
  ['s22.13', 's22.12'],
  ['s22.12', 's21.13'],
  ['s22.12', 's22.11'],
  ['s22.11', 's22.10'],
  ['s22.10', 's21.10'],
  ['s21.10', 's21.09'],
] as const

export function scorpionInitialRailGauge(map: ScorpionMap): (from: string, to: string) => Side {
  const soviet = new Set<string>()
  for (const [from, to] of sovietRails) {
    if (!map.edge(from, to)?.rail) throw new Error(`Missing Scorpion starting railway: ${from} to ${to}`)
    soviet.add(edgeKey(from, to))
  }
  return (from, to) => soviet.has(edgeKey(scorpionHexId(from), scorpionHexId(to))) ? 'soviet' : 'axis'
}
