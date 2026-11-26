// TTW §2.4a 要塞宣告绑定（规则层 ttw/campaign/fortification 判定；本模块落盘要塞单位/工事/状态与城禁出）。
// 轴心可在受控主要/次要城市宣告要塞——条件为敌战斗单位距城市任一格 ≤2（含苏军移动段中途）且可用池有要塞单位；
// 宣告瞬间在该城某格放 1 要塞单位＋1 级工事（Odessa/Kiev/Poltava 可另格再放 1 要塞单位、不加工事）。
// 城内轴心地面单位不得自愿移动/撤退到城外（含后续入城者，含铁路入城者）。要塞状态持续到该城每格均苏控。

import type { Side } from '@ocs-eastern/series/state-types'
import { fortressDeclarationEligible, fortressSecondUnitAllowed, FORTRESS_DECLARATION_HEDGEHOG_LEVEL } from '../ttw/campaign/fortification.ts'
import type { CampaignHedgehog } from './campaign-hedgehogs.ts'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignCounter } from './campaign-reinforcement-state.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignFortress { city: string; hexes: readonly string[]; sinceTurn: number }

export type CampaignFortressAction = { type: 'declare-campaign-fortress'; city: string; hex: string;
  fortress: 'german' | 'rumanian'; secondHex?: string }

export interface CampaignFortressBoard {
  map: CampaignGroundMap
  /** 该格所属城市（名称＋城市全部连通格）。 */
  cityOf(state: Readonly<CampaignTurnState>, hex: string): { city: string; hexes: readonly string[] } | undefined
  axisControlsCity(state: Readonly<CampaignTurnState>, city: string): boolean
  enemyCombatWithin2(state: Readonly<CampaignTurnState>, city: string): boolean
  /** 可用池中的要塞单位定义（缺＝池空）。 */
  fortressUnit(state: Readonly<CampaignTurnState>, kind: 'german' | 'rumanian'): { definition: string; re: number } | undefined
  withinRumania(state: Readonly<CampaignTurnState>, hex: string): boolean
}

/** §2.4a：要塞宣告资格预检（UI/命令共用）。 */
export function campaignFortressEligible(state: Readonly<CampaignTurnState>, action: CampaignFortressAction,
  board: CampaignFortressBoard): boolean {
  const site = board.cityOf(state, board.map.resolveHex(action.hex) ?? action.hex)
  if (!site) return false
  return fortressDeclarationEligible({
    axisControlsCity: board.axisControlsCity(state, site.city),
    enemyCombatWithin2: board.enemyCombatWithin2(state, site.city),
    fortressInAvailablePool: board.fortressUnit(state, action.fortress) !== undefined,
    isRumanianFortress: action.fortress === 'rumanian',
    withinRumania: board.withinRumania(state, board.map.resolveHex(action.hex) ?? action.hex),
  })
}

/** §2.4a：宣告要塞（单一状态写入入口；轴心可在任意非终局阶段宣告，含苏军移动段中途）。 */
export function declareCampaignFortress(state: Readonly<CampaignTurnState>, side: Side,
  action: CampaignFortressAction, board: CampaignFortressBoard): CampaignTurnState {
  if (side !== 'axis') throw new Error('Only the Axis player may declare a fortress')
  if (state.cursor.phase === 'ended') throw new Error('Campaign has ended')
  const hex = board.map.resolveHex(action.hex)
  const site = hex ? board.cityOf(state, hex) : undefined
  if (!hex || !site || site.city !== action.city || !site.hexes.includes(hex)) throw new Error('Choose a hex of the declared city')
  const unit = board.fortressUnit(state, action.fortress)
  if (!unit) throw new Error('No fortress unit is available in the pool')
  if (!campaignFortressEligible(state, action, board)) {
    throw new Error('Fortress declaration requires an Axis-controlled city with an enemy combat unit within two hexes')
  }
  if (state.fortresses?.some((fortress) => fortress.city === action.city)) throw new Error('This city is already a fortress')
  const counters: Record<string, CampaignCounter> = { ...state.counters }
  const place = (at: string) => {
    const id = `fortress:${at}`
    if (Object.hasOwn(counters, id)) throw new Error(`A fortress unit already occupies ${at}`)
    counters[id] = { definition: unit.definition, side: 'axis', kind: 'land', location: { kind: 'map', hex: at },
      currentRe: unit.re, stepsLost: 0, mode: 'combat' }
  }
  place(hex)
  if (action.secondHex !== undefined) {
    const second = board.map.resolveHex(action.secondHex)
    if (!second || second === hex || !site.hexes.includes(second) || !fortressSecondUnitAllowed(site.city)) {
      throw new Error('A second fortress unit is allowed only in another hex of Odessa, Kiev or Poltava')
    }
    place(second)
  }
  // 宣告瞬间放 1 级工事；该格已有工事时不叠加（§2.4a 对第二单位明言「no additional Hedgehog」）。
  const hedgehogs: Record<string, CampaignHedgehog | null> = { ...state.hedgehogs }
  if ((hedgehogs[hex]?.level ?? 0) === 0) hedgehogs[hex] = { side: 'axis', level: FORTRESS_DECLARATION_HEDGEHOG_LEVEL as 1 }
  return { ...state, counters, hedgehogs,
    fortresses: [...(state.fortresses ?? []), { city: site.city, hexes: [...site.hexes], sinceTurn: state.turn }] }
}

/** §2.4a：城内轴心地面单位不得自愿移动/撤退到城外（含后续入城者）。 */
export function fortressExitRefusal(state: Readonly<CampaignTurnState>, from: string, to: string): string | null {
  const resolvedFrom = from, resolvedTo = to
  return (state.fortresses ?? []).some(({ hexes }) => hexes.includes(resolvedFrom) && !hexes.includes(resolvedTo))
    ? 'fortress-city-no-exit' : null
}

/** §2.4a：要塞状态终止——城市每格均苏控（由苏军清理/控制结算调用）。 */
export function settleCampaignFortressStatus(state: Readonly<CampaignTurnState>,
  sovietControlsHex: (hex: string) => boolean): CampaignTurnState {
  const fortresses = state.fortresses ?? []
  const remaining = fortresses.filter(({ hexes }) => !hexes.every((hex) => sovietControlsHex(hex)))
  return remaining.length === fortresses.length ? state : { ...state, fortresses: remaining }
}

/** UI 只读投影：要塞城市清单（含进入回合），供要塞面板渲染（不替代宣告入口）。 */
export function campaignFortressOptions(state: Readonly<CampaignTurnState>) {
  return { fortresses: (state.fortresses ?? []).map(({ city, hexes, sinceTurn }) => ({ city, hexes: [...hexes], sinceTurn })) }
}