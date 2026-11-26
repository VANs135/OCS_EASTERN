import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { newCampaignReinforcementWindow } from '../src/match/campaign-reinforcement-flow.ts'

const hexes = ['A1.1', 'A2.1', 'A3.1']
const resolveHex = (hex) => hexes.includes(hex) ? hex : undefined
const deadHq = (definition) => ({ kind: 'hq', side: 'axis', definition, location: { kind: 'dead-pile' }, currentRe: 0 })
const rec = (id, kind, result = 'free-rebuild', more = {}) => ({ id, definition: `hq-${kind}`, kind, result, turn: 2, availableTurn: 3, ...more })

function start(counters, recoveries, { turn = 3, segment = 'rebuild-consolidate', stage = 'ordinary', phasing = 'axis', dests = {}, steps = {} } = {}) {
  const opened = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn, counters, supplyDumps: { axis: {}, soviet: {} } }, 623)
  const record = { ...opened, state: { ...opened.state, cursor: { phase: 'reinforcement', phasing, first: 'axis' },
    reinforcement: { stage, window: { ...newCampaignReinforcementWindow(), segment } }, hqRecoveries: recoveries } }
  const context = { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex, arrivalSites: () => [] },
    hqRecovery: { resolveHex, destinations: (_state, recovery) => dests[recovery.kind] ?? [],
      printedStepsOf: (_state, id) => steps[id] ?? 1 } }
  return { record, context }
}
const command = (record, action) => ({ id: `hq:${record.revision}`, expectedRevision: record.revision, action })
const submit = (record, context, action, side = 'axis') => submitCampaignMatch(record, side, command(record, action), context).record
const place = (recoveryId, hex) => ({ type: 'place-campaign-hq-recovery', recoveryId, hex })

test('a destroyed Army HQ free-rebuilds at any Army HQ hex in the Axis rebuild window (TTW 2.3b E)', () => {
  const { record, context } = start({ armyHq: deadHq('hq-army'), anchor: { kind: 'hq', side: 'axis', definition: 'hq-army', location: { kind: 'map', hex: 'A1.1' }, currentRe: 1 } },
    [rec('armyHq', 'army')], { dests: { army: ['A1.1'] } })
  const next = submit(record, context, place('armyHq', 'A1.1'))
  assert.deepEqual(next.state.counters.armyHq.location, { kind: 'map', hex: 'A1.1' })
  assert.equal(next.state.counters.armyHq.currentRe, 1)
  assert.equal(next.state.counters.armyHq.stepsLost, 0)
  assert.equal(next.state.counters.armyHq.mode, 'combat')
  assert.equal(next.state.counters.armyHq.disorganized, false)
  assert.deepEqual(next.state.hqRecoveries, [])
  assert.deepEqual(next.state.counters.anchor.location, { kind: 'map', hex: 'A1.1' })
})

test('Army Group HQ rebuilds at a friendly city and Corps at an Army/Group HQ hex; illegal hexes rejected (TTW 2.3c G/d)', () => {
  const group = start({ g: deadHq('hq-group') }, [rec('g', 'army-group')], { dests: { 'army-group': ['A2.1'] }, steps: { g: 2 } })
  const placed = submit(group.record, group.context, place('g', 'A2.1'))
  assert.deepEqual(placed.state.counters.g.location, { kind: 'map', hex: 'A2.1' })
  assert.equal(placed.state.counters.g.currentRe, 2)
  assert.throws(() => submit(group.record, group.context, place('g', 'A3.1')), /illegal-destination/)
  const corps = start({ c: deadHq('hq-corps') }, [rec('c', 'corps', 'free-rebuild', { die: 2 })], { dests: { corps: ['A1.1'] } })
  assert.deepEqual(submit(corps.record, corps.context, place('c', 'A1.1')).state.counters.c.location, { kind: 'map', hex: 'A1.1' })
})

test('a Corps rolled 4-6 stays in the dead pile and is not free-rebuildable (TTW 2.3d)', () => {
  const { record, context } = start({ c: deadHq('hq-corps') }, [rec('c', 'corps', 'dead-pile', { die: 5 })], { dests: { corps: ['A1.1'] } })
  assert.throws(() => submit(record, context, place('c', 'A1.1')), /No free HQ rebuild/)
  assert.deepEqual(record.state.counters.c.location, { kind: 'dead-pile' })
})

test('free rebuild is due only from the next Axis reinforcement phase (TTW 2.3b-d)', () => {
  const early = start({ a: deadHq('hq-army') }, [rec('a', 'army', 'free-rebuild', { availableTurn: 4 })], { turn: 3, dests: { army: ['A1.1'] } })
  assert.throws(() => submit(early.record, early.context, place('a', 'A1.1')), /not due until the next Axis reinforcement/)
  const due = start({ a: deadHq('hq-army') }, [rec('a', 'army', 'free-rebuild', { availableTurn: 3 })], { turn: 3, dests: { army: ['A1.1'] } })
  assert.deepEqual(submit(due.record, due.context, place('a', 'A1.1')).state.counters.a.location, { kind: 'map', hex: 'A1.1' })
})

test('the window, side and dead-pile preconditions are enforced and a rejection changes nothing', () => {
  const counters = { a: deadHq('hq-army') }
  const recoveries = [rec('a', 'army')]
  const opts = { dests: { army: ['A1.1'] } }
  const wrongSegment = start(counters, recoveries, { ...opts, segment: 'supply' })
  assert.throws(() => submit(wrongSegment.record, wrongSegment.context, place('a', 'A1.1')), /Axis rebuild and consolidation window/)
  const opening = start(counters, recoveries, { ...opts, stage: 'opening' })
  assert.throws(() => submit(opening.record, opening.context, place('a', 'A1.1')), /Axis rebuild and consolidation window/)
  const soviet = start(counters, recoveries, { ...opts, phasing: 'soviet' })
  assert.throws(() => submit(soviet.record, soviet.context, place('a', 'A1.1')), /not open for this side/)
  const onMap = start({ a: { kind: 'hq', side: 'axis', definition: 'hq-army', location: { kind: 'map', hex: 'A2.1' }, currentRe: 1 } }, recoveries, opts)
  assert.throws(() => submit(onMap.record, onMap.context, place('a', 'A1.1')), /dead pile/)
  const before = wrongSegment.record.revision
  assert.throws(() => submit(wrongSegment.record, wrongSegment.context, place('a', 'A1.1')), /window/)
  assert.equal(wrongSegment.record.revision, before)
})