// 剧本 01 的 9.14c 运输点盘面：真实计数器分类（MA 黑色=卡车、白色=马车），
// 位移距离用 BFS 并按起点缓存；落位从目录里取同方、同 MA、同点数的真实运输点定义。
import type { Side } from '@ocs-eastern/series/state-types'
import type { Definition } from '../import/unit-catalog.ts'
import type { BackupUnit } from '../import/unit-backup.ts'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'
import type { CampaignTransportCaptureBoard, CampaignTransportCaptureItem, CampaignTransportCaptureFacts } from './campaign-transport-capture.ts'

type TransportClass = 'trucks' | 'wagons'

function classOf(definition: Definition<BackupUnit> | undefined): TransportClass | undefined {
  const color = definition?.source.faces.combat?.maColor
  if (color === 'black') return 'trucks'
  if (color === 'white') return 'wagons'
  return undefined
}

export function dnieperTransportCaptureBoard(map: CampaignGroundMap,
  catalog: ReadonlyMap<string, Definition<BackupUnit>>): CampaignTransportCaptureBoard {
  const cache = new Map<string, Map<string, number>>()
  const distanceMap = (from: string) => {
    const canonical = map.resolveHex(from) ?? from
    let found = cache.get(canonical)
    if (found) return found
    found = new Map([[canonical, 0]])
    const queue = [canonical]
    for (let index = 0; index < queue.length; index += 1) {
      const hex = queue[index]
      for (const neighbor of map.neighbors(hex)) {
        if (found.has(neighbor)) continue
        found.set(neighbor, found.get(hex)! + 1)
        queue.push(neighbor)
      }
    }
    cache.set(canonical, found)
    return found
  }
  const definitions = [...catalog.values()].filter((definition) => definition.kind === 'transport')
  return {
    map,
    distance(from, to) { return distanceMap(from).get(map.resolveHex(to) ?? to) ?? Infinity },
    hexes: [...map.availableHexes],
    transports(state, owner, hex) {
      const at = map.resolveHex(hex) ?? hex
      return Object.entries(state.counters).flatMap(([id, counter]): CampaignTransportCaptureItem[] => {
        if (counter.kind !== 'transport' || counter.side !== owner || counter.location.kind !== 'map' ||
          (map.resolveHex(counter.location.hex) ?? counter.location.hex) !== at) return []
        const kind = classOf(catalog.get(counter.definition))
        return kind ? [{ id, kind, points: counter.transportPoints ?? 0,
          tokens: counter.transportCargoTokens ?? 0 }] : []
      }).filter((item) => item.points > 0)
    },
    placeTransport(state, side, facts) {
      const definition = definitions.find((candidate) => candidate.source.side === side &&
        classOf(candidate) === facts.kind &&
        candidate.source.faces.combat?.stats.transport === facts.points) ??
        definitions.find((candidate) => candidate.source.side === side && classOf(candidate) === facts.kind)
      if (!definition) throw new Error(`No ${side} ${facts.kind} transport definition for ${facts.points} points`)
      let serial = 1
      while (state.counters[`transport:${side}:${facts.kind}:${serial}`]) serial += 1
      const id = `transport:${side}:${facts.kind}:${serial}`
      const counters = { ...state.counters, [id]: { definition: definition.key, kind: 'transport' as const,
        side, location: { kind: 'map' as const, hex: map.resolveHex(facts.hex) ?? facts.hex },
        transportPoints: facts.points, transportCargoTokens: facts.tokens, mode: 'move' as const } }
      return { ...state, counters }
    },
  }
}


