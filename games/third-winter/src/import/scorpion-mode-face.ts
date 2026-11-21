import type { GroundFace, GroundModeState } from '@ocs-eastern/series/modes'
import type { DeployedCounter } from './scorpion-deployment.ts'
import { scorpionGroundProfile } from './ground-profile.ts'
import { scorpionArtillery } from './scorpion-artillery.ts'
import type { BackupUnit } from './unit-backup.ts'
import type { Definition } from './unit-catalog.ts'

export type { GroundFace }

export function scorpionGroundMode(unit: Pick<DeployedCounter, 'moveMode' | 'reserve' | 'disorganized' | 'exploit' | 'released'>): GroundModeState {
  const marker = unit.disorganized ? 'dg' : unit.reserve ? 'reserve' : unit.exploit ? 'exploit' : undefined
  return { face: unit.moveMode ? 'move' : 'combat', marker, released: unit.released }
}

export function scorpionModeFace(unit: DeployedCounter, definition: Definition<BackupUnit> | undefined,
  face: GroundFace): DeployedCounter {
  if ((face === 'move') === Boolean(unit.moveMode)) return unit
  const profile = definition && scorpionGroundProfile(definition, face)
  const stats = definition?.source.faces[face]?.stats
  if (!definition || !profile || !stats) throw new Error('The selected ground counter face is unavailable')
  const artillery = scorpionArtillery(definition, face)
  const range = stats.dropRange
  const headquarters = unit.headquarters && typeof range === 'number'
    ? { ...unit.headquarters, throwRange: range } : unit.headquarters
  const attackCapable = profile.combat && !headquarters && typeof stats.attack === 'number' && stats.attack > 0 &&
    stats.defensiveOnly !== true && !artillery
  const strength = headquarters ? (face === 'move' ? 1 : headquarters.kessel ? 2 : 5)
    : artillery ? 1 : typeof stats.attack === 'number' ? stats.attack : 0
  return { ...unit, ...profile, moveMode: face === 'move', headquarters, attackCapable, strength, artillery,
    actionRating: typeof stats.artRange === 'number' ? stats.artRange : unit.actionRating }
}
