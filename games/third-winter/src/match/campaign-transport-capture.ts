// OCS 9.14c：运输点夺取的交互窗口。组级掷骰与原主算子级选择复用 series，
// 本文件只负责 01/战役层的计数器落位与位移校验。

import { rollDie } from '@ocs-eastern/series/rng'
import type { Side } from '@ocs-eastern/series/state-types'
import type { Die } from '@ocs-eastern/series/dice'
import { buildTransportCaptureGroup, transportDisplacementCandidates, validateTransportCaptureChoice } from
  '@ocs-eastern/series/transport-capture'
import type { TransportCaptureClass, TransportCaptureGroup } from '@ocs-eastern/series/transport-capture'
import type { CampaignTurnState } from './campaign-turn-state.ts'
import type { CampaignGroundMap } from './campaign-ground-position.ts'

export interface CampaignTransportCaptureItem {
  id: string
  kind: TransportCaptureClass
  points: number
  tokens: number
}

export interface CampaignTransportCaptureFacts {
  hex: string
  kind: TransportCaptureClass
  points: number
  tokens: number
}

export interface CampaignTransportCaptureBoard {
  map: CampaignGroundMap
  /** 六角距离；不可达返回 Infinity。 */
  distance(from: string, to: string): number
  /** 可供 UI 枚举的图内格；缺省时投影不列位移候选。 */
  hexes?: readonly string[]
  transports(state: Readonly<CampaignTurnState>, owner: Side, hex: string): readonly CampaignTransportCaptureItem[]
  /** 按点/T 落成一方运输计数器；具体面额由绑定层决定。 */
  placeTransport(state: Readonly<CampaignTurnState>, side: Side, facts: CampaignTransportCaptureFacts): CampaignTurnState
}

export interface CampaignTransportCapture {
  captor: Side
  owner: Side
  hex: string
  groups: readonly TransportCaptureGroup[]
}

export interface CampaignTransportCaptureChoice {
  kind: TransportCaptureClass
  capturedIds: readonly string[]
  displacedTo?: string
}

export type CampaignTransportCaptureAction = {
  type: 'resolve-campaign-transport-capture'
  choices: readonly CampaignTransportCaptureChoice[]
}

/** 9.14c：进格夺取开始时按运输点类别掷骰，并挂起等待原主选择。 */
export function beginCampaignTransportCapture(state: Readonly<CampaignTurnState>, captor: Side, owner: Side,
  hex: string, board: CampaignTransportCaptureBoard, roll: () => Die): CampaignTransportCapture {
  const entries = board.transports(state, owner, hex)
  return {
    captor, owner, hex,
    groups: (['trucks', 'wagons'] as const).flatMap((kind) => {
      const items = entries.filter((item) => item.kind === kind)
      return items.length ? [buildTransportCaptureGroup(kind, roll(), items)] : []
    }),
  }
}

/** 9.14c：进格自动挂起窗口。只对进入方自己的战斗单位触发；已有窗口时不覆盖。 */
export function beginCampaignTransportCaptureOnEntry(state: Readonly<CampaignTurnState>, captor: Side, hex: string,
  ids: readonly string[], board: CampaignTransportCaptureBoard,
  combatUnit: (state: Readonly<CampaignTurnState>, id: string) => boolean): CampaignTurnState {
  if (state.transportCapture) return state
  if (!ids.some((id) => state.counters[id]?.side === captor && combatUnit(state, id))) return state
  const owner: Side = captor === 'axis' ? 'soviet' : 'axis'
  if (!board.transports(state, owner, hex).length) return state
  let rng = state.rng
  const capture = beginCampaignTransportCapture(state, captor, owner, hex, board, () => {
    const rolled = rollDie(rng)
    rng = rolled.rng
    return rolled.value
  })
  if (!capture.groups.length) return state
  return { ...state, rng, transportCapture: capture }
}

/** UI 只读投影：待决组、原主可选的整枚计数器、组级掷骰结果与位移候选。不替玩家预设选择。 */
export function campaignTransportCaptureOptions(state: Readonly<CampaignTurnState>, viewer: Side,
  board?: CampaignTransportCaptureBoard) {
  const capture = state.transportCapture
  if (!capture || !board || viewer !== capture.owner) return null
  return {
    captor: capture.captor,
    owner: capture.owner,
    hex: capture.hex,
    groups: capture.groups.map((group) => ({
      kind: group.kind,
      die: group.die,
      totalPoints: group.totalPoints,
      totalTokens: group.totalTokens,
      capturedPoints: group.capturedPoints,
      capturedTokens: group.capturedTokens,
      items: group.items.map((item) => ({ id: item.id, points: item.points, tokens: item.tokens })),
      displacedTo: board.hexes
        ? transportDisplacementCandidates(capture.hex, board.hexes, board.distance, group.kind)
        : [],
    })),
  }
}

/** 9.14c：原主在每组内选被夺取的整枚计数器；余部必须落到射程内格。 */
export function settleCampaignTransportCapture(state: Readonly<CampaignTurnState>,
  capture: CampaignTransportCapture, choices: readonly CampaignTransportCaptureChoice[],
  board: CampaignTransportCaptureBoard): CampaignTurnState {
  const byKind = new Map(choices.map((choice) => [choice.kind, choice]))
  if (choices.length !== capture.groups.length || byKind.size !== capture.groups.length) {
    throw new Error('Choose exactly one transport capture outcome for each group')
  }
  const counters = { ...state.counters }
  for (const group of capture.groups) {
    const choice = byKind.get(group.kind)
    if (!choice) throw new Error(`Missing transport capture choice for ${group.kind}`)
    const plan = validateTransportCaptureChoice(group, choice.capturedIds)
    if (!plan.exact) throw new Error('The captured counters must match the group dice result exactly')
    const displaced = plan.displacedIds.length > 0
    const destination = choice.displacedTo && board.map.resolveHex(choice.displacedTo)
    if (displaced && (!destination || !transportDisplacementCandidates(capture.hex, [destination],
      board.distance, group.kind).length)) {
      throw new Error('Choose an in-range displacement hex for the remaining transports')
    }
    for (const item of group.items) delete counters[item.id]
  }
  let next: CampaignTurnState = { ...state, counters, transportCapture: undefined }
  for (const group of capture.groups) {
    const choice = byKind.get(group.kind)!
    const plan = validateTransportCaptureChoice(group, choice.capturedIds)
    const destination = choice.displacedTo && board.map.resolveHex(choice.displacedTo)
    for (const item of group.items) {
      const captured = plan.capturedIds.includes(item.id)
      next = board.placeTransport(next, captured ? capture.captor : capture.owner, {
        hex: captured ? capture.hex : destination!,
        kind: group.kind, points: item.points, tokens: item.tokens,
      })
    }
  }
  return next
}
