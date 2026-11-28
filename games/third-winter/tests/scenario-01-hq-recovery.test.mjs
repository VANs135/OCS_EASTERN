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
  return { state, boards: dnieperCampaignBoards({ ...loaded, railheads: state.initialRailheadMarkers }) }
}

function destroyedArmyHq(state) {
  const counter = state.counters['campaign-setup:747']
  assert.equal(counter?.definition, 'hq:id:4149', 'B14.5 is the real Ge HQ 8 Army')
  return {
    ...state,
    turn: 2,
    cursor: { first: 'soviet', phasing: 'axis', phase: 'reinforcement' },
    reinforcement: { stage: 'ordinary', window: { segment: 'rebuild-consolidate' } },
    counters: {
      ...state.counters,
      ['campaign-setup:747']: { ...counter, location: { kind: 'dead-pile' } },
    },
    hqRecoveries: [{
      id: 'campaign-setup:747', definition: counter.definition, kind: 'army', result: 'free-rebuild', turn: 1, availableTurn: 2,
    }],
  }
}

test('scenario 01 real destroyed Axis Army HQ rebuilds free at another Army HQ (§2.3b E)', async () => {
  const { state, boards } = await load()
  const turn = destroyedArmyHq(state)

  const destinations = boards.hqRecovery.destinations(turn, turn.hqRecoveries[0])
  assert(destinations.includes('D35.13'), 'real Ge HQ 6 Army hex is a legal Army HQ rebuilding site')
  assert.equal(destinations.includes('B41.6'), false, 'a city without an Army HQ is not an Army HQ site')

  assert(boards.hqRecovery.destinations(turn, { kind: 'army-group' }).includes('B41.6'),
    'the real Axis-controlled Poltava city is a legal Army Group HQ rebuild site')
  const corps = boards.hqRecovery.destinations(turn, { kind: 'corps' })
  assert(corps.includes('D35.13') && corps.includes('A42.11'),
    'Corps HQ may rebuild at either a real Army HQ or the real Army Group HQ hex')

  const result = applyCampaignTurn(turn, 'axis', {
    type: 'place-campaign-hq-recovery', recoveryId: 'campaign-setup:747', hex: 'D35.13',
  }, { hqRecovery: boards.hqRecovery })

  assert.deepEqual(result.counters['campaign-setup:747'].location, { kind: 'map', hex: 'D35.13' })
  assert.equal(result.counters['campaign-setup:747'].currentRe, 1, 'HQ returns at full printed step')
  assert.equal(result.counters['campaign-setup:747'].mode, 'combat')
  assert.equal(result.counters['campaign-setup:747'].disorganized, false)
  assert.equal(result.hqRecoveries.length, 0, 'the free-rebuild record is consumed')
  assert.equal(turn.counters['campaign-setup:747'].location.kind, 'dead-pile', 'failed input leaves the board unchanged')

  assert.throws(() => applyCampaignTurn(turn, 'axis', {
    type: 'place-campaign-hq-recovery', recoveryId: 'campaign-setup:747', hex: 'B41.6',
  }, { hqRecovery: boards.hqRecovery }), /illegal-destination/)

  assert.throws(() => applyCampaignTurn({ ...turn, turn: 1 }, 'axis', {
    type: 'place-campaign-hq-recovery', recoveryId: 'campaign-setup:747', hex: 'D35.13',
  }, { hqRecovery: boards.hqRecovery }), /not due until the next Axis reinforcement phase/)
})
