import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openCampaignMatch } from '../src/match/campaign-match.ts'
import { applyCampaignReinforcementPhase } from '../src/match/campaign-reinforcement-phase.ts'
import { emptyCampaignReplacementHoldings } from '../src/match/campaign-reinforcement-state.ts'
import { openCampaignReinforcementSession, submitCampaignSession } from '../src/match/campaign-session.ts'
import { campaignRebuildOptions } from '../src/match/campaign-rebuild.ts'

const award = (more = {}) => ({ pax: 2, air: 1, eq: [4, 5], ally: 1, special: false, ...more })
const profile = (more = {}) => ({ printedSteps: 4, rebuildable: true, isBreakdown: false, isAircraft: false, nation: 'Ge', ar: 2, isGermanTiger: false, isAlert: false, ...more })
const counter = (side, more = {}) => ({ definition: 'x', kind: 'land', side, location: { kind: 'dead-pile' }, ...more })
const command = (record, action) => ({ id: `campaign:${record.revision}`, expectedRevision: record.revision, action })
const submit = (record, context, action, side = 'axis') => submitCampaignSession(record, side, command(record, action), context).record
const rebuild = (counterId, point, more = {}) => ({ type: 'rebuild-campaign-unit', counterId, point, ...more })
const at = (kind, key) => ({ destination: { kind, key } })

function session(counters, { award: a = award(), holdings, side = 'axis', profiles = {}, dests = {}, costs = {} } = {}) {
  const base = openCampaignReinforcementSession(1, side, counters, { replacementHoldings: holdings })
  const record = { ...base, state: { ...base.state, segment: 'rebuild-consolidate', replacementAward: a } }
  const board = {
    profileOf: (_state, id) => profiles[id],
    destinations: (_state, actor, id) => dests[id] ?? [{ kind: actor === 'soviet' ? 'rvgk' : 'axis-hq', key: actor === 'soviet' ? 'RVGK-1' : 'A1.1' }],
    costOf: (_state, id, point) => costs[id]?.[point],
  }
  const context = { schedule: {}, bindings: new Map(), resolveHex: (hex) => hex, arrivalSites: () => [], rebuild: board }
  return { record, context }
}

test('a Pax rebuild returns a dead-pile counter fresh at an Axis HQ and records the spend', () => {
  const { record, context } = session({ u: counter('axis') }, { profiles: { u: profile() }, costs: { u: { pax: { pax: 1 } } } })
  assert.throws(() => submit(record, context, rebuild('u', 'pax')), /requires-a-destination/)
  const next = submit(record, context, rebuild('u', 'pax', at('axis-hq', 'A1.1')))
  assert.deepEqual(next.state.counters.u.location, { kind: 'map', hex: 'A1.1' })
  assert.equal(next.state.counters.u.currentRe, 4)
  assert.equal(next.state.counters.u.stepsLost, 0)
  assert.equal(next.state.counters.u.mode, 'combat')
  assert.equal(next.state.counters.u.disorganized, false)
  assert.deepEqual(next.state.replacementSpent, { pax: 1, air: 0, eq: [], ally: 0 })
  assert.deepEqual(next.state.lastRebuild, { counterId: 'u', point: 'pax', destination: { kind: 'axis-hq', key: 'A1.1' }, stepsBefore: 0, stepsAfter: 4, cost: { pax: 1 } })
  assert.equal(record.state.counters.u.location.kind, 'dead-pile')
})

test('Eq spends an awarded AR that covers the unit, never a German Tiger (TTW 1.7a)', () => {
  const ok = session({ u: counter('axis') }, { profiles: { u: profile({ ar: 3 }) }, costs: { u: { eq: { eq: 1 } } } })
  const next = submit(ok.record, ok.context, rebuild('u', 'eq', { eqAr: 4, ...at('axis-hq', 'A1.1') }))
  assert.deepEqual(next.state.replacementSpent.eq, [4])
  assert.throws(() => submit(ok.record, ok.context, rebuild('u', 'eq', { eqAr: 2, ...at('axis-hq', 'A1.1') })), /unit-ar-exceeds-awarded-eq-ar/)
  assert.throws(() => submit(ok.record, ok.context, rebuild('u', 'eq', { eqAr: 3, ...at('axis-hq', 'A1.1') })), /insufficient-eq-points/)
  const tiger = session({ u: counter('axis') }, { profiles: { u: profile({ isGermanTiger: true }) }, costs: { u: { eq: { eq: 1 } } } })
  assert.throws(() => submit(tiger.record, tiger.context, rebuild('u', 'eq', { eqAr: 5, ...at('axis-hq', 'A1.1') })), /eq-cannot-rebuild-german-tiger/)
})

