import type { GroundModeState } from './modes.ts'
import { zocAffectsAction } from './zoc.ts'

// OCS 13.3f–g, 5.10e. From Smolensk 5603e52, rail.ts (validateGaugeConversion).
// The movement procedure supplies the current hex entry and counts one converted rail hex per action.
export function railConversionRefusal(facts: { mode: GroundModeState; currentMa: number; converted: number; rawEnemyZoc: boolean;
  usedNewlyConvertedRail: boolean }) {
  if (zocAffectsAction('railConversion', facts.rawEnemyZoc, false)) return 'rail-conversion-enemy-zoc'
  if (facts.mode.face !== 'combat' || facts.mode.marker && facts.mode.marker !== 'dg') return 'rail-conversion-combat-face-required'
  if (!Number.isFinite(facts.currentMa) || facts.converted + 1 > Math.min(4, facts.currentMa)) return 'rail-conversion-limit'
  if (facts.usedNewlyConvertedRail) return 'rail-conversion-no-leapfrog'
  return null
}
