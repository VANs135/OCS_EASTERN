import assert from 'node:assert/strict'
import test from 'node:test'
import { openCampaignMatch } from '../src/match/campaign-match.ts'
import { campaignGeometryHooks } from '../src/match/campaign-geometry.ts'

const map = {
  resolveHex: (h) => (Number.isInteger(+h) && +h >= 0 && +h <= 30 ? String(h) : undefined),
  neighbors: (h) => [String(+h - 1), String(+h + 1)].filter((n) => +n >= 0 && +n <= 30),
}
const source = {
  map,
  hexSite: (hex) => ({ villageCity: ['12', '20'].includes(hex), detrainable: ['12', '20', '25'].includes(hex),
    map: Number(hex) <= 15 ? 'C' : 'A' }),
  friendlyAirBase: (s, hex, side) => hex === '25' && side === 'axis',
  isCombatUnit: (s, id) => s.counters[id]?.definition.startsWith('combat') === true,
  inSupply: (s, id) => s.counters[id]?.outOfSupply !== true,
}
const hooks = campaignGeometryHooks(source)
function game() {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 1, counters: {}, supplyDumps: {} }, 320)
  const c = (definition, side, hex, extra = {}) => ({ definition, kind: 'land', side, location: { kind: 'map', hex }, ...extra })
  record.state.counters = {
    sov1: c('combat-sov', 'soviet', '5'),
    sov2: c('combat-sov', 'soviet', '8', { outOfSupply: true }),
    ax1: c('combat-ax', 'axis', '28'),
  }
  return record
}

test('geometry hooks read map letter, detrainable and site facts with in-supply distance', () => {
  const s = game().state
  assert.equal(hooks.mapOf('10'), 'C')
  assert.equal(hooks.mapOf('20'), 'A')
  assert.equal(hooks.detrainable(s, '12'), true)
  assert.equal(hooks.detrainable(s, '11'), false)
  // village at 20; nearest in-supply Soviet combat is sov1@5 (sov2@8 is out of supply, excluded) -> 15
  assert.deepEqual(hooks.siteFacts(s, '20'), { villageCityOrFriendlyAirBase: true, distanceToInSupplySovietCombat: 15 })
  // 25 is a friendly air base (not village); distance to sov1@5 = 20
  assert.deepEqual(hooks.siteFacts(s, '25'), { villageCityOrFriendlyAirBase: true, distanceToInSupplySovietCombat: 20 })
  // 12 is village; nearest in-supply Soviet combat sov1@5 -> 7 (not sov2@8 -> 4)
  assert.equal(hooks.siteFacts(s, '12').distanceToInSupplySovietCombat, 7)
})

test('within-10 and route-crossing checks use combat unit positions', () => {
  const s = game().state
  assert.equal(hooks.sovietCombatWithin10(s, '12'), true)   // 12->5 = 7
  assert.equal(hooks.sovietCombatWithin10(s, '20'), false)  // 20->5 = 15
  // axis combat ax1@28; endpoints 10/12 are 18/16 away -> not within 10
  assert.equal(hooks.routeWithin10AxisCombat(s, '10', '12'), false)
  // a rail route passing 25/28 crosses within 10 of ax1
  const routed = campaignGeometryHooks({ ...source, railRoute: () => ['10', '25', '28'] })
  assert.equal(routed.routeWithin10AxisCombat(s, '10', '12'), true)
})