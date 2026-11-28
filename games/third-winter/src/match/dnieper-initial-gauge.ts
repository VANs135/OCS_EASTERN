// 剧本 01 初始轨距。书明 Railhead 是苏军铁路端头；从地图东部/北部苏军战线上的铁路边缘格
// 向图内沿铁路追踪，到 Railhead 为止，所经边均为苏军宽轨。不是只沿书明的一条最短路径落账：
// 同一苏军铁路网侧的分支（例如 RVGK-2 起点 B43.20 的支线）也属于宽轨。
// 为避免把轴心侧线路染宽，追踪限制在同图幅内，并在书明 Wrong Gauge 标记格与
// 明确“未换轨”的边上截断；其余边一律标准轨。

import { edgeKey } from '@ocs-eastern/series/ground-map'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignRailNetwork } from './campaign-rail-network.ts'
import type { TtwRailGauge } from '../ttw/campaign/rail-gauge.ts'

export interface DnieperRailSource {
  map: CampaignGroundMap & { availableHexes?: ReadonlySet<string> }
  railAt(from: string, to: string): string | boolean | undefined
}

export interface DnieperRailhead { side: 'axis' | 'soviet'; hex: string }

/** 01 书明的苏军铁路端头；追踪到这些格即停止，不进入其后的轴心轨距。 */
const SOVIET_RAILHEADS = new Set([
  'D55.5', 'D55.9', 'D51.21', 'D55.26', 'B46.3', 'B32.18', 'B16.28', 'B16.35',
])

/** 地图东部/北部苏军战线上的铁路边缘入口，按 TTW Scenarios 第 1 剧本与 3.1a 落格。 */
const SOVIET_EDGE_ENTRIES = new Set([
  // Map D east edge
  'D62.6', 'D62.19', 'D62.27',
  // Map B east edge
  'B62.16', 'B62.18', 'B62.31',
  // Map B north edge, B16.35 and east
  'B24.35', 'B37.35', 'B41.35', 'B42.35', 'B55.35',
])

/** 书明 Wrong Gauge 标记格；其所在的德军轨距段不参与苏军宽轨泛洪。 */
const WRONG_GAUGE_MARKERS = new Set([
  'D57.1', 'D56.4', 'D50.35', 'B54.9', 'B20.28', 'B20.30', 'B18.35',
])

/** 书明为德军标准轨、或明确“未换轨”的边；即使泛洪可达也强制打回标准轨。 */
const STANDARD_CUTS: readonly (readonly [string, string])[] = [
  // B32.18 “the rail line to the south towards B31.13 is not [converted]”
  ['B32.18', 'B32.17'],
  // B16.28 只书明向东为苏军宽轨
  ['B16.28', 'B16.27'],
  // B46.3 只书明回 B51.2 的东段；西侧 B45.4 保持德军标准轨
  ['B46.3', 'B45.4'],
  // D55.5 / D51.21 / D55.26 西侧不属书明苏军宽轨段
  ['D55.5', 'D54.5'],
  ['D51.21', 'D50.21'],
  ['D55.26', 'D54.25'],
]

/** 书明同属苏军宽轨、但位于两个 Railhead 之间、泛洪到端点即停会漏掉的边。 */
const SOVIET_RAILHEAD_LINKS: readonly (readonly [string, string])[] = [
  ['D55.5', 'D55.9'],
]

export function dnieperInitialRailGauge(input: DnieperRailSource): Record<string, TtwRailGauge> {
  const map = input.map
  const railEdges = new Set<string>()
  for (const from of map.availableHexes ?? []) {
    for (const to of map.neighbors(from)) if (input.railAt(from, to)) railEdges.add(edgeKey(from, to))
  }
  if (!railEdges.size) throw new Error('Scenario 01 has no on-map railway')

  const broad = new Set<string>()
  const visited = new Set<string>()
  const pending: string[] = []
  for (const raw of SOVIET_EDGE_ENTRIES) {
    const hex = map.resolveHex(raw) ?? raw
    if (!railEdges.size || visited.has(hex)) continue
    visited.add(hex)
    pending.push(hex)
  }
  if (!pending.length) throw new Error('Scenario 01 has no Soviet rail edge entry')

  while (pending.length) {
    const at = pending.shift()!
    if (SOVIET_RAILHEADS.has(at) || WRONG_GAUGE_MARKERS.has(at)) continue
    for (const next of map.neighbors(at)) {
      // 图幅缝上的铁路连接不用于初始轨距泛洪：B/D 缝会绕过 Railhead 把轴心侧重新染色。
      if (at[0] !== next[0]) continue
      const key = edgeKey(at, next)
      if (!railEdges.has(key) || broad.has(key)) continue
      if (STANDARD_CUTS.some(([a, b]) => edgeKey(a, b) === key)) continue
      if (SOVIET_RAILHEADS.has(next) || WRONG_GAUGE_MARKERS.has(next)) {
        broad.add(key)
        continue
      }
      broad.add(key)
      if (visited.has(next)) continue
      visited.add(next)
      pending.push(next)
    }
  }
  for (const [a, b] of SOVIET_RAILHEAD_LINKS) broad.add(edgeKey(a, b))

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
