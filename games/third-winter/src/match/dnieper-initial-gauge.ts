// 剧本 01 初始轨距，直接按 TTW Scenarios 第 1 剧本“Soviet Railheads”条逐段落账：
// 从每个 Railhead 沿铁路向苏联补给源（或书明端点）推到的边为苏军宽轨，其余铁路为标准轨。
// 不按“铁路图连通分量”泛化，避免把轴心侧支线误染成苏轨。

import { edgeKey } from '@ocs-eastern/series/ground-map'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignRailNetwork } from './campaign-rail-network.ts'
import type { TtwRailGauge } from '../ttw/campaign/rail-gauge.ts'

export interface DnieperRailSource {
  map: CampaignGroundMap & { availableHexes?: ReadonlySet<string> }
  railAt(from: string, to: string): string | boolean | undefined
}

export interface DnieperRailhead { side: 'axis' | 'soviet'; hex: string }

/** 书明为苏军宽轨的铁路段；端点已按地图库规范格号。 */
const SOVIET_PATH_ENDPOINTS: readonly (readonly [string, string])[] = [
  // Map D
  ['D62.6', 'D55.5'],
  ['D62.6', 'D55.9'],
  ['D55.5', 'D55.9'],
  ['D62.19', 'D51.21'],
  ['D62.27', 'D55.26'],
  // Map B
  ['B46.3', 'B51.2'],
  ['B51.2', 'B57.7'],
  ['B32.18', 'B25.34'],
  ['B32.18', 'B48.16'],
  ['B16.28', 'B62.31'],
]

/** 书明为德军标准轨、即使落在宽轨段内也要打掉的边。只列地图库能确认的直连边。 */
const STANDARD_EDGES: readonly (readonly [string, string])[] = []

export function dnieperInitialRailGauge(input: DnieperRailSource): Record<string, TtwRailGauge> {
  const map = input.map
  const railEdges = new Set<string>()
  for (const from of map.availableHexes ?? []) {
    for (const to of map.neighbors(from)) if (input.railAt(from, to)) railEdges.add(edgeKey(from, to))
  }
  if (!railEdges.size) throw new Error('Scenario 01 has no on-map railway')

  const broad = new Set<string>()
  const unresolved: string[] = []
  for (const [fromRaw, toRaw] of SOVIET_PATH_ENDPOINTS) {
    const from = map.resolveHex(fromRaw) ?? fromRaw
    const to = map.resolveHex(toRaw) ?? toRaw
    const path = railPath(map, input.railAt, railEdges, from, to)
    if (!path) { unresolved.push(`${fromRaw}->${toRaw}`); continue }
    for (let index = 1; index < path.length; index++) broad.add(edgeKey(path[index - 1]!, path[index]!))
  }
  for (const [aRaw, bRaw] of STANDARD_EDGES) broad.delete(edgeKey(aRaw, bRaw))
  if (unresolved.length) {
    throw new Error(`Scenario 01 rail gauge paths have no matching on-map railway: ${unresolved.join(', ')}`)
  }

  const result: Record<string, TtwRailGauge> = {}
  for (const key of railEdges) result[key] = broad.has(key) ? 'broad' : 'standard'
  return result
}

/** 同一条书明路径的铁路网络；未书明的边一律标准轨。 */
export function dnieperRailNetwork(input: DnieperRailSource, railheads: readonly DnieperRailhead[]): CampaignRailNetwork {
  const gauges = dnieperInitialRailGauge(input)
  return {
    edge(from, to) {
      const key = edgeKey(from, to)
      const gauge = gauges[key]
      return gauge ? { gauge, multiTrack: input.railAt(from, to) === 'double' } : undefined
    },
    initialGaugeJunctions: railheads.map(({ hex }) => hex),
  }
}

function railPath(map: DnieperRailSource['map'], railAt: DnieperRailSource['railAt'],
  railEdges: ReadonlySet<string>, from: string, to: string): readonly string[] | undefined {
  const pending = [from]
  const previous = new Map<string, string | null>([[from, null]])
  while (pending.length) {
    const at = pending.shift()!
    if (at === to) {
      const path: string[] = []
      let cursor: string | null = to
      while (cursor) { path.push(cursor); cursor = previous.get(cursor) ?? null }
      return path.reverse()
    }
    for (const next of map.neighbors(at)) {
      if (previous.has(next) || !railEdges.has(edgeKey(at, next))) continue
      previous.set(next, at)
      pending.push(next)
    }
  }
  return undefined
}
