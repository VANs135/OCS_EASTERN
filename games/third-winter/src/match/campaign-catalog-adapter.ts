// 会话装配层数据适配器：把载入的算子库（loadThirdWinterV2Units 的 definitions）转成
// HQ 钩子 catalog 与移动 profile catalog，供 campaignSessionHooks 消费。键＝definition.key（算子 definition 字段）。

import type { BackupUnit } from '../import/unit-backup.ts'
import type { Definition } from '../import/unit-catalog.ts'
import type { CampaignHqCatalog, CampaignHqDefinition } from './campaign-hq-boards.ts'
import type { CampaignMovementCatalog } from './campaign-movement-profiles.ts'

export interface CampaignLoadedCatalog {
  definitions: ReadonlyMap<string, Definition<BackupUnit>>
}

/** 由载入算子库派生 HQ catalog（hq_kind/种别/铁路字段）与移动 catalog（完整 Definition）。 */
export function campaignCatalogAdapter(catalog: CampaignLoadedCatalog):
  { hqCatalog: CampaignHqCatalog; movementCatalog: CampaignMovementCatalog } {
  const hqCatalog: Record<string, CampaignHqDefinition> = {}
  const movementCatalog: Record<string, Definition<BackupUnit>> = {}
  for (const [key, def] of catalog.definitions) {
    movementCatalog[key] = def
    hqCatalog[key] = {
      ...(def.source.hqKind ? { hqKind: def.source.hqKind } : {}),
      catalogKind: def.kind,
      ...(def.source.railOnly === true ? { railOnly: true } : {}),
      ...(typeof def.source.railCapRe === 'number' ? { railCapRe: def.source.railCapRe } : {}),
      ...(def.source.mustBeCity === true ? { mustBeCity: true } : {}),
    }
  }
  return { hqCatalog, movementCatalog }
}