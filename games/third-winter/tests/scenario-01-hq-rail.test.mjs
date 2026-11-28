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
import { applyCampaignRailTransport, campaignRailLoading } from '../src/match/campaign-rail-transport.ts'

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
  const loaded = { catalog, setup, setupRaw, playable, terrain, map }
  const state = openCampaignMatch(prepareDnieperBoard(loaded), createRngState(2)).state
  const boards = dnieperCampaignBoards({ ...loaded, railheads: state.initialRailheadMarkers })
  return { state, boards }
}

function axisMovement(state) {
  return { ...state, cursor: { first: 'soviet', phasing: 'axis', phase: 'movement' }, movementSegment: 'movement' }
}

function action(path, id) {
  return { type: 'transport-campaign-rail', path, counterIds: [id], moveFaceIds: [id], supplyTokens: 0 }
}

test('scenario 01 real Army HQ boards and detrains off-station as 1 RE (§2.3b/c)', async () => {
  const { state, boards } = await load()
  const turn = axisMovement(state)
  assert.deepEqual(boards.railTransport.hqRail?.(turn, 'campaign-setup:747'),
    { railRe: 1, waiveDetrainable: true })

  const loadAtVillage = campaignRailLoading(turn, 'axis', 'B14.5', boards.railTransport, boards.groundMovement)
  assert.equal(loadAtVillage.ok, true)
  const hqLoading = loadAtVillage.counters?.find((counter) => counter.id === 'campaign-setup:747')
  assert.deepEqual(hqLoading, { id: 'campaign-setup:747', needsMoveFace: true, equivalent: 1 },
    'Army HQ rail capacity is one RE regardless of currentRe')

  const settled = applyCampaignRailTransport(turn, 'axis', action(['B14.5', 'B14.4'], 'campaign-setup:747'),
    boards.railTransport, boards.groundMovement)
  assert.deepEqual(settled.counters['campaign-setup:747'].location, { kind: 'map', hex: 'B14.4' },
    'Army HQ may start and end on ordinary rail hexes')
  assert.equal(settled.counters['campaign-setup:747'].currentRe, 1)
  assert.equal(settled.groundMovement?.railCapacitySpent, 1)
})

test('scenario 01 real Army Group HQ still needs a detrainable destination (§2.3c)', async () => {
  const { state, boards } = await load()
  const turn = axisMovement(state)
  assert.deepEqual(boards.railTransport.hqRail?.(turn, 'campaign-setup:745'),
    { railRe: 1, waiveDetrainable: false })

  assert.throws(() => applyCampaignRailTransport(turn, 'axis',
    action(['A42.11', 'A43.12'], 'campaign-setup:745'), boards.railTransport, boards.groundMovement),
  /rail-unloading-unavailable/,
  'A43.12 is an ordinary rail hex; AGS must unload at a city/station')
})
