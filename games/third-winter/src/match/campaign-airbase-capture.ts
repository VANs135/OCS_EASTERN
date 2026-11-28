// 通规 OCS 9.14f / 14.2c：敌方可攻击单位进入敌方空军基地格，基地立即被夺取并可用；
// 对格内每架飞机各投 2 骰查空军基地夺取表：6 或以下损失 1 点军力，7 或以上无损失；
// 激活飞机 +2，战后推进夺取 +2。幸存飞机必须转移到 2 倍航程内的友方空军基地并转为非激活；
// 2 倍航程内没有友方基地时摧毁。玩家机场落点不由本函数代选。

import { rollDie } from '@ocs-eastern/series/rng'
import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignAirBaseCaptureBoard {
  map: CampaignGroundMap
  /** 进入方是否至少有一个可攻击单位（4.4c/9.14f 的资格条件）。 */
  attackCapable(state: Readonly<CampaignTurnState>, id: string): boolean
  /** 飞机印刷航程；2 倍航程用于转移。 */
  rangeOf(state: Readonly<CampaignTurnState>, id: string): number | undefined
  /** 两格间最短距离（沿地图邻接 BFS）。 */
  distance(from: string, to: string): number
}

export interface CampaignAirBaseCaptureOptions {
  /** 战后推进夺取：飞机损失骰 +2。 */
  advance?: boolean
  /** 玩家选择的幸存飞机转移机场；有多个合法机场时必须由玩家提交。 */
  destination?: string
}

const opposite = (side: Side): Side => side === 'axis' ? 'soviet' : 'axis'

function roll2d6(rng: Readonly<CampaignTurnState['rng']>) {
  const first = rollDie(rng)
  const second = rollDie(first.rng)
  return { value: first.value + second.value, rng: second.rng }
}

/** 9.14f：夺取敌方空军基地；没有基地、没有可攻击单位或基地已属进入方时原样返回。 */
export function captureCampaignAirBase(state: Readonly<CampaignTurnState>, side: Side, hex: string,
  ids: readonly string[], board: CampaignAirBaseCaptureBoard, options: CampaignAirBaseCaptureOptions = {}): CampaignTurnState {
  const owner = opposite(side)
  const base = state.airBases?.find((candidate) => candidate.hex === hex)
  if (!base || base.side !== owner) return state
  if (!ids.some((id) => board.attackCapable(state, id))) return state

  const aircraft = Object.entries(state.counters)
    .filter(([, counter]) => counter.side === owner && counter.kind === 'aircraft' &&
      counter.location.kind === 'map' && counter.location.hex === hex)
  const capturedBases = (state.airBases ?? []).map((candidate) => candidate.hex === hex
    ? { ...candidate, side } : candidate)

  const destinations = new Map<string, string[]>()
  for (const [id, counter] of aircraft) {
    if (counter.location.kind !== 'map') continue
    const range = board.rangeOf(state, id)
    if (range === undefined || !Number.isFinite(range) || range < 0) {
      throw new Error(`Missing printed air range for ${id}`)
    }
    const legal = capturedBases.filter((candidate) => candidate.side === owner && candidate.hex !== hex &&
      board.distance(hex, candidate.hex) <= range * 2).map((candidate) => candidate.hex)
    destinations.set(id, legal)
  }
  if (options.destination !== undefined) {
    for (const [id, legal] of destinations) {
      if (legal.length && !legal.includes(options.destination)) {
        throw new Error(`The chosen airbase is out of twice the range of ${id}`)
      }
    }
  } else {
    for (const [id, legal] of destinations) {
      if (legal.length > 1) throw new Error(`Choose a transfer airbase for ${id} within twice its range`)
    }
  }

  let rng = state.rng
  const counters = { ...state.counters }
  for (const [id, counter] of aircraft) {
    const draw = roll2d6(rng)
    rng = draw.rng
    const modifiers = (counter.active === true ? 2 : 0) + (options.advance === true ? 2 : 0)
    const loss = draw.value + modifiers <= 6
    if (loss && (counter.stepsLost ?? 0) >= 1) {
      counters[id] = { ...counter, location: { kind: 'dead-pile' }, active: false }
      continue
    }
    if (loss) counters[id] = { ...counter, stepsLost: (counter.stepsLost ?? 0) + 1 }
    const legal = destinations.get(id) ?? []
    if (!legal.length) {
      counters[id] = { ...counters[id], location: { kind: 'dead-pile' }, active: false }
      continue
    }
    const destination = options.destination ?? (legal.length === 1 ? legal[0] : undefined)
    if (!destination) throw new Error(`Choose a transfer airbase for ${id} within twice its range`)
    counters[id] = { ...counters[id], location: { kind: 'map', hex: destination }, active: false }
  }

  return { ...state, rng, counters, airBases: capturedBases }
}
