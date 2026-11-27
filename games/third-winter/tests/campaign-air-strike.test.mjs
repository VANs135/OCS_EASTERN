import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openCampaignMatch } from '../src/match/campaign-match.ts'
import {
  completeCampaignAirStrike, launchCampaignAirStrike, resolveCampaignAirFlak,
} from '../src/match/campaign-air-strike.ts'

const hexes = ['A1.1', 'A2.1', 'A3.1', 'A4.1']
const map = {
  resolveHex: (hex) => hexes.includes(hex) ? hex : undefined,
  neighbors(hex) { const index = hexes.indexOf(hex); return index < 0 ? [] : [hexes[index - 1], hexes[index + 1]].filter(Boolean) },
}
const table = { columns: ['1-2', '3-6', '7-8'], costs: [1, 1, 1], matrix: Array.from({ length: 11 }, () => ['1', '-', '-']) }
const board = {
  map, table, distance: (a, b) => Math.abs(hexes.indexOf(a) - hexes.indexOf(b)),
  profileOf: (state, id) => ({ combat: state.counters[id].kind !== 'transport', attackCapable: true,
    inCombatMode: state.counters[id].mode === 'combat', outOfSupply: false, moveMa: 4, moveMobility: 'leg', drawMobility: 'leg', singleTransportPoint: false }),
  barrageProfile: () => undefined,
  stepsOf: (state, id) => state.counters[id]?.currentRe,
  printedReOf: (state, id) => state.counters[id]?.currentRe ?? 1,
  terrainAt: () => ['Open'], hedgehogAt: () => 0,
  canUseSupply: () => true,
  losses: { stepsOf: (state, id) => state.counters[id]?.currentRe, reAfterLoss: (state, id, losses) => state.counters[id].currentRe - losses,
    hqKindOf: () => undefined },
  airProfileOf: (state, id) => state.counters[id]?.kind === 'aircraft' ? {
    rangeHexes: 99, printedSteps: 2, airCombat: 1, bombing: 8, fighter: false, hipShoot: false, tankBuster: false,
  } : undefined,
  rangeHexes: () => 99,
  workRefusal: () => null,
}

function start(counters = {
  a: { kind: 'aircraft', side: 'axis', definition: 'Ju.87D', location: { kind: 'box', box: '09:axis:air' }, active: true, availableThrough: 5 },
  victim: { kind: 'land', side: 'soviet', definition: 'inf', location: { kind: 'map', hex: 'A3.1' }, currentRe: 1, mode: 'combat' },
}, more = {}) {
  const opened = openCampaignMatch({ when: { scenarioId: '09', date: '1944-01-05' }, turn: 1, counters }, 623)
  return { ...opened.state, weather: { ground: 'frozen', flight: 'normal' },
    cursor: { phase: 'movement', phasing: 'axis', first: 'axis' }, movementSegment: 'barrage', ...more }
}

test('an off-map 09 air strike launches into the Flak step and returns to its box inactive', () => {
  const state = start()
  const launched = launchCampaignAirStrike(state, 'axis', { type: 'launch-campaign-air-strike', kind: 'barrage',
    targetHex: 'A3.1', aircraftIds: ['a'] }, board)
  assert.equal(launched.airMission.step.kind, 'flak')
  assert.equal(launched.airMission.flights[0].distanceHexes, 0)
  assert.equal(launched.counters.a.active, true)

  const pending = { ...launched, airMission: { ...launched.airMission, step: { kind: 'barrage' } }, barrage: null }
  const done = completeCampaignAirStrike(pending, 'axis', board)
  assert.deepEqual(done.counters.a.location, { kind: 'box', box: '09:axis:air' })
  assert.equal(done.counters.a.active, false)
  assert.equal(done.airMission, null)
  assert.equal(done.airHistory.length, 1)
})

test('09 air availability and segment gates reject the sortie before it starts', () => {
  const late = start({ ...start().counters, a: { ...start().counters.a, availableThrough: 2 } }, { turn: 3 })
  assert.throws(() => launchCampaignAirStrike(late, 'axis', { type: 'launch-campaign-air-strike', kind: 'barrage',
    targetHex: 'A3.1', aircraftIds: ['a'] }, board), /not-available-this-turn/)

  const wrongSegment = start(undefined, { movementSegment: 'movement' })
  assert.throws(() => launchCampaignAirStrike(wrongSegment, 'axis', { type: 'launch-campaign-air-strike', kind: 'barrage',
    targetHex: 'A3.1', aircraftIds: ['a'] }, board), /Barrage Segment/)

  const noFlight = start(undefined, { weather: { ground: 'frozen', flight: 'none' } })
  assert.throws(() => launchCampaignAirStrike(noFlight, 'axis', { type: 'launch-campaign-air-strike', kind: 'barrage',
    targetHex: 'A3.1', aircraftIds: ['a'] }, board), /weather prohibits flight/)
})

test('a successful Flak hit reduces one aircraft and turns the strike into an air barrage', () => {
  const state = start()
  const launched = launchCampaignAirStrike(state, 'axis', { type: 'launch-campaign-air-strike', kind: 'barrage',
    targetHex: 'A3.1', aircraftIds: ['a'] }, board)
  const resolved = resolveCampaignAirFlak(launched, 'axis', { ...board, flakValueAt: () => 10 })
  assert.equal(resolved.counters.a.stepsLost, 1)
  assert.equal(resolved.airMission.step.kind, 'barrage')
  assert.equal(resolved.barrage.air.missionId, resolved.airMission.id)
  assert.equal(resolved.barrage.strength, 8)
})

test('duplicate aircraft cannot be entered twice in one mission', () => {
  const state = start({
    a: { kind: 'aircraft', side: 'axis', definition: 'Ju.87D', location: { kind: 'box', box: '09:axis:air' }, active: true },
    b: { kind: 'aircraft', side: 'axis', definition: 'Ju.87D', location: { kind: 'box', box: '09:axis:air' }, active: true },
    victim: { kind: 'land', side: 'soviet', definition: 'inf', location: { kind: 'map', hex: 'A3.1' }, currentRe: 1, mode: 'combat' },
  })
  assert.throws(() => launchCampaignAirStrike(state, 'axis', { type: 'launch-campaign-air-strike', kind: 'barrage',
    targetHex: 'A3.1', aircraftIds: ['a', 'a'] }, board), /distinct aircraft/)
})
