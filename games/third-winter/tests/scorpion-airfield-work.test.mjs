import assert from 'node:assert/strict'
import { test } from 'node:test'
import { airbaseUnloadCapacity } from '@ocs-eastern/series/airbase'
import { createRngState } from '@ocs-eastern/series/rng'
import { scorpionMap } from '../src/import/scorpion-map.ts'
import { activeAirfieldExcess } from '../src/match/scorpion-air-bases.ts'
import { scorpionAirstripPool } from '../src/match/scorpion-airfield-work.ts'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'
import { scorpionAuxiliaryCardViews } from '../src/view/scorpion-auxiliary-cards.ts'
import { scorpionMapStacks } from '../src/view/scorpion-map-counters.ts'
import { localMenu } from '../desktop/local/interaction.mjs'

const from = 's12.04'
const field = 's12.06'
const middle = 's12.05'
const dumpId = `axis:hex:${from}`
const regular = { definition: 'hq', side: 'axis', hex: from, combat: true, attackCapable: false,
  printedRe: 1, stepsLost: 0, allowance: 0, mobility: 'leg', headquarters: { kessel: false, mobility: 'leg', throwRange: 3 } }
const strip = { key: 'as1', kind: 'marker', source: { name: 'Air Strip 1', faces: { combat: { asset: 'AS1.png' } } } }
const fieldOrder = (operation, tokens, unitIds = ['hq']) => ({ type: 'work-airfield', operation, hex: field, unitIds,
  payments: tokens ? [{ dumpId, tokens }] : [] })
const aircraft = (at = field) => ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({
  id, side: 'axis', kind: 'aircraft', definition: 'plane', active: true, location: { kind: 'hex', hex: at },
}))

function fixture(changes = {}) {
  const map = scorpionMap([from, middle, field, 's12.07'].map((hex_id) => ({ hex_id, on_map: true, terrains_present: ['Open'] })),
    [[from, middle], [middle, field], [field, 's12.07']].map(([hex_a, hex_b]) => ({
      hex_a, hex_b, edge_terrain: 'none', rail_present: false, road_present: false, bridge: false,
    })))
  const assets = { map, catalog: { definitions: new Map([[strip.key, strip]]), aliases: new Map() } }
  const board = { supplyRail: { railGauge: () => 'axis' } }
  const state = { kind: 'playing', cursor: { phase: 'movement', turn: 2, phasing: 'axis', first: 'axis', retention: 'closed' },
    turn: { number: 2, weather: { ground: 'freeze', flight: 'normal' }, step: { kind: 'player-turn', first: 'axis' } },
    units: { hq: regular, spare: { ...regular, hex: middle } }, pieces: [], airBases: [], moved: [], rng: createRngState(3),
    rerollHolder: null, dumps: { [dumpId]: { side: 'axis', tokens: 12, location: 'on-map' } }, railControl: {}, ...changes }
  const submit = (action, s = state, seat = 'axis') => submitScorpionSession({ state: s, revision: 0, receipts: [] },
    seat, { id: 'order', expectedRevision: 0, action }, assets, board).record.state
  return { state, assets, board, submit }
}

test('a remote engineer can build from the target menu and its strip moves from stock to map and back', () => {
  const { state, assets, board, submit } = fixture()
  const menuAt = (s, hex) => localMenu(s, 'axis', { unitId: 'hq', unitIds: ['hq'] },
    { hex, ownIds: [], labels: {} }, { assets, board }, () => [])
  const order = menuAt(state, field).find(({ actions }) => actions[0].operation === 'build-strip').actions[0]
  const stripId = 'airstrip:as1'
  const inStock = (s) => {
    const cards = scorpionAuxiliaryCardViews({ ...s, availableAlerts: [], arrival: { sovietVp: 0 } }, assets.catalog, [])
    return cards['axis-off-map'].counters.some(({ id }) => id === stripId)
  }
  assert.ok(inStock(state))
  const built = submit(order)
  assert.equal(inStock(built), false)
  assert.ok(scorpionMapStacks({ ...built, units: {}, dumps: {} }, assets.catalog, [])
    .find(({ hex }) => hex === field).pages.flat().some(({ id }) => id === stripId))
  assert.ok(!menuAt(built, field).some(({ actions }) => actions[0].type === 'work-airfield'))
  const ready = { ...built, moved: [] }
  const upgrade = menuAt(ready, field).find(({ actions }) => actions[0].operation === 'build').actions[0]
  assert.deepEqual(upgrade.payments, [{ dumpId, tokens: 3 }])
  assert.ok(inStock(submit(upgrade, ready)))
})

