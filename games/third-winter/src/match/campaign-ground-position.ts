import type { Mobility } from '@ocs-eastern/series/ground-map'
import { groundModeEffect } from '@ocs-eastern/series/modes'
import type { GroundModeState } from '@ocs-eastern/series/modes'
import type { Side } from '@ocs-eastern/series/state-types'
import { projectsZoc, zocAffectsAction } from '@ocs-eastern/series/zoc'
import type { CampaignCounter } from './campaign-reinforcement-state.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignGroundMap {
  resolveHex(printed: string): string | undefined
  neighbors(hex: string): readonly string[]
}

export function normalizeCampaignPath(map: CampaignGroundMap, printedHexes: readonly string[]) {
  const path: string[] = []
  for (const printed of printedHexes) {
    const hex = map.resolveHex(printed)
    if (!hex) return undefined
    path.push(hex)
  }
  return path
}

export interface CampaignGroundProfile {
  combat: boolean
  /** A TTW pontoon unit, from its normalized counter definition. */
  pontoon?: boolean
  attackCapable: boolean
  inCombatMode: boolean
  outOfSupply: boolean
  moveMa: number
  moveMobility: Mobility
  drawMobility: Mobility
  singleTransportPoint: boolean
}

export type CampaignGroundProfiles = (state: Readonly<CampaignTurnState>, counterId: string) => CampaignGroundProfile | undefined

export function campaignCounterGroundMode(counter: CampaignCounter, combatFace: boolean): GroundModeState {
  const face = counter.mode === 'combat' || (!counter.mode && combatFace) ? 'combat' : 'move'
  const marker = counter.disorganized ? 'dg' : counter.mode === 'reserve' || counter.mode === 'strat' ? counter.mode : undefined
  return { face, marker }
}

export function campaignCombatPontoon(counter: CampaignCounter, profile: CampaignGroundProfile): boolean {
  return profile.combat && profile.pontoon === true && campaignCounterGroundMode(counter, profile.inCombatMode).face === 'combat'
}

/** Read a consistent snapshot of occupation and ZOC. Missing on-map facts leave the snapshot unavailable. */
export function campaignGroundPosition(state: Readonly<CampaignTurnState>, side: Side, map: CampaignGroundMap,
  profileOf: CampaignGroundProfiles) {
  const friendly = new Map<string, { hex: string; profile: CampaignGroundProfile }>()
  const friendlyCombat = new Set<string>()
  const enemyCombat = new Set<string>()
  const enemyNoncombat = new Set<string>()
  const enemySte = new Set<string>()
  const enemyZoc = new Set<string>()
  for (const [id, unit] of Object.entries(state.counters)) {
    if (unit.location.kind !== 'map') continue
    const hex = map.resolveHex(unit.location.hex)
    if (unit.specialTruckExtender) {
      if (!hex) return undefined
      if (unit.side !== side) enemySte.add(hex)
      continue
    }
    if (unit.kind === 'aircraft') {
      if (hex && unit.side !== side) enemyNoncombat.add(hex)
      continue
    }
    const profile = profileOf(state, id)
    if (!hex || !profile) return undefined
    if (unit.side === side) {
      friendly.set(id, { hex, profile })
      if (profile.combat) friendlyCombat.add(hex)
    } else if (profile.combat) {
      enemyCombat.add(hex)
      const mode = groundModeEffect(campaignCounterGroundMode(unit, profile.inCombatMode))
      if (projectsZoc({ attackCapable: profile.attackCapable, inCombatMode: mode.keepsCombatZoc,
        outOfSupply: unit.outOfSupply ?? profile.outOfSupply })) {
        for (const neighbor of map.neighbors(hex)) enemyZoc.add(neighbor)
      }
    } else enemyNoncombat.add(hex)
  }
  // OCS 4.5a–b. A friendly combat unit can negate ZOC for trace and the breakout path.
  const unnegatedEnemyZoc = new Set([...enemyZoc].filter((hex) => zocAffectsAction('truckSupply', true, friendlyCombat.has(hex))))
  return { friendly, enemyCombat, enemyNoncombat, enemySte, enemyZoc, unnegatedEnemyZoc }
}
