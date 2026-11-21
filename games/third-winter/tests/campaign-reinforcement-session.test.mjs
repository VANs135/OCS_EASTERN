import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRngState, rollDice } from '@ocs-eastern/series/rng'
import { reinforcementSteps } from '@ocs-eastern/series/reinforcement'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { prepareCampaignReinforcements } from '../src/import/campaign-reinforcements.ts'
import { scheduledCampaignReinforcements } from '../src/match/campaign-reinforcement-actions.ts'
import { openCampaignReinforcementSession, submitCampaignSession } from '../src/match/campaign-session.ts'
import { campaignMapInPlayArea } from '../src/ttw/campaign/play-area.ts'

const map = indexTtwCampaignMap({ items: [
  ...['D14.03', 'A1.01', 'A2.01', 'B4.03', 'B5.03'].map((hex_id) => ({ hex_id })),
  { hex_id: 'A3.00', seam_twin: 'C3.34', seam_primary: true },
  { hex_id: 'C3.34', seam_twin: 'A3.00', seam_primary: false },
] }, { items: [] })
const playable = campaignMapInPlayArea(map, { kind: 'hex-list', hexes: ['D14.3', 'A1.1', 'A2.1', 'A3.0', 'B4.3'] })
const definitions = {
  infantry: { key: 'land:axis', kind: 'land', source: { side: 'axis' } },
  other: { key: 'land:soviet', kind: 'land', source: { side: 'soviet' } },
  fighters: { key: 'aircraft:axis', kind: 'aircraft', source: { side: 'axis' } },
}
const aliases = new Map(Object.entries(definitions).map(([ref, value]) => [ref, [value]]))
const counter = (def, fields = {}) => ({ definition: definitions[def].key, kind: definitions[def].kind,
  side: definitions[def].source.side, location: { kind: 'available' }, ...fields })
const group = (channel, ref, more = {}) => ({ turn: 1, date: '1943-10-01', phase: 'reinforce', side: 'axis', channel,
  entries: [{ ref, note: null }], ...more })
const fixture = (groups, counters, bindings, sites = [], side = 'axis', opening = {}) => ({
  record: openCampaignReinforcementSession(1, side, counters, opening),
  context: { schedule: prepareCampaignReinforcements(groups, aliases, map, playable).schedule,
    bindings: new Map(Object.entries(bindings).map(([index, ids]) => [`campaign-reinforcement:${index}:1`, ids])),
    resolveHex: playable.resolveHex, arrivalSites: () => sites },
})
const order = (row, placements) => ({ type: 'execute-scheduled-reinforcement', orderId: `campaign-reinforcement:${row}:1`,
  ...(placements === undefined ? {} : { placements }) })
const at = (counterId, hex) => ({ counterId, hex })
const close = { type: 'complete-scheduled-reinforcements' }
const supply = { type: 'roll-campaign-supply' }
const command = (record, action) => ({ id: `campaign:${record.revision}`, expectedRevision: record.revision, action })
const submit = (record, context, action, side = 'axis') => submitCampaignSession(record, side, command(record, action), context).record

test('fixed arrivals, exact withdrawals and direct dead-pile placement close only the scheduled window', () => {
  const { record, context } = fixture([
    group('kherson d14.03', 'infantry'), group('withdraw', 'infantry'), group('add to dead pile', 'infantry'),
    group('withdraw', 'infantry', { turn: 2, date: '1943-10-05' }),
  ], { arrival: counter('infantry'), removed: counter('infantry', { location: { kind: 'map', hex: 'A1.1' }, currentRe: 2, internalStocks: 'low' }),
    reserve: counter('infantry') }, { 1: ['arrival'], 2: ['removed'], 3: ['reserve'], 4: ['arrival'] })
  assert.deepEqual(scheduledCampaignReinforcements(record.state, context).map(({ status }) => status), ['ready', 'ready', 'ready'])
  assert.throws(() => submit(record, context, close), /outstanding/)
  assert.throws(() => submit(record, context, order(1, [at('arrival', 'D14.03')]), 'soviet'), /active side/)
  assert.throws(() => submit(record, context, order(4)), /not due/)
  const placed = submit(record, context, order(1, [at('arrival', 'D14.03')]))
  assert.equal(placed.state.counters.arrival.location.hex, 'D14.3')
  assert.equal(record.state.counters.arrival.location.kind, 'available')
  assert.equal(submitCampaignSession(placed, 'axis', command(record, order(1, [at('arrival', 'D14.03')])), context).duplicate, true)
  assert.throws(() => submit(placed, context, order(1, [at('arrival', 'D14.03')])), /settled/)
  const removed = submit(placed, context, order(2))
  assert.equal(removed.state.counters.removed.location.kind, 'withdrawn')
  assert.equal(removed.state.counters.removed.internalStocks, undefined)
  assert.deepEqual(removed.state.withdrawalSupplyDebt, { axis: 4, soviet: 0 })
  const dead = submit(removed, context, order(3))
  assert.equal(dead.state.counters.reserve.location.kind, 'dead-pile')
  const closed = submit(dead, context, close)
  assert.equal(closed.state.cursor.phase, 'reinforcement')
  assert.equal(closed.state.step, 'supply')
  assert.throws(() => submit(closed, context, close), /must be open/)
})

