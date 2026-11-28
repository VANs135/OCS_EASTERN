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
import { removeCampaignKessel } from '../src/match/campaign-kessel-placement.ts'
import { dnieperCampaignBoards } from '../src/match/dnieper-campaign-boards.ts'

const ROOT = 'D:/war game/OCS各作数据库/OCS第三个冬天'
const SCENARIO = '01-dnepr-battles'
const KESSEL = 'campaign-setup:654'
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

const axisReinforcement = (state) => ({
  ...state,
  cursor: { first: 'soviet', phasing: 'axis', phase: 'reinforcement' },
  reinforcement: { ...(state.reinforcement ?? {}), stage: 'ordinary' },
})

test('scenario 01 Kessel HQ removes, returns after three turns, and places with a real friendly combat unit', async () => {
  const { opened, boards } = await scenario01()
  const turnOne = axisReinforcement({ ...opened, turn: 1 })
  const removed = applyCampaignTurn(turnOne, 'axis', { type: 'remove-campaign-kessel', kesselId: KESSEL },
    { kesselPlacement: boards.kesselPlacement })
  assert.deepEqual(removed.counters[KESSEL].location, { kind: 'available' })
  assert.equal(removed.kesselReturn?.[KESSEL], 4)
  assert.equal(boards.groundMovement.traceSupply(removed, 'axis').network.hasTrace('B42.6', 'leg'), false,
    'removing the only Kessel HQ removes its self-contained source')

  assert.throws(() => applyCampaignTurn({ ...removed, turn: 2 }, 'axis',
    { type: 'place-campaign-kessel', kesselId: KESSEL, hex: 'B42.6' },
    { kesselPlacement: boards.kesselPlacement }), /returns three turns/)

  const turnFour = axisReinforcement({ ...removed, turn: 4 })
  const placed = applyCampaignTurn(turnFour, 'axis',
    { type: 'place-campaign-kessel', kesselId: KESSEL, hex: 'B42.6' },
    { kesselPlacement: boards.kesselPlacement })
  assert.deepEqual(placed.counters[KESSEL].location, { kind: 'map', hex: 'B42.6' })
  assert.equal(placed.counters[KESSEL].mode, 'combat')
  assert.equal(placed.kesselReturn?.[KESSEL], undefined)
  const kesselTrace = boards.groundMovement.traceSupply(placed, 'axis')
  assert.ok(kesselTrace.network.trace('B42.6').some((option) =>
    option.kind === 'self-contained' && option.headquarters === KESSEL))
  const strategic = {
    ...placed,
    counters: { ...placed.counters, [KESSEL]: { ...placed.counters[KESSEL], mode: 'strat' } },
  }
  assert.equal(boards.groundMovement.traceSupply(strategic, 'axis').network.hasTrace('B42.6', 'leg'), false,
    'a strategic-mode Kessel HQ is not a self-contained source')

  assert.throws(() => applyCampaignTurn(turnFour, 'axis',
    { type: 'place-campaign-kessel', kesselId: KESSEL, hex: 'D55.5' },
    { kesselPlacement: boards.kesselPlacement }), /friendly combat unit/)
  assert.throws(() => removeCampaignKessel({ ...turnOne,
    cursor: { first: 'soviet', phasing: 'axis', phase: 'movement' }, movementSegment: 'movement' },
    'axis', { type: 'remove-campaign-kessel', kesselId: KESSEL },
    boards.kesselPlacement), /Axis reinforcement phase/)
})

test('scenario 01 Kessel free move uses the real Kessel HQ, stops eastward, and is once per turn', async () => {
  const { opened, boards } = await scenario01()
  const turnOne = {
    ...opened, turn: 1, weather: { ...opened.weather, ground: 'dry' },
    cursor: { first: 'soviet', phasing: 'axis', phase: 'movement' }, movementSegment: 'movement',
  }
  const moved = applyCampaignTurn(turnOne, 'axis',
    { type: 'kessel-campaign-free-move', counterId: KESSEL, path: ['B41.6'] },
    { groundMovement: boards.groundMovement, kesselBoard: boards.kesselBoard })
  assert.deepEqual(moved.counters[KESSEL].location, { kind: 'map', hex: 'B41.6' })
  assert.equal(moved.kesselFreeMove?.turn, 1)

  assert.throws(() => applyCampaignTurn(turnOne, 'axis',
    { type: 'kessel-campaign-free-move', counterId: KESSEL, path: ['B43.6'] },
    { groundMovement: boards.groundMovement, kesselBoard: boards.kesselBoard }), /no-further-east/)
  assert.throws(() => applyCampaignTurn(turnOne, 'axis',
    { type: 'kessel-campaign-free-move', counterId: KESSEL, path: ['B42.6', 'B42.7', 'B41.7', 'B41.6', 'B41.5'] },
    { groundMovement: boards.groundMovement, kesselBoard: boards.kesselBoard }), /four hexes/)
  assert.throws(() => applyCampaignTurn(moved, 'axis',
    { type: 'kessel-campaign-free-move', counterId: KESSEL, path: ['B41.5'] },
    { groundMovement: boards.groundMovement, kesselBoard: boards.kesselBoard }), /one Kessel HQ/)
})
