// 剧本 01 的开局控制只落在“剧本指定地点”：可卸载聚落（城市格）与 Railhead，
// 普通铁路格不逐格记账。剧本没有印刷完整战线，因此空白聚落按双方初设地面战斗单位的
// 最近格距判归；平局归轴心，沿用 09 的无印刷战线口径。铁路通行本身仍由单位/ZOC/
// 轨距阻断，换轨由铁路工兵处理，不由逐格控制代替。

import type { Side } from '@ocs-eastern/series/state-types'
import type { DnieperRailhead } from './dnieper-initial-gauge.ts'

export interface DnieperInitialLandUnit {
  side: Side
  hex: string
}

export interface DnieperControlSiteSource {
  citySites: readonly { hexes: readonly string[] }[]
  railheads: readonly DnieperRailhead[]
}

/** 只记录规则需要的控制点：聚落（可卸载/VP）与书明 Railhead。 */
export function dnieperControlSites(input: DnieperControlSiteSource): ReadonlySet<string> {
  const sites = new Set<string>()
  for (const city of input.citySites) for (const hex of city.hexes) sites.add(hex)
  for (const railhead of input.railheads) sites.add(railhead.hex)
  return sites
}

/**
 * 开局控制：Railhead 以标记所属方为准；聚落先取格内初设地面单位所属方；
 * 空白聚落按最近初设地面单位判归，平局归轴心。
 */
export function dnieperOpeningControl(input: DnieperControlSiteSource & {
  neighbors: (hex: string) => readonly string[]
  landUnits: readonly DnieperInitialLandUnit[]
}): Record<string, Side> {
  const sites = dnieperControlSites(input)
  const explicit = new Map<string, Side>()
  for (const railhead of input.railheads) explicit.set(railhead.hex, railhead.side)
  const occupants = new Map<string, Set<Side>>()
  for (const unit of input.landUnits) {
    const sides = occupants.get(unit.hex) ?? new Set<Side>()
    sides.add(unit.side)
    occupants.set(unit.hex, sides)
  }
  const starts: Record<Side, Set<string>> = { axis: new Set(), soviet: new Set() }
  for (const unit of input.landUnits) starts[unit.side].add(unit.hex)
  const distances = starts.axis.size && starts.soviet.size
    ? { axis: hexDistances(input.neighbors, starts.axis), soviet: hexDistances(input.neighbors, starts.soviet) }
    : undefined

  const control: Record<string, Side> = {}
  for (const hex of sites) {
    const owner = explicit.get(hex)
      ?? singleOccupant(occupants.get(hex))
      ?? (distances ? closerSide(hex, distances) : undefined)
    if (owner) control[hex] = owner
  }
  return control
}

function singleOccupant(sides: ReadonlySet<Side> | undefined): Side | undefined {
  if (!sides || sides.size !== 1) return undefined
  return sides.has('soviet') ? 'soviet' : 'axis'
}

function closerSide(hex: string, distances: { axis: ReadonlyMap<string, number>; soviet: ReadonlyMap<string, number> }): Side {
  const toAxis = distances.axis.get(hex)
  const toSoviet = distances.soviet.get(hex)
  if (toAxis === undefined) return 'soviet'
  if (toSoviet === undefined) return 'axis'
  return toSoviet < toAxis ? 'soviet' : 'axis'
}

function hexDistances(neighbors: (hex: string) => readonly string[], starts: ReadonlySet<string>) {
  const distance = new Map<string, number>()
  const queue = [...starts]
  for (const hex of queue) distance.set(hex, 0)
  for (let index = 0; index < queue.length; index++) {
    const hex = queue[index]!
    for (const to of neighbors(hex)) {
      if (distance.has(to)) continue
      distance.set(to, distance.get(hex)! + 1)
      queue.push(to)
    }
  }
  return distance
}
