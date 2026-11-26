// 会话装配层：由地图库适配器＋盘面事实派生几何钩子（替代合成测试注入）。
// 格性质（村庄/城市、可卸载、地图归属）与友军机场由地图库适配器注入；战斗单位距离沿地图邻接 BFS。
// 距离口径复用 ttw/campaign/hex-range.ts 的几何邻接；RVGK 穿越判定经注入的铁路路径格序。

import { campaignHexesWithin } from '../ttw/campaign/hex-range.ts'
import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignGeometryMap {
  resolveHex(hex: string): string | undefined
  neighbors(hex: string): readonly string[]
}

export interface CampaignGeometrySource {
  map: CampaignGeometryMap
  /** 格性质：村庄/城市、可卸载（铁路格）、地图归属（A–D）。地图库适配器提供。 */
  hexSite(hex: string): { villageCity: boolean; detrainable: boolean; map: string } | undefined
  /** 友军机场格。 */
  friendlyAirBase(state: Readonly<CampaignTurnState>, hex: string, side: Side): boolean
  /** 算子是否为战斗单位（attackCapable；轴心 RVGK 限制可由调用方排除 Kessel 补给者）。 */
  isCombatUnit(state: Readonly<CampaignTurnState>, id: string): boolean
  /** 算子是否在补给。 */
  inSupply(state: Readonly<CampaignTurnState>, id: string): boolean
  /** 铁路路径格序（含起讫），用于 RVGK 标记穿越判定；缺省仅查起讫格。 */
  railRoute?(state: Readonly<CampaignTurnState>, from: string, to: string): readonly string[]
}

export interface CampaignGeometryHooks {
  mapOf(hex: string): string | undefined
  detrainable(state: Readonly<CampaignTurnState>, hex: string): boolean
  siteFacts(state: Readonly<CampaignTurnState>, hex: string):
    { villageCityOrFriendlyAirBase: boolean; distanceToInSupplySovietCombat: number } | undefined
  sovietCombatWithin10(state: Readonly<CampaignTurnState>, hex: string): boolean
  routeWithin10AxisCombat(state: Readonly<CampaignTurnState>, from: string, to: string): boolean
}

/** 某侧在图战斗单位（可选要求在补）的格集。 */
function combatHexes(state: Readonly<CampaignTurnState>, source: CampaignGeometrySource,
  side: Side, requireInSupply: boolean): Set<string> {
  const hexes = new Set<string>()
  for (const [id, counter] of Object.entries(state.counters)) {
    if (counter.side !== side || counter.location.kind !== 'map') continue
    if (!source.isCombatUnit(state, id)) continue
    if (requireInSupply && !source.inSupply(state, id)) continue
    hexes.add(counter.location.hex)
  }
  return hexes
}

/** 沿邻接 BFS 求 from 到目标格集的最短距离；无目标返回 Infinity。 */
function minDistance(map: CampaignGeometryMap, from: string, targets: ReadonlySet<string>): number {
  if (targets.size === 0) return Infinity
  const start = map.resolveHex(from) ?? from
  if (targets.has(start)) return 0
  const seen = new Set([start])
  let frontier: readonly string[] = [start]
  for (let distance = 1; frontier.length; distance++) {
    const next: string[] = []
    for (const hex of frontier) for (const neighbor of map.neighbors(hex)) {
      if (seen.has(neighbor)) continue
      if (targets.has(neighbor)) return distance
      seen.add(neighbor)
      next.push(neighbor)
    }
    frontier = next
  }
  return Infinity
}

function withinRadius(map: CampaignGeometryMap, from: string, targets: ReadonlySet<string>, radius: number): boolean {
  if (targets.size === 0) return false
  return campaignHexesWithin(map, from, radius).some((hex) => targets.has(hex))
}

/** 由地图库适配器＋盘面事实派生几何钩子。 */
export function campaignGeometryHooks(source: CampaignGeometrySource): CampaignGeometryHooks {
  const { map } = source
  return {
    mapOf: (hex) => source.hexSite(map.resolveHex(hex) ?? hex)?.map,
    detrainable: (state, hex) => source.hexSite(map.resolveHex(hex) ?? hex)?.detrainable === true,
    siteFacts: (state, hex) => {
      const resolved = map.resolveHex(hex) ?? hex
      const site = source.hexSite(resolved)
      if (!site) return undefined
      return {
        villageCityOrFriendlyAirBase: site.villageCity || source.friendlyAirBase(state, resolved, 'axis'),
        distanceToInSupplySovietCombat: minDistance(map, resolved, combatHexes(state, source, 'soviet', true)),
      }
    },
    sovietCombatWithin10: (state, hex) =>
      withinRadius(map, map.resolveHex(hex) ?? hex, combatHexes(state, source, 'soviet', true), 10),
    routeWithin10AxisCombat: (state, from, to) => {
      const axis = combatHexes(state, source, 'axis', false)
      const route = source.railRoute?.(state, from, to) ?? [from, to]
      return route.some((hex) => withinRadius(map, map.resolveHex(hex) ?? hex, axis, 10))
    },
  }
}