import type { Side } from '@ocs-eastern/series/state-types'

export type Victory =
  | { outcome: 'draw' }
  | { outcome: 'axis' | 'soviet'; level: 'major' | 'minor' }

/** Scenario Book p.53. The input is the current Soviet VP tally. */
export function scorpionSuddenDeath(turn: number, vp: number): Victory | null {
  if (turn < 3) return null
  if (vp < -4) return { outcome: 'axis', level: 'major' }
  if (vp > 19) return { outcome: 'soviet', level: 'major' }
  return null
}

/** Award the reroll counter to its holder only at game end. */
export function scorpionFinalVictory(vp: number, rerollHolder: Side | null): Victory {
  const finalVp = scorpionFinalPoints(vp, rerollHolder)
  if (finalVp <= 0) return { outcome: 'axis', level: 'major' }
  if (finalVp <= 4) return { outcome: 'axis', level: 'minor' }
  if (finalVp <= 10) return { outcome: 'draw' }
  return { outcome: 'soviet', level: finalVp <= 14 ? 'minor' : 'major' }
}

export function scorpionFinalPoints(vp: number, rerollHolder: Side | null): number {
  return vp + (rerollHolder === 'soviet' ? 1 : rerollHolder === 'axis' ? -1 : 0)
}
