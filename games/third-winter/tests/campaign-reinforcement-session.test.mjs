import assert from 'node:assert/strict'
import { test } from 'node:test'
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
const fixture = (groups, counters, bindings, sites = [], side = 'axis') => ({
  record: openCampaignReinforcementSession(1, side, counters),
  context: { schedule: prepareCampaignReinforcements(groups, aliases, map, playable).schedule,
    bindings: new Map(Object.entries(bindings).map(([index, ids]) => [`campaign-reinforcement:${index}:1`, ids])),
    resolveHex: playable.resolveHex, arrivalSites: () => sites },
})
const order = (row, placements) => ({ type: 'execute-scheduled-reinforcement', orderId: `campaign-reinforcement:${row}:1`,
  ...(placements === undefined ? {} : { placements }) })
const at = (counterId, hex) => ({ counterId, hex })
const close = { type: 'complete-scheduled-reinforcements' }
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
  assert.equal(closed.state.scheduledWindow, 'closed')
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
