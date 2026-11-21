import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRngState } from '@ocs-eastern/series/rng'
import { localChoices, localDecisionSide } from '../desktop/local/actions.mjs'
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
const board = { supplyRail: { railGauge: () => 'soviet' }, combat: { table: {} } }
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

const order = { parentId: 'parent', definitions: ['split'] }
const atCombat = (combat, patch) => {
  const record = fixture({ combat }, patch)
  return { ...record, state: { ...record.state, cursor: { ...record.state.cursor, phase: 'combat' } } }
}

test('selected surviving attackers can split at the start of a regular combat advance', () => {
  const record = atCombat({ attacker: 'soviet', attackers: ['parent'], step: 'advance', target: destination })
  const advance = { type: 'advance-after-combat', unitIds: ['parent'], breakdowns: [order] }
  assert.throws(() => submit(record, advance, 'axis'), /responding side/)
  assert.throws(() => submit(record, { ...advance, unitIds: [] }), /distinct eligible/)
  const { state } = submit(record, advance)
  assert.equal(state.units.parent.stepsLost, 1)
  assert.equal(state.units.parent.hex, destination)
  assert.equal(state.units['breakdown:split:1'].hex, destination)
  assert.equal(state.combat, null)
})

test('retreat splitting uses surviving steps and the detached counter follows the validated stack', () => {
  const record = atCombat({ attacker: 'axis', attackers: [], defenders: ['parent'], defenderLeader: 'parent', target: origin,
    step: 'defender-result', heldAtStart: { axis: [], soviet: [] }, roll: { defender: { loss: 1, option: 1 } } })
  const result = { type: 'resolve-combat', lossOrder: ['parent'], optionLosses: 0,
    retreats: [{ units: ['parent'], path: [destination], breakdowns: [order] }] }
  assert.throws(() => submit(record, { ...result, retreats: [{ ...result.retreats[0], path: ['s10.05'] }] }), /Retreat/)
  assert.equal(record.state.units.parent.stepsLost, 0)
  const { state } = submit(record, result)
  assert.equal(state.units.parent.stepsLost, 2)
  assert.equal(state.units.parent.hex, destination)
  assert.equal(state.units['breakdown:split:1'].hex, destination)
  assert.equal(state.combat, null)
})

test('resuming an interrupted retreat keeps its detached counter without spending another parent step', () => {
  const endpoint = 's10.03'
  const localMap = scorpionMap([origin, destination, endpoint].map((hex_id) => ({ hex_id, on_map: true, terrains_present: ['Open'] })),
    [[origin, destination], [destination, endpoint]].map(([hex_a, hex_b]) =>
      ({ hex_a, hex_b, edge_terrain: 'none', road_present: false, rail_present: false, bridge: false })))
  const fighter = { kind: 'aircraft', source: { side: 'axis', name: 'Fighter',
    faces: { combat: { stats: { range: 10 } }, move: { stats: { range: 5 } } } } }
  const local = { ...assets, map: localMap, catalog: { definitions: new Map([...assets.catalog.definitions, ['fighter', fighter]]) } }
  const original = atCombat({ attacker: 'axis', attackers: [], defenders: ['parent'], defenderLeader: 'parent', target: origin,
    step: 'defender-result', heldAtStart: { axis: [], soviet: [] }, roll: { defender: { loss: 0, option: 2 } } })
  const before = { ...original, state: { ...original.state, airBases: [{ side: 'axis', hex: destination, level: 1 }],
    pieces: [{ id: 'fig', kind: 'aircraft', definition: 'fighter', side: 'axis', active: true,
      location: { kind: 'hex', hex: destination } }] } }
  const issue = (record, side, action) => submitScorpionSession(record, side,
    { id: `retreat-${record.revision}`, expectedRevision: record.revision, action }, local, { ...board, captureResolution: 'manual' }).record
  const paused = issue(before, 'soviet', { type: 'resolve-combat', lossOrder: [], optionLosses: 0,
    retreats: [{ units: ['parent'], path: [destination, endpoint], breakdowns: [order] }] })
  assert.deepEqual(paused.state.combat.retreat.routes[0].units, ['parent', 'breakdown:split:1'])
  const displaced = issue(paused, 'axis', { type: 'settle-capture', aircraft: [{ id: 'fig', destination: { kind: 'off-map-air' } }] })
  const { state } = issue(displaced, 'soviet', { type: 'continue-combat-retreat' })
  assert.equal(state.units.parent.stepsLost, 1)
  assert.equal(state.units.parent.hex, endpoint)
  assert.equal(state.units['breakdown:split:1'].hex, endpoint)
  assert.equal(state.units['breakdown:split:2'], undefined)
})

