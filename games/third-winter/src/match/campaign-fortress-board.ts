// TTW §2.4a 要塞盘面装配：地图库城市格集（仅 Major/Minor City）＋hexControl 城市归属＋距城 2 格敌战斗单位＋剧本要塞池。
// 宣告入口与状态存储仍在 campaign-fortress.ts；本工厂只把真实数据面接成 CampaignFortressBoard，并派生城禁出钩子。

import type { Side } from '@ocs-eastern/series/state-types'
import { campaignHexesWithin } from '../ttw/campaign/hex-range.ts'
import { campaignCityControl } from './campaign-control.ts'
import type { CampaignFortressBoard } from './campaign-fortress.ts'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignFortressCity { city: string; level: string; hexes: readonly string[] }

export interface CampaignFortressSource {
  map: CampaignGroundMap
  /** 地图库城市访问器（indexTtwCampaignMap 的 cityOf）；村庄/非城市返回 undefined 或非 City 等级。 */
  cityOf(hex: string): CampaignFortressCity | undefined
  /** 全部城市格集（用于按城名取格）。 */
  citySites: readonly CampaignFortressCity[]
  /** 算子是否为战斗单位（与几何工厂共用 attackCapable 口径）。 */
  isCombatUnit(state: Readonly<CampaignTurnState>, id: string): boolean
  /** 剧本"available"池中的要塞单位定义（§2.4a 宣告前提）；按 kind 取用。 */
  fortressUnits: readonly { kind: 'german' | 'rumanian'; definition: string; re: number }[]
  /** 罗马尼亚边界判定（Rumanian Fortress 只能放在罗马尼亚境内）；缺省视为不在罗马尼亚（禁止宣告）。 */
  withinRumania?(hex: string): boolean
}

export interface CampaignFortressHooks extends CampaignFortressBoard {
  /** §2.4a 城内轴心地面单位不得自愿走出城市（含后续入城者）；返回拒绝原因或 null。 */
  exitRefusal(state: Readonly<CampaignTurnState>, id: string, from: string, to: string): string | null
}

const fortressCityLevel = (level: string) => /Major City|Minor City/.test(level)

/** 由地图库＋盘面事实装配要塞板。 */
export function campaignFortressBoards(source: CampaignFortressSource): CampaignFortressHooks {
  const cityOf = (hex: string) => {
    const site = source.cityOf(hex)
    if (!site || !fortressCityLevel(site.level)) return undefined
    return { city: site.city, hexes: [...site.hexes] }
  }
  const citySite = (city: string) => source.citySites.find((site) => site.city === city)
  return {
    map: source.map,
    cityOf: (_state, hex) => cityOf(hex),
    axisControlsCity: (state, city) => campaignCityControl(state, citySite(city)?.hexes ?? [city]) === 'axis',
    enemyCombatWithin2(state, city) {
      const site = citySite(city)
      if (!site) return false
      const reach = new Set<string>()
      for (const hex of site.hexes) for (const near of campaignHexesWithin(source.map, hex, 2)) reach.add(near)
      return Object.entries(state.counters).some(([id, counter]) => counter.side === 'soviet' &&
        counter.location.kind === 'map' &&
        reach.has(source.map.resolveHex(counter.location.hex) ?? counter.location.hex) && source.isCombatUnit(state, id))
    },
    fortressUnit(state, kind) {
      const placed = new Set(Object.values(state.counters)
        .filter((counter) => counter.location.kind === 'map').map((counter) => counter.definition))
      const free = source.fortressUnits.find((unit) => unit.kind === kind && !placed.has(unit.definition))
      return free ? { definition: free.definition, re: free.re } : undefined
    },
    withinRumania: (_state, hex) => source.withinRumania?.(hex) ?? false,
    exitRefusal(state, id, from, to) {
      const counter = state.counters[id]
      if (!counter || counter.side !== 'axis' || counter.location.kind !== 'map') return null
      // 只受「所在那一座」要塞城的限制：走到任何城外格（含另一座城）都不允许。
      const city = (state.fortresses ?? []).find(({ hexes }) => hexes.includes(from))
      return city && !city.hexes.includes(to) ? 'fortress-city-no-exit' : null
    },
  }
}
