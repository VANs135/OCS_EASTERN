import type { BackupUnit } from '../../import/unit-backup.ts'
import type { Definition } from '../../import/unit-catalog.ts'

/** TTW 2.2d and 3.2e. Only this Soviet brigade has a combat-unit drop capability, subject to prior planning. */
export function mayPlanTtwCombatAirDrop(definition: Definition<BackupUnit> | undefined): boolean {
  return definition?.kind === 'land' && definition.source.side === 'soviet' && definition.sourceId === '4301'
}
