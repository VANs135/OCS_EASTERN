import { matchRowIndex } from '@ocs-eastern/series/tables/lookup'
import type { Die } from '@ocs-eastern/series/dice'

export type Ground = 'dry' | 'mud' | 'freeze' | 'thaw'
export type Flight = 'normal' | 'limited' | 'none'

export interface CampaignWeather {
  ground: Ground
  flight: Flight
}

export type CampaignWeatherCheck = 'ground-weather' | 'flight-weather'
export type CampaignThawTiming = 'during-third-turn' | 'start-of-next-turn'

export interface WeatherHistory {
  freezeRun: number
  thawRun: number
  aprilMudRun: number
  ice: boolean
  iceNextTurn: boolean
}

export const initialWeatherHistory: Readonly<WeatherHistory> = {
  freezeRun: 0, thawRun: 0, aprilMudRun: 0, ice: false, iceNextTurn: false,
}

// Axis Player Booklet p.1. The ground is automatically Dry through October 1.
const groundRows = [
  [10, 5, 15, 3, 6, 6],
  [10, 19, 29, 2, 6, 6],
  [11, 1, 12, 4, 4, 6],
  [11, 15, 29, 2, 2, 6],
  [12, 1, 31, 1, 1, 6],
  [1, 1, 31, 0, 0, 5],
  [2, 1, 29, 0, 0, 5],
  [3, 1, 31, 0, 4, 6],
  [4, 1, 30, 2, 6, 6],
] as const
const flightRows = {
  dry: ['2-9', '10-11', '12'],
  mud: ['2-7', '8-9', '10-12'],
  freeze: ['2-4', '5-8', '9-12'],
} as const
const flights = ['normal', 'limited', 'none'] as const

/** TTW 1.4b and 1.8. Run once at turn start; Thaw is a no-flight Simulcast turn. */
export function campaignWeather(
  date: { month: number; day: number },
  previous: Readonly<WeatherHistory>,
  roll: (check: CampaignWeatherCheck) => Die,
  prescribed?: CampaignWeather,
  thawTiming?: CampaignThawTiming,
): {
  state: WeatherHistory
  weather: CampaignWeather | { ground: 'mud'; flight: null }
  endGame: boolean
  removeFerries: boolean
} {
  const row = groundRows.find(([month, start, end]) => month === date.month && date.day >= start && date.day <= end)
  const automaticDry = date.month === 9 || (date.month === 10 && date.day === 1)
  if (!row && !prescribed && !automaticDry) {
    throw new Error('TTW weather requires a scenario value for this date')
  }

  const ground = prescribed?.ground ?? (row ? rollGround(row, roll('ground-weather')) : 'dry')
  const aprilMudRun = date.month === 4 && ground === 'mud' ? previous.aprilMudRun + 1 : 0
  const endGame = aprilMudRun >= 3 && prescribed === undefined
  const freezeRun = ground === 'freeze' ? previous.freezeRun + 1 : 0
  const iceAtStart = previous.iceNextTurn
  const thawRun = iceAtStart && ground !== 'freeze' ? previous.thawRun + 1 : 0
  const reachedThaw = thawRun >= 3
  // TTW 1.4b gives a worked example for freezing. Q02 leaves the thaw boundary open.
  if (!endGame && reachedThaw && !thawTiming) {
    throw new Error('TTW 1.4b: specify the thaw timing ruling')
  }
  const ice = iceAtStart && !(reachedThaw && thawTiming === 'during-third-turn')
  const state = { freezeRun, thawRun, aprilMudRun, ice, iceNextTurn: (ice && !reachedThaw) || freezeRun >= 3 }
  const removeFerries = iceAtStart && !previous.ice
  if (endGame) return { state, weather: { ground: 'mud', flight: null }, endGame, removeFerries }

  if (prescribed) return { state, weather: prescribed, endGame, removeFerries }
  const flightRoll = roll('flight-weather') + roll('flight-weather')
  const flight = ground === 'thaw' ? 'none'
    : flights[matchRowIndex(flightRows[ground], flightRoll, 'ttw:1.8')]!
  return { state, weather: { ground, flight }, endGame, removeFerries }
}

function rollGround(row: (typeof groundRows)[number], die: number): Ground {
  if (die <= row[3]) return 'dry'
  if (die <= row[4]) return 'mud'
  if (die <= row[5]) return 'freeze'
  return 'thaw'
}
