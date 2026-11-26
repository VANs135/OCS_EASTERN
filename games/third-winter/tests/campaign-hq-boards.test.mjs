import assert from 'node:assert/strict'
import test from 'node:test'
import { openCampaignMatch } from '../src/match/campaign-match.ts'
import { campaignHqHooks, campaignDestroyOnRetreat } from '../src/match/campaign-hq-boards.ts'

// 镜像 data/units_hq.json 的代表性事实
const catalog = {
  'ge-army': { hqKind: 'army', railOnly: true, railCapRe: 1 },
  'ge-ags': { hqKind: 'ags', railOnly: true, railCapRe: 1, mustBeCity: true },
  'ge-corps': { hqKind: 'corps' },
  'sov-army': { hqKind: 'army' },
  'kessel': { hqKind: 'kessel' },
  'luft': { catalogKind: 'luftflotte-hq' },
  'inf-div': {},
}
const hooks = campaignHqHooks(catalog)
const hq = (definition, side) => ({ definition, kind: 'hq', side, location: { kind: 'map', hex: '10' }, mode: 'combat', stepsLost: 0 })
function game() {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 1, counters: {}, supplyDumps: {} }, 300)
  record.state.counters = {
    'a-army': hq('ge-army', 'axis'), 'a-ags': hq('ge-ags', 'axis'), 'a-corps': hq('ge-corps', 'axis'),
    's-army': hq('sov-army', 'soviet'), 'kessel': hq('kessel', 'axis'), 'luft': hq('luft', 'axis'),
    'inf': { definition: 'inf-div', kind: 'land', side: 'axis', location: { kind: 'map', hex: '10' }, mode: 'combat', stepsLost: 0 },
  }
  return record
}
const lossBoard = {
  stepsOf: (s, id) => s.counters[id]?.location.kind === 'map' ? 1 - (s.counters[id].stepsLost ?? 0) : undefined,
  reAfterLoss: () => undefined, hqKindOf: hooks.hqKindOf, isKesselHq: hooks.isKesselHq,
}

test('HQ hooks derive class, rail and retreat facts from the catalog (side-gated)', () => {
  const s = game().state
  assert.equal(hooks.hqKindOf(s, 'a-army'), 'army')
  assert.equal(hooks.hqKindOf(s, 'a-ags'), 'army-group')
  assert.equal(hooks.hqKindOf(s, 'a-corps'), 'corps')
  assert.equal(hooks.hqKindOf(s, 's-army'), undefined)   // Soviet HQ: no axis loss class
  assert.equal(hooks.hqKindOf(s, 'inf'), undefined)      // land unit
  assert.equal(hooks.isKesselHq(s, 'kessel'), true)
  assert.equal(hooks.isKesselHq(s, 'a-army'), false)
  assert.equal(hooks.retreatDestroyed(s, 'a-army'), true)
  assert.equal(hooks.retreatDestroyed(s, 'a-ags'), true)
  assert.equal(hooks.retreatDestroyed(s, 'a-corps'), false)
  assert.equal(hooks.retreatDestroyed(s, 's-army'), false)
  assert.equal(hooks.railOnly(s, 'a-army'), true)
  assert.equal(hooks.railOnly(s, 'a-ags'), true)
  assert.equal(hooks.railOnly(s, 'a-corps'), false)      // Corps has truck face
  assert.equal(hooks.railOnly(s, 's-army'), false)
  assert.deepEqual(hooks.hqRail(s, 'a-army'), { railRe: 1, waiveDetrainable: true })
  assert.deepEqual(hooks.hqRail(s, 'a-ags'), { railRe: 1, waiveDetrainable: false })  // must_be_city
  assert.equal(hooks.hqRail(s, 'a-corps'), undefined)
})

test('destroyOnRetreat routes a forced-retreat Army HQ through the shared loss entry', () => {
  const settled = campaignDestroyOnRetreat(lossBoard)(game().state, ['a-army'])
  assert.equal(settled.counters['a-army'].location.kind, 'dead-pile')
  assert.equal(settled.sovietVp, 1)
  const rec = settled.hqRecoveries.find((r) => r.id === 'a-army')
  assert.equal(rec?.kind, 'army')
  assert.equal(rec?.result, 'free-rebuild')
  // empty ids leaves state unchanged
  const s = game().state
  assert.equal(campaignDestroyOnRetreat(lossBoard)(s, []), s)
})