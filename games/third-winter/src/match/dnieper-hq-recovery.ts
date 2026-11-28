// 01 被毁轴心 HQ 的免费重建落点板：army → 任一在盘 Axis Army HQ；army-group → 任一 Axis 大/小城市；
// corps → 任一在盘 Army/Army Group HQ。HQ 均为 1 步，满步重建。数据由真实 01 算子与地图派生。

import type { CampaignHqRecoveryBoard } from './campaign-hq-recovery.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'
import { campaignHqClass, type CampaignHqClass } from '../ttw/hq-classify.ts'
import type { Definition } from '../import/unit-catalog.ts'
import type { BackupUnit } from '../import/unit-backup.ts'
import type { TtwCampaignMapIndex } from '../import/campaign-map-index.ts'

type Playable = ReturnType<typeof import('../ttw/campaign/play-area.ts').campaignMapInPlayArea>
type Terrain = ReturnType<typeof import('../import/campaign-terrain.ts').campaignTerrain>

export interface DnieperHqRecoveryInput {
  playable: Playable
  map: TtwCampaignMapIndex
  terrain: Terrain
  catalog: { definitions: ReadonlyMap<string, Definition<BackupUnit>> }
}

export function dnieperHqRecoveryBoard(input: DnieperHqRecoveryInput): CampaignHqRecoveryBoard {
  const resolve = (hex: string) => input.playable.resolveHex(hex) ?? hex
  const classOf = (state: Readonly<CampaignTurnState>, id: string): CampaignHqClass | undefined => {
    const definition = state.counters[id]?.definition
    const unit = definition ? input.catalog.definitions.get(definition) : undefined
    return campaignHqClass(unit?.source.hqKind, unit?.kind)
  }
  const onMapHqHexes = (state: Readonly<CampaignTurnState>, classes: ReadonlySet<CampaignHqClass>) => {
    const sites = new Set<string>()
    for (const [id, counter] of Object.entries(state.counters)) {
      if (counter.side !== 'axis' || counter.location.kind !== 'map') continue
      if (classes.has(classOf(state, id)!)) sites.add(resolve(counter.location.hex))
    }
    return [...sites]
  }

  return {
    resolveHex: (hex) => resolve(hex),
    destinations: (state, recovery) => {
      if (recovery.kind === 'army-group') {
        return input.map.cities.flatMap((city) => city.hexes.map(resolve)).filter((hex) =>
          state.hexControl?.[hex] === 'axis' &&
          input.terrain.terrainAt(hex)?.some((terrain) => terrain === 'Minor City' || terrain === 'Major City') === true)
      }
      const classes = new Set<CampaignHqClass>(recovery.kind === 'army' ? ['army'] : ['army', 'army-group'])
      return onMapHqHexes(state, classes)
    },
    // 01 的 HQ 均为 1 步；免费重建回满步战斗面。
    printedStepsOf: () => 1,
  }
}
