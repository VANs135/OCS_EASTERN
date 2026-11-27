// OCS 9.14c：运输点夺取的组级取整与算子级分配。
// 只实现共享规则：按 MA 分组、组级掷骰、SP/T 同等比例、原主在组内选择。
// 具体剧本的运输点算子、位移落点与交互窗由匹配层提供，不能从这里猜。

import type { Die } from './dice.ts'
import { capturedAmount } from './tables/capture.ts'

export type TransportCaptureClass = 'trucks' | 'wagons'

/** 9.14c：MA > 10 并入卡车列，MA ≤ 10 并入马车列。 */
export function transportCaptureClass(ma: number): TransportCaptureClass {
  if (!Number.isFinite(ma) || ma < 0) throw new Error('Transport MA must be a non-negative number')
  return ma > 10 ? 'trucks' : 'wagons'
}

/** 9.14c 原文示例：运输点可转移到最远 10 格；马车按 5 格处理（与同系列移动类别一致）。 */
export function transportDisplacementMaxHexes(kind: TransportCaptureClass): number {
  return kind === 'trucks' ? 10 : 5
}

export interface TransportCaptureItem {
  id: string
  points: number
  tokens: number
}

export interface TransportCaptureGroup {
  kind: TransportCaptureClass
  die: Die
  items: readonly TransportCaptureItem[]
  totalPoints: number
  totalTokens: number
  capturedPoints: number
  capturedTokens: number
}

/**
 * 9.14c 组级结算。
 *
 * - 同组先合计点数和装载 T，再按百分比取整；不能逐算子取整。
 * - `capturedAmount` 同时用于点数和 T；1 SP = 4T 的换算留给调用方。
 * - 组内空集合直接拒绝，避免零成员仍消耗骰点。
 */
export function buildTransportCaptureGroup(kind: TransportCaptureClass, die: Die,
  items: readonly TransportCaptureItem[]): TransportCaptureGroup {
  if (!Number.isSafeInteger(die) || die < 1 || die > 6) throw new Error('Transport capture die must be 1..6')
  if (!items.length) throw new Error('Transport capture group needs at least one counter')
  for (const item of items) {
    if (!Number.isSafeInteger(item.points) || item.points <= 0 ||
      !Number.isSafeInteger(item.tokens) || item.tokens < 0) throw new Error('Invalid transport capture item')
  }
  const totalPoints = items.reduce((sum, item) => sum + item.points, 0)
  const totalTokens = items.reduce((sum, item) => sum + item.tokens, 0)
  return {
    kind, die, items: [...items], totalPoints, totalTokens,
    capturedPoints: capturedAmount(totalPoints, kind, die),
    capturedTokens: capturedAmount(totalTokens, kind, die),
  }
}

export interface TransportSplitPlan {
  capturedIds: readonly string[]
  displacedIds: readonly string[]
  capturedPoints: number
  capturedTokens: number
  /** 组内整算子能否拼出表值；不能时为最接近方案。 */
  exact: boolean
}

/**
 * 9.14c 原主选择的校验结果。
 *
 * 与 `planTransportSplit` 的分工：本函数不替玩家选，只把玩家勾选的算子汇总成点/T，
 * 与组级表值对照；`exact=false` 表示整算子拼不出表值，调用方须如实报告差额。
 */
export type TransportCaptureChoice = TransportSplitPlan

/**
 * 9.14c 的默认算子级分配。
 *
 * 规则要求原主在组内决定哪些算子被夺取；此函数只给默认方案，调用方仍可替换。
 * 枚举子集，优先点数差、再装载 T 差；平手取不超过表值的一侧。
 */
export function planTransportSplit(group: TransportCaptureGroup): TransportSplitPlan {
  const items = group.items
  const target = group.capturedPoints
  const targetTokens = group.capturedTokens
  const score = (points: number, tokens: number) =>
    Math.abs(points - target) * 1000 + Math.abs(tokens - targetTokens)
  let best: { ids: string[]; points: number; tokens: number } | null = null
  const count = items.length
  const subsets = count <= 16 ? 1 << count : 0
  for (let mask = 0; mask < (subsets === 0 ? 1 : subsets); mask += 1) {
    const ids: string[] = []
    let points = 0
    let tokens = 0
    if (subsets === 0) {
      // 仅防御性退化：真实剧本的组内算子远少于 17 个。
      for (const item of [...items].sort((a, b) => b.points - a.points)) {
        if (points + item.points > target) continue
        ids.push(item.id)
        points += item.points
        tokens += item.tokens
      }
    } else {
      for (let index = 0; index < count; index += 1) {
        if ((mask & (1 << index)) === 0) continue
        const item = items[index]!
        ids.push(item.id)
        points += item.points
        tokens += item.tokens
      }
    }
    if (best === null || score(points, tokens) < score(best.points, best.tokens) ||
      (score(points, tokens) === score(best.points, best.tokens) && points <= target && best.points > target)) {
      best = { ids, points, tokens }
    }
  }
  const chosen = best ?? { ids: [], points: 0, tokens: 0 }
  const chosenSet = new Set(chosen.ids)
  return {
    capturedIds: chosen.ids,
    displacedIds: items.filter((item) => !chosenSet.has(item.id)).map((item) => item.id),
    capturedPoints: chosen.points,
    capturedTokens: chosen.tokens,
    exact: chosen.points === target && chosen.tokens === targetTokens,
  }
}

/**
 * 9.14c 原主选择的校验。
 *
 * 不替玩家选，也不擅自把差额抹平；只汇总玩家勾选的算子点数/装载 T，与组级表值对照。
 * `exact=false` 仍需由调用方如实报告，不能静默当成精确夺取。
 */
export function validateTransportCaptureChoice(group: TransportCaptureGroup,
  capturedIds: readonly string[]): TransportCaptureChoice {
  const chosen = new Set(capturedIds)
  if (chosen.size !== capturedIds.length) throw new Error('Transport capture choice contains duplicate counters')
  let capturedPoints = 0
  let capturedTokens = 0
  for (const id of chosen) {
    const item = group.items.find((candidate) => candidate.id === id)
    if (!item) throw new Error(`Transport capture choice contains an unknown counter: ${id}`)
    capturedPoints += item.points
    capturedTokens += item.tokens
  }
  return {
    capturedIds: [...chosen],
    displacedIds: group.items.filter((item) => !chosen.has(item.id)).map((item) => item.id),
    capturedPoints,
    capturedTokens,
    exact: capturedPoints === group.capturedPoints && capturedTokens === group.capturedTokens,
  }
}

/** 9.14c 位移候选：图内、非原格、格距不超过上限；敌情/地形不参与过滤。 */export function transportDisplacementCandidates(from: string, hexes: readonly string[],
  distance: (a: string, b: string) => number, kind: TransportCaptureClass): string[] {
  const limit = transportDisplacementMaxHexes(kind)
  return hexes.filter((hex) => hex !== from && Number.isFinite(distance(from, hex)) && distance(from, hex) <= limit)
    .sort((a, b) => a.localeCompare(b))
}