test('Ally rebuilds only Rumanian or Hungarian units and Air rebuilds aircraft only (TTW 1.7a)', () => {
  const rum = session({ u: counter('axis') }, { profiles: { u: profile({ nation: 'Rum' }) }, costs: { u: { ally: { ally: 1 } } } })
  assert.equal(submit(rum.record, rum.context, rebuild('u', 'ally', at('axis-hq', 'A1.1'))).state.counters.u.currentRe, 4)
  const ge = session({ u: counter('axis') }, { profiles: { u: profile({ nation: 'Ge' }) }, costs: { u: { ally: { ally: 1 } } } })
  assert.throws(() => submit(ge.record, ge.context, rebuild('u', 'ally', at('axis-hq', 'A1.1'))), /ally-rebuilds-rumanian-or-hungarian-only/)
  const air = session({ u: counter('axis', { kind: 'aircraft' }) }, { profiles: { u: profile({ isAircraft: true }) }, dests: { u: [{ kind: 'airbase', key: 'A2.1' }] }, costs: { u: { air: { air: 1 } } } })
  const flown = submit(air.record, air.context, rebuild('u', 'air', at('airbase', 'A2.1')))
  assert.equal(flown.state.counters.u.active, true)
  assert.deepEqual(flown.state.counters.u.location, { kind: 'map', hex: 'A2.1' })
  const ground = session({ u: counter('axis') }, { profiles: { u: profile() }, costs: { u: { air: { air: 1 } } } })
  assert.throws(() => submit(ground.record, ground.context, rebuild('u', 'air', at('airbase', 'A2.1'))), /air-rebuilds-aircraft-only/)
})

test('a reduced counter restores steps in place and rejects a destination or an unaffordable cost', () => {
  const reduced = { u: counter('axis', { location: { kind: 'map', hex: 'B4.3' }, currentRe: 1, stepsLost: 3 }) }
  const { record, context } = session(reduced, { profiles: { u: profile() }, costs: { u: { pax: { pax: 1 } } } })
  assert.throws(() => submit(record, context, rebuild('u', 'pax', at('axis-hq', 'A1.1'))), /restores-in-place/)
  const next = submit(record, context, rebuild('u', 'pax', { stepsToRestore: 2 }))
  assert.deepEqual(next.state.counters.u.location, { kind: 'map', hex: 'B4.3' })
  assert.equal(next.state.counters.u.currentRe, 3)
  assert.equal(next.state.counters.u.stepsLost, 1)
  assert.equal(next.state.lastRebuild.destination, undefined)
  const poor = session({ u: counter('axis') }, { award: award({ pax: 0 }), profiles: { u: profile() }, costs: { u: { pax: { pax: 1 } } } })
  assert.throws(() => submit(poor.record, poor.context, rebuild('u', 'pax', at('axis-hq', 'A1.1'))), /insufficient-replacement-points/)
  const uncosted = session({ u: counter('axis') }, { profiles: { u: profile() }, costs: {} })
  assert.throws(() => submit(uncosted.record, uncosted.context, rebuild('u', 'pax', at('axis-hq', 'A1.1'))), /rebuild-cost-unavailable/)
})

