import { airMissionSegments } from '@ocs-eastern/series/fire-timing'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { PlayerTurn } from './scorpion-player-turn.ts'

export function inScorpionPhase(cursor: PlayerTurn, event: Pick<PlayerTurn, 'turn' | 'phasing' | 'phase'>) {
  return event.turn === cursor.turn && event.phasing === cursor.phasing && event.phase === cursor.phase
}

export function scorpionPhaseBarrages(state: Readonly<ScorpionInPlay>) {
  return (state.barrageHistory ?? []).filter((event) => inScorpionPhase(state.cursor, event))
}

export function scorpionPhaseAirMissions(state: Readonly<ScorpionInPlay>) {
  return (state.airHistory ?? []).filter((event) => inScorpionPhase(state.cursor, event))
}

/** OCS 10.0e: a declared ordinary barrage uses the hex even if all aircraft abort or are destroyed. */
export function scorpionRegularBarrageTargets(state: Readonly<ScorpionInPlay>) {
  const targets = scorpionPhaseBarrages(state).filter((event) => !event.air?.hipShoot).map(({ target }) => target)
  for (const event of scorpionPhaseAirMissions(state)) {
    if (airMissionSegments[event.kind] === 'barrage' && event.target.kind === 'hex') targets.push(event.target.hex)
  }
  return new Set(targets)
}
