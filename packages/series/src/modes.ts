import { reserveMovementFactor } from './reserve.ts'
import type { Phase } from './turn.ts'

export type GroundFace = 'combat' | 'move'
type MarkedMode = 'reserve' | 'strat' | 'exploit' | 'dg'

export interface GroundModeState {
  face: GroundFace
  marker?: MarkedMode
  released?: boolean
}

// OCS 5.7–5.10. Adapted from Smolensk 5603e52, src/engine/rules/modes.ts.
const baseEffect = {
  attackFactor: 1, defenseFactor: 1, barrageFactor: 1, actionRatingModifier: 0,
  canAttack: true, canBarrage: true, canOverrun: true,
}
const markerEffects = {
  reserve: { ...baseEffect, defenseFactor: 0.5, canAttack: false, canBarrage: false, canOverrun: false },
  strat: { ...baseEffect, attackFactor: 0, defenseFactor: 0, barrageFactor: 0,
    canAttack: false, canBarrage: false, canOverrun: false },
  exploit: baseEffect,
  dg: { ...baseEffect, attackFactor: 0.5, defenseFactor: 0.5, barrageFactor: 0.5,
    actionRatingModifier: -1, canOverrun: false },
} satisfies Record<MarkedMode, typeof baseEffect>

export function groundModeEffect({ face, marker }: GroundModeState) {
  return {
    ...(marker ? markerEffects[marker] : baseEffect),
    keepsCombatZoc: face === 'combat' && (marker === undefined || marker === 'exploit'),
    actionRatingFactor: marker === 'strat' ? 0 : 1,
  }
}

/** Movement budget for an eligible unit. Phase/side permission is checked at the command boundary. */
export function groundModeMovementFactor({ marker, released }: GroundModeState, phase: Phase): number {
  if (marker === 'dg' || marker === 'exploit') return 0.5
  if (marker === 'strat') return 2
  return reserveMovementFactor(phase, marker === 'reserve', released === true)
}
