import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'

test('campaign indexing aligns reciprocal seam twins without deciding disputed transport classifications', () => {
  const hexes = { items: [
    { hex_id: 'A2.00', seam_twin: 'C2.34', seam_primary: true },
    { hex_id: 'C2.34', seam_twin: 'A2.0', seam_primary: false },
    { hex_id: 'A2.01', seam_twin: 'C2.34', seam_primary: false },
  ] }
  const edges = { meta: { river_state: 'pending' }, items: [
    { edge_key: 'first', hex_a: 'A2.0', hex_b: 'A2.1', seam_dup_group: 'seam', road_present: true },
    { edge_key: 'second', hex_a: 'C2.34', hex_b: 'A2.01', seam_dup_group: 'seam', road_present: false },
  ] }
  const { canonicalByHex, diagnostics, neighbors, connection } = indexTtwCampaignMap(hexes, edges)
  assert.equal(canonicalByHex.get('C2.34'), 'A2.0')
  assert.equal(canonicalByHex.get('A2.1'), 'A2.1')
  assert.deepEqual(diagnostics.mismatchedHexTwins, ['A2.01'])
  assert.deepEqual(diagnostics.danglingEdges, [])
  assert.deepEqual(diagnostics.seamTransportDisagreements, ['seam'])
  assert.equal(diagnostics.connections, 1)
  assert.equal(diagnostics.duplicateConnections, 1)
  assert.deepEqual(neighbors('C2.34'), ['A2.1'])
  assert.deepEqual(neighbors('A2.01'), ['A2.0'])
  assert.deepEqual(connection('A2.01', 'C2.34').disputedFields, ['road_present'])
  assert.deepEqual(connection('A2.0', 'A2.1').sourceEdges.map(({ edge_key }) => edge_key), ['first', 'second'])
  assert.equal(diagnostics.riverState, 'pending')
})

test('city sites group canonical city hexes and separate villages (§2.4a 城市格集)', () => {
  const hexes = { items: [
    { hex_id: 'A1.01', seam_twin: null, seam_primary: null, city_hex: true, city_name: 'Kiev', city_level: 'Major City' },
    { hex_id: 'C1.34', seam_twin: 'A1.02', seam_primary: false, city_hex: true, city_name: 'Kiev', city_level: 'Major City' },
    { hex_id: 'A1.02', seam_twin: 'C1.34', seam_primary: true, city_hex: true, city_name: 'Kiev', city_level: 'Major City' },
    { hex_id: 'A1.03', seam_twin: null, seam_primary: null, city_hex: true, city_name: 'Village X', city_level: 'Village' },
    { hex_id: 'A1.04', seam_twin: null, seam_primary: null },
  ] }
  const { cities, cityOf } = indexTtwCampaignMap(hexes, { items: [] })
  assert.deepEqual(cities, [{ city: 'Kiev', level: 'Major City', hexes: ['A1.1', 'A1.2'] },
    { city: 'Village X', level: 'Village', hexes: ['A1.3'] }])
  assert.deepEqual(cityOf('C1.34').hexes, ['A1.1', 'A1.2'])
  assert.equal(cityOf('A1.04'), undefined)
})

test('a source seam group spanning two different pairs keeps the connections separate', () => {
  const hexes = { items: ['A1.1', 'A1.2', 'A1.3'].map((hex_id) => ({ hex_id })) }
  const edges = { items: [
    { edge_key: 'first', hex_a: 'A1.01', hex_b: 'A1.02', seam_dup_group: 'mixed' },
    { edge_key: 'second', hex_a: 'A1.02', hex_b: 'A1.03', seam_dup_group: 'mixed' },
    { edge_key: 'boundary', hex_a: 'A1.01', hex_b: null },
  ] }
  const { diagnostics, neighbors, connection } = indexTtwCampaignMap(hexes, edges)
  assert.deepEqual(neighbors('A1.2'), ['A1.1', 'A1.3'])
  assert.equal(connection('A1.1', 'A1.3'), undefined)
  assert.equal(diagnostics.openEndedEdges, 1)
  assert.deepEqual(diagnostics.seamGroupsWithDifferentEndpoints,
    [{ id: 'mixed', pairs: [['A1.1', 'A1.2'], ['A1.2', 'A1.3']] }])
})
