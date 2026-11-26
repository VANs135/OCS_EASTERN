// 会话装配层数据适配器：把战役地图索引（indexTtwCampaignMap）转成几何工厂的地图＋格性质面。
// villageCity 读 terrains_present（Village/Minor City/Major City）；detrainable 取静态「有铁路格」事实
// （动态轨距/卸载点由铁路网络绑定另行组合）；地图归属取规范格号首字母（A–D）。

import { tryCampaignHexKey } from '../import/hex-id.ts'
import type { TtwCampaignMapIndex } from '../import/campaign-map-index.ts'
import type { CampaignGeometryMap } from './campaign-geometry.ts'

const cityTerrains: ReadonlySet<string> = new Set(['Village', 'Minor City', 'Major City'])

export interface CampaignMapAdapter {
  map: CampaignGeometryMap
  hexSite(hex: string): { villageCity: boolean; detrainable: boolean; map: string } | undefined
}

/** 由战役地图索引派生几何地图与格性质。friendlyAirBase/isCombatUnit/inSupply 由调用方另补。 */
export function campaignMapAdapter(index: TtwCampaignMapIndex): CampaignMapAdapter {
  const resolveHex = (hex: string): string | undefined => {
    const key = tryCampaignHexKey(hex)
    if (!key) return undefined
    const canonical = index.canonicalByHex.get(key)
    return canonical && index.onMapHexes.has(canonical) ? canonical : undefined
  }
  const hasRail = (hex: string): boolean =>
    index.neighbors(hex).some((to) =>
      index.connection(hex, to)?.sourceEdges.some((edge) => edge.rail_present === true) === true)
  return {
    map: { resolveHex, neighbors: (hex) => index.neighbors(hex) },
    hexSite: (hex) => {
      const terrains = index.terrainAt(hex)
      if (!terrains) return undefined
      return { villageCity: terrains.some((terrain) => cityTerrains.has(terrain)), detrainable: hasRail(hex), map: hex[0]! }
    },
  }
}