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
import { applyCampaignRailTransport, campaignRailLoading, campaignRailStatus } from '../src/match/campaign-rail-transport.ts'
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
    movementSegment: 'movement',
  }

  assert.deepEqual(campaignRailStatus(turnSix, 'soviet', boards.railTransport),
    { capacity: 7.5, remainingCapacity: 7.5 })
  const loadAtSix = campaignRailLoading(turnSix, 'soviet', atRailhead, boards.railTransport, boards.groundMovement)
  assert.equal(loadAtSix.ok, true)
  assert.equal(loadAtSix.remainingCapacity, 7.5)
  assert.ok(loadAtSix.counters?.some((counter) => counter.id === 'campaign-setup:4'),
    'D55.5 must offer the real Soviet land unit after the railhead control baseline')

  const combat = { ...turnSix, cursor: { first: 'soviet', phasing: 'soviet', phase: 'combat' } }
  assert.deepEqual(campaignRailLoading(combat, 'soviet', atRailhead, boards.railTransport, boards.groundMovement),
    { ok: false, reason: 'window-closed' })
})

test('scenario 01 real rail cargo rides the broad gauge and unloads only at a designated site', async () => {
  const { state, boards } = await load()
  const turnSix = {
    ...state, turn: 6, cursor: { first: 'soviet', phasing: 'soviet', phase: 'movement' },
    movementSegment: 'movement',
  }
  const broadPath = ['D55.5', 'D56.5', 'D56.6', 'D56.7', 'D55.8', 'D55.9']
  const action = {
    type: 'transport-campaign-rail', path: broadPath,
    counterIds: ['campaign-setup:4', 'campaign-setup:5'],
    moveFaceIds: ['campaign-setup:4', 'campaign-setup:5'], supplyTokens: 0,
  }
  const settled = applyCampaignRailTransport(turnSix, 'soviet', action, boards.railTransport, boards.groundMovement)
  assert.deepEqual(settled.counters['campaign-setup:4'].location, { kind: 'map', hex: 'D55.9' })
  assert.deepEqual(settled.counters['campaign-setup:5'].location, { kind: 'map', hex: 'D55.9' })
  assert.equal(settled.groundMovement?.railCapacitySpent, 1.5, '0.5 RE + 1 RE charged against turn 6 capacity')

  assert.deepEqual(applyRefusal(turnSix, boards, ['D55.5', 'D56.5', 'D56.6']), 'rail-unloading-unavailable',
    'an ordinary rail hex is not a cargo unload site')
  assert.deepEqual(applyRefusal(turnSix, boards, ['D55.5', 'D54.5']), 'rail-wrong-gauge',
    'the standard-gauge approach is not usable by Soviet rail')
})

test('scenario 01 only a real rail repair unit may convert the entered rail hex', async () => {
  const { state, boards } = await load()
  const turnSix = {
    ...state, turn: 6, weather: { ...state.weather, ground: 'dry' },
    cursor: { first: 'soviet', phasing: 'soviet', phase: 'movement' }, movementSegment: 'movement',
  }
  assert.equal(boards.groundMovement.railNetwork.isRepairUnit(turnSix, 'campaign-setup:5'), true,
    'Sov 4.Ukr Rail Repair carries rail_repair')
  assert.equal(boards.groundMovement.railNetwork.isRepairUnit(turnSix, 'campaign-setup:4'), false,
    'an ordinary land unit does not carry rail_repair')

  const work = {
    type: 'move-campaign-ground',
    movers: [{ id: 'campaign-setup:5', railWork: [{ step: 1, connections: ['D53.5'] }] }],
    path: ['D54.5'],
  }
  const settled = applyCampaignTurn(turnSix, 'soviet', work, { groundMovement: boards.groundMovement })
  assert.deepEqual(settled.counters['campaign-setup:5'].location, { kind: 'map', hex: 'D54.5' })
  assert.equal(settled.railGaugeByEdge['D54.5|D55.5'], 'broad',
    'entry edge D55.5–D54.5 switches to Soviet broad gauge')
  assert.equal(settled.railGaugeByEdge['D53.5|D54.5'], 'broad',
    'the whole hex converts, including the outgoing edge toward D53.5')
  assert.equal(settled.groundMovement.railConversionCount['campaign-setup:5'], 1)
  assert.deepEqual(settled.groundMovement.railConvertedHexes, ['D54.5'])

  assert.throws(() => applyCampaignTurn(turnSix, 'soviet', {
    ...work, movers: [{ id: 'campaign-setup:4', railWork: [{ step: 1, connections: ['D53.5'] }] }],
  }, { groundMovement: boards.groundMovement }), /rail-repair-unit-required/)
})

function applyRefusal(state, boards, path) {
  try {
    applyCampaignRailTransport(state, 'soviet', {
      type: 'transport-campaign-rail', path,
      counterIds: ['campaign-setup:4'], moveFaceIds: ['campaign-setup:4'], supplyTokens: 0,
    }, boards.railTransport, boards.groundMovement)
    return 'settled'
  } catch (error) {
    return String(error.message).replace('Campaign rail transport: ', '')
  }
}