test('phase completion requires the owning side to choose an eligible absorption before resuming', () => {
  const original = atCombat(null, { stepsLost: 1, internalStocks: 'low' })
  const placed = (id, extra = {}) => ({ ...deployScorpionGroundCounter(assets.catalog.definitions.get(id), origin, 0), ...extra })
  const before = { ...original, state: { ...original.state, units: { ...original.state.units,
    another: { ...original.state.units.parent },
    lowRating: placed('split', { internalStocks: 'low' }),
    wrongMode: placed('high-ar', { moveMode: true, internalStocks: 'low' }),
    wrongStock: placed('high-ar'),
    eligible: placed('high-ar', { internalStocks: 'low' }),
  } } }
  const finish = { type: 'complete-combat' }
  const choose = { type: 'absorb-breakdown', parentId: 'another', breakdownId: 'eligible' }
  assert.throws(() => submit(before, choose), /at the end of the phase/)
  assert.throws(() => submit(before, finish, 'axis'), /This side cannot complete/)
  const pending = submit(before, finish)
  assert.equal(pending.state.cursor.phase, 'combat')
  assert.equal(localDecisionSide(pending.state), 'soviet')
  assert.deepEqual(localChoices(pending.state, 'soviet', {}, { assets }).map(({ actions }) => actions[0]), [
    { ...choose, parentId: 'parent' }, choose,
  ])
  assert.throws(() => submit(pending, choose, 'axis'), /owning side/)
  assert.throws(() => submit(pending, { ...choose, breakdownId: 'lowRating' }), /eligible breakdown/)
  assert.throws(() => submit(pending, finish), /mandatory breakdown/)
  const { state } = submit(pending, choose)
  assert.equal(state.cursor.phase, 'exploitation')
  assert.equal(state.phaseClose, undefined)
  assert.equal(state.units.another.stepsLost, 0)
  assert.equal(state.units.parent.stepsLost, 1)
  assert.equal(state.units.eligible, undefined)
})

test('the non-phasing side can owe absorption during the phasing side’s phase completion', () => {
  const original = atCombat(null)
  const axisParent = unit('axis-parent', 2, 3, 'axis')
  const counters = { axisParent: deployScorpionGroundCounter(axisParent, destination, 1),
    axisBreakdown: deployScorpionGroundCounter(assets.catalog.definitions.get('enemy'), destination, 0) }
  const local = { ...assets, breakdowns: { ...assets.breakdowns,
    parentPools: new Map([...assets.breakdowns.parentPools, ['axis-parent', 'first']]) } }
  const pending = submit({ ...original, state: { ...original.state, units: { ...original.state.units, ...counters } } },
    { type: 'complete-combat' }, 'soviet', local)
  assert.equal(localDecisionSide(pending.state), 'axis')
  const { state } = submit(pending, { type: 'absorb-breakdown', parentId: 'axisParent', breakdownId: 'axisBreakdown' }, 'axis', local)
  assert.equal(state.units.axisParent.stepsLost, 0)
  assert.equal(state.cursor.phasing, 'soviet')
  assert.equal(state.cursor.phase, 'exploitation')
})

test('the first Simulcast handoff leaves the absorption decision for the shared phase’s end', () => {
  const original = fixture({}, { stepsLost: 1 })
  const before = { ...original, state: { ...original.state,
    cursor: { ...original.state.cursor, simulcast: true },
    turn: { ...original.state.turn, weather: { ground: 'thaw', flight: 'limited' } },
    units: { ...original.state.units, detached: deployScorpionGroundCounter(assets.catalog.definitions.get('high-ar'), origin, 0) },
  } }
  const finish = { type: 'complete-movement' }
  const handedOff = submit(before, finish)
  assert.equal(handedOff.state.cursor.phase, 'movement')
  assert.equal(handedOff.state.cursor.phasing, 'axis')
  assert.equal(handedOff.state.phaseClose, undefined)
  const pending = submit(handedOff, finish, 'axis')
  assert.equal(pending.state.cursor.phase, 'movement')
  assert.equal(pending.state.phaseClose.actor, 'soviet')
  const { state } = submit(pending, { type: 'absorb-breakdown', parentId: 'parent', breakdownId: 'detached' })
  assert.equal(state.cursor.phase, 'supply')
  assert.equal(state.units.parent.stepsLost, 0)
})
