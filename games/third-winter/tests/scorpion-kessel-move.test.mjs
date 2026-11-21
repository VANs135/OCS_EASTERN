import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRngState } from '@ocs-eastern/series/rng'
import { scorpionMap } from '../src/import/scorpion-map.ts'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'
import { localMenu, routeTo } from '../desktop/local/interaction.mjs'

const plains = Array.from({ length: 6 }, (_, i) => `s${i + 8}.08`)
const connections = plains.slice(1).map((hex, i) => [plains[i], hex])
connections.push(['s11.08', 's11.09'])
const command = (path, fields = {}) => ({ type: 'kessel-move', unitId: 'infantry', headquartersId: 'first', path, ...fields })
const route = ['s12.08', 's11.08', 's10.08', 's9.08']
const infantry = { side: 'axis', hex: 's13.08', combat: true, mobility: 'leg', allowance: 1,
  printedRe: 1, stepsLost: 0, attackCapable: true, outOfSupply: true, fueled: false }
const hq = (hex) => ({ ...infantry, hex, allowance: 0, attackCapable: false,
  headquarters: { kessel: true, mobility: 'leg', throwRange: 2 } })

function fixture({ mountain = false, units = {}, ...changes } = {}) {
  const map = scorpionMap([...plains, 's11.09'].map((hex_id) => ({ hex_id, on_map: true,
    terrains_present: mountain && hex_id === 's11.08' ? ['Mountain'] : ['Open'] })),
  connections.map(([hex_a, hex_b]) => ({ hex_a, hex_b, edge_terrain: 'none', road_present: false, rail_present: false, bridge: false })))
  const state = { kind: 'playing', cursor: { phase: 'movement', phasing: 'axis', first: 'axis', turn: 2, retention: 'closed' },
    turn: { number: 2, step: { kind: 'player-turn' }, weather: { ground: 'freeze', flight: 'normal' } },
    rng: createRngState(23), units: { infantry, first: hq('s10.08'), second: hq('s9.08'), ...units },
    moved: [], railControl: {}, dumps: {}, airBases: [], pieces: [], combat: null, rerollHolder: null, ...changes }
  const record = { revision: 0, state, receipts: [] }
  const assets = { map, catalog: { definitions: new Map(), aliases: new Map() } }
  const board = { combat: { table: {} }, supplyRail: { railGauge: () => 'axis' } }
  const submit = (record, action, side = 'axis') =>
    submitScorpionSession(record, side, { id: `test:${record.revision}`, expectedRevision: record.revision, action }, assets, board).record
  return { record, assets, board, submit, issue: (action, side) => submit(record, action, side) }
}

test('a left-click route offers Kessel as an explicit right-click order beyond ordinary movement', () => {
  const { record, assets, board, issue } = fixture()
  const picked = { unitId: 'infantry', unitIds: ['infantry'], route: [] }
  for (const hex of route) {
    picked.route = routeTo(record.state, picked, hex, assets.map)
    picked.hex = hex
  }
  const rows = localMenu(record.state, 'axis', picked, { hex: picked.hex, ownIds: [], labels: {} },
    { assets, board }, () => [])
  const order = rows.find(({ actions }) => actions[0].headquartersId === 'first').actions[0]
  assert.deepEqual(order, command(route))
  assert.equal(issue(order).state.units.infantry.hex, picked.hex)
})

test('2.3a B allows four free Leg entries under one HQ and consumes the unit’s movement', () => {
  const { record, issue, submit } = fixture()
  const settled = issue(command(route))
  assert.equal(settled.state.units.infantry.hex, 's9.08')
  assert.equal(settled.state.units.infantry.outOfSupply, true)
  assert.equal(settled.state.units.infantry.fueled, false)
  assert.deepEqual(settled.state.rng, record.state.rng)
  assert.deepEqual(settled.state.moved, ['infantry'])
  assert.equal(settled.state.groundActivity, undefined)
  assert.deepEqual(settled.receipts[0].action, command(route))
  const saved = JSON.parse(JSON.stringify(settled))
  assert.throws(() => submit(saved, command(['s8.08'], { headquartersId: 'second' })), /unmoved/)
  assert.throws(() => submit(saved, { type: 'ground-move', unitId: 'infantry', path: ['s8.08'] }), /unavailable/)
  const overrun = { type: 'declare-overrun', target: 's8.08', attackers: ['infantry'], payments: [] }
  assert.throws(() => submit(saved, overrun), /eligible attackers/)
  const ordinary = issue({ type: 'ground-move', unitId: 'infantry', path: ['s12.08'] })
  assert.throws(() => submit(ordinary, command(['s11.08'])), /unmoved/)
})

test('2.3a B checks route length, one HQ radius, adjacency and eastern endpoint', () => {
  const { issue } = fixture({ units: { inside: { ...infantry, hex: 's10.08', moveMode: true } } })
  assert.throws(() => issue(command([...route, 's8.08'])), /one to four/)
  assert.throws(() => issue(command(route, { headquartersId: 'absent' })), /on-map Axis Kessel HQ/)
  assert.throws(() => issue(command(['s11.08'])), /blocked terrain/)
  assert.throws(() => issue(command(['s11.08'], { unitId: 'inside' })), /cannot end east/)
  assert.throws(() => issue(command(['s11.08', 's12.08', 's13.08'], { unitId: 'inside' })), /within two hexes/)
  const allowed = issue(command(['s11.08', 's10.08', 's9.08'], { unitId: 'inside' }))
  assert.equal(allowed.state.units.inside.hex, 's9.08')
  assert.equal(allowed.state.units.inside.moveMode, true)
})

test('Kessel movement must stop at an All-cost entry or unnegated enemy ZOC', () => {
  const mountain = fixture({ mountain: true })
  assert.throws(() => mountain.issue(command(route)), /All-cost/)
  assert.equal(mountain.issue(command(route.slice(0, 2))).state.units.infantry.hex, 's11.08')
  const enemy = { ...infantry, side: 'soviet', hex: 's11.09', outOfSupply: false }
  const zoc = fixture({ units: { enemy } })
  assert.throws(() => zoc.issue(command(route)), /enemy ZOC/)
  assert.equal(zoc.issue(command(route.slice(0, 2))).state.units.infantry.hex, 's11.08')
  const negated = fixture({ units: { enemy, blocker: { ...infantry, hex: 's11.08' } }, moved: ['blocker'] })
  assert.equal(negated.issue(command(route)).state.units.infantry.hex, 's9.08')
})

test('Kessel movement respects side, weather, mode and the normal capture procedure', () => {
  const dumps = { 'soviet:hex:s12.08': { side: 'soviet', location: 'on-map', tokens: 4 } }
  const { issue, record } = fixture({ dumps })
  assert.throws(() => issue(command(route), 'soviet'), /requires an unmoved Axis/)
  const thaw = fixture({ turn: { ...record.state.turn, weather: { ground: 'thaw', flight: 'none' } } })
  assert.throws(() => thaw.issue(command(route)), /requires an unmoved Axis/)
  for (const mode of [{ reserve: 'infantry' }, { disorganized: true }, { exploit: true }, { mobility: 'truck' }]) {
    const ineligible = fixture({ units: { infantry: { ...infantry, ...mode } } })
    assert.throws(() => ineligible.issue(command(route)), /Combat or Move Mode/)
  }
  const capture = issue(command(route)).state
  assert.equal(capture.units.infantry.hex, 's9.08')
  assert.equal(capture.dumps['soviet:hex:s12.08'], undefined)
  assert.deepEqual(capture.captureHistory.map(({ hex }) => hex), ['s12.08'])
})
