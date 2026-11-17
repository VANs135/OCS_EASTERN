import type { Side } from '@ocs-eastern/series/state-types'
import { actingSide, nextPlayerPhase } from '@ocs-eastern/series/turn'
import type { Phase } from '@ocs-eastern/series/turn'
import type { Retention } from '../ttw/scorpion/initiative.ts'
import type { ScorpionTurn } from '../ttw/scorpion/pre-turn.ts'

export interface PlayerTurn {
  turn: number
  first: Side
  phasing: Side
  phase: Phase
  retention: Retention
}

export function startScorpionPlayerTurns(turn: Readonly<ScorpionTurn>): PlayerTurn {
  if (turn.step.kind !== 'player-turn') throw new Error('Scorpion initiative must be resolved first')
  const { first, retention } = turn.step
  return { turn: turn.number, first, phasing: first, phase: 'aircraft-refit', retention }
}

/** The completed phase is checked by its own module before calling this cursor. */
export function advanceScorpionPhase(
  current: Readonly<PlayerTurn>, actor: Side,
): PlayerTurn | null {
  if (actingSide(current.phasing, current.phase) !== actor) {
    throw new Error('This side cannot complete the current phase')
  }
  const next = nextPlayerPhase(current.phase)
  if (next) return { ...current, phase: next }
  if (current.phasing !== current.first) return null
  return { ...current, phasing: current.first === 'axis' ? 'soviet' : 'axis', phase: 'aircraft-refit' }
}
