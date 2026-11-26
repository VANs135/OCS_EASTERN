import assert from 'node:assert/strict'
import test from 'node:test'
import { openCampaignMatch } from '../src/match/campaign-match.ts'
import { campaignMovementProfiles } from '../src/match/campaign-movement-profiles.ts'

const face = (ma, color, extra = {}) => ({ asset: null, maColor: color, stats: { move: ma, ...extra } })
function def(key, kind, side, combat, move, abilities = []) {
  return { key, kind, sourceFile: 'test', sourceId: key,
    source: { name: key, side, re: 1, faces: { combat, move }, abilities } }
}
const catalog = {
  inf: def('inf', 'land', 'axis', face(4, 'white', { attack: 6 }), face(4, 'white')),
  truck: def('truck', 'land', 'axis', face(10, 'black', { attack: 4 }), face(10, 'black')),
  wagon1: def('wagon1', 'transport', 'axis', face(10, 'white', { transport: 1 }), null),
  wagon2: def('wagon2', 'transport', 'axis', face(10, 'white', { transport: 2 }), null),
  pontoon: def('pontoon', 'land', 'axis', face(4, 'white', { attack: 0 }), face(4, 'white'), ['pontoon']),
  kessel: def('kessel', 'hq', 'axis', face(3, 'white', { dropRange: 2 }), face(3, 'white'), ['kessel_supply']),
  army: def('army', 'hq', 'axis', face(10, 'black', { dropRange: 5 }), null),
}
const board = campaignMovementProfiles(catalog)
function game() {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 1, counters: {}, supplyDumps: {} }, 310)
  const c = (definition, kind, extra = {}) => ({ definition, kind, side: 'axis', location: { kind: 'map', hex: '10' }, ...extra })
  record.state.counters = {
    inf: c('inf', 'land'), truck: c('truck', 'land', { fueled: true }),
    wagon1: c('wagon1', 'transport'), wagon2: c('wagon2', 'transport'),
    pontoon: c('pontoon', 'land'), kessel: c('kessel', 'hq'), army: c('army', 'hq'),
  }
  return record
}

test('movement profiles derive mobility, attack, pontoon, transport and HQ draw from the catalog', () => {
  const s = game().state
  assert.deepEqual(board.profileOf(s, 'inf'), { combat: true, pontoon: false, attackCapable: true, inCombatMode: true,
    outOfSupply: false, moveMa: 4, moveMobility: 'leg', drawMobility: 'leg', singleTransportPoint: false })
  assert.equal(board.profileOf(s, 'truck').moveMobility, 'truck')
  assert.equal(board.profileOf(s, 'wagon1').singleTransportPoint, true)
  assert.equal(board.profileOf(s, 'wagon1').combat, false)
  assert.equal(board.profileOf(s, 'wagon2').singleTransportPoint, false)
  assert.equal(board.profileOf(s, 'pontoon').pontoon, true)
  assert.equal(board.profileOf(s, 'kessel').drawMobility, 'leg')      // Kessel HQ draws leg
  assert.equal(board.profileOf(s, 'kessel').attackCapable, false)
  assert.equal(board.profileOf(s, 'army').drawMobility, 'truck')     // other HQ draws truck
})

test('moveProfile reads the current mode face MA/mobility and fuel readiness', () => {
  const s = game().state
  assert.deepEqual(board.moveProfile(s, 'inf'), { ma: 4, mobility: 'leg', fuelReady: false })
  assert.deepEqual(board.moveProfile(s, 'truck'), { ma: 10, mobility: 'truck', fuelReady: true })
  // move mode flips to the back face
  s.counters.inf = { ...s.counters.inf, mode: 'move' }
  assert.equal(board.moveProfile(s, 'inf').ma, 4)
  assert.equal(board.moveProfile(s, 'missing'), undefined)
})