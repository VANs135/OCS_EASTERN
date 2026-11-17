import type { RollDie } from '@ocs-eastern/series/dice'
import type { Side } from '@ocs-eastern/series/state-types'
import { closeScorpionGame, openScorpionTurn } from '../ttw/scorpion/pre-turn.ts'
import type { ScorpionTurn } from '../ttw/scorpion/pre-turn.ts'
import { scorpionDates, scorpionWeather } from '../ttw/scorpion/weather.ts'
import { advanceScorpionPhase } from './scorpion-player-turn.ts'
import type { ReinforcementState } from './scorpion-reinforcement-state.ts'

export type ScorpionPlayerProgress = Pick<ReinforcementState, 'cursor' | 'arrival' | 'victory'>

/** The live score comes from the same player state that applies reinforcement VP changes. */
export function currentScorpionTurn(turn: Readonly<ScorpionTurn>, player?: ScorpionPlayerProgress): ScorpionTurn {
  if (!player) return turn
  if (turn.step.kind !== 'player-turn' || player.cursor.turn !== turn.number || player.cursor.first !== turn.step.first) {
    throw new Error('Scorpion player progress belongs to a different turn')
  }
  const step = player.victory ? { kind: 'ended' as const, result: player.victory } : turn.step
  return { ...turn, vp: player.arrival.sovietVp, step }
}

/** Called after the side's cleanup has been resolved. Weather is rolled only after both cleanups. */
export function completeScorpionCleanup(
  turn: Readonly<ScorpionTurn>, player: ScorpionPlayerProgress, actor: Side,
  axisCombatStepsAlongDnepr: number, rerollHolder: Side | null, roll: RollDie,
) {
  const current = currentScorpionTurn(turn, player)
  if (current.step.kind === 'ended' || player.cursor.phase !== 'cleanup') {
    throw new Error('Scorpion cleanup is unavailable')
  }
  const cursor = advanceScorpionPhase(player.cursor, actor)
  if (cursor) return { turn: current, cursor }
  if (current.number === scorpionDates.length) return { turn: closeScorpionGame(current, rerollHolder), cursor: null }
  const number = current.number + 1
  const weather = scorpionWeather(number, current.thawSeen, roll)
  return { turn: openScorpionTurn(number, weather, current.vp, player.cursor.retention,
    axisCombatStepsAlongDnepr, rerollHolder), cursor: null }
}
