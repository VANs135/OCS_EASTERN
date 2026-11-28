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
import { dnieperGroundMovementBoard } from '../src/match/dnieper-ground-movement.ts'

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
const terrain = { terrainAt: () => [], crossingAt: () => ({ barrier: 'none', routes: [] }) }
const distance = (map, from, to) => {
  const start = map.resolveHex(from)
  const target = map.resolveHex(to)
  if (!start || !target) return Infinity
  if (start === target) return 0
  const seen = new Set([start])
  let frontier = [start]
  for (let steps = 1; frontier.length; steps += 1) {
    const next = []
    for (const hex of frontier) for (const neighbor of map.neighbors(hex)) {
      if (seen.has(neighbor)) continue
      if (neighbor === target) return steps
      seen.add(neighbor)
      next.push(neighbor)
    }
    frontier = next
  }
  return Infinity
}

test('scenario 01 ground entry captures the real B20.29 airbase and transfers its aircraft', async () => {
  const loaded = await scenario01()
  const state = openCampaignMatch(prepareDnieperBoard(loaded), createRngState(1)).state
  const base = state.airBases.find((candidate) => candidate.side === 'soviet' &&
    candidate.hex === loaded.playable.resolveHex('B20.29'))
  assert.ok(base)
  const aircraftIds = Object.keys(state.counters).filter((id) => state.counters[id].side === 'soviet' &&
    state.counters[id].kind === 'aircraft' && state.counters[id].location.kind === 'map' &&
    state.counters[id].location.hex === base.hex)
  assert.equal(aircraftIds.length, 4)
  const destination = state.airBases.find((candidate) => candidate.side === 'soviet' &&
    candidate.hex === loaded.playable.resolveHex('B54.32'))
  assert.ok(destination)
  const attackerRow = loaded.setup.counters.find((counter) => counter.ref === 'Ge 302 Ers Bn')
  const attackerId = Object.keys(state.counters).find((id) => state.counters[id].side === 'axis' &&
    state.counters[id].definition === attackerRow.definition)
  const truckRow = loaded.setup.counters.find((counter) => counter.ref === 'Ge 23.Pz Truck')
  const truckId = Object.keys(state.counters).find((id) => state.counters[id].side === 'axis' &&
    state.counters[id].definition === truckRow.definition)
  const airBaseBoard = { map: loaded.playable,
    attackCapable(_state, id) {
      const attack = loaded.catalog.definitions.get(state.counters[id]?.definition ?? '')?.source.faces.combat?.stats.attack
      return typeof attack === 'number' && attack > 0
    },
    rangeOf(_state, id) {
      const range = loaded.catalog.definitions.get(state.counters[id]?.definition ?? '')?.source.faces.combat?.stats.range
      return typeof range === 'number' ? range : undefined
    },
    distance: (from, to) => distance(loaded.playable, from, to) }
  const board = dnieperGroundMovementBoard(loaded.playable, terrain, loaded.catalog.definitions,
    { board: airBaseBoard, options: { destination: destination.hex } })
  const entered = { ...state, counters: { ...state.counters,
    [attackerId]: { ...state.counters[attackerId], location: { kind: 'map', hex: base.hex } } } }
  const after = board.resolveEntry?.(entered, 'axis', base.hex, [attackerId]) ?? entered
  assert.equal(after.airBases.find((candidate) => candidate.hex === base.hex).side, 'axis')
  for (const id of aircraftIds) {
    assert.equal(after.counters[id].location.kind, 'map')
    assert.equal(after.counters[id].location.hex, destination.hex)
    assert.equal(after.counters[id].active, false)
  }

  const refusedState = { ...state, counters: { ...state.counters,
    [truckId]: { ...state.counters[truckId], location: { kind: 'map', hex: base.hex } } } }
  const refused = board.resolveEntry?.(refusedState, 'axis', base.hex, [truckId]) ?? refusedState
  assert.equal(refused.airBases.find((candidate) => candidate.hex === base.hex).side, 'soviet')
  for (const id of aircraftIds) assert.equal(refused.counters[id].location.hex, base.hex)
  assert.equal(refused, refusedState)
})
