import type { Side } from '@ocs-eastern/series/state-types'
import { advancePlayerTurn } from '@ocs-eastern/series/turn'
import type { PlayerTurnCursor } from '@ocs-eastern/series/turn'
import type { Retention } from '../ttw/scorpion/initiative.ts'
import type { ScorpionTurn } from '../ttw/scorpion/pre-turn.ts'

export interface PlayerTurn extends PlayerTurnCursor {
  turn: number
  retention: Retention
  simulcast?: true
}

export function startScorpionPlayerTurns(turn: Readonly<ScorpionTurn>): PlayerTurn {
  if (turn.step.kind !== 'player-turn') throw new Error('Scorpion initiative must be resolved first')
  const { first, retention } = turn.step
  return { turn: turn.number, first, phasing: first, phase: 'aircraft-refit', retention,
    ...(turn.weather?.ground === 'thaw' ? { simulcast: true } : {}) }
}

/** The completed phase is checked by its own module before calling this cursor. */
export function advanceScorpionPhase(
  current: Readonly<PlayerTurn>, actor: Side,
): PlayerTurn | null {
  const next = advancePlayerTurn(current, actor)
  return next && { ...current, ...next }
}
