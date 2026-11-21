import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRngState, rollDice } from '@ocs-eastern/series/rng'
import { reinforcementSegments } from '@ocs-eastern/series/reinforcement'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { prepareCampaignReinforcements } from '../src/import/campaign-reinforcements.ts'
import { scheduledCampaignReinforcements } from '../src/match/campaign-reinforcement-actions.ts'
import { openCampaignReinforcementSession, submitCampaignSession } from '../src/match/campaign-session.ts'
import { campaignReinforcementStep } from '../src/match/campaign-reinforcement-flow.ts'
import { campaignMapInPlayArea } from '../src/ttw/campaign/play-area.ts'
import { projectCampaignReinforcements } from '../src/view/campaign-reinforcement-view.ts'

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
  assert.equal(closed.state.segment, 'supply')
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
  assert.deepEqual(reinforcementSegments, ['scheduled', 'supply', 'variable-replacements', 'rebuild-consolidate'])
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
  assert.equal(ready.state.segment, 'supply')
  assert.throws(() => submit(ready, configured, supply, 'soviet'), /active side/)
  assert.throws(() => submit(ready, context, supply), /not configured/)
  assert.throws(() => submit(ready, { ...context, supplyTable: () => [pools[1]] }, supply), /Invalid campaign supply pools/)
  assert.deepEqual(ready.state.rng, rng)
  const result = submit(ready, configured, supply)
  assert.deepEqual(result.state.rng, expected.rng)
  assert.deepEqual(result.state.supplyAward, { status: 'awaiting-placement', dice: expected.value,
    pools, grossTokens: 36, withheldTokens: 4, tokensToPlace: 32 })
  assert.deepEqual(result.state.withdrawalSupplyDebt, { axis: 0, soviet: 6 })
  assert.equal(result.state.segment, 'supply')
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
  assert.equal(after.state.segment, 'supply')
  assert.throws(() => submit(after, configured, supply, 'soviet'), /not available/)
})

test('scenario 02 skips only the normal tables on January 26 for both sides', () => {
  for (const side of ['axis', 'soviet']) {
    const { record, context } = fixture([], {}, {}, [], side, { when: { scenarioId: '02-gotterdammerung', date: '1944-01-26' },
      withdrawalSupplyDebt: { axis: 4, soviet: 2 } })
    const after = submit(record, context, close, side).state
    assert.equal(after.segment, 'rebuild-consolidate')
    assert.equal(after.supplyAward, undefined)
    assert.deepEqual(after.rng, record.state.rng)
    assert.deepEqual(after.withdrawalSupplyDebt, record.state.withdrawalSupplyDebt)
  }
  for (const when of [{ scenarioId: '02-gotterdammerung', date: '1944-02-01' }, { scenarioId: '01-dnepr-battles', date: '1944-01-26' }]) {
    const { record, context } = fixture([], {}, {}, [], 'axis', { when })
    assert.equal(submit(record, context, close).state.segment, 'supply')
  }
})

const place = (placements) => ({ type: 'place-campaign-supply', placements })
const replacements = { type: 'roll-campaign-replacements' }
const special = { type: 'roll-campaign-special-replacement' }

