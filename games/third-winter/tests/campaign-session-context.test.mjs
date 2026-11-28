import assert from 'node:assert/strict'
import test from 'node:test'
import { openCampaignMatch } from '../src/match/campaign-match.ts'
import { campaignSessionHooks } from '../src/match/campaign-session-context.ts'

const face = (ma, color, extra = {}) => ({ asset: null, maColor: color, stats: { move: ma, ...extra } })
const def = (key, kind, side, combat, move, abilities = []) =>
  ({ key, kind, sourceFile: 'test', sourceId: key, source: { name: key, side, re: 1, faces: { combat, move }, abilities } })
const map = {
  resolveHex: (h) => (Number.isInteger(+h) && +h >= 0 && +h <= 30 ? String(h) : undefined),
  neighbors: (h) => [String(+h - 1), String(+h + 1)].filter((n) => +n >= 0 && +n <= 30),
}
const hooks = campaignSessionHooks({
  hqCatalog: { 'ge-army': { hqKind: 'army', railOnly: true, railCapRe: 1 } },
  movementCatalog: {
    'ge-army': def('ge-army', 'hq', 'axis', face(10, 'black', { dropRange: 5 }), null),
    inf: def('inf', 'land', 'axis', face(4, 'white', { attack: 6 }), face(4, 'white')),
  },
  geometry: {
    map, hexSite: (hex) => ({ villageCity: hex === '20', detrainable: hex === '12', map: Number(hex) <= 15 ? 'C' : 'A' }),
    friendlyAirBase: () => false,
    isCombatUnit: (s, id) => s.counters[id]?.definition === 'inf',
    inSupply: (s, id) => s.counters[id]?.outOfSupply !== true,
  },
  posture: { frontOfHex: (hex) => (hex === '10' ? 'front1' : undefined), benefitEligible: (s, hex) => hex === '10' },
  lossBoard: {
    stepsOf: (s, id) => s.counters[id]?.location.kind === 'map' ? 1 - (s.counters[id].stepsLost ?? 0) : undefined,
    reAfterLoss: () => undefined,
  },
})
function game() {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 1, counters: {}, supplyDumps: {} }, 340)
  record.state.counters = {
    'a-army': { definition: 'ge-army', kind: 'hq', side: 'axis', location: { kind: 'map', hex: '10' }, mode: 'combat', stepsLost: 0 },
    inf: { definition: 'inf', kind: 'land', side: 'axis', location: { kind: 'map', hex: '10' }, mode: 'combat', stepsLost: 0 },
  }
  record.state.frontPostures = { front1: { mode: 'regrouping', sinceTurn: 1 } }
  return record
}

test('session hooks wire HQ/movement/geometry/posture factories into board fragments', () => {
  const s = game().state
  // combat fragment
  assert.equal(hooks.combat.losses.hqKindOf(s, 'a-army'), 'army')
  assert.equal(hooks.combat.retreatDestroyed(s, 'a-army'), true)
  assert.equal(hooks.combat.frontOfHex('10'), 'front1')
  assert.equal(hooks.combat.postureBenefitAt(s, '10', 'soviet'), true)
  const destroyed = hooks.combat.destroyOnRetreat(s, ['a-army'])
  assert.equal(destroyed.counters['a-army'].location.kind, 'dead-pile')
  assert.equal(destroyed.sovietVp, 1)
  // ground movement fragment
  assert.equal(hooks.groundMovement.railOnly(s, 'a-army'), true)
  assert.equal(hooks.groundMovement.profileOf(s, 'inf').moveMobility, 'leg')
  assert.deepEqual(hooks.groundMovement.moveProfile(s, 'inf'), { ma: 4, mobility: 'leg', fuelReady: false })
  // rail fragment
  assert.deepEqual(hooks.railTransport.hqRail(s, 'a-army'), { railRe: 1, waiveDetrainable: true })
  // geometry fragments
  assert.equal(hooks.rvgkMarker.mapOf('20'), 'A')
  assert.equal(hooks.rvgkMarker.detrainable(s, '12'), true)
  assert.equal(hooks.luftflottePlacement.siteFacts(s, '20').villageCityOrFriendlyAirBase, true)
  // 4.8a stacking fragment uses the same map, combat filter and loss surface
  assert.equal(hooks.stacking.map, map)
  assert.equal(hooks.stacking.combatOf(s, 'inf'), true)
  assert.equal(hooks.stacking.combatOf(s, 'a-army'), false)
  assert.equal(hooks.stacking.losses.stepsOf(s, 'inf'), 1)
})