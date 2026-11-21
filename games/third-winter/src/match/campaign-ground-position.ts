import type { Mobility } from '@ocs-eastern/series/ground-map'
import { groundModeEffect } from '@ocs-eastern/series/modes'
import type { Side } from '@ocs-eastern/series/state-types'
import { projectsZoc, zocAffectsAction } from '@ocs-eastern/series/zoc'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignGroundMap {
  resolveHex(printed: string): string | undefined
  neighbors(hex: string): readonly string[]
}

export interface CampaignGroundProfile {
  combat: boolean
  attackCapable: boolean
  inCombatMode: boolean
  outOfSupply: boolean
  moveMa: number
  moveMobility: Mobility
  drawMobility: Mobility
  singleTransportPoint: boolean
}

export type CampaignGroundProfiles = (state: Readonly<CampaignTurnState>, counterId: string) => CampaignGroundProfile | undefined

/** Read a consistent snapshot of occupation and ZOC. Missing on-map facts leave the snapshot unavailable. */
export function campaignGroundPosition(state: Readonly<CampaignTurnState>, side: Side, map: CampaignGroundMap,
  profileOf: CampaignGroundProfiles) {
  const friendly = new Map<string, { hex: string; profile: CampaignGroundProfile }>()
  const friendlyCombat = new Set<string>()
  const enemyCombat = new Set<string>()
  const enemyZoc = new Set<string>()
  for (const [id, unit] of Object.entries(state.counters)) {
    if (unit.location.kind !== 'map' || unit.kind === 'aircraft') continue
    const hex = map.resolveHex(unit.location.hex)
    const profile = profileOf(state, id)
    if (!hex || !profile) return undefined
    if (unit.side === side) {
      friendly.set(id, { hex, profile })
      if (profile.combat) friendlyCombat.add(hex)
    } else if (profile.combat) {
      enemyCombat.add(hex)
      const mode = groundModeEffect({
        face: unit.mode === 'combat' || (!unit.mode && profile.inCombatMode) ? 'combat' : 'move',
        marker: unit.disorganized ? 'dg' : unit.mode === 'reserve' || unit.mode === 'strat' ? unit.mode : undefined,
      })
      if (projectsZoc({ attackCapable: profile.attackCapable, inCombatMode: mode.keepsCombatZoc,
        outOfSupply: unit.outOfSupply ?? profile.outOfSupply })) {
        for (const neighbor of map.neighbors(hex)) enemyZoc.add(neighbor)
      }
    }
  }
  // OCS 4.5a–b. A friendly combat unit can negate ZOC for trace and the breakout path.
  const unnegatedEnemyZoc = new Set([...enemyZoc].filter((hex) => zocAffectsAction('truckSupply', true, friendlyCombat.has(hex))))
  return { friendly, enemyCombat, unnegatedEnemyZoc }
}
