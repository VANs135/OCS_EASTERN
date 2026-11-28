import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { edgeKey } from '@ocs-eastern/series/ground-map'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { prepareCampaignSetup } from '../src/import/campaign-setup.ts'
import { campaignTerrain } from '../src/import/campaign-terrain.ts'
import { loadThirdWinterV2Units } from '../src/import/unit-v2.ts'
import { campaignMapInPlayArea, ttwCampaignPlayArea } from '../src/ttw/campaign/play-area.ts'
import { prepareDnieperBoard } from '../src/match/dnieper-opening.ts'
import { dnieperControlSites } from '../src/match/dnieper-initial-control.ts'
import { dnieperInitialRailGauge, dnieperRailNetwork } from '../src/match/dnieper-initial-gauge.ts'

const ROOT = 'D:/war game/OCS各作数据库/OCS第三个冬天'
const SCENARIO = '01-dnepr-battles'
const read = async (...parts) => JSON.parse((await readFile(join(ROOT, ...parts), 'utf8')).replace(/^\uFEFF/, ''))

async function load() {
  const [hexes, edges, catalog, setupRaw] = await Promise.all([
    read('地图数据库', 'map_hexes.json'), read('地图数据库', 'map_edges.json'),
    loadThirdWinterV2Units((file) => read('data', file)), read('scenarios', SCENARIO, 'setup.json'),
  ])
  const map = indexTtwCampaignMap(hexes, edges)
  const playable = campaignMapInPlayArea(map, ttwCampaignPlayArea(SCENARIO))
  const terrain = campaignTerrain(playable)
  const setup = prepareCampaignSetup(setupRaw, catalog.aliases, map, playable)
  return { catalog, setup, setupRaw, map, playable, terrain }
}

test('scenario 01 initial gauge follows the book Soviet Railhead paths, not a flood fill', async () => {
  const loaded = await load()
  const gauges = dnieperInitialRailGauge({ map: loaded.playable, railAt: loaded.terrain.railAt })
  const counts = { broad: 0, standard: 0 }
  for (const gauge of Object.values(gauges)) counts[gauge]++

  assert.deepEqual(counts, { broad: 142, standard: 1689 })
  assert.equal(gauges[edgeKey('B32.18', 'B32.19')], 'broad')
  assert.equal(gauges[edgeKey('B33.18', 'B32.18')], 'broad', 'east through B48.16 is converted')
  assert.equal(gauges[edgeKey('B32.18', 'B32.17')], 'standard', 'south towards B31.13 is not converted')
  assert.equal(gauges[edgeKey('B16.28', 'B17.29')], 'broad', 'B16.28 east line')
  assert.equal(gauges[edgeKey('B16.27', 'B16.28')], 'standard')
  assert.equal(gauges[edgeKey('B46.3', 'B47.4')], 'broad')
  assert.equal(gauges[edgeKey('B45.4', 'B46.3')], 'standard')
  assert.equal(gauges[edgeKey('D55.8', 'D55.9')], 'broad')
})

test('scenario 01 railheads are the only broad-gauge junctions and B16.35 has no on-map edge', async () => {
  const loaded = await load()
  const railheads = ['D55.5', 'D55.9', 'D51.21', 'D55.26', 'B46.3', 'B32.18', 'B16.28', 'B16.35']
    .map((hex) => ({ side: 'soviet', hex }))
  const network = dnieperRailNetwork({ map: loaded.playable, railAt: loaded.terrain.railAt }, railheads)

  assert.deepEqual(network.initialGaugeJunctions, railheads.map(({ hex }) => hex))
  assert.equal(network.edge('B16.28', 'B17.29')?.gauge, 'broad')
  assert.equal(network.edge('B16.35', 'B15.35')?.gauge ?? 'standard', 'standard')
})

test('scenario 01 opening control covers settlement/VP sites and Railheads, not ordinary rail hexes', async () => {
  const loaded = await load()
  const opening = prepareDnieperBoard(loaded)
  const sites = dnieperControlSites({
    citySites: loaded.map.cities,
    railheads: opening.initialRailheadMarkers ?? [],
  })
  assert.deepEqual(new Set(Object.keys(opening.hexControl ?? {})), sites)
  assert.ok(sites.size > 8, 'all settlement/VP hexes carry opening control')
  assert.equal(opening.hexControl?.['D55.5'], 'soviet')
  assert.equal(opening.hexControl?.['B41.6'], 'axis', 'Poltava starts Axis-held')
  for (const hex of ['B3.24', 'C55.4', 'C55.5', 'C56.4', 'A58.1', 'A41.12', 'A42.11', 'A14.22']) {
    assert.ok(opening.hexControl?.[hex], `${hex} is a victory-point city hex and must carry opening control`)
  }
  assert.equal(opening.hexControl?.['D54.5'], undefined, 'a plain rail hex has no control record')
})
