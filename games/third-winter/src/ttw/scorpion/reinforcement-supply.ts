import type { Side } from '@ocs-eastern/series/state-types'
import type { RollDie } from '@ocs-eastern/series/dice'

export interface ScorpionSupplyAward {
  sp: number
  pax: number
  alert: number
  dice: readonly [number, number] | null
}

/** Scenario Book pp.53, 55 and the Scorpion map. User ruling: use the map's Soviet bands. */
export function rollScorpionVariableReinforcements(
  turn: number,
  side: Side,
  roll: RollDie,
): ScorpionSupplyAward {
  if (!Number.isInteger(turn) || turn < 1 || turn > 8) throw new RangeError('Invalid Scorpion turn')
  if (turn === 1) return { sp: 0, pax: 0, alert: 0, dice: null }

  const dice = [roll(), roll()] as const
  const total = dice[0] + dice[1]
  if (side === 'axis') {
    return { sp: total <= 3 ? 4 : total <= 10 ? 5 : 6, pax: 1, alert: 1, dice }
  }
  const sp = total <= 5 ? 5 : total <= 7 ? 6 : 7
  return { sp, pax: 0, alert: 0, dice }
}
