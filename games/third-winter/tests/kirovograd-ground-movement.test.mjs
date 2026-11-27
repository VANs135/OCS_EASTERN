import assert from 'node:assert/strict'
import { test } from 'node:test'
import { unitCatalog } from '../src/import/unit-catalog.ts'
import { createRngState, rollDie } from '@ocs-eastern/series/rng'
import { capturedAmount } from '@ocs-eastern/series/tables/capture'
import { kirovogradGroundMovementBoard } from '../src/match/kirovograd-ground-movement.ts'

const unit = { id: 'u1', name: 'Test infantry', side: 'axis', re: 4, faces: {
  combat: { asset: null, maColor: 'white', stats: { attack: 3, move: 4 } },
  move: { asset: null, maColor: 'white', stats: { move: 4 } },
} }
const catalog = unitCatalog([{ kind: 'land', file: 'synthetic', rows: [unit] }])
const map = { resolveHex: (hex) => ['A1.1', 'A2.1', 'A3.1'].includes(hex) ? hex : undefined,
  neighbors: (hex) => hex === 'A1.1' ? ['A2.1'] : hex === 'A2.1' ? ['A1.1', 'A3.1'] : ['A2.1'],
  connection: () => ({ sourceEdges: [{ rail_present: true }] }) }
const terrain = { terrainAt: () => ['Open'], crossingAt: () => ({ barrier: 'none', routes: [] }) }
const data = { map, mapAdapter: { hexSite: () => ({ villageCity: false, detrainable: true, map: 'A' }) },
  terrain, catalog, kirovogradHex: 'A2.1' }
const state = { counters: { u1: { definition: 'land:id:u1', side: 'axis', kind: 'land', location: { kind: 'map', hex: 'A1.1' },
  currentRe: 4, mode: 'combat' } }, weather: { ground: 'freeze', flight: 'none' }, weatherHistory: { ice: false },
  edgeSupplySources: { axis: ['A1.1'], soviet: [] }, hexControl: { 'A2.1': 'axis' } }

test('real-data-shaped Scenario 9 ground board reads profiles, terrain cost and edge supply trace', () => {
  const board = kirovogradGroundMovementBoard(data, { edge: () => undefined })
  assert.equal(board.profileOf(state, 'u1')?.combat, true)
  assert.equal(board.moveProfile(state, 'u1')?.ma, 4)
  assert.equal(board.cost(state, 'u1', 'A1.1', 'A2.1', 'leg'), 1)
  assert.equal(board.inTrace(state, 'u1', 'A2.1'), true)
  assert.ok(board.railOnly)
  assert.equal(typeof board.releases, 'function')
  assert.equal(typeof board.resolveEntry, 'function')
})

test('the real board settles 9.14b dump capture on entry', () => {
  const board = kirovogradGroundMovementBoard(data, { edge: () => undefined })
  const withDump = { ...state, rng: createRngState(623), supplyDumps: { axis: {}, soviet: { 'A2.1': 4 } } }
  const expected = capturedAmount(4, 'dump', rollDie(withDump.rng).value)
  const after = board.resolveEntry(withDump, 'axis', 'A2.1', ['u1'])
  assert.equal(after.supplyDumps.soviet['A2.1'], undefined)
  assert.equal(after.supplyDumps.axis['A2.1'], expected)
  assert.equal(after.rng.drawCount, withDump.rng.drawCount + 1)
})
