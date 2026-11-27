// 09 剧本终局计分绑定：把通用清算阶段的 scenarioVictory 钩子接到 Scenario Book p.62 的 VP 口径。
// 只读状态里的歼灭事件与控制点历史，不重新解释 Dead Pile 或当前算子位置。

import type { BackupUnit } from '../import/unit-backup.ts'
import type { Definition } from '../import/unit-catalog.ts'
import { kirovogradOutcome, kirovogradScenario, kirovogradVictoryPoints } from '../ttw/campaign/kirovograd.ts'
import { campaignCityControl } from './campaign-control.ts'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignScenarioVictory } from './campaign-victory.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'
import { kirovogradFormationClassOf, kirovogradLossClass, kirovogradLosses } from './kirovograd-victory.ts'

export interface KirovogradVictoryData {
  map: CampaignGroundMap
  definitions: ReadonlyMap<string, Definition<BackupUnit>>
  /** The Kirovograd city hex, resolved from the map database. */
  kirovogradHex: string
}

/**
 * Scenario Book p.62: liberation is a one-time event, end control is a separate source,
 * and losses are destruction events rather than the units currently in the Dead Pile.
 */
export function kirovogradScenarioVictory(data: KirovogradVictoryData): (state: Readonly<CampaignTurnState>) => CampaignScenarioVictory | undefined {
  const city = data.map.resolveHex(data.kirovogradHex) ?? data.kirovogradHex
  const classOf = kirovogradFormationClassOf(data.definitions)
  return (state) => {
    if (state.when.scenarioId !== kirovogradScenario) return undefined
    let armyGroupHq = 0
    const classes: ReturnType<typeof kirovogradLossClass>[] = []
    for (const unit of state.destroyedUnits ?? []) {
      const definition = data.definitions.get(unit.definition)
      // Army Group HQs are outside this library's ordinary HQ classes; count them separately (TTW 2.3c).
      if (definition?.source.hqKind === 'ags') {
        armyGroupHq++
        continue
      }
      classes.push(kirovogradLossClass(definition, classOf))
    }
    const losses = kirovogradLosses(classes, armyGroupHq)
    const control = campaignCityControl(state, [city])
    const liberated = (state.controlEvents ?? []).some((event) => event.hex === city && event.side === 'soviet') ||
      control === 'soviet'
    const points = kirovogradVictoryPoints({ ...losses, kirovogradLiberated: liberated,
      kirovogradSovietAtEnd: control === 'soviet' })
    return { scenarioId: kirovogradScenario, ...points, ...kirovogradOutcome(points.net) }
  }
}
