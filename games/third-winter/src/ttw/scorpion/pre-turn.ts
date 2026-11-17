import type { Side } from '@ocs-eastern/series/state-types'
import type { Flight, ScorpionGround, ScorpionWeather } from './weather.ts'
import type { Retention } from './initiative.ts'
import type { Victory } from './victory.ts'
import { scorpionFinalVictory, scorpionSuddenDeath } from './victory.ts'

export type PreTurn =
  | { kind: 'retention'; responder: Side; retention: 'axis' | 'soviet' }
  | { kind: 'roll'; retention: Retention }
  | { kind: 'choose-order'; responder: Side; retention: Retention }
  | { kind: 'player-turn'; first: Side; retention: Retention }
  | { kind: 'ended'; result: Victory }

export interface ScorpionTurn {
  number: number
  weather: { ground: ScorpionGround; flight: Flight }
  thawSeen: boolean
  vp: number
  step: PreTurn
}

/** Scenario Book p.53. Axis steps are evaluated on the specified Dnepr reach. */
export function openScorpionTurn(
  turn: number,
  weather: Readonly<ScorpionWeather>,
  vp: number,
  retention: Retention,
  axisCombatStepsAlongDnepr: number,
  rerollHolder: Side | null,
): ScorpionTurn {
  const base = {
    number: turn,
    weather: { ground: weather.ground, flight: weather.flight },
    thawSeen: weather.thawSeen,
    vp,
  }
  const suddenDeath = scorpionSuddenDeath(turn, vp)
  if (suddenDeath) return { ...base, step: { kind: 'ended', result: suddenDeath } }
  if (weather.endGame) {
    return { ...base, step: { kind: 'ended', result: scorpionFinalVictory(vp, rerollHolder) } }
  }
  if (turn === 1) {
    return { ...base, step: { kind: 'player-turn', first: 'soviet', retention: 'soviet' } }
  }

  // The dated VP check follows weather and is skipped on Thaw.
  const penalty = turn >= 3 && weather.ground !== 'thaw' ? Math.min(axisCombatStepsAlongDnepr, 4) : 0
  const adjustedVp = vp - penalty
  const result = scorpionSuddenDeath(turn, adjustedVp)
  if (result) return { ...base, vp: adjustedVp, step: { kind: 'ended', result } }

  const step: PreTurn = retention === 'closed'
    ? { kind: 'roll', retention }
    : { kind: 'retention', responder: retention, retention }
  return { ...base, vp: adjustedVp, step }
}
