import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRngState } from '@ocs-eastern/series/rng'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { prepareCampaignSetup } from '../src/import/campaign-setup.ts'
import { campaignTerrain } from '../src/import/campaign-terrain.ts'
import { loadThirdWinterV2Units } from '../src/import/unit-v2.ts'
import { campaignMapInPlayArea, ttwCampaignPlayArea } from '../src/ttw/campaign/play-area.ts'
import { prepareDnieperBoard } from '../src/match/dnieper-opening.ts'
import { openCampaignMatch } from '../src/match/campaign-match.ts'
import { dnieperCampaignBoards } from '../src/match/dnieper-campaign-boards.ts'

const ROOT = 'D:/war game/OCS各作数据库/OCS第三个冬天'
const SCENARIO = '01-dnepr-battles'
const read = async (...parts) => JSON.parse((await readFile(join(ROOT, ...parts), 'utf8')).replace(/^\uFEFF/, ''))

async function scenario01() {
  const [hexes, edges, catalog, setupRaw] = await Promise.all([
    read('地图数据库', 'map_hexes.json'), read('地图数据库', 'map_edges.json'),
    loadThirdWinterV2Units((file) => read('data', file)), read('scenarios', SCENARIO, 'setup.json'),
  ])
  const map = indexTtwCampaignMap(hexes, edges)
  const playable = campaignMapInPlayArea(map, ttwCampaignPlayArea(SCENARIO))
  const terrain = campaignTerrain(playable)
  const setup = prepareCampaignSetup(setupRaw, catalog.aliases, map, playable)
  const loaded = { catalog, setup, setupRaw, playable, terrain, map }
  const opened = openCampaignMatch(prepareDnieperBoard(loaded), createRngState(1)).state
  const boards = dnieperCampaignBoards({ ...loaded, railheads: opened.initialRailheadMarkers })
  return { loaded, opened, boards }
}

test('scenario 01 real HQ throw supplies a unit outside direct trace, and strategic HQ cannot', async () => {
  const { loaded, opened, boards } = await scenario01()
  const state = {
    ...opened, turn: 1, weather: { ...opened.weather, ground: 'dry' },
    cursor: { first: 'soviet', phasing: 'soviet', phase: 'movement' }, movementSegment: 'movement',
  }
  const trace = boards.groundMovement.traceSupply(state, 'soviet')
  assert.ok(trace)
  // Sov 15 AA Div (land:id:2442) sits at D51.15, outside direct draw from any source.
  assert.ok(trace.network.hasTrace('D51.15', 'truck'))
  const options = trace.network.trace('D51.15')
  assert.ok(options.some((option) => option.kind === 'hq' && option.headquarters === 'campaign-setup:661'
    && option.source === 'D55.9'), 'D50.11 Front HQ throws to D51.15 from the D55.9 railhead')
  assert.equal(trace.network.canUseDumpVia('campaign-setup:661', 'D51.15', 'D55.9'), true)

  const hqStrategic = {
    ...state,
    counters: Object.fromEntries(Object.entries(state.counters).map(([id, counter]) =>
      [id, counter.kind === 'hq' ? { ...counter, mode: 'strat' } : counter])),
  }
  const withoutThrow = boards.groundMovement.traceSupply(hqStrategic, 'soviet')
  assert.ok(withoutThrow)
  assert.equal(withoutThrow.network.hasTrace('D51.15', 'truck'), false,
    '12.3b-C: a strategic-mode HQ cannot throw, so the unit loses trace')
  assert.deepEqual(withoutThrow.network.trace('D51.15'), [])

  // Real Sov 74 Gd Rifle Div (land:id:3085) sits at D55.25, outside every source and HQ throw range.
  assert.equal(trace.network.hasTrace('D55.25', 'truck'), false)
})

test('scenario 01 real HQ dump draw rejects a location outside its throw range', async () => {
  const { opened, boards } = await scenario01()
  const state = {
    ...opened, turn: 1, weather: { ...opened.weather, ground: 'dry' },
    cursor: { first: 'soviet', phasing: 'soviet', phase: 'movement' }, movementSegment: 'movement',
  }
  const trace = boards.groundMovement.traceSupply(state, 'soviet')
  assert.ok(trace)
  assert.equal(trace.network.canUseDumpVia('campaign-setup:661', 'D51.15', 'D55.9'), true)
  assert.equal(trace.network.canUseDumpVia('campaign-setup:661', 'B16.28', 'D55.9'), false,
    'a location beyond the printed throw range cannot draw through this HQ')
  assert.equal(trace.network.inThrowRange('campaign-setup:661', 'B16.28'), false)

  const unknownHq = trace.network.canUseDumpVia('campaign-setup:9999', 'D51.15', 'D55.9')
  assert.equal(unknownHq, false)
})
