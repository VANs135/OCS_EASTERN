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
import { campaignRailLoading, campaignRailStatus } from '../src/match/campaign-rail-transport.ts'
import { dnieperRailCapacity } from '../src/match/dnieper-rail-capacity.ts'

const ROOT = 'D:/war game/OCS各作数据库/OCS第三个冬天'
const SCENARIO = '01-dnepr-battles'
const read = async (...parts) => JSON.parse((await readFile(join(ROOT, ...parts), 'utf8')).replace(/^\uFEFF/, ''))

const rail = {
  capacity: (state, side) => dnieperRailCapacity(side, state.turn),
  ordinaryCargo: () => true,
  controlBlocksAt: () => false,
  trainbustingAt: () => false,
}

function movement(turn, side = 'soviet', spent = 0) {
  return {
    turn,
    cursor: { first: 'soviet', phasing: side, phase: 'movement' },
    movementSegment: 'movement',
    groundMovement: { moved: [], zocLocks: [], railCapacitySpent: spent },
  }
}

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
  const opening = prepareDnieperBoard(loaded)
  const state = openCampaignMatch(opening, createRngState(2)).state
  return { loaded, state, boards: dnieperCampaignBoards({ ...loaded, railheads: state.initialRailheadMarkers }) }
}

test('scenario 01 rail capacity follows the Soviet 7 / 7.5 / 8 / 8.5 schedule', () => {
  assert.equal(dnieperRailCapacity('soviet', 1), 7)
  assert.equal(dnieperRailCapacity('soviet', 5), 7)
  assert.equal(dnieperRailCapacity('soviet', 6), 7.5)
  assert.equal(dnieperRailCapacity('soviet', 23), 7.5)
  assert.equal(dnieperRailCapacity('soviet', 24), 8)
  assert.equal(dnieperRailCapacity('soviet', 57), 8)
  assert.equal(dnieperRailCapacity('soviet', 58), 8.5)
  assert.equal(dnieperRailCapacity('soviet', 63), 8.5)
  assert.equal(dnieperRailCapacity('axis', 6), 10)
})

test('scenario 01 rail status refuses outside the movement window and applies spent capacity', () => {
  assert.deepEqual(campaignRailStatus(movement(6, 'soviet', 2), 'soviet', rail),
    { capacity: 7.5, remainingCapacity: 5.5 })
  assert.equal(campaignRailStatus(movement(58, 'soviet', 8), 'soviet', rail)?.remainingCapacity, 0.5)

  const combat = { ...movement(6), cursor: { first: 'soviet', phasing: 'soviet', phase: 'combat' } }
  assert.equal(campaignRailStatus(combat, 'soviet', rail), null)
  assert.throws(() => dnieperRailCapacity('soviet', 0), /turn out of range/)
  assert.throws(() => dnieperRailCapacity('soviet', 64), /turn out of range/)
})

test('scenario 01 production rail board reports the dated capacity and opens only in movement', async () => {
  const { loaded, state, boards } = await load()
  const atRailhead = loaded.playable.resolveHex('D55.5')
  const turnSix = {
    ...state, turn: 6, cursor: { first: 'soviet', phasing: 'soviet', phase: 'movement' },
    movementSegment: 'movement', hexControl: { ...state.hexControl, [atRailhead]: 'soviet' },
  }

  assert.deepEqual(campaignRailStatus(turnSix, 'soviet', boards.railTransport),
    { capacity: 7.5, remainingCapacity: 7.5 })
  const loadAtSix = campaignRailLoading(turnSix, 'soviet', atRailhead, boards.railTransport, boards.groundMovement)
  assert.equal(loadAtSix.ok, true)
  assert.equal(loadAtSix.remainingCapacity, 7.5)

  const combat = { ...turnSix, cursor: { first: 'soviet', phasing: 'soviet', phase: 'combat' } }
  assert.deepEqual(campaignRailLoading(combat, 'soviet', atRailhead, boards.railTransport, boards.groundMovement),
    { ok: false, reason: 'window-closed' })
})
