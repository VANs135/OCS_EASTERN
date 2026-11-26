// TTW §3.5 RVGK 盒绑定（判定复用 ttw/rvgk.ts；几何复用 campaignHexesWithin）。
// 重建入盒已在 campaign-rebuild.ts / campaign-special-replacement.ts（location.box）。本模块接标记几何、
// 在图入盒（增援阶段≤20 格战略可达）、移动段首释放（≤5 格）、敌逼强制出盒（≤5 格触发、放≤3 格）与 UI 投影。
// 战略可达/满编/最低编成维持/独立单位编组等盘面事实由调用方注入（数据驱动），不脑补。
// 欠出盒义务经 campaignRvgkExitObligations 派生，装配层应并入 groundMovement.endBlockers（如 `rvgk-forced-exit:<box>`），
// 使移动段不能在义务未履行时结束。

import {
  RVGK_ENTER_DISTANCE, RVGK_FORCED_EXIT_DISTANCE, RVGK_FORCED_EXIT_PLACE_RADIUS, RVGK_RELEASE_DISTANCE,
  rvgkEnterEligible, rvgkForcedExit, rvgkReleaseEligible, type RvgkBox,
} from '../ttw/rvgk.ts'
import { campaignHexesWithin } from '../ttw/campaign/hex-range.ts'
import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export type CampaignRvgkAction =
  | { type: 'enter-campaign-rvgk'; counterId: string; box: RvgkBox }
  | { type: 'release-campaign-rvgk'; counterId: string; box: RvgkBox; hex: string }
  | { type: 'force-exit-campaign-rvgk'; box: RvgkBox; axisCombatHex: string; placements: Readonly<Record<string, string>> }

const markerHex = (state: Readonly<CampaignTurnState>, box: RvgkBox) => state.rvgkMarkers?.[box]
const within = (map: CampaignGroundMap, center: string | undefined, radius: number, hex: string) =>
  center !== undefined && campaignHexesWithin(map, center, radius).includes(map.resolveHex(hex) ?? hex)

/** UI 只读投影：各盒标记格＋ contents（按 stepsLost 分 Rebuilding/Ready 区）。最低编成由数据层另算。 */
export function campaignRvgkOptions(state: Readonly<CampaignTurnState>, side: Side) {
  if (side !== 'soviet') return null
  const boxes: RvgkBox[] = ['rvgk-1', 'rvgk-2']
  return boxes.map((box) => {
    const contents = Object.entries(state.counters)
      .filter(([, c]) => c.side === 'soviet' && c.location.kind === 'box' && c.location.box === box)
      .map(([id, c]) => ({ id, rebuilding: (c.stepsLost ?? 0) > 0 }))
    return { box, markerHex: markerHex(state, box) ?? null,
      ready: contents.filter((c) => !c.rebuilding).map((c) => c.id),
      rebuilding: contents.filter((c) => c.rebuilding).map((c) => c.id) }
  })
}

/** §3.5c：苏军增援阶段，在图单位距标记≤20 格且战略可达 → 入盒（无燃油）。 */
export function enterCampaignRvgk(state: Readonly<CampaignTurnState>, side: Side,
  action: Extract<CampaignRvgkAction, { type: 'enter-campaign-rvgk' }>, map: CampaignGroundMap,
  stratReachable: (state: Readonly<CampaignTurnState>, id: string) => boolean): CampaignTurnState {
  const cursor = state.cursor
  if (!('phasing' in cursor) || cursor.phase !== 'reinforcement' || cursor.phasing !== 'soviet' || side !== 'soviet') {
    throw new Error('RVGK entry is in the Soviet reinforcement phase')
  }
  const counter = state.counters[action.counterId]
  if (!counter || counter.side !== 'soviet' || counter.location.kind !== 'map') throw new Error('Choose a Soviet on-map counter')
  const reachable = stratReachable(state, action.counterId)
  if (!rvgkEnterEligible({ sovietReinforcementPhase: true, within20: within(map, markerHex(state, action.box), RVGK_ENTER_DISTANCE, counter.location.hex), stratReachable: reachable })) {
    throw new Error('The counter must be within 20 hexes of the RVGK marker and able to reach it in Strat Mode')
  }
  return { ...state, counters: { ...state.counters, [action.counterId]: { ...counter, location: { kind: 'box', box: action.box } } } }
}

