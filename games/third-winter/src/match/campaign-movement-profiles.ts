// 会话装配层：由 definition catalog 派生战役地面移动 profile（替代合成测试注入）。
// MA/移动类复用 import/ground-profile.ts（white→leg/black→truck/red→track）；
// attackCapable 镜像 scorpion-mode-face.ts；pontoon/organic_truck/kessel_supply 读 abilities；
// HQ draw 移动类镜像 scorpion-deployment.ts（Kessel→leg，其余 HQ→truck）；运输点读 stats.transport。

import type { Mobility } from '@ocs-eastern/series/ground-map'
import { scorpionGroundProfile } from '../import/ground-profile.ts'
import { scorpionArtillery } from '../import/scorpion-artillery.ts'
import type { BackupUnit } from '../import/unit-backup.ts'
import type { Definition } from '../import/unit-catalog.ts'
import { campaignUnitFuelReady } from './campaign-fuel.ts'
import { campaignCounterGroundMode, type CampaignGroundProfile, type CampaignGroundProfiles } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export type CampaignMovementCatalog = Readonly<Record<string, Definition<BackupUnit>>>

export interface CampaignMovementProfileBoard {
  profileOf: CampaignGroundProfiles
  moveProfile(state: Readonly<CampaignTurnState>, id: string): { ma: number; mobility: Mobility; fuelReady: boolean } | undefined
}

/** 由 catalog 派生 profileOf（静态地面 profile）与 moveProfile（当前模式面 MA/移动类/燃料就绪）。 */
export function campaignMovementProfiles(catalog: CampaignMovementCatalog): CampaignMovementProfileBoard {
  const defOf = (state: Readonly<CampaignTurnState>, id: string): Definition<BackupUnit> | undefined =>
    catalog[state.counters[id]?.definition ?? '']
  function profileOf(state: Readonly<CampaignTurnState>, id: string): CampaignGroundProfile | undefined {
    const counter = state.counters[id]
    const def = defOf(state, id)
    if (!counter || !def) return undefined
    const combat = scorpionGroundProfile(def, 'combat') ?? scorpionGroundProfile(def, 'move')
    if (!combat) return undefined
    const move = scorpionGroundProfile(def, 'move')
    const source = def.source
    const combatStats = source.faces.combat?.stats
    const headquarters = def.kind === 'hq'
    const kessel = source.abilities?.includes('kessel_supply') === true
    const artillery = scorpionArtillery(def, 'combat')
    const attackCapable = combat.combat && !headquarters && typeof combatStats?.attack === 'number' &&
      combatStats.attack > 0 && combatStats.defensiveOnly !== true && !artillery
    const drawMobility: Mobility = headquarters ? (kessel ? 'leg' : 'truck') : combat.mobility
    return {
      combat: combat.combat,
      pontoon: source.abilities?.includes('pontoon') === true,
      attackCapable,
      inCombatMode: combat.combat,
      outOfSupply: counter.outOfSupply ?? false,
      moveMa: move?.allowance ?? combat.allowance,
      moveMobility: move?.mobility ?? combat.mobility,
      drawMobility,
      singleTransportPoint: def.kind === 'transport' && combatStats?.transport === 1,
    }
  }
  function moveProfile(state: Readonly<CampaignTurnState>, id: string) {
    const def = defOf(state, id)
    const profile = profileOf(state, id)
    if (!def || !profile) return undefined
    const face = campaignCounterGroundMode(state.counters[id]!, profile.inCombatMode).face
    const ground = scorpionGroundProfile(def, face)
    if (!ground) return undefined
    return { ma: ground.allowance, mobility: ground.mobility, fuelReady: campaignUnitFuelReady(state, id) }
  }
  return { profileOf, moveProfile }
}