test('Soviet ground rebuilds into an RVGK box, an Alert Axis unit may use a Kessel HQ, and illegal sites are rejected', () => {
  const soviet = session({ u: counter('soviet') }, { side: 'soviet', profiles: { u: profile({ nation: 'Ru' }) }, dests: { u: [{ kind: 'rvgk', key: 'RVGK-1' }, { kind: 'rvgk', key: 'RVGK-2' }] }, costs: { u: { pax: { pax: 1 } } } })
  const boxed = submit(soviet.record, soviet.context, rebuild('u', 'pax', at('rvgk', 'RVGK-2')), 'soviet')
  assert.deepEqual(boxed.state.counters.u.location, { kind: 'box', box: 'RVGK-2' })
  assert.throws(() => submit(soviet.record, soviet.context, rebuild('u', 'pax', at('axis-hq', 'A1.1')), 'soviet'), /illegal-destination-kind/)
  const alert = session({ u: counter('axis') }, { profiles: { u: profile({ isAlert: true }) }, dests: { u: [{ kind: 'kessel-hq', key: 'C3.34' }] }, costs: { u: { pax: { pax: 1 } } } })
  assert.equal(submit(alert.record, alert.context, rebuild('u', 'pax', at('kessel-hq', 'C3.34'))).state.counters.u.location.hex, 'C3.34')
  const wrongKey = session({ u: counter('axis') }, { profiles: { u: profile() }, costs: { u: { pax: { pax: 1 } } } })
  assert.throws(() => submit(wrongKey.record, wrongKey.context, rebuild('u', 'pax', at('axis-hq', 'Z9.9'))), /illegal-destination/)
})

test('banked holdings add to this phase award and the options projection lists eligible counters', () => {
  const holdings = { axis: { pax: 2, ally: 0 }, soviet: { pax: 0, ally: 0 } }
  const { record, context } = session({ u: counter('axis'), full: counter('axis', { location: { kind: 'map', hex: 'B4.3' }, currentRe: 4, stepsLost: 0 }) },
    { award: award({ pax: 1 }), holdings, profiles: { u: profile(), full: profile() }, costs: { u: { pax: { pax: 3 } } } })
  const options = campaignRebuildOptions(record.state, 'axis', context)
  assert.equal(options.configured, true)
  assert.deepEqual(options.available, { pax: 3, ally: 1, air: 1, eq: [4, 5] })
  assert.deepEqual(options.candidates.map(({ counterId }) => counterId), ['u'])
  assert.deepEqual(options.rejected, [{ counterId: 'full', reason: 'unit-not-reduced' }])
  const next = submit(record, context, rebuild('u', 'pax', at('axis-hq', 'A1.1')))
  assert.deepEqual(next.state.replacementSpent, { pax: 3, air: 0, eq: [], ally: 0 })
  assert.equal(campaignRebuildOptions(record.state, 'soviet', context), null)
})

const turnState = (window, holdings, side = 'axis') => {
  const match = openCampaignMatch({ when: { scenarioId: '01-dnepr-battles', date: '1943-09-26' }, turn: 1, counters: {} }, 0)
  return { ...match.state, cursor: { phase: 'reinforcement', phasing: side, turn: 1 },
    reinforcement: { stage: 'ordinary', window }, replacementHoldings: holdings ?? emptyCampaignReplacementHoldings() }
}

test('closing the rebuild ring banks unspent Pax/Ally and drops Air/Eq/SR (TTW 1.7a)', () => {
  const window = { settledOrders: [], segment: 'rebuild-consolidate', rolls: [],
    replacementAward: { pax: 3, air: 2, eq: [4, 5], ally: 2, special: false }, replacementSpent: { pax: 1, air: 1, eq: [4], ally: 0 } }
  const holdings = { axis: { pax: 2, ally: 1 }, soviet: { pax: 0, ally: 0 } }
  const next = applyCampaignReinforcementPhase(turnState(window, holdings), 'axis', { type: 'complete-campaign-rebuilds' }, {})
  assert.deepEqual(next.replacementHoldings.axis, { pax: 4, ally: 3 })
  assert.deepEqual(next.replacementHoldings.soviet, { pax: 0, ally: 0 })
  assert.equal(next.reinforcement.stage, 'closing')
  assert.throws(() => applyCampaignReinforcementPhase(next, 'axis', { type: 'complete-campaign-rebuilds' }, {}), /not active/)
})

test('with no replacement roll the ring closes without changing banked holdings', () => {
  const window = { settledOrders: [], segment: 'rebuild-consolidate', rolls: [] }
  const holdings = { axis: { pax: 5, ally: 2 }, soviet: { pax: 0, ally: 0 } }
  const next = applyCampaignReinforcementPhase(turnState(window, holdings), 'axis', { type: 'complete-campaign-rebuilds' }, {})
  assert.deepEqual(next.replacementHoldings.axis, { pax: 5, ally: 2 })
})