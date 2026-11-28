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
import { applyCampaignTurn } from '../src/match/campaign-match.ts'
import { campaignGroundMovementOptions } from '../src/match/campaign-ground-movement.ts'

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
  const opening = prepareDnieperBoard(loaded)
  const state = openCampaignMatch(opening, createRngState(4)).state
  return { loaded, state, boards: dnieperCampaignBoards({ ...loaded, railheads: state.initialRailheadMarkers }) }
}

test('scenario 01 real Army HQ is rail-only and is excluded from ordinary ground movement', async () => {
  const { state, boards } = await load()
  const turn = {
    ...state, turn: 1,
    cursor: { first: 'soviet', phasing: 'axis', phase: 'movement' }, movementSegment: 'movement',
  }

  assert.equal(turn.counters['campaign-setup:747']?.definition, 'hq:id:4149',
    'B14.5 is the real Ge HQ 8 Army')
  assert.equal(boards.groundMovement.railOnly?.(turn, 'campaign-setup:747'), true)
  assert.equal(boards.groundMovement.moveProfile(turn, 'campaign-setup:747')?.ma, 0,
    'rail-only HQ has no ground MA')

  const options = campaignGroundMovementOptions(turn, 'axis', boards.groundMovement)
  assert.equal(options.availableIds.includes('campaign-setup:747'), false,
    'HQ does not appear in the ordinary movement picker')

  assert.throws(() => applyCampaignTurn(turn, 'axis', {
    type: 'move-campaign-ground', movers: [{ id: 'campaign-setup:747' }], path: ['B14.4'],
  }, { groundMovement: boards.groundMovement }), /hq-rail-only/)
})