test('HQ arrivals select legal sites from the current position and unify printed seam aliases', () => {
  const sites = [
    { kind: 'army-hq', hex: 'A1.1', side: 'axis', detrainable: false },
    { kind: 'army-group-hq', hex: 'C3.34', side: 'axis', detrainable: true },
    { kind: 'army-hq', hex: 'B4.3', side: 'axis', detrainable: true },
    { kind: 'army-hq', hex: 'B5.3', side: 'axis', detrainable: true },
    { kind: 'front-hq', hex: 'A2.1', side: 'soviet' },
  ]
  const { record, context } = fixture([group('any army or army group hq', 'infantry')], {
    ready: counter('infantry'), enemy: counter('other', { location: { kind: 'map', hex: 'B4.03' } }),
  }, { 1: ['ready'] }, sites)
  assert.deepEqual([...scheduledCampaignReinforcements(record.state, context)[0].capacity.keys()], ['A3.0'])
  for (const hex of ['A1.1', 'B4.3', 'B5.03', 'A2.1']) {
    assert.throws(() => submit(record, context, order(1, [at('ready', hex)])), /Illegal campaign arrival hex/)
  }
  const placed = submit(record, context, order(1, [at('ready', 'C3.34')]))
  assert.equal(placed.state.counters.ready.location.hex, 'A3.0')

  const soviet = fixture([group('any front hq', 'other', { side: 'soviet' })], { ready: counter('other') }, { 1: ['ready'] }, sites, 'soviet')
  const arrived = submit(soviet.record, soviet.context, order(1, [at('ready', 'A2.01')]), 'soviet')
  assert.equal(arrived.state.counters.ready.location.hex, 'A2.1')
})

test('several aircraft can use different supplied bases but may not overfill one base', () => {
  const present = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`existing${i}`, counter('fighters', {
    active: true, location: { kind: 'map', hex: 'A1.01' },
  })]))
  const { record, context } = fixture([group('any airbase', 'fighters')], { ...present,
    one: counter('fighters'), two: counter('fighters') }, { 1: ['one', 'two'] }, [
    { kind: 'airbase', side: 'axis', hex: 'A1.1', inTrace: true, level: 1 },
    { kind: 'airbase', side: 'axis', hex: 'A2.1', inTrace: true, level: 1 },
    { kind: 'airbase', side: 'axis', hex: 'D14.3', inTrace: false, level: 3 },
    { kind: 'airbase', side: 'soviet', hex: 'B4.3', inTrace: true, level: 3 },
  ])
  const result = scheduledCampaignReinforcements(record.state, context)[0]
  assert.deepEqual([...result.capacity], [['A1.1', 1], ['A2.1', 5]])
  assert.throws(() => submit(record, context, order(1, [at('one', 'A1.1'), at('two', 'A1.01')])), /active aircraft capacity/)
  assert.throws(() => submit(record, context, order(1, [at('one', 'A1.1'), at('one', 'A2.1')])), /exactly the counters/)
  const placed = submit(record, context, order(1, [at('one', 'A1.1'), at('two', 'A2.1')]))
  assert.equal(placed.state.counters.one.active, true)
  assert.equal(placed.state.counters.two.active, true)
  assert.equal(placed.state.counters.two.location.hex, 'A2.1')
  assert.equal(record.revision, 0)
  assert.equal(record.state.counters.two.location.kind, 'available')
})

test('pending, unbound, unsupported and blocked orders remain visible and cannot be bypassed', () => {
  const { record, context } = fixture([
    group('kherson d14.03', 'infantry'), group('add to dead pile', 'infantry'),
    group('rvgk 1 or 2', 'infantry'), group('variable', null), group('withdraw', 'infantry'),
  ], {
    available: counter('infantry'), enemy: counter('other', { location: { kind: 'map', hex: 'D14.03' } }),
    wrong: counter('other', { location: { kind: 'dead-pile' } }),
  }, { 1: ['available'], 5: ['wrong'] })
  const expected = ['no-destination', 'unbound', 'unsupported', 'data-pending', 'counter-unavailable']
  assert.deepEqual(scheduledCampaignReinforcements(record.state, context).map(({ status }) => status), expected)
  for (const [index, issue] of expected.entries()) assert.throws(() => submit(record, context, order(index + 1)), new RegExp(issue))
  assert.throws(() => submit(record, context, close), /outstanding/)
})

