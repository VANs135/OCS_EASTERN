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
import { captureCampaignAirBase } from '../src/match/campaign-airbase-capture.ts'

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

test('scenario 01 real Soviet airbase is captured and its real aircraft transfers inactive', async () => {
  const loaded = await scenario01()
  const opening = prepareDnieperBoard(loaded)
  const state = openCampaignMatch(opening, createRngState(1)).state
  const base = state.airBases.find((candidate) => candidate.side === 'soviet' &&
    Object.values(state.counters).some((counter) => counter.side === 'soviet' && counter.kind === 'aircraft' &&
      counter.location.kind === 'map' && counter.location.hex === candidate.hex))
  assert.ok(base, '01 has a Soviet airbase with at least one real aircraft')
  const aircraftIds = Object.keys(state.counters).filter((id) => state.counters[id].side === 'soviet' &&
    state.counters[id].kind === 'aircraft' && state.counters[id].location.kind === 'map' &&
    state.counters[id].location.hex === base.hex)
  const aircraft = state.counters[aircraftIds[0]]
  const range = loaded.catalog.definitions.get(aircraft.definition)?.source.faces.combat?.stats.range
  assert.ok(typeof range === 'number' && range > 0, 'the real aircraft has a printed range')
  const rangeOf = (id) => loaded.catalog.definitions.get(state.counters[id]?.definition ?? '')
    ?.source.faces.combat?.stats.range
  const destination = state.airBases.find((candidate) => candidate.side === 'soviet' &&
    candidate.hex !== base.hex && aircraftIds.every((id) => {
      const printed = rangeOf(id)
      return typeof printed === 'number' && distance(loaded.playable, base.hex, candidate.hex) <= printed * 2
    }))
  assert.ok(destination, '01 has another Soviet airbase within twice every aircraft range')

  const attacker = loaded.setup.counters.find((counter) => counter.ref === 'Ge 302 Ers Bn')
  assert.ok(attacker)
  const attackerId = Object.keys(state.counters).find((id) => state.counters[id].definition === attacker.definition)
  assert.ok(attackerId, 'the real Axis attacker is on the 01 board')
  const attackerHex = loaded.playable.neighbors(base.hex).find((hex) => hex !== base.hex)
  assert.ok(attackerHex, 'the real base has a real neighbor')
  const placed = { ...state, counters: { ...state.counters,
    [attackerId]: { ...state.counters[attackerId], location: { kind: 'map', hex: attackerHex } } } }

  const airBaseBoard = {
    map: loaded.playable,
    attackCapable(_state, id) {
      const definition = loaded.catalog.definitions.get(state.counters[id]?.definition ?? '')
      const attack = definition?.source.faces.combat?.stats.attack
      return typeof attack === 'number' && attack > 0
    },
    rangeOf(_state, id) {
      return loaded.catalog.definitions.get(state.counters[id]?.definition ?? '')?.source.faces.combat?.stats.range ?? undefined
    },
    distance: (from, to) => distance(loaded.playable, from, to),
  }
  const after = captureCampaignAirBase(placed, 'axis', base.hex, [attackerId], airBaseBoard,
    { destination: destination.hex })

  assert.equal(after.airBases.find((candidate) => candidate.hex === base.hex).side, 'axis')
  const moved = after.counters[aircraftIds[0]]
  assert.equal(moved.location.kind, 'map')
  assert.equal(moved.location.hex, destination.hex)
  assert.equal(moved.active, false)
  assert.ok((moved.stepsLost ?? 0) <= 1)
  assert.throws(() => captureCampaignAirBase(placed, 'axis', base.hex, [attackerId], airBaseBoard),
    /Choose a transfer airbase/)

  const truck = loaded.setup.counters.find((counter) => counter.ref === 'Ge 23.Pz Truck')
  assert.ok(truck)
  const truckId = Object.keys(state.counters).find((id) => state.counters[id].definition === truck.definition)
  assert.ok(truckId, 'the real Axis organic truck is on the 01 board')
  const refused = captureCampaignAirBase(placed, 'axis', base.hex, [truckId], {
    map: loaded.playable,
    attackCapable: () => false,
    rangeOf: () => undefined,
    distance: () => Infinity,
  })
  assert.equal(refused, placed)

  const isolated = { ...state, airBases: state.airBases.filter((candidate) => candidate.hex === base.hex) }
  const destroyed = captureCampaignAirBase(isolated, 'axis', base.hex, [attackerId], {
    map: loaded.playable,
    attackCapable: () => true,
    rangeOf: () => 0,
    distance: () => Infinity,
  })
  for (const id of aircraftIds) assert.equal(destroyed.counters[id].location.kind, 'dead-pile')
})
