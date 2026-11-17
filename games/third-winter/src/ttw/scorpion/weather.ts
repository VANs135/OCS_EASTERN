import type { RollDie } from '@ocs-eastern/series/dice'

export type ScorpionGround = 'freeze' | 'thaw'
export type Flight = 'normal' | 'limited' | 'none'

export interface ScorpionWeather {
  ground: ScorpionGround
  flight: Flight
  thawSeen: boolean
  endGame: boolean
}

export const scorpionDates = [
  '1944-01-26', '1944-01-29', '1944-02-01', '1944-02-05',
  '1944-02-08', '1944-02-12', '1944-02-15', '1944-02-19',
] as const

// Scenario Book p.53 and the turn track / flight table on Scorpion-Map-200929.png.
const freezeCeilings = [6, 6, 5, 4, 3, 2, 1, 0] as const

export function scorpionWeather(turn: number, thawSeen: boolean, roll: RollDie): ScorpionWeather {
  const freezeCeiling = freezeCeilings[turn - 1]
  if (freezeCeiling === undefined) throw new RangeError('Invalid Scorpion turn')
  if (turn === 1) return { ground: 'freeze', flight: 'limited', thawSeen: false, endGame: false }
  const freeze = thawSeen || freezeCeiling === 6 || (freezeCeiling > 0 && roll() <= freezeCeiling)
  if (!freeze) return { ground: 'thaw', flight: 'none', thawSeen: true, endGame: turn === 8 }
  const total = roll() + roll()
  const flight = total <= 5 ? 'none' : total <= 9 ? 'limited' : 'normal'
  return { ground: 'freeze', flight, thawSeen, endGame: false }
}
