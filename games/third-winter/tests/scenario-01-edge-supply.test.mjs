import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { prepareCampaignSetup } from '../src/import/campaign-setup.ts'
import { campaignTerrain } from '../src/import/campaign-terrain.ts'
import { loadThirdWinterV2Units } from '../src/import/unit-v2.ts'
import { campaignMapInPlayArea, ttwCampaignPlayArea } from '../src/ttw/campaign/play-area.ts'
import { prepareDnieperBoard } from '../src/match/dnieper-opening.ts'
import { dnieperEdgeSupplySources } from '../src/match/dnieper-edge-supply.ts'
import { openCampaignMatch } from '../src/match/campaign-match.ts'
import { dnieperCampaignBoards } from '../src/match/dnieper-campaign-boards.ts'
import { completeCampaignCleanup } from '../src/match/campaign-cleanup-phase.ts'
import { createRngState } from '@ocs-eastern/series/rng'

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
  return { catalog, setup, setupRaw, playable, terrain, map }
}

test('scenario 01 edge supply sources follow 2.1a/3.1a map edges and dated handovers', async () => {
  const loaded = await load()
  const opening = prepareDnieperBoard(loaded)
  const initial = dnieperEdgeSupplySources(loaded.map, 1)

  assert.deepEqual(opening.edgeSupplySources, initial)
  assert.deepEqual([initial.axis.length, initial.soviet.length], [59, 21])
  assert(initial.axis.includes('A50.34'), 'Korosten is an Axis source before 1 Jan')
  assert(initial.axis.includes('A50.35'))
  assert(initial.axis.includes('B2.35'), 'B2.35 is an Axis source in September')
  assert(initial.soviet.includes('B16.35'), 'B north edge starts at B16.35 inclusive')
  assert(initial.soviet.includes('B62.31'), 'B east edge has a rail/road entry')

  for (const hex of [...initial.axis, ...initial.soviet]) {
    assert(loaded.map.canonicalByHex.has(hex), `supply source is on the map: ${hex}`)
  }
  assert(!initial.axis.some((hex) => initial.soviet.includes(hex)))

  const turn5 = dnieperEdgeSupplySources(loaded.map, 5)
  assert.deepEqual([turn5.axis.length, turn5.soviet.length], [58, 22])
  assert(!turn5.axis.includes('B2.35'))
  assert(turn5.soviet.includes('B2.35'), '8 Oct turns B2.35 over to the Soviets')
  assert(turn5.axis.includes('A50.34'))

  const turn30 = dnieperEdgeSupplySources(loaded.map, 30)
  assert.deepEqual([turn30.axis.length, turn30.soviet.length], [55, 25])
  assert(!turn30.axis.includes('A50.34'))
  assert(!turn30.axis.includes('A50.35'))
  assert(turn30.soviet.includes('A50.34'))
  assert(turn30.soviet.includes('A50.35'), '1 Jan turns Korosten and road hexes east over')
  assert(turn30.axis.includes('A25.35'), 'Rovno is still Axis on 1 Jan')

  const turn32 = dnieperEdgeSupplySources(loaded.map, 32)
  assert.deepEqual([turn32.axis.length, turn32.soviet.length], [46, 34])
  assert(!turn32.axis.includes('D43.0'))
  assert(turn32.soviet.includes('D43.0'), '8 Jan opens the D south edge to the Soviets')

  const turn40 = dnieperEdgeSupplySources(loaded.map, 40)
  assert.deepEqual([turn40.axis.length, turn40.soviet.length], [41, 39])
  assert(!turn40.axis.includes('A25.35'))
  assert(turn40.soviet.includes('A25.35'), '5 Feb turns Rovno over')
  assert(turn40.soviet.includes('A38.35'))
  assert(turn40.soviet.includes('A42.35'))
  assert(turn40.axis.includes('A19.35'), 'road hexes west of Rovno remain Axis')
})

