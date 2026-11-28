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
import { campaignMovementProfiles } from '../src/match/campaign-movement-profiles.ts'
import { workCampaignAirfield } from '../src/match/campaign-airfield.ts'

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

test('scenario 01 real B20.29 airbase reduces one level with a stationary local combat unit', async () => {
  const loaded = await scenario01()
  const opened = openCampaignMatch(prepareDnieperBoard(loaded), createRngState(1)).state
  const hex = loaded.playable.resolveHex('B20.29')
  assert.ok(hex, 'B20.29 is on the 01 map')
  assert.deepEqual(opened.airBases.find((base) => base.hex === hex), { hex, side: 'soviet', level: 3 })
  const row = loaded.setup.counters.find((counter) => counter.ref === 'Sov 50 Rifle Div')
  assert.ok(row)
  const workerId = Object.keys(opened.counters).find((id) => opened.counters[id].side === 'soviet' &&
    opened.counters[id].definition === row.definition && opened.counters[id].location.kind === 'map')
  assert.ok(workerId)
  const truckRow = loaded.setup.counters.find((counter) => counter.ref === 'Sov 5.Gd Cav Truck')
  assert.ok(truckRow)
  const truckId = Object.keys(opened.counters).find((id) => opened.counters[id].side === 'soviet' &&
    opened.counters[id].definition === truckRow.definition)
  const counters = { ...opened.counters,
    [workerId]: { ...opened.counters[workerId], location: { kind: 'map', hex } } }
  const state = { ...opened, counters, cursor: { first: 'soviet', phasing: 'soviet', phase: 'movement' },
    movementSegment: 'movement', groundMovement: { moved: [], zocLocks: [] } }
  const profiles = campaignMovementProfiles(Object.fromEntries(loaded.catalog.definitions))
  const board = { map: loaded.playable,
    worker(current, id) {
      const counter = current.counters[id]
      if (!counter || counter.location.kind !== 'map') return undefined
      return { hex: counter.location.hex, combat: profiles.profileOf(current, id)?.combat === true,
        stationary: !(current.groundMovement?.moved ?? []).includes(id), re: counter.currentRe ?? 1,
        engineerAt: () => false }
    } }
  const after = workCampaignAirfield(state, 'soviet', { type: 'work-campaign-airfield', operation: 'reduce', hex,
    unitIds: [workerId] }, board)
  assert.equal(after.airBases.find((base) => base.hex === hex).level, 2)
  assert.equal(after.airfieldReducedAt[hex], state.turn)

  assert.throws(() => workCampaignAirfield(state, 'soviet', { type: 'work-campaign-airfield', operation: 'reduce', hex,
    unitIds: [truckId] }, board), /Illegal airfield work: airfield-workers-required/)
})
