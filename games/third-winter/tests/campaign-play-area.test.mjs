import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { campaignMapInPlayArea, ttwCampaignPlayArea } from '../src/ttw/campaign/play-area.ts'

const geometry = indexTtwCampaignMap({ items: [
  { hex_id: 'A2.00', seam_twin: 'C2.34', seam_primary: true, on_map: true },
  { hex_id: 'C2.34', seam_twin: 'A2.00', seam_primary: false, on_map: true },
  { hex_id: 'B1.01', on_map: true },
  { hex_id: 'C2.33', on_map: true },
  { hex_id: 'D1.01', on_map: true },
  { hex_id: 'D1.02', on_map: false },
] }, { items: [
  { edge_key: 'cross-panel', hex_a: 'C2.34', hex_b: 'C2.33', edge_terrain: 'river' },
  { edge_key: 'outside', hex_a: 'D1.01', hex_b: 'D1.02' },
] })

test('scenario 01 includes all mapped panels and counts a seam hex only once', () => {
  const map = campaignMapInPlayArea(geometry, ttwCampaignPlayArea('01-dnepr-battles'))
  assert.deepEqual([...map.availableHexes], ['A2.0', 'B1.1', 'C2.33', 'D1.1'])
  assert.equal(map.resolveHex('C2.34'), 'A2.0')
  assert.deepEqual(map.neighbors('A2.00'), ['C2.33'])
  assert.deepEqual(map.neighbors('C2.33'), ['A2.0'])
  assert.equal(map.connection('A2.00', 'C2.33').sourceEdges[0].edge_terrain, 'river')
  assert.equal(map.resolveHex('D1.02'), undefined)
  assert.deepEqual(map.neighbors('D1.01'), [])
})

test('an explicit scenario area rejects destinations outside the area and validates its source list', () => {
  assert.equal(ttwCampaignPlayArea('07-hubes-pocket'), undefined)
  const map = campaignMapInPlayArea(geometry, { kind: 'hex-list', hexes: ['C2.34', 'A2.00'] })
  assert.deepEqual([...map.availableHexes], ['A2.0'])
  assert.equal(map.resolveHex('C2.33'), undefined)
  assert.deepEqual(map.neighbors('A2.0'), [])
  assert.equal(map.connection('A2.00', 'C2.33'), undefined)
  for (const hex of ['D1.02', 'D99.99']) {
    assert.throws(() => campaignMapInPlayArea(geometry, { kind: 'hex-list', hexes: [hex] }), /Unknown on-map hex/)
  }
})
