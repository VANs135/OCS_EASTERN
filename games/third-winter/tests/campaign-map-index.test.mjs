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
  const { canonicalByHex, diagnostics } = indexTtwCampaignMap(hexes, edges)
  assert.equal(canonicalByHex.get('C2.34'), 'A2.0')
  assert.equal(canonicalByHex.get('A2.1'), 'A2.1')
  assert.deepEqual(diagnostics.mismatchedHexTwins, ['A2.01'])
  assert.deepEqual(diagnostics.danglingEdges, [])
  assert.deepEqual(diagnostics.seamTransportDisagreements, ['seam'])
  assert.equal(diagnostics.riverState, 'pending')
})
