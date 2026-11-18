import type { Side } from '@ocs-eastern/series/state-types'
import { inScorpionPhase } from './scorpion-barrage-timing.ts'
import type { PlayerTurn } from './scorpion-player-turn.ts'
import type { ScorpionInPlay, ScorpionSession } from './scorpion-session.ts'

export interface ScorpionPhaseOccupancy extends Pick<PlayerTurn, 'turn' | 'phasing' | 'phase'> {
  occupied: Readonly<Record<Side, readonly string[]>>
}

export function scorpionPhaseOccupancy(state: ScorpionInPlay): ScorpionPhaseOccupancy {
  const { turn, phasing, phase } = state.cursor
  const occupied = { axis: new Set<string>(), soviet: new Set<string>() }
  for (const unit of Object.values(state.units)) occupied[unit.side].add(unit.hex)
  for (const base of state.airBases ?? []) occupied[base.side].add(base.hex)
  for (const piece of state.pieces ?? []) if (piece.location.kind === 'hex') occupied[piece.side].add(piece.location.hex)
  for (const [id, dump] of Object.entries(state.dumps ?? {})) {
    const prefix = `${dump.side}:hex:`
    if (dump.location === 'on-map' && dump.tokens > 0 && id.startsWith(prefix)) occupied[dump.side].add(id.slice(prefix.length))
  }
  return { turn, phasing, phase, occupied: { axis: [...occupied.axis], soviet: [...occupied.soviet] } }
}

export function scorpionKnownPhaseOccupancy(state: ScorpionInPlay): ScorpionPhaseOccupancy | undefined {
  if (state.phaseOccupancy && inScorpionPhase(state.cursor, state.phaseOccupancy)) return state.phaseOccupancy
  if (!state.moved?.length && !state.airMission && !state.combat &&
    !state.airHistory?.some((event) => inScorpionPhase(state.cursor, event))) return scorpionPhaseOccupancy(state)
}

/** OCS Air Transport Success Table. Take occupancy after entering the phase, before its first action. */
export function withScorpionPhaseOccupancy(before: ScorpionSession, after: ScorpionSession): ScorpionSession {
  if (after.kind !== 'playing' || !['movement', 'reaction', 'exploitation'].includes(after.cursor.phase)) return after
  if (before.kind === 'setup' || !inScorpionPhase(after.cursor, before.cursor)) {
    return { ...after, phaseOccupancy: scorpionPhaseOccupancy(after) }
  }
  // An existing save at the start of a phase can still supply a valid snapshot.
  const occupancy = scorpionKnownPhaseOccupancy(before)
  return occupancy && occupancy !== after.phaseOccupancy ? { ...after, phaseOccupancy: occupancy } : after
}
