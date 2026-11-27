import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { prepareCampaignSetup } from '../src/import/campaign-setup.ts'
import { prepareCampaignReinforcements } from '../src/import/campaign-reinforcements.ts'
import { loadThirdWinterV2Units } from '../src/import/unit-v2.ts'
import { campaignMapInPlayArea, ttwCampaignPlayArea } from '../src/ttw/campaign/play-area.ts'

const ROOT = 'D:/war game/OCS各作数据库/OCS第三个冬天'
const SCENARIO = '01-dnepr-battles'
const read = async (...parts) => JSON.parse((await readFile(join(ROOT, ...parts), 'utf8')).replace(/^\uFEFF/, ''))
const countBy = (rows, fn) => Object.fromEntries([...Map.groupBy(rows, fn)].map(([key, value]) => [key, value.length]))

// Scenario 01 is the full-campaign acceptance surface: A-D, 63 turns, all
// special-rule HQs, RVGK/STE/KG, fortresses, hedgehogs, rail gauge changes,
// air armies, Rumanian/Hungarian restrictions and both VP/surrender tracks.
test('scenario 01 real-library coverage keeps every special-rule family present', async () => {
  const [hexes, edges, catalog, setupRaw, arrivals, objectives] = await Promise.all([
    read('地图数据库', 'map_hexes.json'), read('地图数据库', 'map_edges.json'),
    loadThirdWinterV2Units((file) => read('data', file)),
    read('scenarios', SCENARIO, 'setup.json'), read('scenarios', SCENARIO, 'reinforcements.json'),
    read('scenarios', SCENARIO, 'objectives.json'),
  ])
  const geometry = indexTtwCampaignMap(hexes, edges)
  const playable = campaignMapInPlayArea(geometry, ttwCampaignPlayArea(SCENARIO))
  assert.ok(playable)
  assert.equal(playable.availableHexes.size, 8680)

  const setup = prepareCampaignSetup(setupRaw, catalog.aliases, geometry, playable)
  for (const list of [setup.unresolvedSetup, setup.unresolvedLosses, setup.missingSetupHexes,
    setup.outsideSetupArea, setup.unresolvedDraws, setup.pendingMarkerRows, setup.unresolvedHedgehogs]) {
    assert.equal(list.length, 0)
  }
  assert.equal(setup.total, 774)
  assert.equal(setup.counters.length, 774)
  assert.equal(setup.initialHedgehogs.length, 13)
  assert.deepEqual(countBy(setup.counters, (row) => row.kind), {
    land: 711, aircraft: 1, hq: 58, 'air-army-hq': 3, 'luftflotte-hq': 1,
  })

  const used = [...new Set([...setup.counters, ...prepareCampaignReinforcements(arrivals, catalog.aliases, geometry, playable).entries]
    .flatMap((row) => row.definition ? [row.definition] : []))]
    .map((key) => catalog.definitions.get(key)?.source)
    .filter(Boolean)
  const abilityCounts = countBy(used.flatMap((source) => source.abilities ?? []), (ability) => ability)
  for (const ability of ['front_hq', 'air_army_hq', 'luftflotte_hq', 'kessel_free_move', 'kessel_supply',
    'fortification', 'fortress_defense', 'air_transport', 'air_transport_supply_1sp_60hex', 'extender_capable',
    'rail_repair', 'pontoon', 'arty_barrage_marker']) {
    assert.ok((abilityCounts[ability] ?? 0) > 0, `scenario 01 must exercise ${ability}`)
  }
  assert.equal(abilityCounts.front_hq, 4)
  assert.equal(abilityCounts.air_army_hq, 3)
  assert.equal(abilityCounts.fortification, 4)

  assert.deepEqual(countBy(setupRaw.markers, (row) => row.ref)['RVGK-1 Marker'], 1)
  assert.deepEqual(countBy(setupRaw.markers, (row) => row.ref)['RVGK-2 Marker'], 1)
  assert.equal(countBy(setupRaw.markers, (row) => row.ref)['Ge HQ 4 Pz Kessel'], 1)
  assert.equal(setupRaw.markers.filter((row) => / KG$/.test(row.ref)).length, 4)
  assert.equal(countBy(setupRaw.markers, (row) => row.ref)['Railhead'], 8)
  assert.equal(countBy(setupRaw.markers, (row) => row.ref)['Wrong Gauge'], 7)
  assert.equal(countBy(setupRaw.markers, (row) => row.ref)['Pontoon Track Bridge'], 6)

  assert.equal(setupRaw.air.length, 104)
  assert.equal(setupRaw.dead_pile.length, 46)
  assert.equal(setupRaw.meta.turns, 63)
  assert.equal(setupRaw.meta.maps, 'A-D 全四图（完整战役）')
  assert.equal(setupRaw.meta.first_player, 'soviet')
  assert.equal(setupRaw.meta.rail_capacity_changes.length, 3)
  assert.equal(setupRaw.meta.supply_source_changes.length, 4)

  const reinforcement = prepareCampaignReinforcements(arrivals, catalog.aliases, geometry, playable)
  assert.equal(reinforcement.groups, 274)
  assert.deepEqual(reinforcement.groupCounts, new Map([
    ['any army or army group hq', 46], ['at any detrainable hex', 1], ['any front hq', 103],
    ['kherson d14.03', 3], ['withdraw', 80], ['any airbase', 18], ['add to dead pile', 8],
    ['rvgk 1 or 2', 6], ['available', 6], ['variable', 1],
    ['any army or army group hq (Hungarian units on maps A/B)', 1],
    ['Lviv or within 10 hexes of Lviv, western map edge (optional rule 4.1)', 1],
  ]))
  assert.equal(reinforcement.entries.filter((row) => row.status === 'pending').length, 19)

  assert.equal((objectives.vpSources ?? []).length, 14)
  assert.equal((objectives.terminal?.bands ?? []).length, 3)
  assert.equal(objectives.terminal.autoVictory.axis_win_at_or_below, -2)
  assert.equal(objectives.terminal.autoVictory.soviet_win_at_or_above, 16)
})