test('15.3 builds through a leg-passable route, consumes 1 SP and locks the engineer for the phase', () => {
  const { state, submit } = fixture()
  assert.throws(() => submit(fieldOrder('build', 3)), /exactly 4T/)
  assert.throws(() => submit(fieldOrder('build', 4), { ...state, units: { hq: { ...regular,
    headquarters: { ...regular.headquarters, kessel: true } } } }), /eligible engineer/)
  const occupied = { ...state, units: { ...state.units, enemy: { ...regular, side: 'soviet', hex: middle } } }
  assert.throws(() => submit(fieldOrder('build', 4), occupied), /eligible engineer/)
  const built = submit(fieldOrder('build', 4))
  assert.deepEqual(built.airBases, [{ side: 'axis', hex: field, level: 1 }])
  assert.equal(built.dumps[dumpId].tokens, 8)
  assert.deepEqual(built.moved, ['hq'])
  assert.throws(() => submit(fieldOrder('build-strip', 1), built), /without an airfield/)
  assert.throws(() => submit(fieldOrder('build', 4, ['spare']), built), /one level per turn/)
  const later = { ...built, cursor: { ...built.cursor, turn: 3 }, moved: [] }
  assert.equal(submit(fieldOrder('build', 4), later).airBases[0].level, 2)
})

test('15.4 reduction can use a local combat RE and opens an aircraft-capacity decision', () => {
  const base = { hex: field, side: 'axis', level: 2 }
  const local = { ...regular, hex: field, headquarters: undefined, allowance: 3 }
  const { state, submit } = fixture({ airBases: [base], pieces: aircraft(), units: { local } })
  const result = submit(fieldOrder('reduce', 0, ['local']))
  assert.equal(result.airBases[0].level, 1)
  assert.deepEqual(result.airfieldCapacityChoice, { side: 'axis', hex: field, excess: 1 })
  assert.equal(result.dumps[dumpId].tokens, state.dumps[dumpId].tokens)
  const settled = submit({ type: 'settle-airfield-capacity', unitIds: ['a'] }, result)
  assert.equal(settled.pieces[0].active, false)
  assert.throws(() => submit(fieldOrder('reduce', 0, ['local']), settled), /never below level one/)
})

test('TTW 2.2h strips draw physical counters, enforce capacity, upgrade or return after Soviet occupation', () => {
  const { state, assets, submit } = fixture()
  const built = submit(fieldOrder('build-strip', 1))
  assert.deepEqual(built.airBases, [{ side: 'axis', hex: field, level: 0, strip: strip.key }])
  assert.equal(built.dumps[dumpId].tokens, 11)
  assert.deepEqual(scorpionAirstripPool(built, assets.catalog), [])
  const other = { ...fieldOrder('build-strip', 1, ['spare']), hex: middle }
  assert.throws(() => submit(other, built), /No air strip counter/)
  assert.deepEqual(activeAirfieldExcess({ ...built, pieces: aircraft().slice(0, 5) },
    'axis', { kind: 'hex', hex: field }), { side: 'axis', hex: field, excess: 1 })
  assert.equal(airbaseUnloadCapacity(built.airBases[0].level), 2)
  const upgrade = submit(fieldOrder('build', 3, ['spare']), built)
  assert.deepEqual(upgrade.airBases, [{ side: 'axis', hex: field, level: 1 }])
  assert.equal(upgrade.dumps[dumpId].tokens, 8)
  assert.deepEqual(scorpionAirstripPool(upgrade, assets.catalog), [strip])
  const soviet = { ...regular, side: 'soviet', hex: 's12.07', headquarters: undefined, attackCapable: true, allowance: 3 }
  const next = { ...built, cursor: { ...state.cursor, phasing: 'soviet' }, units: { ...built.units, soviet }, moved: [] }
  const enter = { type: 'ground-move', unitId: 'soviet', path: [field] }
  const reserve = { ...next, units: { ...next.units, soviet: { ...soviet, reserve: 'soviet' } } }
  assert.throws(() => submit(enter, reserve, 'soviet'), /attack-capable/)
  const captured = submit(enter, next, 'soviet')
  assert.deepEqual(captured.airBases, [])
  assert.deepEqual(scorpionAirstripPool(captured, assets.catalog), [strip])
  assert.equal(captured.captureHistory[0].airstripRemoved, strip.key)
})

test('an Axis strip can refit one aircraft per refit phase for 1T', () => {
  const { submit } = fixture()
  const built = submit(fieldOrder('build-strip', 1))
  const refit = { ...built, cursor: { ...built.cursor, phase: 'aircraft-refit' },
    pieces: aircraft().slice(0, 2).map((air) => ({ ...air, active: false })) }
  const order = { type: 'refit-aircraft', base: { kind: 'hex', hex: field, dumpId }, unitIds: ['a'] }
  assert.throws(() => submit({ ...order, unitIds: ['a', 'b'] }, refit), /refit or active stacking capacity/)
  const settled = submit(order, refit)
  assert.equal(settled.pieces[0].active, true)
  assert.equal(settled.pieces[1].active, false)
  assert.equal(settled.dumps[dumpId].tokens, 10)
  assert.throws(() => submit({ ...order, unitIds: ['b'] }, settled), /already refitted/)
})
