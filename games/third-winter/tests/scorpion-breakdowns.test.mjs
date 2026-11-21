import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRngState } from '@ocs-eastern/series/rng'
import { deployScorpionGroundCounter } from '../src/import/scorpion-deployment.ts'
import { scorpionMap } from '../src/import/scorpion-map.ts'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'

const origin = 's10.01'
const destination = 's10.02'
const map = scorpionMap([origin, destination].map((hex_id) => ({ hex_id, on_map: true, terrains_present: ['Open'] })),
  [{ hex_a: origin, hex_b: destination, edge_terrain: 'none', road_present: false, rail_present: false, bridge: false }])
const unit = (key, rating, re, side = 'soviet') => ({ key, kind: 'land', source: { name: key, side, re,
  faces: { combat: { maColor: 'white', stats: { attack: 3, artRange: rating, move: 3 } },
    move: { maColor: 'white', stats: { attack: 2, artRange: rating, move: 4 } } } } })
const parent = unit('parent', 3, 3)
const assets = { map, catalog: { definitions: new Map([
  parent, unit('split', 2, 1), unit('high-ar', 4, 1), unit('other-pool', 2, 1), unit('enemy', 2, 1, 'axis'),
].map((definition) => [definition.key, definition])) }, breakdowns: {
  parentPools: new Map([['parent', 'first']]),
  counters: new Map([
    ['split', { pool: 'first', copies: 2 }], ['high-ar', { pool: 'first', copies: 1 }],
    ['enemy', { pool: 'first', copies: 1 }], ['other-pool', { pool: 'other', copies: 1 }],
  ]),
} }

function fixture(fields = {}, patch = {}) {
  return { revision: 0, receipts: [], state: { kind: 'playing',
    cursor: { turn: 1, first: 'soviet', phasing: 'soviet', phase: 'movement', retention: 'soviet' },
    turn: { number: 1, weather: { ground: 'freeze', flight: 'limited' }, vp: 0, thawSeen: false,
      step: { kind: 'player-turn', first: 'soviet', retention: 'soviet' } },
    units: { parent: { ...deployScorpionGroundCounter(parent, origin, 0), ...patch } }, rng: createRngState(1),
    moved: [], pieces: [], availableAlerts: [], railControl: {}, rerollHolder: null, airBases: [], combat: null,
    arrivalsOnMap: [], placedAlerts: [], dumps: {}, window: null, combatTargets: [], combatAttackers: [],
    arrival: { placed: [], mobilized: [], sovietVp: 0 }, victory: null, ...fields,
  } }
}

const action = (fields = {}) => ({ type: 'ground-move', unitId: 'parent', path: [destination],
  breakdownDefinitions: ['split'], ...fields })
const board = { supplyRail: { railGauge: () => 'soviet' } }
const submit = (record, move, side = 'soviet', local = assets) => submitScorpionSession(record, side,
  { id: `test-${record.revision}`, expectedRevision: record.revision, action: move }, local, board).record

test('the move detaches one step at the starting hex, preserving mode and markers', () => {
  const before = fixture({}, { disorganized: true, outOfSupply: true, internalStocks: 'low' })
  const move = action({ face: 'move' })
  const after = submit(before, move)
  const detached = after.state.units['breakdown:split:1']
  assert.equal(after.state.units.parent.hex, destination)
  assert.equal(after.state.units.parent.stepsLost, 1)
  assert.equal(detached.hex, origin)
  assert.equal(detached.printedRe, 1)
  assert.equal(detached.moveMode, true)
  assert.equal(detached.disorganized, true)
  assert.equal(detached.outOfSupply, true)
  assert.equal(detached.internalStocks, 'low')
  assert.equal(detached.formation, undefined)
  assert.deepEqual(after.state.moved, ['parent'])
  assert.equal(before.state.units.parent.stepsLost, 0)
  assert.ok(submitScorpionSession(after, 'soviet', { id: 'test-0', expectedRevision: 0, action: move }, assets, board).duplicate)
  const next = submit(after, { type: 'ground-move', unitId: 'breakdown:split:1', path: [destination] })
  assert.equal(next.state.units['breakdown:split:1'].hex, destination)
})

test('pool, eligible parent, rating, remaining steps and pre-move window are enforced', () => {
  assert.throws(() => submit(fixture(), action(), 'soviet', { ...assets, breakdowns: undefined }), /No breakdown pools/)
  for (const definition of ['other-pool', 'enemy']) {
    assert.throws(() => submit(fixture(), action({ breakdownDefinitions: [definition] })), /parent unit’s pool/)
  }
  assert.throws(() => submit(fixture(), action({ breakdownDefinitions: ['high-ar'] })), /action rating/)
  for (const before of [fixture({}, { stepsLost: 2 }), fixture({}, { combatClass: 'mech' }), fixture({ moved: ['parent'] })]) {
    assert.throws(() => submit(before, action()), /before it starts moving/)
  }
  assert.throws(() => submit(fixture(), action(), 'axis'), /before it starts moving/)
})

test('physical limits count boxed copies, and a rejected path or stock request leaves the board unchanged', () => {
  const before = fixture({ pieces: [{ id: 'breakdown:split:1', kind: 'ground', side: 'soviet', definition: 'split',
    location: { kind: 'dead-pile' } }] })
  assert.throws(() => submit(before, action({ breakdownDefinitions: ['split', 'split'] })), /No copy/)
  assert.throws(() => submit(before, action({ path: ['s10.05'] })), /route|hex|adjacent/i)
  assert.deepEqual(Object.keys(before.state.units), ['parent'])
  assert.equal(before.state.units.parent.stepsLost, 0)
  const after = submit(before, action())
  assert.equal(after.state.units['breakdown:split:2'].hex, origin)
  assert.equal(after.state.pieces[0].id, 'breakdown:split:1')
})
