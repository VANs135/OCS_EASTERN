import { inScorpionPhase } from './scorpion-barrage-timing.ts'
import type { PlayerTurn } from './scorpion-player-turn.ts'

export interface ScorpionGroundActivity extends Pick<PlayerTurn, 'turn' | 'phasing' | 'phase'> {
  spent: Readonly<Record<string, number>>
  airlifted: readonly string[]
  transport?: { unitId: string; enteredHex: boolean }
}

interface ActivityState {
  cursor: PlayerTurn
  groundActivity?: ScorpionGroundActivity
}

export function scorpionGroundActivity(state: ActivityState): ScorpionGroundActivity {
  if (state.groundActivity && inScorpionPhase(state.cursor, state.groundActivity)) return state.groundActivity
  const { turn, phasing, phase } = state.cursor
  return { turn, phasing, phase, spent: {}, airlifted: [] }
}
