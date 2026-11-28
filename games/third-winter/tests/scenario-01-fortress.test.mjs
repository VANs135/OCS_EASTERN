import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRngState } from '@ocs-eastern/series/rng'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { prepareCampaignSetup } from '../src/import/campaign-setup.ts'
import { loadThirdWinterV2Units } from '../src/import/unit-v2.ts'
import { campaignMapInPlayArea, ttwCampaignPlayArea } from '../src/ttw/campaign/play-area.ts'
import { prepareDnieperBoard } from '../src/match/dnieper-opening.ts'
import { openCampaignMatch } from '../src/match/campaign-match.ts'
import { campaignCityControl } from '../src/match/campaign-control.ts'
import { campaignFortressBoards } from '../src/match/campaign-fortress-board.ts'
import { declareCampaignFortress, settleCampaignFortressStatus } from '../src/match/campaign-fortress.ts'

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
  const setup = prepareCampaignSetup(setupRaw, catalog.aliases, map, playable)
  return { map, playable, catalog, setup, setupRaw }
}

test('scenario 01 Poltava fortress keeps its real Axis fortress unit inside and ends only when both hexes are Soviet', async () => {
  const loaded = await scenario01()
  const state = openCampaignMatch(prepareDnieperBoard(loaded), createRngState(1)).state
  const poltava = loaded.map.cityOf('B41.6')
  assert.equal(poltava.city, 'Poltava')
  assert.deepEqual(poltava.hexes, ['B41.6', 'B42.6'])
  const fortress = state.fortresses.find(({ city }) => city === 'Poltava')
  assert.deepEqual(fortress.hexes, poltava.hexes)
  const unitId = Object.keys(state.counters).find((id) => state.counters[id].side === 'axis' &&
    state.counters[id].kind === 'land' && state.counters[id].location.kind === 'map' &&
    state.counters[id].location.hex === 'B41.6')
  assert.ok(unitId, 'the real Axis fortress unit at B41.6 is on the board')

  const hooks = campaignFortressBoards({
    map: loaded.playable,
    cityOf: (hex) => loaded.map.cityOf(hex),
    citySites: loaded.map.cities,
    isCombatUnit: (current, id) => current.counters[id]?.kind === 'land',
    fortressUnits: [],
  })
  assert.equal(hooks.exitRefusal(state, unitId, 'B41.6', 'B42.6'), null)
  assert.equal(hooks.exitRefusal(state, unitId, 'B41.6', 'B40.6'), 'fortress-city-no-exit')
  assert.equal(hooks.exitRefusal(state, unitId, 'B41.6', 'B41.5'), 'fortress-city-no-exit')

  const oneSoviet = { ...state, hexControl: { 'B41.6': 'soviet' } }
  const partial = settleCampaignFortressStatus(oneSoviet,
    () => campaignCityControl(oneSoviet, poltava.hexes) === 'soviet')
  assert.equal(partial.fortresses.length, state.fortresses.length)
  const bothSoviet = { ...state, hexControl: { 'B41.6': 'soviet', 'B42.6': 'soviet' } }
  const ended = settleCampaignFortressStatus(bothSoviet,
    () => campaignCityControl(bothSoviet, poltava.hexes) === 'soviet')
  assert.equal(ended.fortresses.some(({ city }) => city === 'Poltava'), false)

  assert.throws(() => declareCampaignFortress(state, 'axis',
    { type: 'declare-campaign-fortress', city: 'Poltava', hex: 'B41.6', fortress: 'german' },
    { ...hooks, axisControlsCity: () => true, enemyCombatWithin2: () => true,
      fortressUnit: () => ({ definition: 'Ge Fortress', re: 1 }) }), /already a fortress/)
})
