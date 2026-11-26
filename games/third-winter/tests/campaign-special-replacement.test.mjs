import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openCampaignReinforcementSession, submitCampaignSession } from '../src/match/campaign-session.ts'
import { campaignSpecialReplacementOptions } from '../src/match/campaign-special-replacement.ts'

const profile = (more = {}) => ({ printedSteps: 4, rebuildable: true, isBreakdown: false, isAircraft: false, nation: 'Ge', ar: 2, isGermanTiger: false, isAlert: false, ...more })
const counter = (side, more = {}) => ({ definition: 'x', kind: 'land', side, location: { kind: 'dead-pile' }, ...more })
const command = (record, action) => ({ id: `campaign:${record.revision}`, expectedRevision: record.revision, action })
const submit = (record, context, action, side = 'axis') => submitCampaignSession(record, side, command(record, action), context).record
const apply = (index, counterId, destination) => ({ type: 'apply-campaign-special-replacement', index, counterId, destination })
const at = (kind, key) => ({ kind, key })

function session(counters, { results = ['flak'], side = 'axis', profiles = {}, dests = {}, categories = {} } = {}) {
  const base = openCampaignReinforcementSession(1, side, counters, {})
  const record = { ...base, state: { ...base.state, segment: 'rebuild-consolidate', specialReplacements: [...results] } }
  const board = {
    profileOf: (_state, id) => profiles[id],
    destinations: (_state, actor, id) => dests[id] ?? [{ kind: actor === 'soviet' ? 'rvgk' : 'axis-hq', key: actor === 'soviet' ? 'RVGK-1' : 'A1.1' }],
    costOf: () => undefined,
    specialCategoryOf: (_state, id) => categories[id],
  }
  const context = { schedule: {}, bindings: new Map(), resolveHex: (hex) => hex, arrivalSites: () => [], rebuild: board }
  return { record, context }
}

test('a Flak SR result rebuilds a matching dead-pile counter for free and is consumed', () => {
  const { record, context } = session({ u: counter('axis') }, { profiles: { u: profile() }, categories: { u: 'flak' } })
  const next = submit(record, context, apply(0, 'u', at('axis-hq', 'A1.1')))
  assert.deepEqual(next.state.counters.u.location, { kind: 'map', hex: 'A1.1' })
  assert.equal(next.state.counters.u.currentRe, 4)
  assert.equal(next.state.counters.u.mode, 'combat')
  assert.deepEqual(next.state.specialReplacements, [])
  assert.equal(next.state.replacementSpent, undefined)
  assert.deepEqual(next.state.lastSpecialRebuild, { index: 0, category: 'flak', counterId: 'u', destination: { kind: 'axis-hq', key: 'A1.1' }, stepsAfter: 4 })
  assert.throws(() => submit(next, context, apply(0, 'u', at('axis-hq', 'A1.1'))), /invalid-result-index/)
})

test('the counter must match the rolled category and be a rebuildable dead-pile unit', () => {
  const mismatch = session({ u: counter('axis') }, { results: ['flak'], profiles: { u: profile() }, categories: { u: 'aa' } })
  assert.throws(() => submit(mismatch.record, mismatch.context, apply(0, 'u', at('axis-hq', 'A1.1'))), /counter-does-not-match-category/)
  const onMap = session({ u: counter('axis', { location: { kind: 'map', hex: 'B4.3' }, currentRe: 1, stepsLost: 3 }) }, { profiles: { u: profile() }, categories: { u: 'flak' } })
  assert.throws(() => submit(onMap.record, onMap.context, apply(0, 'u', at('axis-hq', 'A1.1'))), /rebuilds-from-dead-pile/)
  const noRebuild = session({ u: counter('axis') }, { profiles: { u: profile({ rebuildable: false }) }, categories: { u: 'flak' } })
  assert.throws(() => submit(noRebuild.record, noRebuild.context, apply(0, 'u', at('axis-hq', 'A1.1'))), /unit-not-rebuildable/)
})

test('Hedgehog and Alert await their own modules; an invalid index is rejected', () => {
  const hh = session({ u: counter('axis') }, { results: ['hedgehog'], profiles: { u: profile() }, categories: { u: 'hedgehog' } })
  assert.throws(() => submit(hh.record, hh.context, apply(0, 'u', at('axis-hq', 'A1.1'))), /hedgehog-awaits-its-own-module/)
  const alert = session({ u: counter('axis') }, { results: ['alert'], profiles: { u: profile() }, categories: { u: 'alert' } })
  assert.throws(() => submit(alert.record, alert.context, apply(0, 'u', at('axis-hq', 'A1.1'))), /alert-awaits-its-own-module/)
  const { record, context } = session({ u: counter('axis') }, { profiles: { u: profile() }, categories: { u: 'flak' } })
  assert.throws(() => submit(record, context, apply(3, 'u', at('axis-hq', 'A1.1'))), /invalid-result-index/)
})

test('a compound Axis result consumes only the chosen entry and illegal destinations are rejected', () => {
  const { record, context } = session({ tiger: counter('axis'), arty: counter('axis') }, { results: ['artillery', 'tiger'],
    profiles: { tiger: profile({ isGermanTiger: true }), arty: profile() }, categories: { tiger: 'tiger', arty: 'artillery' } })
  const next = submit(record, context, apply(1, 'tiger', at('axis-hq', 'A1.1')))
  assert.deepEqual(next.state.specialReplacements, ['artillery'])
  assert.equal(next.state.counters.tiger.currentRe, 4)
  assert.equal(next.state.counters.arty.location.kind, 'dead-pile')
  const wrongKind = session({ u: counter('soviet') }, { side: 'soviet', results: ['hq'], profiles: { u: profile({ nation: 'Ru' }) }, categories: { u: 'hq' } })
  assert.throws(() => submit(wrongKind.record, wrongKind.context, apply(0, 'u', at('axis-hq', 'A1.1')), 'soviet'), /illegal-destination-kind/)
  const wrongKey = session({ u: counter('axis') }, { profiles: { u: profile() }, categories: { u: 'flak' } })
  assert.throws(() => submit(wrongKey.record, wrongKey.context, apply(0, 'u', at('axis-hq', 'Z9.9'))), /illegal-destination/)
})

test('Soviet SR rebuilds into RVGK and the options projection lists supported results and candidates', () => {
  const soviet = session({ u: counter('soviet') }, { side: 'soviet', results: ['hq'], profiles: { u: profile({ nation: 'Ru' }) },
    dests: { u: [{ kind: 'rvgk', key: 'RVGK-1' }, { kind: 'rvgk', key: 'RVGK-2' }] }, categories: { u: 'hq' } })
  const boxed = submit(soviet.record, soviet.context, apply(0, 'u', at('rvgk', 'RVGK-2')), 'soviet')
  assert.deepEqual(boxed.state.counters.u.location, { kind: 'box', box: 'RVGK-2' })
  const { record, context } = session({ u: counter('axis'), hh: counter('axis') }, { results: ['flak', 'hedgehog'],
    profiles: { u: profile(), hh: profile() }, categories: { u: 'flak', hh: 'hedgehog' } })
  const options = campaignSpecialReplacementOptions(record.state, 'axis', context)
  assert.equal(options.configured, true)
  assert.deepEqual(options.results, [{ index: 0, category: 'flak', supported: true }, { index: 1, category: 'hedgehog', supported: false }])
  assert.deepEqual(options.candidates.map(({ counterId, category }) => [counterId, category]), [['u', 'flak']])
  assert.equal(campaignSpecialReplacementOptions(record.state, 'soviet', context), null)
})