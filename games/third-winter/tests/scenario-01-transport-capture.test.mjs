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
import { buildTransportCaptureGroup, planTransportSplit, transportDisplacementCandidates,
  validateTransportCaptureChoice } from '@ocs-eastern/series/transport-capture'

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

function bfs(map, from) {
  const distance = new Map([[from, 0]])
  const queue = [from]
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const hex = queue[cursor]
    for (const neighbor of map.neighbors(hex)) {
      if (distance.has(neighbor)) continue
      distance.set(neighbor, distance.get(hex) + 1)
      queue.push(neighbor)
    }
  }
  return distance
}

test('scenario 01 real truck/wagon markers complete 9.14c group, owner choice and displacement', async () => {
  const loaded = await scenario01()
  const { map, playable, setupRaw } = loaded
  const truckMarker = setupRaw.markers.find((row) => row.ref === 'Truck Points' && row.at.map === 'B' &&
    row.at.col === 35 && row.at.row === 17)
  const wagonMarker = setupRaw.markers.find((row) => row.ref === 'Wagon Points' && row.at.map === 'B' &&
    row.at.col === 16 && row.at.row === 28)
  assert.ok(truckMarker)
  assert.ok(wagonMarker)
  const truckHex = `B${truckMarker.at.col}.${truckMarker.at.row}`
  const wagonHex = `B${wagonMarker.at.col}.${wagonMarker.at.row}`
  assert.ok(playable.availableHexes.has(truckHex))
  assert.ok(playable.availableHexes.has(wagonHex))
  assert.equal(truckMarker.count, 2)
  assert.equal(wagonMarker.count, 3)

  const state = openCampaignMatch(prepareDnieperBoard(loaded), createRngState(1)).state
  const truckCounters = Object.entries(state.counters).filter(([, counter]) => counter.kind === 'transport' &&
    counter.location.kind === 'map' && counter.location.hex === truckHex &&
    counter.definition.endsWith(':tp_013'))
  const wagonCounters = Object.entries(state.counters).filter(([, counter]) => counter.kind === 'transport' &&
    counter.location.kind === 'map' && counter.location.hex === wagonHex &&
    counter.definition.endsWith(':tp_011'))
  assert.equal(truckCounters.length, 2)
  assert.equal(wagonCounters.length, 3)

  const truck = buildTransportCaptureGroup('trucks', 3,
    truckCounters.map(([id, counter]) => ({ id, points: counter.transportPoints, tokens: counter.transportCargoTokens })))
  assert.deepEqual([truck.totalPoints, truck.totalTokens, truck.capturedPoints], [2, 0, 1])
  const truckPlan = planTransportSplit(truck)
  assert.deepEqual(truckPlan.capturedIds, [truckCounters[0][0]])
  assert.equal(truckPlan.exact, true)
  assert.deepEqual(validateTransportCaptureChoice(truck, truckPlan.capturedIds), truckPlan)
  assert.throws(() => validateTransportCaptureChoice(truck, ['01:no-such-counter']), /unknown counter/)

  const wagon = buildTransportCaptureGroup('wagons', 4,
    wagonCounters.map(([id, counter]) => ({ id, points: counter.transportPoints, tokens: counter.transportCargoTokens })))
  assert.deepEqual([wagon.totalPoints, wagon.capturedPoints], [3, 2])
  const wagonPlan = planTransportSplit(wagon)
  assert.equal(wagonPlan.exact, true)
  assert.equal(wagonPlan.capturedIds.length, 2)
  assert.equal(wagonPlan.displacedIds.length, 1)

  const from = truckHex
  const distances = bfs(map, from)
  const candidates = transportDisplacementCandidates(from, [...playable.availableHexes],
    (a, b) => distances.get(b) ?? Infinity, 'trucks')
  const adjacent = map.neighbors(from).find((hex) => playable.availableHexes.has(hex))
  assert.ok(adjacent)
  assert.ok(candidates.includes(adjacent))
  assert.ok(!candidates.includes(from))
  const far = [...playable.availableHexes].find((hex) => (distances.get(hex) ?? Infinity) > 10)
  assert.ok(far)
  assert.ok(!candidates.includes(far))
  assert.equal(transportDisplacementCandidates(from, [from, adjacent], () => 0, 'wagons').length, 1)
})
