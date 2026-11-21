import type { Side } from './state-types.ts'

export const playerPhases = [
  'aircraft-refit', 'reinforcement', 'movement', 'supply',
  'reaction', 'combat', 'exploitation', 'cleanup',
] as const

export type Phase = (typeof playerPhases)[number]

export interface PlayerTurnCursor {
  first: Side
  phasing: Side
  phase: Phase
}

/** OCS v4.3 2.2. The non-phasing side acts in Reaction. */
export function actingSide(phasing: Side, phase: Phase): Side {
  if (phase !== 'reaction') return phasing
  return phasing === 'axis' ? 'soviet' : 'axis'
}

export function nextPlayerPhase(phase: Phase): Phase | null {
  return playerPhases[playerPhases.indexOf(phase) + 1] ?? null
}

// Player-turn transitions from Smolensk 06a9faa, src/engine/turn-driver.ts (OCS 2.2).
/** Advance after the current stage's own checks. At game-turn end, return control to the work. */
export function advancePlayerTurn(cursor: Readonly<PlayerTurnCursor>, actor: Side): PlayerTurnCursor | null {
  const { first, phasing, phase } = cursor
  if (actingSide(phasing, phase) !== actor) throw new Error('This side cannot complete the current phase')
  const next = nextPlayerPhase(phase)
  if (next) return { first, phasing, phase: next }
  if (phasing !== first) return null
  return { first, phasing: phasing === 'axis' ? 'soviet' : 'axis', phase: playerPhases[0] }
}