test('the supply placement step pays mandatory sites, updates one side, and only then opens the replacement segment', () => {
  const { record, context } = fixture([], {}, {}, [], 'soviet', { supplyDumps: { axis: { 'A1.1': 7 }, soviet: { 'A3.0': 2 } } })
  const configured = { ...context, supplyTable: () => [{ kind: 'soviet-supply', tokens: 12 }],
    supplyPlacementPlan: () => [{ pool: 'soviet-supply', tokens: 12, sites: [
      { side: 'soviet', hex: 'A2.1', minTokens: 8, maxTokens: 12 },
      { side: 'soviet', hex: 'C3.34', maxTokens: 12 },
    ] }] }
  const ready = submit(record, configured, close, 'soviet')
  assert.equal(campaignReinforcementStep(ready.state), 'roll-supply')
  assert.throws(() => submit(ready, configured, place([]), 'soviet'), /placement is not available/)
  const rolled = submit(ready, configured, supply, 'soviet')
  assert.equal(campaignReinforcementStep(rolled.state), 'place-supply')
  assert.throws(() => submit(rolled, configured, replacements, 'soviet'), /replacement roll is not available/)
  const delivery = (hex, tokens) => ({ pool: 'soviet-supply', hex, tokens })
  assert.throws(() => submit(rolled, configured, place([delivery('C3.34', 12)]), 'soviet'), /mandatory site quota/)
  assert.throws(() => submit(rolled, configured, place([delivery('A2.1', 8), delivery('B5.3', 4)]), 'soviet'), /Illegal campaign supply/)
  assert.throws(() => submit(rolled, configured, place([delivery('A2.01', 8), delivery('A2.1', 5)]), 'soviet'), /site quota/)
  assert.throws(() => submit(rolled, configured, place([delivery('A2.01', 8)]), 'soviet'), /entire authorized/)
  const wrongSideSite = { ...configured, supplyPlacementPlan: () => [{ pool: 'soviet-supply', tokens: 12,
    sites: [{ side: 'axis', hex: 'A2.1', maxTokens: 12 }] }] }
  assert.throws(() => submit(rolled, wrongSideSite, place([delivery('A2.01', 12)]), 'soviet'), /Invalid campaign supply site/)
  assert.deepEqual(rolled.state.supplyDumps, record.state.supplyDumps)
  const issued = submit(rolled, configured, place([delivery('A2.01', 8), delivery('C3.34', 4)]), 'soviet')
  assert.deepEqual(issued.state.supplyDumps, { axis: { 'A1.1': 7 }, soviet: { 'A2.1': 8, 'A3.0': 6 } })
  assert.deepEqual(issued.state.rng, rolled.state.rng)
  assert.equal(issued.state.segment, 'variable-replacements')
  assert.equal(campaignReinforcementStep(issued.state), 'roll-replacements')
})

test('supply, main replacements and the Axis compound SR use fresh draws and one record per check', () => {
  const before = rollDice(createRngState(19), 1).rng
  const first = rollDice(before, 2)
  const second = rollDice(first.rng, 2)
  const draws = [first, second, rollDice(second.rng, 1)]
  const { record, context } = fixture([], {}, {}, [], 'axis', { rng: before, withdrawalSupplyDebt: { axis: 2, soviet: 0 } })
  const configured = { ...context, supplyTable: (_state, total) => {
    assert.equal(total, draws[0].value.total)
    return [{ kind: 'axis-cities', tokens: 8 }, { kind: 'axis-hq', tokens: 8 }]
  }, supplyPlacementPlan: () => [
    { pool: 'axis-cities', tokens: 8, sites: [{ side: 'axis', hex: 'A1.1', maxTokens: 8 }] },
    { pool: 'axis-hq', tokens: 6, sites: [{ side: 'axis', hex: 'A2.1', maxTokens: 6 }] },
  ], replacementTable: (_state, total) => {
    assert.equal(total, draws[1].value.total)
    return { pax: 2, air: 1, eq: [4], ally: 1, special: true }
  }, specialReplacementTable: (_state, face) => {
    assert.equal(face, draws[2].value.total)
    return ['hedgehog', 'alert']
  } }
  const rolled = submit(submit(record, configured, close), configured, supply)
  const placed = submit(rolled, configured, place([
    { pool: 'axis-cities', hex: 'A1.01', tokens: 8 }, { pool: 'axis-hq', hex: 'A2.01', tokens: 6 },
  ]))
  assert.throws(() => submit(placed, configured, special), /not available/)
  const main = submit(placed, configured, replacements)
  assert.equal(campaignReinforcementStep(main.state), 'roll-special-replacement')
  assert.throws(() => submit(main, configured, replacements), /not available/)
  assert.throws(() => submit(main, { ...configured, specialReplacementTable: () => ['hedgehog'] }, special), /Invalid.*award/)
  const resolved = submit(main, configured, special)
  assert.deepEqual(resolved.state.specialReplacements, ['hedgehog', 'alert'])
  assert.equal(resolved.state.segment, 'rebuild-consolidate')
  assert.deepEqual(resolved.state.rng, draws[2].rng)
  assert.deepEqual(resolved.state.rolls.map(({ check, dice, before, after }) => [check, dice, before, after]), [
    ['supply', draws[0].value, 1, 3], ['replacements', draws[1].value, 3, 5], ['special-replacement', draws[2].value, 5, 6],
  ])
  assert.deepEqual(resolved.state.rolls.map(({ side, turn, phase, segment, step }) => [side, turn, phase, segment, step]), [
    ['axis', 1, 'reinforcement', 'supply', 'roll-supply'],
    ['axis', 1, 'reinforcement', 'variable-replacements', 'roll-replacements'],
    ['axis', 1, 'reinforcement', 'variable-replacements', 'roll-special-replacement'],
  ])
  assert.equal(submitCampaignSession(resolved, 'axis', command(main, special), configured).duplicate, true)
  const opposingView = projectCampaignReinforcements(resolved, 'soviet', configured)
  assert.doesNotMatch(JSON.stringify(opposingView), /replacementAward|hedgehog|alert|withheldTokens/)
})

