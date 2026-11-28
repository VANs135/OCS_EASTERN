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
import { applyCampaignTurn, openCampaignMatch } from '../src/match/campaign-match.ts'
import { dnieperCampaignBoards } from '../src/match/dnieper-campaign-boards.ts'

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
  const state = openCampaignMatch(prepareDnieperBoard(loaded), createRngState(3)).state
  const boards = dnieperCampaignBoards({ ...loaded, railheads: state.initialRailheadMarkers })
  return { state, boards }
}

function sovietMovement(state) {
  return { ...state, cursor: { first: 'axis', phasing: 'soviet', phase: 'movement' }, movementSegment: 'movement' }
}

const move = (state, boards, box, hex) => applyCampaignTurn(state, 'soviet',
  { type: 'move-campaign-rvgk-marker', box, hex }, boards)

test('scenario 01 RVGK marker rail movement is restricted to Soviet broad gauge (§3.5a)', async () => {
  const { state, boards } = await load()
  const turn = sovietMovement(state)
  assert.deepEqual(state.rvgkMarkers, { 'rvgk-1': 'D60.19', 'rvgk-2': 'B43.20' })
  assert.equal(boards.rvgkMarker.detrainable(turn, 'B59.9'), true)
  assert.equal(boards.rvgkMarker.detrainable(turn, 'B44.19'), false)

  assert.equal(boards.rvgkMarker.railRoute?.(turn, 'B43.20', 'B59.9'), undefined,
    'B43.20 is on the German standard-gauge side, so a Soviet marker may not rail from it')
  const broad = boards.rvgkMarker.railRoute?.(turn, 'D60.19', 'D56.18')
  assert.equal(broad?.length, 5,
    'a real Soviet broad-gauge route exists from D60.19')
  assert.equal(broad?.[0], 'D60.19')
  assert.equal(broad?.at(-1), 'D56.18')
  assert.equal(boards.rvgkMarker.railCapacityRemaining(turn), 7)

  assert.throws(() => move(turn, boards, 'rvgk-2', 'B59.9'), /connected railway/)
})

test('scenario 01 RVGK marker refuses non-detrainable, inside Axis 10 and wrong phase', async () => {
  const { state, boards } = await load()
  const turn = sovietMovement(state)
  assert.throws(() => move(turn, boards, 'rvgk-1', 'D56.18'), /detrainable/)
  assert.throws(() => move(turn, boards, 'rvgk-1', 'D51.21'), /10 hexes/)
  assert.throws(() => move(turn, boards, 'rvgk-2', 'B18.7'), /connected railway/)

  const axisPhase = { ...turn, cursor: { first: 'soviet', phasing: 'axis', phase: 'movement' } }
  assert.throws(() => move(axisPhase, boards, 'rvgk-2', 'B59.9'), /Soviet movement phase/)
})
