import type { Side } from '@ocs-eastern/series/state-types'
import type { BackupUnit } from '../import/unit-backup.ts'
import type { Definition } from '../import/unit-catalog.ts'
import type { CampaignGroundMap } from './campaign-ground-position.ts'

export interface KirovogradInitialLandUnit {
  side: Side
  hex: string
  definition: string
}

/**
 * Opening-front adjudication for Scenario 9. The scenario prints no front line,
 * so use the initial ground combat deployments: a hex is on the Soviet side only
 * when it is strictly closer (in hex steps) to a Soviet land unit than to an Axis
 * land unit. Ties fall to the Axis side so rail tracing never crosses an
 * uncertain front into German territory. Encircled Soviet positions therefore
 * keep their local rail but the component stops at the German ring.
 */
export function kirovogradOpeningSovietSide(input: {
  map: CampaignGroundMap
  counters: readonly KirovogradInitialLandUnit[]
  definitions: ReadonlyMap<string, Definition<BackupUnit>>
}): ((hex: string) => boolean) | undefined {
  const starts: Record<Side, Set<string>> = { axis: new Set(), soviet: new Set() }
  for (const counter of input.counters) {
    const definition = input.definitions.get(counter.definition)
    if (definition?.kind !== 'land') continue
    const hex = input.map.resolveHex(counter.hex)
    if (hex) starts[counter.side].add(hex)
  }
  if (!starts.axis.size || !starts.soviet.size) return undefined
  const axis = distances(input.map, starts.axis)
  const soviet = distances(input.map, starts.soviet)
  return (hex) => {
    const toSoviet = soviet.get(hex)
    const toAxis = axis.get(hex)
    if (toAxis === undefined) return toSoviet !== undefined
    if (toSoviet === undefined) return false
    return toSoviet < toAxis
  }
}

function distances(map: CampaignGroundMap, starts: ReadonlySet<string>) {
  const distance = new Map<string, number>()
  const queue = [...starts]
  for (const hex of queue) distance.set(hex, 0)
  for (let index = 0; index < queue.length; index++) {
    const hex = queue[index]!
    for (const to of map.neighbors(hex)) {
      if (distance.has(to)) continue
      distance.set(to, distance.get(hex)! + 1)
      queue.push(to)
    }
  }
  return distance
}
