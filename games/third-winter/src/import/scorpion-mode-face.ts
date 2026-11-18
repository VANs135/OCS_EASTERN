import type { DeployedCounter } from './scorpion-deployment.ts'
import { scorpionGroundProfile } from './ground-profile.ts'
import type { BackupUnit } from './unit-backup.ts'
import type { Definition } from './unit-catalog.ts'

export type GroundFace = 'combat' | 'move'

export function scorpionModeFace(unit: DeployedCounter, definition: Definition<BackupUnit> | undefined,
  face: GroundFace): DeployedCounter {
  if ((face === 'move') === Boolean(unit.moveMode)) return unit
  const profile = definition && scorpionGroundProfile(definition, face)
  const stats = definition?.source.faces[face]?.stats
  if (!profile || !stats) throw new Error('The selected ground counter face is unavailable')
  const range = stats.dropRange
  const headquarters = unit.headquarters && typeof range === 'number'
    ? { ...unit.headquarters, throwRange: range } : unit.headquarters
  const attackCapable = profile.combat && !headquarters && typeof stats.attack === 'number' && stats.attack > 0 &&
    stats.defensiveOnly !== true && typeof stats.barrage !== 'number'
  const strength = headquarters ? (face === 'move' ? 1 : headquarters.kessel ? 2 : 5)
    : typeof stats.barrage === 'number' ? 1 : typeof stats.attack === 'number' ? stats.attack : 0
  return { ...unit, ...profile, moveMode: face === 'move', headquarters, attackCapable, strength,
    actionRating: typeof stats.artRange === 'number' ? stats.artRange : unit.actionRating }
}