/** §3.5d B：苏军移动阶段开始释放——距标记≤5 格、维持最低编成、满编、本回合未入盒；独立单位随坦克集团军 HQ。 */
export function releaseCampaignRvgk(state: Readonly<CampaignTurnState>, side: Side,
  action: Extract<CampaignRvgkAction, { type: 'release-campaign-rvgk' }>, map: CampaignGroundMap,
  facts: { fullStrength: boolean; minimumsMaintained: boolean; enteredThisTurn: boolean; independent: boolean; withTankArmyHq: boolean; independentRe: number; truckOrTrackMa: boolean }): CampaignTurnState {
  const cursor = state.cursor
  if (!('phasing' in cursor) || cursor.phase !== 'movement' || cursor.phasing !== 'soviet' || side !== 'soviet' ||
    state.movementSegment !== 'movement') throw new Error('RVGK release is at the start of the Soviet movement phase')
  const counter = state.counters[action.counterId]
  if (!counter || counter.side !== 'soviet' || counter.location.kind !== 'box' || counter.location.box !== action.box) {
    throw new Error('Choose a counter in the named RVGK box')
  }
  const target = map.resolveHex(action.hex)
  if (!target || !within(map, markerHex(state, action.box), RVGK_RELEASE_DISTANCE, action.hex)) {
    throw new Error('Released units are placed within 5 hexes of the RVGK marker')
  }
  if (!rvgkReleaseEligible({ sovietMovementStart: true, within5: true, ...facts })) {
    throw new Error('The release does not meet the RVGK minimums, strength or independent-unit conditions')
  }
  // §3.5d B：释放的卡车/履带 MA 单位按单单位法免费加油（只本阶段有效，换段由 clearCampaignPhaseFuel 清）。
  const released = { ...counter, location: { kind: 'map' as const, hex: target }, ...(facts.truckOrTrackMa ? { fueled: true } : {}) }
  return { ...state, counters: { ...state.counters, [action.counterId]: released } }
}

/** §3.5d A：轴心战斗单位进入标记≤5 格 → 盒内全部单位立即放到标记≤3 格（placements 由调用方按盘面给出）。 */
export function forceExitCampaignRvgk(state: Readonly<CampaignTurnState>, map: CampaignGroundMap, box: RvgkBox,
  axisCombatHex: string, placements: Readonly<Record<string, string>>): CampaignTurnState {
  const marker = markerHex(state, box)
  if (!rvgkForcedExit({ axisCombatWithin5: within(map, marker, RVGK_FORCED_EXIT_DISTANCE, axisCombatHex) })) return state
  const counters = { ...state.counters }
  for (const [id, counter] of Object.entries(state.counters)) {
    if (counter.side !== 'soviet' || counter.location.kind !== 'box' || counter.location.box !== box) continue
    const hex = placements[id] && map.resolveHex(placements[id])
    if (!hex || !within(map, marker, RVGK_FORCED_EXIT_PLACE_RADIUS, hex)) throw new Error('Forced-exit units must be placed within 3 hexes of the RVGK marker')
    counters[id] = { ...counter, location: { kind: 'map', hex } }
  }
  return { ...state, counters }
}

/** §3.5d A：仍欠强制出盒的盒——轴心战斗单位在标记≤5 格且盒内尚有苏军单位（供移动段末阻塞）。 */
export function campaignRvgkExitObligations(state: Readonly<CampaignTurnState>, map: CampaignGroundMap,
  isAxisCombatUnit: (state: Readonly<CampaignTurnState>, id: string) => boolean):
  { box: RvgkBox; axisCombatHex: string }[] {
  const boxes: RvgkBox[] = ['rvgk-1', 'rvgk-2']
  const axisHexes = Object.entries(state.counters)
    .filter(([id, counter]) => counter.side === 'axis' && counter.location.kind === 'map' && isAxisCombatUnit(state, id))
    .map(([, counter]) => map.resolveHex((counter.location as { hex: string }).hex) ?? (counter.location as { hex: string }).hex)
  const obligations: { box: RvgkBox; axisCombatHex: string }[] = []
  for (const box of boxes) {
    if (!Object.values(state.counters).some((counter) =>
      counter.side === 'soviet' && counter.location.kind === 'box' && counter.location.box === box)) continue
    const marker = markerHex(state, box)
    if (marker === undefined) continue
    const hit = axisHexes.find((hex) => within(map, marker, RVGK_FORCED_EXIT_DISTANCE, hex))
    if (hit) obligations.push({ box, axisCombatHex: hit })
  }
  return obligations
}

/** §3.5d A：苏军把被逼近盒内的单位放到标记≤3 格（单一状态写入入口）。 */
export function applyForceExitCampaignRvgk(state: Readonly<CampaignTurnState>, side: Side,
  action: Extract<CampaignRvgkAction, { type: 'force-exit-campaign-rvgk' }>, map: CampaignGroundMap,
  isAxisCombatUnit: (state: Readonly<CampaignTurnState>, id: string) => boolean): CampaignTurnState {
  if (side !== 'soviet') throw new Error('Only the Soviet player places the forced-exit units')
  const marker = markerHex(state, action.box)
  if (!marker || !Object.values(state.counters).some((counter) =>
    counter.side === 'soviet' && counter.location.kind === 'box' && counter.location.box === action.box)) {
    throw new Error('The named RVGK box holds no Soviet counters')
  }
  const axisHex = map.resolveHex(action.axisCombatHex)
  const axisUnit = Object.entries(state.counters).find(([id, counter]) => counter.side === 'axis' &&
    counter.location.kind === 'map' && map.resolveHex(counter.location.hex) === axisHex && isAxisCombatUnit(state, id))
  if (!axisHex || !axisUnit || !within(map, marker, RVGK_FORCED_EXIT_DISTANCE, axisHex)) {
    throw new Error('The forcing Axis combat unit is not within five hexes of the RVGK marker')
  }
  return forceExitCampaignRvgk(state, map, action.box, axisHex, action.placements)
}