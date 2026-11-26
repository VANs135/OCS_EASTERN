import assert from 'node:assert/strict'
import test from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'

const map = { resolveHex: (h) => h }
const kindOf = (counter) => (/truck/i.test(counter.definition) ? 'truck' : 'wagon')
const counter = (patch = {}) => ({ definition: 'Axis Truck 5/45', kind: 'transport', side: 'axis',
  location: { kind: 'map', hex: '10' }, transportPoints: 5, transportCargoTokens: 0, ...patch })

const board = (patch = {}) => ({ map,
  transports: (state, side, hex) => Object.entries(state.counters)
    .filter(([, unit]) => unit.side === side && unit.kind === 'transport' && unit.location.kind === 'map' && unit.location.hex === hex)
    .map(([id, unit]) => ({ id, kind: kindOf(unit), points: unit.transportPoints ?? 0,
      loaded: (unit.transportCargoTokens ?? 0) > 0 })),
  placeTransport: (state, side, facts) => ({ ...state, counters: { ...state.counters,
    [`tp:${facts.kind}:${facts.points}:${Math.random().toString(36).slice(2, 7)}`]: { definition: `Axis ${facts.kind === 'truck' ? 'Truck' : 'Wagon'} ${facts.points}`,
      kind: 'transport', side, location: { kind: 'map', hex: facts.hex }, transportPoints: facts.points,
      transportCargoTokens: 0 } } }),
  ...patch })

function game(counters = {}, patch = {}) {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 6, counters }, 500)
  record.state.cursor = { phase: 'movement', phasing: 'axis', first: 'axis' }
  record.state.movementSegment = 'movement'
  Object.assign(record.state, patch)
  return record
}
let seq = 0
const submit = (record, action, b = board(), side = 'axis') => submitCampaignMatch(record, side,
  { id: `extender-${seq++}`, expectedRevision: record.revision, action }, {
    reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: (h) => h, arrivalSites: () => [] },
    extenderWork: b }).record

test('five convertible truck points flip into one 20MP extender (OCS 12.7a)', () => {
  const a = game({ A: counter() })
  const converted = submit(a, { type: 'convert-campaign-extender', hex: '10', kind: 'truck', count: 1 })
  assert.equal(converted.state.counters.A, undefined)
  assert.deepEqual(converted.state.extenders, [{ id: 'extender:truck:1', side: 'axis', hex: '10', kind: 'truck', range: 20 }])
  assert.equal(converted.state.extenderSerial, 2)
  // four points are not enough
  assert.throws(() => submit(game({ A: counter({ transportPoints: 4 }) }),
    { type: 'convert-campaign-extender', hex: '10', kind: 'truck', count: 1 }), /insufficient-points/)
  // mixed kinds do not pool
  assert.throws(() => submit(game({ A: counter({ transportPoints: 3 }), B: counter({ definition: 'Axis Wagon 3/10', transportPoints: 3 }) }),
    { type: 'convert-campaign-extender', hex: '10', kind: 'truck', count: 1 }), /insufficient-points/)
})

test('the leftover points land back on the map and each counter pays half its own MA (OCS 12.7a/e)', () => {
  const converted = submit(game({ A: counter({ transportPoints: 3 }), B: counter({ transportPoints: 3 }) }),
    { type: 'convert-campaign-extender', hex: '10', kind: 'truck', count: 1 })
  assert.equal(converted.state.counters.A, undefined)
  assert.equal(converted.state.counters.B, undefined)
  const leftover = Object.values(converted.state.counters)[0]
  assert.equal(leftover.transportPoints, 1)
  assert.equal(leftover.location.hex, '10')
  // without a placement hook the leftover cannot be represented
  const noHook = board({ placeTransport: undefined })
  assert.throws(() => submit(game({ A: counter({ transportPoints: 3 }), B: counter({ transportPoints: 3 }) }),
    { type: 'convert-campaign-extender', hex: '10', kind: 'truck', count: 1 }, noHook), /cannot be placed/)
})

test('conversion is limited to movement, reaction and exploitation (OCS 12.7a)', () => {
  const supply = game({ A: counter() })
  supply.state.cursor = { phase: 'supply', phasing: 'axis', first: 'axis' }
  assert.throws(() => submit(supply, { type: 'convert-campaign-extender', hex: '10', kind: 'truck', count: 1 }),
    /movement, reaction or exploitation/)
  // the non-phasing side may only do it in its own reaction segment
  assert.throws(() => submit(game({ A: counter() }), { type: 'convert-campaign-extender', hex: '10', kind: 'truck', count: 1 },
    board(), 'soviet'), /movement, reaction or exploitation/)
  const reaction = game({ A: counter({ side: 'soviet' }) })
  reaction.state.cursor = { phase: 'reaction', phasing: 'axis', first: 'axis' }
  const converted = submit(reaction, { type: 'convert-campaign-extender', hex: '10', kind: 'truck', count: 1 }, board(), 'soviet')
  assert.equal(converted.state.extenders[0].side, 'soviet')
})

test('loaded points must unload first and moved counters leave the moved list (OCS 12.7d)', () => {
  assert.throws(() => submit(game({ A: counter({ transportPoints: 3 }), B: counter({ transportPoints: 3, transportCargoTokens: 4 }) }),
    { type: 'convert-campaign-extender', hex: '10', kind: 'truck', count: 1 }), /loaded-must-unload/)
  const converted = submit(game({ A: counter() }, { groundMovement: { moved: ['A'], zocLocks: [] } }),
    { type: 'convert-campaign-extender', hex: '10', kind: 'truck', count: 1 })
  assert.deepEqual(converted.state.groundMovement.moved, [])
})

test('flipping an extender back yields five points at half its own MA (OCS 12.7d)', () => {
  const flipped = submit(game({}, { extenders: [{ id: 'extender:truck:1', side: 'axis', hex: '10', kind: 'truck', range: 20 }] }),
    { type: 'flip-campaign-extender', id: 'extender:truck:1' })
  assert.equal(flipped.state.extenders.length, 0)
  const placed = Object.values(flipped.state.counters)[0]
  assert.equal(placed.transportPoints, 5)
  assert.equal(placed.location.hex, '10')
  assert.throws(() => submit(game({}, { extenders: [{ id: 'extender:wagon:1', side: 'soviet', hex: '10', kind: 'wagon', range: 10 }] }),
    { type: 'flip-campaign-extender', id: 'extender:wagon:1' }), /your own extender/)
})
