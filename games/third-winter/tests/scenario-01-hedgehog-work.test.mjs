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
import { workCampaignHedgehog } from '../src/match/campaign-hedgehogs.ts'

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

test('scenario 01 real hedgehog D35.29 reduces with a stationary real combat unit', async () => {
  const loaded = await scenario01()
  const state = openCampaignMatch(prepareDnieperBoard(loaded), createRngState(1)).state
  const hedgehogHex = loaded.playable.resolveHex('D35.29')
  assert.ok(hedgehogHex, 'D35.29 is on the 01 map')
  assert.deepEqual(state.hedgehogs[hedgehogHex], { side: 'axis', level: 1 })
  const row = loaded.setup.counters.find((counter) => counter.ref === 'Ge 302 Ers Bn')
  assert.ok(row)
  const workerId = Object.keys(state.counters).find((id) => state.counters[id].side === 'axis' &&
    state.counters[id].definition === row.definition && state.counters[id].location.kind === 'map' &&
    state.counters[id].location.hex === hedgehogHex)
  assert.ok(workerId, 'the real Axis unit at D35.29 is on the board')
  const truckRow = loaded.setup.counters.find((counter) => counter.ref === 'Ge 23.Pz Truck')
  assert.ok(truckRow)
  const truckId = Object.keys(state.counters).find((id) => state.counters[id].side === 'axis' &&
    state.counters[id].definition === truckRow.definition)

  const board = {
    map: loaded.playable,
    worker(current, id) {
      const counter = current.counters[id]
      if (!counter || counter.location.kind !== 'map') return undefined
      const definition = loaded.catalog.definitions.get(counter.definition)
      const attack = definition?.source.faces.combat?.stats.attack
      return { hex: counter.location.hex, combat: typeof attack === 'number' && attack > 0,
        stationary: !(current.groundMovement?.moved ?? []).includes(id),
        re: counter.currentRe ?? 1, engineerAt: () => false }
    },
    printed: (current, hex) => loaded.setup.initialHedgehogs.find((entry) => entry.hex === hex) ?? null,
  }
  const movement = { ...state, cursor: { first: 'axis', phasing: 'axis', phase: 'movement' },
    movementSegment: 'movement', groundMovement: { moved: [], zocLocks: [] } }
  const after = workCampaignHedgehog(movement, 'axis', { type: 'work-campaign-hedgehog', operation: 'reduce',
    hex: hedgehogHex, unitIds: [workerId] }, board)
  assert.equal(after.hedgehogs[hedgehogHex], null)
  assert.equal(after.hedgehogReducedAt[hedgehogHex], state.turn)
  assert.ok(after.groundMovement.moved.includes(workerId))

  assert.throws(() => workCampaignHedgehog(movement, 'axis', { type: 'work-campaign-hedgehog', operation: 'reduce',
    hex: hedgehogHex, unitIds: [truckId] }, board), /Illegal hedgehog work: hedgehog-workers-required/)
})
