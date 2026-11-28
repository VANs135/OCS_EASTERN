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
import { applyCampaignRailTransport, campaignRailLoading, campaignRailStatus } from '../src/match/campaign-rail-transport.ts'

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
  const state = openCampaignMatch(opening, createRngState(3)).state
  return { loaded, state, boards: dnieperCampaignBoards({ ...loaded, railheads: state.initialRailheadMarkers }) }
}

function refuse(state, boards, path) {
  try {
    applyCampaignRailTransport(state, 'axis', {
      type: 'transport-campaign-rail', path,
      counterIds: ['campaign-setup:423'], moveFaceIds: ['campaign-setup:423'], supplyTokens: 0,
    }, boards.railTransport, boards.groundMovement)
    return 'settled'
  } catch (error) {
    return String(error.message).replace('Campaign rail transport: ', '')
  }
}

test('scenario 01 Axis rail rides the standard gauge between real cities and refuses ordinary unload', async () => {
  const { loaded, state, boards } = await load()
  const turn = {
    ...state, turn: 1,
    cursor: { first: 'soviet', phasing: 'axis', phase: 'movement' }, movementSegment: 'movement',
  }

  assert.deepEqual(campaignRailStatus(turn, 'axis', boards.railTransport),
    { capacity: 10, remainingCapacity: 10 })
  assert.equal(loaded.terrain.railAt('C25.20', 'C26.20'), 'single',
    'the Axis line at C25.20 is printed standard-gauge railway')
  const loading = campaignRailLoading(turn, 'axis', 'C25.20', boards.railTransport, boards.groundMovement)
  assert.equal(loading.ok, true)
  assert.ok(loading.counters?.some((counter) => counter.id === 'campaign-setup:423'),
    'C25.20 must offer the real Axis land unit')

  const settled = applyCampaignRailTransport(turn, 'axis', {
    type: 'transport-campaign-rail', path: ['C25.20', 'C26.20'],
    counterIds: ['campaign-setup:423'], moveFaceIds: ['campaign-setup:423'], supplyTokens: 0,
  }, boards.railTransport, boards.groundMovement)
  assert.deepEqual(settled.counters['campaign-setup:423'].location, { kind: 'map', hex: 'C26.20' })
  assert.equal(settled.groundMovement?.railCapacitySpent, 1, 'one RE against the Axis capacity')

  assert.equal(refuse(turn, boards, ['C25.20', 'C26.20', 'C26.21']), 'rail-unloading-unavailable',
    'an ordinary standard-gauge rail hex is not an Axis unload site')

  const broad = {
    ...turn,
    railGaugeByEdge: { ...(state.railGaugeByEdge ?? {}), 'C25.20|C26.20': 'broad' },
  }
  assert.equal(refuse(broad, boards, ['C25.20', 'C26.20']), 'rail-wrong-gauge',
    'Axis rail may not use a Soviet broad-gauge edge')
})
