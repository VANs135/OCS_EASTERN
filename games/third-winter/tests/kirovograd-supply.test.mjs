import assert from 'node:assert/strict'
import { test } from 'node:test'
import { campaignPhysicalSupply, campaignSupplySourceKey, spendCampaignSupply } from '../src/match/campaign-supply-ledger.ts'
import { kirovogradEdgeSupplySources } from '../src/match/kirovograd-supply.ts'

test('Scenario 9 derives rail sources on each map edge', () => {
  const hexes = ['D1.23', 'D1.24', 'D2.23', 'D30.23', 'D31.23', 'D31.24']
  const edges = new Set(['D1.23|D1.24', 'D2.23|D1.24', 'D30.23|D31.23', 'D31.23|D31.24'])
  const map = {
    availableHexes: new Set(hexes),
    neighbors: (hex) => ({
      'D1.23': ['D1.24', 'D2.23'], 'D1.24': ['D1.23', 'D2.23', 'D2.24'], 'D2.23': ['D1.23', 'D1.24'],
      'D30.23': ['D31.23'], 'D31.23': ['D30.23', 'D31.24'], 'D31.24': ['D31.23'],
    }[hex] ?? []),
    connection: (from, to) => edges.has([from, to].sort().join('|'))
      ? { sourceEdges: [{ rail_present: true }] } : { sourceEdges: [{ rail_present: false }] },
  }
  assert.deepEqual(kirovogradEdgeSupplySources(map), { axis: ['D1.23', 'D1.24'], soviet: ['D31.23', 'D31.24'] })
  assert.deepEqual(kirovogradEdgeSupplySources({}), { axis: [], soviet: [] })
})

test('Scenario edge sources are physical and unlimited, unlike dumps', () => {
  const map = { resolveHex: (hex) => hex }
  const state = { counters: {}, supplyDumps: { axis: { 'D5.23': 4 }, soviet: {} },
    edgeSupplySources: { axis: ['D1.26'], soviet: [] } }
  const sources = campaignPhysicalSupply(state, 'axis', map)
  assert.equal(sources.get('edge:D1.26')?.tokens, Number.MAX_SAFE_INTEGER)
  assert.equal(campaignSupplySourceKey(map.resolveHex, { kind: 'edge', hex: 'D1.26' }), 'edge:D1.26')
  const after = spendCampaignSupply(state, 'axis', sources, new Map([['edge:D1.26', 1]]))
  assert.deepEqual(after.supplyDumps, state.supplyDumps)
})
