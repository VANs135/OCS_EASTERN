import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { submitScorpionReinforcement, scorpionScheduledArrivals } from '../src/match/scorpion-reinforcement.ts'
import { forfeitScorpionArrivals, forfeitedScorpionArrivals, placeScorpionArrival }
  from '../src/ttw/scorpion/arrival.ts'

const open = { id: '3:soviet:open', side: 'soviet', turn: 3, destinations: ['s22.02'], definition: 'unit' }
const blocked = { id: '3:soviet:blocked', side: 'soviet', turn: 3, destinations: ['s2.16'], definition: 'unit' }
const later = { id: '4:soviet:later', side: 'soviet', turn: 4, destinations: ['s22.02'], definition: 'unit' }

const cursor = { turn: 3, first: 'soviet', phasing: 'soviet', phase: 'aircraft-refit', retention: 'closed' }
const rollTwo = () => 2
const noDraw = () => { throw new Error('Unexpected random draw') }

function boardWith(catalog, openIds) {
  return {
    catalog,
    supplySources: { soviet: new Set(['s22.02']), axis: new Set(['s1.03']) },
    controlOf: () => null,
    arrivalDestinations: (arrival) => openIds.includes(arrival.id) ? arrival.destinations : [],
    alertDestinations: () => [],
  }
}

function recordAt(state = {}) {
  return { revision: 0, receipts: [], state: {
    cursor, window: null, arrival: { placed: [], mobilized: [], sovietVp: 0 }, arrivalsOnMap: [],
    dumps: {}, pax: { axis: 0, soviet: 0 }, availableAlerts: [], placedAlerts: [], victory: null, ...state,
  } }
}

function session(record, board) {
  const apply = (id, action) => {
    record = submitScorpionReinforcement(record, 'soviet', { id, expectedRevision: record.revision, action },
      board, rollTwo, noDraw).record
  }
  return { get: () => record, apply }
}

test('a scheduled arrival with no legal entry hex is recorded as forfeited instead of vanishing', () => {
  const board = boardWith([blocked, later], [])
  const run = session(recordAt(), board)
  run.apply('open', { type: 'complete-refit' })
  assert.equal(run.get().state.window.stage, 'scheduled')
  assert.deepEqual(scorpionScheduledArrivals(run.get().state, 'soviet', board).blocked.map(({ id }) => id),
    [blocked.id])

  // Before the fix this command passed silently: the arrival was filtered out of "outstanding", so
  // the phase rolled the variable award with the unit neither placed nor recorded anywhere.
  run.apply('finish', { type: 'finish-scheduled-arrivals' })
  let state = run.get().state
  assert.equal(state.window.stage, 'variable')
  assert.deepEqual(forfeitedScorpionArrivals(state.arrival), [blocked.id])
  assert.deepEqual(state.arrival.placed, [])
  assert.equal(state.arrivalsOnMap.length, 0)
  assert.equal(state.arrival.sovietVp, 0, 'a forfeited arrival never reaches the map, so it scores nothing')

  assert.equal(state.window.variableTokens, 20)
  run.apply('variable', { type: 'place-supply', tokens: 20, target: { kind: 'hex', id: 's22.02' } })
  run.apply('close', { type: 'complete-reinforcement' })
  state = run.get().state
  assert.equal(state.cursor.phase, 'movement')
  assert.deepEqual(forfeitedScorpionArrivals(state.arrival), [blocked.id], 'the record survives the transition')

  // The obligation is settled for this turn, and the unit cannot be smuggled in on a later turn.
  const settled = scorpionScheduledArrivals({ ...state, cursor }, 'soviet', board)
  assert.deepEqual(settled.outstanding.map(({ id }) => id), [])
  assert.deepEqual(settled.blocked, [])
  assert.throws(() => placeScorpionArrival(state.arrival, blocked, 3, 'soviet', 's2.16', []),
    /forfeited for this phase/, 'a forfeited arrival cannot be placed back onto the map')
  const nextTurn = { ...state, cursor: { ...cursor, turn: 4 } }
  assert.throws(() => placeScorpionArrival(nextTurn.arrival, blocked, 4, 'soviet', 's2.16', []),
    /forfeited for this phase/)
})

test('a placeable scheduled arrival still blocks the phase end until it is placed', () => {
  const board = boardWith([open], [open.id])
  const run = session(recordAt(), board)
  run.apply('open', { type: 'complete-refit' })
  assert.deepEqual(scorpionScheduledArrivals(run.get().state, 'soviet', board).placeable.map(({ id }) => id),
    [open.id])
  assert.throws(() => run.apply('skip', { type: 'finish-scheduled-arrivals' }),
    /Place the available scheduled arrivals first/)
  assert.equal(run.get().state.window.stage, 'scheduled')

  run.apply('place', { type: 'place-arrival', arrivalId: open.id, hex: 's22.02' })
  assert.deepEqual(run.get().state.arrival.placed, [open.id])
  assert.equal(run.get().state.arrivalsOnMap[0].hex, 's22.02')
  run.apply('finish', { type: 'finish-scheduled-arrivals' })
  assert.equal(run.get().state.window.stage, 'variable')
  assert.deepEqual(forfeitedScorpionArrivals(run.get().state.arrival), [])
})

test('one blocked and one placeable arrival in the same turn: place first, then only the blocked one forfeits', () => {
  const board = boardWith([open, blocked, later], [open.id])
  const run = session(recordAt(), board)
  run.apply('open', { type: 'complete-refit' })
  assert.deepEqual(scorpionScheduledArrivals(run.get().state, 'soviet', board).placeable.map(({ id }) => id),
    [open.id])
  assert.throws(() => run.apply('skip', { type: 'finish-scheduled-arrivals' }),
    /Place the available scheduled arrivals first/)

  run.apply('place', { type: 'place-arrival', arrivalId: open.id, hex: 's22.02' })
  run.apply('finish', { type: 'finish-scheduled-arrivals' })
  assert.deepEqual(run.get().state.arrival.placed, [open.id])
  assert.deepEqual(forfeitedScorpionArrivals(run.get().state.arrival), [blocked.id],
    'placing the open arrival must not settle the blocked one')
  assert.deepEqual(run.get().state.arrivalsOnMap.map(({ arrival }) => arrival.id), [open.id])
})

test('a turn with no scheduled arrival at all does not invent a forfeiture', () => {
  const board = boardWith([later], [])
  const run = session(recordAt(), board)
  run.apply('open', { type: 'complete-refit' })
  run.apply('finish', { type: 'finish-scheduled-arrivals' })
  assert.equal(run.get().state.window.stage, 'variable')
  assert.deepEqual(forfeitedScorpionArrivals(run.get().state.arrival), [])
  assert.equal(run.get().state.arrival.forfeited, undefined, 'an untouched state keeps no empty record')
})

test('forfeiture is idempotent but refuses an arrival that is already on the map', () => {
  const state = { placed: [], mobilized: [], sovietVp: 0 }
  const first = forfeitScorpionArrivals(state, [blocked])
  assert.deepEqual(forfeitedScorpionArrivals(first), [blocked.id])
  const again = forfeitScorpionArrivals(first, [blocked])
  assert.deepEqual(forfeitedScorpionArrivals(again), [blocked.id], 'a repeat adds nothing')
  assert.deepEqual(forfeitedScorpionArrivals(forfeitScorpionArrivals(state, [])), [])
  assert.throws(() => forfeitScorpionArrivals({ ...state, placed: [blocked.id] }, [blocked]),
    /Arrival is already on the map/)
})
