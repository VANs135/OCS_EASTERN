import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { scorpionWeather } from '../src/ttw/scorpion/weather.ts'
import { campaignWeather, initialWeatherHistory } from '../src/ttw/campaign/weather.ts'

function dice(...faces) {
  return () => {
    const value = faces.shift()
    assert.notEqual(value, undefined, 'Unexpected dice roll')
    return value
  }
}

test('Scorpion weather uses its own flight table and exactly one Thaw', () => {
  assert.equal(scorpionWeather(1, false, dice()).flight, 'limited')
  assert.equal(scorpionWeather(2, false, dice(2, 3)).flight, 'none')
  assert.equal(scorpionWeather(3, false, dice(6)).ground, 'thaw')
  assert.equal(scorpionWeather(4, true, dice(5, 5)).flight, 'normal')
  assert.equal(scorpionWeather(8, true, dice(3, 3)).endGame, false)
  assert.equal(scorpionWeather(8, false, dice()).endGame, true)
})

test('TTW 1.4b Ice starts after the third Freeze, regardless of current weather', () => {
  let state = initialWeatherHistory
  for (const date of [{month: 11, day: 29}, {month: 12, day: 1}, {month: 12, day: 5}]) {
    const result = campaignWeather(date, state, dice(6, 1, 1))
    state = result.state
    assert.equal(state.ice, false)
  }
  const result = campaignWeather({month: 12, day: 8}, state, dice(1, 1, 1))
  assert.equal(result.weather.ground, 'dry')
  assert.equal(result.state.ice, true)
  assert.equal(result.removeFerries, true)
})

test('TTW 1.8 April third Mud ends before the flight roll', () => {
  let state = initialWeatherHistory
  for (const day of [1, 5]) {
    state = campaignWeather({month: 4, day}, state, dice(3, 1, 1)).state
  }
  const result = campaignWeather({month: 4, day: 8}, state, dice(3))
  assert.equal(result.endGame, true)
  assert.equal(result.weather.flight, null)
})

test('campaign uses March Freeze and the automatic Dry row through October 1', () => {
  assert.equal(campaignWeather({month: 3, day: 22}, initialWeatherHistory, dice(5, 2, 2)).weather.ground, 'freeze')
  assert.equal(campaignWeather({month: 10, day: 1}, initialWeatherHistory, dice(6, 6)).weather.flight, 'none')
})

test('unresolved third thaw boundary is explicit at the caller', () => {
  const state = { ...initialWeatherHistory, thawRun: 2, ice: true, iceNextTurn: true }
  const date = {month: 4, day: 8}
  assert.throws(() => campaignWeather(date, state, dice(1)), /thaw timing/)
  assert.equal(campaignWeather(date, state, dice(1, 1, 1), undefined, 'during-third-turn').state.ice, false)
  const delayed = campaignWeather(date, state, dice(1, 1, 1), undefined, 'start-of-next-turn')
  assert.equal(delayed.state.ice, true)
  assert.equal(delayed.state.iceNextTurn, false)
})
