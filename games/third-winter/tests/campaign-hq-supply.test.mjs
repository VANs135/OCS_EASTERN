import assert from 'node:assert/strict'
import { test } from 'node:test'
import { unitCatalog } from '../src/import/unit-catalog.ts'
import { campaignThrowHeadquarters } from '../src/match/campaign-hq-supply.ts'

const hq = {
  id: 'h1', name: 'Test HQ', side: 'axis', re: 1, kind: 'hq', hqKind: 'army',
  abilities: ['supply_throw'],
  faces: {
    combat: { asset: null, maColor: 'black', stats: { dropRange: 5, attack: 2, move: 5 } },
    move: { asset: null, maColor: 'black', stats: { dropRange: 3, move: 8 } },
  },
}
const kessel = {
  id: 'k1', name: 'Test Kessel HQ', side: 'axis', re: 1, kind: 'hq', hqKind: 'kessel',
  abilities: ['kessel_supply'],
  faces: {
    combat: { asset: null, maColor: 'black', stats: { dropRange: 2, attack: 2, move: 1 } },
    move: { asset: null, maColor: 'black', stats: { dropRange: 2, move: 1 } },
  },
}
const infantry = {
  id: 'u1', name: 'Test infantry', side: 'axis', re: 4, kind: 'ground',
  faces: {
    combat: { asset: null, maColor: 'white', stats: { attack: 3, move: 4 } },
    move: { asset: null, maColor: 'white', stats: { move: 4 } },
  },
}
const catalog = Object.fromEntries(unitCatalog([
  { kind: 'hq', file: 'synthetic', rows: [hq, kessel] },
  { kind: 'land', file: 'synthetic', rows: [infantry] },
]).definitions)

function stateOf(mode, definition = 'hq:id:h1', kind = 'hq') {
  return {
    counters: { h1: { definition, kind, side: 'axis', location: { kind: 'map', hex: 'D5.23' }, mode } },
  }
}

test('HQ throw reads the printed range of the current face', () => {
  assert.deepEqual(campaignThrowHeadquarters(stateOf('combat'), catalog), [
    { id: 'h1', hex: 'D5.23', throwRange: 5, mobility: 'truck' },
  ])
  assert.deepEqual(campaignThrowHeadquarters(stateOf('move'), catalog), [
    { id: 'h1', hex: 'D5.23', throwRange: 3, mobility: 'truck' },
  ])
})

test('strategic mode cannot throw, and non-HQ counters are ignored', () => {
  assert.deepEqual(campaignThrowHeadquarters(stateOf('strat'), catalog), [])
  assert.deepEqual(campaignThrowHeadquarters(stateOf('combat', 'land:id:u1', 'land'), catalog), [])
})

test('Kessel HQ stays on its self-contained trace path rather than the normal throw list', () => {
  assert.deepEqual(campaignThrowHeadquarters(stateOf('combat', 'hq:id:k1'), catalog), [])
})

test('an off-map HQ contributes no throw source', () => {
  const state = stateOf('combat')
  state.counters.h1.location = { kind: 'box', box: '09:axis:air' }
  assert.deepEqual(campaignThrowHeadquarters(state, catalog), [])
})
