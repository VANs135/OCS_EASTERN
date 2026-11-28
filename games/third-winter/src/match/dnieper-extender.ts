// 剧本 01 的 12.7 延补队盘面：同格真实运输点按 MA 颜色分卡车/马车，
// 翻回时落成同方、同类别、同点数的真实 tp_* 计数器；崩溃 trace 仍由调用方注入。
import type { Side } from '@ocs-eastern/series/state-types'
import type { Definition } from '../import/unit-catalog.ts'
import type { BackupUnit } from '../import/unit-backup.ts'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignExtenderBoard, ExtenderTransportKind } from './campaign-extender.ts'

function extenderKind(color: string | undefined): ExtenderTransportKind | undefined {
  if (color === 'black') return 'truck'
  if (color === 'white') return 'wagon'
  return undefined
}

export function dnieperExtenderBoard(map: CampaignGroundMap, catalog: ReadonlyMap<string, Definition<BackupUnit>>,
  options: { hasTrace?: (state: import('./campaign-turn-state.ts').CampaignTurnState, side: Side, hex: string) => boolean } = {}): CampaignExtenderBoard {
  const definitions = [...catalog.values()].filter((definition) => definition.kind === 'transport')
  return {
    map,
    transports(state, side, hex) {
      const at = map.resolveHex(hex) ?? hex
      return Object.entries(state.counters).flatMap(([id, counter]) => {
        if (counter.side !== side || counter.kind !== 'transport' || counter.location.kind !== 'map' ||
          (map.resolveHex(counter.location.hex) ?? counter.location.hex) !== at) return []
        const definition = catalog.get(counter.definition)
        const kind = extenderKind(definition?.source.faces.combat?.maColor)
        const points = counter.transportPoints ?? 0
        if (!kind || points <= 0) return []
        return [{ id, kind, points, ma: definition?.source.faces.combat?.stats.move ?? 0,
          mpSpent: 0, loaded: (counter.transportCargoTokens ?? 0) > 0 }]
      })
    },
    placeTransport(state, side, facts) {
      const definition = definitions.find((candidate) => candidate.source.side === side &&
        extenderKind(candidate.source.faces.combat?.maColor) === facts.kind &&
        candidate.source.faces.combat?.stats.transport === facts.points) ??
        definitions.find((candidate) => candidate.source.side === side &&
          extenderKind(candidate.source.faces.combat?.maColor) === facts.kind)
      if (!definition) throw new Error(`No ${side} ${facts.kind} transport definition for ${facts.points} points`)
      let serial = 1
      while (state.counters[`extender:transport:${side}:${facts.kind}:${serial}`]) serial += 1
      const id = `extender:transport:${side}:${facts.kind}:${serial}`
      return { ...state, counters: { ...state.counters, [id]: { definition: definition.key, kind: 'transport' as const,
        side, location: { kind: 'map' as const, hex: map.resolveHex(facts.hex) ?? facts.hex },
        transportPoints: facts.points, transportCargoTokens: 0, mode: 'move' as const } } }
    },
    hasTrace: options.hasTrace,
  }
}
