import type { Side } from './state-types.ts'

export const playerPhases = [
  'aircraft-refit', 'reinforcement', 'movement', 'supply',
  'reaction', 'combat', 'exploitation', 'cleanup',
] as const

export type Phase = (typeof playerPhases)[number]

/** OCS v4.3 2.2. The non-phasing side acts in Reaction. */
export function actingSide(phasing: Side, phase: Phase): Side {
  if (phase !== 'reaction') return phasing
  return phasing === 'axis' ? 'soviet' : 'axis'
}

export function nextPlayerPhase(phase: Phase): Phase | null {
  return playerPhases[playerPhases.indexOf(phase) + 1] ?? null
}