test('withdrawal applies even in the dead pile or an off-map box', () => {
  const { record, context } = fixture([group('withdraw', 'infantry')], {
    dead: counter('infantry', { location: { kind: 'dead-pile' } }),
    boxed: counter('infantry', { location: { kind: 'box', box: 'example' }, currentRe: 1, internalStocks: 'exhausted' }),
  }, { 1: ['dead', 'boxed'] })
  const next = submit(record, context, order(1))
  assert.equal(next.state.counters.dead.location.kind, 'withdrawn')
  assert.equal(next.state.counters.boxed.location.kind, 'withdrawn')
  assert.deepEqual(next.state.withdrawalSupplyDebt, { axis: 4, soviet: 0 })
})

test('the standard reinforcement sequence feeds one supply roll and withholds only the active side’s debt', () => {
  assert.deepEqual(reinforcementSteps, ['scheduled', 'supply', 'variable-replacements', 'rebuild-consolidate'])
  const rng = createRngState(19)
  const scenario = { scenarioId: '01-dnepr-battles', date: '1943-09-26' }
  const { record, context } = fixture([group('withdraw', 'infantry')], {
    departing: counter('infantry', { location: { kind: 'dead-pile' }, currentRe: 1, internalStocks: 'low' }),
  }, { 1: ['departing'] }, [], 'axis', { when: scenario, rng, withdrawalSupplyDebt: { axis: 2, soviet: 6 } })
  const expected = rollDice(rng, 2)
  const pools = [{ kind: 'axis-cities', tokens: 20 }, { kind: 'axis-hq', tokens: 16 }]
  const configured = { ...context, supplyTable: (state, value) => {
    assert.equal(state.when, scenario)
    assert.equal(value, expected.value.total)
    return pools
  } }
  assert.throws(() => submit(record, configured, supply), /not available/)
  const settled = submit(record, configured, order(1))
  const ready = submit(settled, configured, close)
  assert.equal(ready.state.step, 'supply')
  assert.throws(() => submit(ready, configured, supply, 'soviet'), /active side/)
  assert.throws(() => submit(ready, context, supply), /not configured/)
  assert.throws(() => submit(ready, { ...context, supplyTable: () => [pools[1]] }, supply), /Invalid campaign supply pools/)
  assert.deepEqual(ready.state.rng, rng)
  const result = submit(ready, configured, supply)
  assert.deepEqual(result.state.rng, expected.rng)
  assert.deepEqual(result.state.supplyAward, { status: 'awaiting-placement', dice: expected.value,
    pools, grossTokens: 36, withheldTokens: 4, tokensToPlace: 32 })
  assert.deepEqual(result.state.withdrawalSupplyDebt, { axis: 0, soviet: 6 })
  assert.equal(result.state.step, 'supply')
  assert.equal(submitCampaignSession(result, 'axis', command(ready, supply), configured).duplicate, true)
  assert.throws(() => submit(result, configured, supply), /not available/)
})

test('an insufficient award keeps the dice and debit pending for an explicit resolution', () => {
  const { record, context } = fixture([], {}, {}, [], 'soviet', { withdrawalSupplyDebt: { axis: 0, soviet: 12 } })
  const configured = { ...context, supplyTable: () => [{ kind: 'soviet-supply', tokens: 8 }] }
  const ready = submit(record, configured, close, 'soviet')
  const after = submit(ready, configured, supply, 'soviet')
  assert.equal(after.state.supplyAward.status, 'deduction-pending')
  assert.equal(after.state.supplyAward.requiredTokens, 12)
  assert.equal(after.state.withdrawalSupplyDebt.soviet, 12)
  assert.equal(after.state.supplyAward.grossTokens, 8)
  assert.equal(after.state.step, 'supply')
  assert.throws(() => submit(after, configured, supply, 'soviet'), /not available/)
})

test('scenario 02 skips only the normal tables on January 26 for both sides', () => {
  for (const side of ['axis', 'soviet']) {
    const { record, context } = fixture([], {}, {}, [], side, { when: { scenarioId: '02-gotterdammerung', date: '1944-01-26' },
      withdrawalSupplyDebt: { axis: 4, soviet: 2 } })
    const after = submit(record, context, close, side).state
    assert.equal(after.step, 'rebuild-consolidate')
    assert.equal(after.supplyAward, undefined)
    assert.deepEqual(after.rng, record.state.rng)
    assert.deepEqual(after.withdrawalSupplyDebt, record.state.withdrawalSupplyDebt)
  }
  for (const when of [{ scenarioId: '02-gotterdammerung', date: '1944-02-01' }, { scenarioId: '01-dnepr-battles', date: '1944-01-26' }]) {
    const { record, context } = fixture([], {}, {}, [], 'axis', { when })
    assert.equal(submit(record, context, close).state.step, 'supply')
  }
})
