// TTW §3.5a RVGK 标记的生产板：铁路路径/轨距取 01 的 railNetwork，标记只沿苏军宽轨移动
// （与所有铁路移动/铁路运输同一轨距限制）；可卸载格取生产 trace，
// 10 格轴心战斗单位禁入用真实邻接判断；费用按 5 RE 起算并照常叠加 Trainbusting/多轨修正。

import { inTrainbustingZone } from '@ocs-eastern/series/trainbusting'
import { railCapacityCost } from '@ocs-eastern/series/rail-transport'
import { ttwRailGauge } from '../ttw/campaign/rail-gauge.ts'
import { campaignHexesWithin } from '../ttw/campaign/hex-range.ts'
import type { RvgkBox } from '../ttw/rvgk.ts'
import { campaignRailEdge } from './campaign-rail-network.ts'
import { campaignRailStatus } from './campaign-rail-transport.ts'
import type { CampaignRailBoard } from './campaign-rail-transport.ts'
import type { CampaignGroundMovementBoard } from './campaign-movement-board.ts'
import type { CampaignRvgkMarkerBoard } from './campaign-rvgk-marker.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

type Playable = ReturnType<typeof import('../ttw/campaign/play-area.ts').campaignMapInPlayArea>
type Terrain = ReturnType<typeof import('../import/campaign-terrain.ts').campaignTerrain>

const RVGK_MARKER_RE = 5

export interface DnieperRvgkMarkerBoardInput {
  playable: Playable
  terrain: Terrain
  groundMovement: CampaignGroundMovementBoard
  railTransport: CampaignRailBoard
  railheads?: readonly string[]
}

/** 01 生产 RVGK 标记铁路板。 */
export function dnieperRvgkMarkerBoard(input: DnieperRvgkMarkerBoardInput): CampaignRvgkMarkerBoard {
  const { playable, terrain, groundMovement, railTransport } = input

  const detrainable = (state: Readonly<CampaignTurnState>, hex: string) => {
    const resolved = playable.resolveHex(hex) ?? hex
    const railheads = state.initialRailheadMarkers ?? input.railheads ?? []
    const sites = new Set(railheads.map((railhead) => {
      const printed = typeof railhead === 'string' ? railhead : railhead.hex
      return playable.resolveHex(printed) ?? printed
    }))
    return sites.has(resolved) || terrain.terrainAt(resolved)?.some((t) =>
      t === 'Minor City' || t === 'Major City') === true
  }

  /** 沿铁路的 BFS；§3.5a 未单独写轨距，但铁路移动统一只走本方轨距，RVGK 标记同样只走苏军宽轨。 */
  const railRoute = (state: Readonly<CampaignTurnState>, from: string, to: string, avoid?: ReadonlySet<string>) => {
    const start = playable.resolveHex(from)
    const target = playable.resolveHex(to)
    const network = groundMovement.railNetwork
    if (!start || !target || !network) return undefined
    const gauge = ttwRailGauge('soviet')
    const queue = [start]
    const parent = new Map<string, string | undefined>([[start, undefined]])
    for (let i = 0; i < queue.length; i += 1) {
      const hex = queue[i]!
      if (hex === target) break
      for (const next of playable.neighbors(hex)) {
        if (parent.has(next)) continue
        if (avoid?.has(next)) continue
        const edge = campaignRailEdge(state, playable, network, hex, next)
        if (!edge || edge.gauge !== gauge) continue
        parent.set(next, hex)
        queue.push(next)
      }
    }
    if (!parent.has(target)) return undefined
    const path = [target]
    let cursor = target
    while (cursor !== start) {
      const previous = parent.get(cursor)
      if (!previous) return undefined
      path.push(previous)
      cursor = previous
    }
    return path.reverse()
  }

  const axisCombatHexes = (state: Readonly<CampaignTurnState>) => {
    const hexes = new Set<string>()
    for (const [id, counter] of Object.entries(state.counters)) {
      if (counter.side !== 'axis' || counter.location.kind !== 'map') continue
      if (groundMovement.profileOf(state, id)?.combat !== true) continue
      hexes.add(playable.resolveHex(counter.location.hex) ?? counter.location.hex)
    }
    return hexes
  }

  const unsafeHexes = (state: Readonly<CampaignTurnState>) => {
    const unsafe = new Set<string>()
    for (const hex of axisCombatHexes(state)) {
      for (const near of campaignHexesWithin(playable, hex, 10)) unsafe.add(near)
    }
    return unsafe
  }

  return {
    resolveHex: (hex) => playable.resolveHex(hex),
    detrainable: (state, hex) => detrainable(state, hex),
    mapOf: (hex) => {
      const resolved = playable.resolveHex(hex) ?? hex
      return /^[A-D]/.test(resolved) ? resolved[0] : undefined
    },
    railRoute: (state, from, to) =>
      railRoute(state, from, to, unsafeHexes(state)) ?? railRoute(state, from, to),
    routeWithin10AxisCombat: (state, from, to) => {
      const all = railRoute(state, from, to)
      if (!all) return false
      return railRoute(state, from, to, unsafeHexes(state)) === undefined
    },
    railCost: (state, _box: RvgkBox, from: string, to: string) => {
      const route = railRoute(state, from, to, unsafeHexes(state)) ?? railRoute(state, from, to) ?? [from, to]
      const path = { hasTrainbustingZone: route.some((hex) =>
        inTrainbustingZone(state.trainbusting ?? [], 'soviet', hex, playable.neighbors, 'rail')),
      entirePathMultiTrack: route.length > 1 && route.every((hex, index) =>
        index === 0 || terrain.railAt(route[index - 1]!, hex) === 'double') }
      return railCapacityCost([{ kind: 'unit', re: RVGK_MARKER_RE, mobility: 'leg', moveMa: 0 }], path).cost
    },
    railCapacityRemaining: (state) => campaignRailStatus(state, 'soviet', railTransport)?.remainingCapacity ?? 0,
  }
}
