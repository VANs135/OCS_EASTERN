import assert from 'node:assert/strict'
import { test } from 'node:test'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { campaignTerrain } from '../src/import/campaign-terrain.ts'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { campaignMapInPlayArea, ttwCampaignPlayArea } from '../src/ttw/campaign/play-area.ts'
import { kirovogradScenario } from '../src/ttw/campaign/kirovograd.ts'

const hex = (hex_id, fields = {}) => ({ hex_id, terrains_present: ['Woods', 'Open'], movement_terrain: 'Open', ...fields })
const edge = (hex_a, hex_b, fields = {}) => ({ hex_a, hex_b, edge_key: `${hex_a}|${hex_b}`, edge_terrain: 'none', ...fields })

test('Kirovograd uses the printed D window including seam aliases and authoritative mixed terrain', () => {
  const map = indexTtwCampaignMap({ items: [hex('D1.22'), hex('D1.23'), hex('D31.33'), hex('D31.35'), hex('D32.35'),
    hex('B31.00', { seam_twin: 'D31.34', seam_primary: true }), hex('D31.34', { seam_twin: 'B31.00', seam_primary: false })] }, {
    items: [edge('D31.33', 'D31.34', { edge_terrain: 'river', river_class: 'dnieper', river_class_status: 'auto_pending_visual',
      rail_present: true, rail_class: 'double', bridge: true }), edge('D1.22', 'D1.23')],
  })
  const area = campaignMapInPlayArea(map, ttwCampaignPlayArea(kirovogradScenario))
  assert.deepEqual([...area.availableHexes], ['D1.23', 'D31.33', 'B31.0', 'D31.35'])
  assert.equal(area.resolveHex('D1.22'), undefined)
  assert.equal(area.resolveHex('D32.35'), undefined)
  assert.deepEqual(area.neighbors('D1.23'), [])
  assert.equal(area.resolveHex('D31.34'), 'B31.0')
  const terrain = campaignTerrain(area)
  assert.deepEqual(terrain.terrainAt('D31.34'), ['Woods', 'Open'])
  assert.equal(terrain.crossingAt('B31.0', 'D31.33'), undefined)
  assert.equal(terrain.railAt('D31.34', 'D31.33'), 'double')
  assert.equal(terrain.riverStatus('D31.34', 'D31.33'), 'auto_pending_visual')
  assert.deepEqual(campaignTerrain(area, () => 'volga').crossingAt('B31.0', 'D31.33'),
    { barrier: 'volga', bridge: 'intact', routes: ['rail'] })
})

test('Kirovograd later turns retain the prescribed ground and flight conditions without a weather roll', () => {
  const initial = openCampaignMatch({ when: { scenarioId: kirovogradScenario, date: '1944-01-05' }, turn: 1, counters: {} }, 55)
  assert.equal(initial.state.opening.first, 'soviet')
  const record = openCampaignMatch({ when: { scenarioId: kirovogradScenario, date: '1944-01-15' }, turn: 4, counters: {} }, 55)
  const { record: updated } = submitCampaignMatch(record, 'soviet',
    { id: 'weather', expectedRevision: 0, action: { type: 'determine-campaign-weather' } }, {})
  assert.deepEqual(updated.state.weather, { ground: 'freeze', flight: 'limited' })
  assert.equal(updated.state.rng.drawCount, 0)
})
