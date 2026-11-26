import assert from 'node:assert/strict'
import test from 'node:test'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { campaignMapAdapter } from '../src/match/campaign-map-adapter.ts'
import { campaignGeometryHooks } from '../src/match/campaign-geometry.ts'

const hex = (hex_id, terrains) => ({ hex_id, on_map: true, seam_twin: null, seam_primary: null, terrains_present: terrains })
const edge = (edge_key, hex_a, hex_b, rail) => ({ edge_key, hex_a, hex_b, seam_dup_group: null,
  road_present: false, road_subclass: null, rail_present: rail, rail_class: rail ? 'single' : null })
const index = indexTtwCampaignMap(
  { items: [hex('A1.1', ['Open']), hex('A1.2', ['Village']), hex('A2.1', ['Open']), hex('B1.1', ['Minor City'])], meta: { count: 4 } },
  { items: [edge('e1', 'A1.1', 'A1.2', true), edge('e2', 'A1.2', 'A2.1', false)], meta: { count: 2 } },
)
const adapter = campaignMapAdapter(index)

test('map adapter derives site facts, rail presence and map letter from the campaign index', () => {
  assert.equal(adapter.map.resolveHex('A1.1'), 'A1.1')
  assert.equal(adapter.map.resolveHex('A1.01'), 'A1.1')   // printed alias normalized
  assert.equal(adapter.map.resolveHex('Z9.9'), undefined) // off map
  assert.deepEqual(adapter.hexSite('A1.1'), { villageCity: false, detrainable: true, map: 'A' })  // rail edge e1
  assert.deepEqual(adapter.hexSite('A1.2'), { villageCity: true, detrainable: true, map: 'A' })   // village + rail
  assert.deepEqual(adapter.hexSite('A2.1'), { villageCity: false, detrainable: false, map: 'A' }) // no rail
  assert.deepEqual(adapter.hexSite('B1.1'), { villageCity: true, detrainable: false, map: 'B' })  // minor city, map B
})

test('map adapter feeds geometry hooks end to end', () => {
  const hooks = campaignGeometryHooks({ ...adapter, friendlyAirBase: () => false,
    isCombatUnit: () => false, inSupply: () => true })
  const empty = { counters: {} }
  assert.equal(hooks.mapOf('A1.2'), 'A')
  assert.equal(hooks.mapOf('B1.1'), 'B')
  assert.equal(hooks.detrainable(empty, 'A1.1'), true)
  assert.equal(hooks.detrainable(empty, 'A2.1'), false)
  assert.equal(hooks.siteFacts(empty, 'A1.2').villageCityOrFriendlyAirBase, true)
  assert.equal(hooks.siteFacts(empty, 'A2.1').villageCityOrFriendlyAirBase, false)
})