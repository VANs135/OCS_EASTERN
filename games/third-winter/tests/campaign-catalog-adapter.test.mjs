import assert from 'node:assert/strict'
import test from 'node:test'
import { openCampaignMatch } from '../src/match/campaign-match.ts'
import { campaignCatalogAdapter } from '../src/match/campaign-catalog-adapter.ts'
import { campaignHqHooks } from '../src/match/campaign-hq-boards.ts'
import { campaignMovementProfiles } from '../src/match/campaign-movement-profiles.ts'

const face = (ma, color, extra = {}) => ({ asset: null, maColor: color, stats: { move: ma, ...extra } })
const def = (key, kind, source) => ({ key, kind, sourceFile: 'test', sourceId: key, source: { name: key, ...source } })
const definitions = new Map([
  ['hq:id:ge-army', def('hq:id:ge-army', 'hq', { side: 'axis', hqKind: 'army', railOnly: true, railCapRe: 1,
    faces: { combat: face(10, 'black', { dropRange: 5 }), move: null } })],
  ['hq:id:ge-ags', def('hq:id:ge-ags', 'hq', { side: 'axis', hqKind: 'ags', railOnly: true, mustBeCity: true,
    faces: { combat: face(10, 'black', { dropRange: 5 }), move: null } })],
  ['hq:id:corps', def('hq:id:corps', 'hq', { side: 'axis', hqKind: 'corps',
    faces: { combat: face(10, 'black', { dropRange: 3 }), move: null } })],
  ['hq:id:kessel', def('hq:id:kessel', 'hq', { side: 'axis', hqKind: 'kessel', abilities: ['kessel_supply'],
    faces: { combat: face(3, 'white', { dropRange: 2 }), move: null } })],
  ['luftflotte-hq:id:lf', def('luftflotte-hq:id:lf', 'luftflotte-hq', { side: 'axis',
    faces: { combat: face(null, null), move: null } })],
  ['land:id:inf', def('land:id:inf', 'land', { side: 'axis',
    faces: { combat: face(4, 'white', { attack: 6 }), move: face(4, 'white') } })],
])
const { hqCatalog, movementCatalog } = campaignCatalogAdapter({ definitions })
const hq = campaignHqHooks(hqCatalog)
const movement = campaignMovementProfiles(movementCatalog)
function game() {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 1, counters: {}, supplyDumps: {} }, 350)
  const c = (definition, kind) => ({ definition, kind, side: 'axis', location: { kind: 'map', hex: '10' }, mode: 'combat', stepsLost: 0 })
  record.state.counters = {
    army: c('hq:id:ge-army', 'hq'), ags: c('hq:id:ge-ags', 'hq'), corps: c('hq:id:corps', 'hq'),
    kessel: c('hq:id:kessel', 'hq'), inf: c('land:id:inf', 'land'),
  }
  return record
}

test('catalog adapter feeds HQ hooks from loaded definitions', () => {
  const s = game().state
  assert.equal(hq.hqKindOf(s, 'army'), 'army')
  assert.equal(hq.hqKindOf(s, 'ags'), 'army-group')
  assert.equal(hq.hqKindOf(s, 'corps'), 'corps')
  assert.equal(hq.isKesselHq(s, 'kessel'), true)
  assert.equal(hq.railOnly(s, 'army'), true)
  assert.equal(hq.railOnly(s, 'corps'), false)
  assert.deepEqual(hq.hqRail(s, 'army'), { railRe: 1, waiveDetrainable: true })
  assert.deepEqual(hq.hqRail(s, 'ags'), { railRe: 1, waiveDetrainable: false })
})

test('catalog adapter feeds movement profiles from loaded definitions', () => {
  const s = game().state
  assert.equal(movement.profileOf(s, 'inf').moveMobility, 'leg')
  assert.equal(movement.profileOf(s, 'inf').attackCapable, true)
  assert.equal(movement.profileOf(s, 'kessel').drawMobility, 'leg')
  assert.deepEqual(movement.moveProfile(s, 'inf'), { ma: 4, mobility: 'leg', fuelReady: false })
})