import assert from 'node:assert/strict'
import test from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { campaignLuftflottePlacementOptions } from '../src/match/campaign-luftflotte-placement.ts'

const sites = {
  '20': { villageCityOrFriendlyAirBase: true, distanceToInSupplySovietCombat: 15 },
  '5': { villageCityOrFriendlyAirBase: true, distanceToInSupplySovietCombat: 3 },
  '25': { villageCityOrFriendlyAirBase: false, distanceToInSupplySovietCombat: 20 },
}
const board = {
  resolveHex: (h) => (Number.isInteger(+h) && +h >= 0 && +h <= 30 ? String(h) : undefined),
  isLuftflotteHq: (s, id) => id === 'luftflotte',
  siteFacts: (s, hex) => sites[hex],
  sovietCombatWithin10: (s, hex) => hex === '5',
}
function game(hex = '10') {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 1,
    counters: { luftflotte: { id: 'luftflotte', side: 'axis', location: { kind: 'map', hex }, stepsLost: 0, mode: 'combat', kind: 'hq', definition: 'luftflotte-hq' } }, supplyDumps: {} }, 200)
  record.state.cursor = { phase: 'movement', phasing: 'axis', first: 'axis' }
  record.state.movementSegment = 'movement'
  return record
}
const ctx = { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: (h) => h, arrivalSites: () => [] }, luftflottePlacement: board }
let seq = 0
const move = (record, targetHex) => submitCampaignMatch(record, 'axis',
  { id: `luftflotte-move-${seq++}`, expectedRevision: record.revision, action: { type: 'move-campaign-luftflotte', targetHex } }, ctx).record

test('Luftflotte HQ relocates to a friendly village/city/air base 10+ hexes from Soviet combat (§2.2b)', () => {
  const moved = move(game(), '20')
  assert.deepEqual(moved.state.counters.luftflotte.location, { kind: 'map', hex: '20' })
  const options = campaignLuftflottePlacementOptions(moved.state, 'axis', board)
  assert.equal(options.hex, '20')
  assert.equal(options.mustMove, false)
  // too close to an in-supply Soviet combat unit is refused
  assert.throws(() => move(game(), '5'), /10\+ hexes/)
  // a non friendly-village/city/air-base hex is refused
  assert.throws(() => move(game(), '25'), /10\+ hexes/)
  // not the Axis movement phase is refused
  const wrong = game(); wrong.state.cursor = { phase: 'reinforcement', phasing: 'axis', first: 'axis' }
  assert.throws(() => move(wrong, '20'), /movement phase/)
})

test('Luftflotte HQ must move when a Soviet combat unit is within 10 hexes; UI projection flags it', () => {
  const threatened = game('5')
  const options = campaignLuftflottePlacementOptions(threatened.state, 'axis', board)
  assert.equal(options.hex, '5')
  assert.equal(options.mustMove, true)
  // it can still relocate to a valid site
  assert.deepEqual(move(threatened, '20').state.counters.luftflotte.location, { kind: 'map', hex: '20' })
  assert.equal(campaignLuftflottePlacementOptions(game().state, 'soviet', board), null)
})