test('scenario 01 production trace consumes the edge sources and keeps real in/out units distinct', async () => {
  const loaded = await load()
  const opening = prepareDnieperBoard(loaded)
  const state = openCampaignMatch(opening, createRngState(2)).state
  const boards = dnieperCampaignBoards(loaded)

  assert.deepEqual(boards.edgeSupplySourcesForTurn(1), initialFor(loaded))
  assert.deepEqual(boards.edgeSupplySourcesForTurn(5), dnieperEdgeSupplySources(loaded.map, 5))

  const axisTrace = boards.groundMovement.traceSupply(state, 'axis')
  const sovietTrace = boards.groundMovement.traceSupply(state, 'soviet')
  assert.ok(axisTrace)
  assert.ok(sovietTrace)

  const axisKorosten = Object.entries(state.counters).find(([, counter]) => counter.side === 'axis' &&
    counter.location.kind === 'map' && counter.location.hex === loaded.playable.resolveHex('A50.34'))
  const sovietEast = Object.entries(state.counters).find(([, counter]) => counter.side === 'soviet' &&
    counter.location.kind === 'map' && counter.location.hex === loaded.playable.resolveHex('B62.31'))
  const axisDepth = Object.entries(state.counters).find(([, counter]) => counter.definition === 'land:id:4055')
  const sovietDepth = Object.entries(state.counters).find(([, counter]) => counter.definition === 'land:id:2070')
  assert.ok(axisKorosten, 'real Axis unit on A50.34')
  assert.ok(sovietEast, 'real Soviet unit on B62.31')
  assert.ok(axisDepth, 'real Ge 302 Ers Bn')
  assert.ok(sovietDepth, 'real Sov 50 Rifle Div')

  const axisUnit = axisTrace.ground.friendly.get(axisKorosten[0])
  const sovietUnit = sovietTrace.ground.friendly.get(sovietEast[0])
  assert.ok(axisUnit)
  assert.ok(sovietUnit)
  assert.equal(axisTrace.network.hasTrace(axisUnit.hex, axisUnit.profile.drawMobility), true,
    'A50.34 is an Axis edge source')
  assert.equal(sovietTrace.network.hasTrace(sovietUnit.hex, sovietUnit.profile.drawMobility), true,
    'B62.31 is a Soviet edge source')

  const axisDeep = axisTrace.ground.friendly.get(axisDepth[0])
  const sovietDeep = sovietTrace.ground.friendly.get(sovietDepth[0])
  assert.ok(axisDeep)
  assert.ok(sovietDeep)
  assert.equal(axisTrace.network.hasTrace(axisDeep.hex, axisDeep.profile.drawMobility), false,
    'D35.29 is beyond the initial Axis road trace')
  assert.equal(sovietTrace.network.hasTrace(sovietDeep.hex, sovietDeep.profile.drawMobility), false,
    'D59.29 is beyond the initial Soviet road trace')
})

test('scenario 01 cleanup refreshes the edge source snapshot for the next turn', () => {
  let asked
  const refreshed = { axis: ['A50.34'], soviet: ['B62.31'] }
  const cleaned = completeCampaignCleanup({
    turn: 1, when: { scenarioId: '01-dnepr-battles', date: '1943-09-26' },
    cursor: { first: 'axis', phasing: 'soviet', phase: 'cleanup' }, counters: {},
  }, 'soviet', {
    cleanupEndBlockers: () => [],
    roundEnd: () => ({ kind: 'continue', date: '1943-10-01' }),
    edgeSupplySourcesForTurn: (turn) => {
      asked = turn
      return refreshed
    },
  })
  assert.equal(asked, 2)
  assert.equal(cleaned.turn, 2)
  assert.deepEqual(cleaned.edgeSupplySources, refreshed)
})

function initialFor(loaded) {
  return dnieperEdgeSupplySources(loaded.map, 1)
}
