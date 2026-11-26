import assert from 'node:assert/strict'
import test from 'node:test'
import { supplyNetwork } from '@ocs-eastern/series/supply-network'
import { kesselSupplyHeadquarters } from '../src/match/campaign-kessel-trace.ts'

const hexes = ['10', '11', '12', '13']
const board = {
  hasHex: (hex) => hexes.includes(hex),
  neighbors: (hex) => { const i = hexes.indexOf(hex); return [hexes[i - 1], hexes[i + 1]].filter(Boolean) },
  traceCost: () => 1, railCanTrace: () => false, detrainable: () => false,
}
const kessel = { id: 'k1', hex: '10', throwRange: 1, mobility: 'truck', selfContained: true }
const network = supplyNetwork(board, { sources: new Set(), controlled: new Set(hexes), enemyCombat: new Set(),
  unnegatedEnemyZoc: new Set(), headquarters: [kessel] })

test('Kessel HQ provides self-contained trace to axis units within throw range (§2.3a A)', () => {
  assert.equal(network.hasTrace('11'), true) // adjacent, within 1 throw + adjacency
  assert.equal(network.hasTrace('13'), false) // beyond throw range, no source
})

test('kesselSupplyHeadquarters derives only on-map axis Kessel HQs as self-contained sources', () => {
  const state = { counters: {
    k1: { definition: 'k1', kind: 'hq', side: 'axis', location: { kind: 'map', hex: '10' } },
    k2: { definition: 'k2', kind: 'hq', side: 'axis', location: { kind: 'box', box: 'available' } },
    s1: { definition: 's1', kind: 'hq', side: 'soviet', location: { kind: 'map', hex: '12' } },
    a1: { definition: 'a1', kind: 'hq', side: 'axis', location: { kind: 'map', hex: '13' } },
  } }
  const facts = { isKesselHq: (_s, id) => id.startsWith('k'), throwRangeOf: () => 1 }
  const hqs = kesselSupplyHeadquarters(state, facts)
  assert.deepEqual(hqs.map(({ id }) => id), ['k1'])
  assert.equal(hqs[0].selfContained, true)
  assert.equal(hqs[0].throwRange, 1)
})