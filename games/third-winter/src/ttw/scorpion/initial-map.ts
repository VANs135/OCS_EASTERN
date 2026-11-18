import { edgeKey } from '@ocs-eastern/series/ground-map'
import type { Side } from '@ocs-eastern/series/state-types'
import { scorpionHexId } from '../../import/hex-id.ts'
import type { ScorpionMap } from '../../import/scorpion-map.ts'
import { scorpionFixedSupply } from './fixed-supply.ts'

// Scorpion Axis setup, TTW Scenarios p.55.
export const scorpionAxisSources = ['s1.03', 's1.06', 's7.01', 's15.01'] as const

// TTW Scenarios p.54 and the printed Scorpion perimeter, clockwise from s1.14 to s20.01.
export const scorpionSovietSources = [
  's1.14', 's1.16', 's2.17', 's3.17', 's4.17', 's8.17', 's20.17',
  's22.13', 's22.11', 's22.09', 's22.07', 's22.02', 's20.01',
] as const

export const scorpionSupplySources = { axis: scorpionAxisSources, soviet: scorpionSovietSources } as const

const designatedSites = new Set<string>([...scorpionAxisSources, ...scorpionSovietSources,
  ...scorpionFixedSupply.flatMap(({ destinations }) => destinations)])
const controlSites = new WeakMap<ScorpionMap, ReadonlySet<string>>()

/** TTW 1.2b. The Scorpion map prints the Korsun point-of-interest symbol in s13.11. */
export function scorpionPrintedUnloadingSite(map: ScorpionMap, hex: string): boolean {
  return Boolean(map.hexes.get(hex)?.city || hex === 's13.11')
}

export function scorpionControlSites(map: ScorpionMap): ReadonlySet<string> {
  const existing = controlSites.get(map)
  if (existing) return existing
  const sites = new Set([...map.hexes.keys()].filter((hex) => designatedSites.has(hex) ||
    (scorpionPrintedUnloadingSite(map, hex) && map.neighbors(hex).some((near) => map.edge(hex, near)?.rail))))
  controlSites.set(map, sites)
  return sites
}

// Opening adjudication from the opposing setup positions in TTW Scenarios pp.54–55.
// Entries run west to east, starting at s1. Axis controls through that row, south of the line.
// Columns beyond the eastern Axis line are Soviet. This is separate from printed rail gauges.
const axisNorthRow = [10, 10, 11, 11, 13, 13, 14, 14, 14, 14, 14, 14, 15, 15, 15, 14, 13] as const

export function scorpionOpeningFrontControl(map: ScorpionMap | undefined): Readonly<Record<string, Side>> {
  if (!map) return {}
  const printed = Object.fromEntries(Object.entries(scorpionSupplySources).flatMap(([side, sources]) =>
    sources.filter((hex) => map.hexes.has(hex)).map((hex) => [hex, side as Side])))
  // Small test maps and position excerpts do not carry the complete scenario's front.
  if (map.hexes.size !== 22 * 17 || !map.hexes.has('s1.01') || !map.hexes.has('s22.17')) return printed
  const front = Object.fromEntries<Side>([...scorpionControlSites(map)].map((hex) => {
    const [col, row] = hex.slice(1).split('.').map(Number) as [number, number]
    return [hex, row <= (axisNorthRow[col - 1] ?? 0) ? 'axis' : 'soviet']
  }))
  return { ...front, ...printed }
}

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