test('an SR no result opens rebuild directly and leaves the special table untouched', () => {
  const { record, context } = fixture([], {}, {}, [], 'soviet')
  const local = { ...context, supplyTable: () => [{ kind: 'soviet-supply', tokens: 0 }],
    supplyPlacementPlan: () => [{ pool: 'soviet-supply', tokens: 0, sites: [] }],
    replacementTable: () => ({ pax: 1, air: 0, eq: [], ally: 0, special: false }),
    specialReplacementTable: () => assert.fail('No SR lookup without a main-table award') }
  const afterSupply = [close, supply, place([])].reduce((before, action) => submit(before, local, action, 'soviet'), record)
  const result = submit(afterSupply, local, replacements, 'soviet')
  assert.equal(result.state.segment, 'rebuild-consolidate')
  assert.equal(result.state.rolls.length, 2)
  assert.throws(() => submit(result, local, special, 'soviet'), /not available/)
})

test('seat projection withholds the opposing schedule, private counters, awards, debt and dice state', () => {
  const { record, context } = fixture([group('kherson d14.03', 'infantry')], {
    axisSecret: counter('infantry'), sovietSecret: counter('other', { location: { kind: 'box', box: 'RVGK-private' } }),
  }, { 1: ['axisSecret'] }, [], 'axis', { supplyDumps: { axis: { 'A3.0': 85 }, soviet: { 'A2.1': 39 } },
    withdrawalSupplyDebt: { axis: 7, soviet: 4 } })
  const pendingAxis = projectCampaignReinforcements(record, 'axis', context)
  assert.equal(pendingAxis.active.step, 'settle-scheduled-orders')
  assert.deepEqual(pendingAxis.active.scheduled[0].counterIds, ['axisSecret'])
  assert.doesNotMatch(JSON.stringify(pendingAxis), /sovietSecret|RVGK-private/)
  const settled = submit(record, context, order(1, [at('axisSecret', 'D14.03')]))
  assert.equal(projectCampaignReinforcements(settled, 'axis', context).active.step, 'close-scheduled-orders')
  const ready = submit(settled, context, close)
  const supplier = { ...context, supplyTable: () => [{ kind: 'axis-cities', tokens: 8 }, { kind: 'axis-hq', tokens: 8 }] }
  const rolled = submit(ready, supplier, supply)
  const soviet = projectCampaignReinforcements(rolled, 'soviet', supplier)
  assert.equal(soviet.phase, 'reinforcement')
  assert.equal(soviet.segment, 'supply')
  assert.equal(soviet.active, null)
  assert.deepEqual(soviet.own.counters.map(({ id }) => id), ['sovietSecret'])
  assert.deepEqual(soviet.own.supplyDumps, { 'A2.1': 39 })
  assert.equal(soviet.own.withdrawalSupplyDebt, 4)
  assert.doesNotMatch(JSON.stringify(soviet), /withheldTokens|axisSecret|drawCount|rng|receipts|before/)
  const own = projectCampaignReinforcements(rolled, 'axis', supplier)
  assert.equal(own.active.step, 'place-supply')
  assert.equal(own.active.supply.withheldTokens, 7)
  assert.deepEqual(Object.keys(own.active.rolls[0]), ['check', 'dice'])
  own.active.rolls[0].dice.faces[0] = 99
  assert.notEqual(rolled.state.rolls[0].dice.faces[0], 99)
})
