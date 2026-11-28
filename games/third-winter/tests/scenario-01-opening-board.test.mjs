import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRngState } from '@ocs-eastern/series/rng'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { prepareCampaignSetup } from '../src/import/campaign-setup.ts'
import { loadThirdWinterV2Units } from '../src/import/unit-v2.ts'
import { campaignMapInPlayArea, ttwCampaignPlayArea } from '../src/ttw/campaign/play-area.ts'
import { prepareDnieperBoard, dnieperOpeningChoices } from '../src/match/dnieper-opening.ts'
import { dnieperGroundMovementBoard } from '../src/match/dnieper-ground-movement.ts'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'

const ROOT = 'D:/war game/OCS各作数据库/OCS第三个冬天'
const SCENARIO = '01-dnepr-battles'
const read = async (...parts) => JSON.parse((await readFile(join(ROOT, ...parts), 'utf8')).replace(/^\uFEFF/, ''))

async function data() {
  const [hexes, edges, catalog, setupRaw] = await Promise.all([
    read('地图数据库', 'map_hexes.json'), read('地图数据库', 'map_edges.json'),
    loadThirdWinterV2Units((file) => read('data', file)), read('scenarios', SCENARIO, 'setup.json'),
  ])
  const map = indexTtwCampaignMap(hexes, edges)
  const playable = campaignMapInPlayArea(map, ttwCampaignPlayArea(SCENARIO))
  const setup = prepareCampaignSetup(setupRaw, catalog.aliases, map, playable)
  return { map, playable, catalog, setup, setupRaw }
}

test('scenario 01 opening board places every fixed counter, aircraft, marker and optional pool', async () => {
  const loaded = await data()
  const opening = prepareDnieperBoard(loaded)
  const choices = dnieperOpeningChoices(loaded)
  const record = openCampaignMatch(opening, createRngState(1))
  const state = record.state
  assert.equal(Object.keys(state.counters).length, 774 + 104 + 26 + 9 + 1 + 15)
  assert.equal(Object.keys(state.counters).filter((id) => id.startsWith('01-fixed-transport:')).length, 15)
  const fixedTransport = Object.entries(state.counters).filter(([id]) => id.startsWith('01-fixed-transport:'))
    .map(([, counter]) => counter)
  assert.equal(fixedTransport.filter((counter) => counter.definition.endsWith(':tp_013')).length, 6)
  assert.equal(fixedTransport.filter((counter) => counter.definition.endsWith(':tp_011')).length, 6)
  assert.equal(fixedTransport.filter((counter) => counter.definition.endsWith(':tp_001')).length, 3)
  for (const counter of fixedTransport) {
    assert.equal(counter.transportPoints, 1)
    assert.equal(counter.currentRe, 0)
  }
  const b3517 = loaded.playable.resolveHex('B35.17')
  assert.equal(fixedTransport.filter((counter) => counter.location.hex === b3517 &&
    counter.definition.endsWith(':tp_013')).length, 2)
  assert.equal(fixedTransport.filter((counter) => counter.location.hex === b3517 &&
    counter.definition.endsWith(':tp_011')).length, 1)
  assert.equal(state.counters['01-air:1'].kind, 'aircraft')
  assert.equal(state.airBases.length, 59)
  assert.equal(Object.keys(state.hedgehogs).length, 18)
  assert.ok(Object.values(state.supplyDumps.soviet).some((tokens) => tokens >= 4))
  const axisSupply = choices.find((choice) => choice.side === 'axis' && choice.kind === 'supply')
  assert.ok(axisSupply)
  assert.equal(axisSupply.preset.reduce((total, hex) => total + (state.supplyDumps.axis[hex] ?? 0), 0), 8)
  assert.deepEqual(state.opening, { weather: { ground: 'dry', flight: 'normal' }, first: 'soviet' })
  assert.equal(state.initialRailheadMarkers.length, 8)
  assert.equal(state.fortresses.length, 2)
  assert.equal(state.fortresses.some(({ city }) => city === 'Homostayivka'), true)
  assert.deepEqual(state.rvgkMarkers, { 'rvgk-1': 'D60.19', 'rvgk-2': 'B43.20' })

  const fixedHedgehogs = new Set(loaded.setup.initialHedgehogs.map(({ hex }) => hex))
  const optionalHedgehogs = Object.keys(state.hedgehogs).filter((hex) => !fixedHedgehogs.has(hex))
  assert.equal(optionalHedgehogs.length, 5)
  for (const hex of optionalHedgehogs) {
    assert.equal(hex.startsWith('B'), true, 'the optional hedgehogs are B-map Dnepr placements')
    assert.equal(loaded.map.neighbors(hex).some((to) =>
      loaded.map.connection(hex, to)?.sourceEdges.some((edge) => edge.river_class === 'major')), true)
  }
  const trucks = choices.find((choice) => choice.kind === 'transport' && choice.definition.endsWith('tp_003'))
  const wagons = choices.find((choice) => choice.kind === 'transport' && choice.definition.endsWith('tp_001'))
  const fortress = choices.find((choice) => choice.kind === 'fortress')
  assert.ok(trucks && wagons && fortress)
  assert.equal(Object.keys(state.counters).filter((id) => id.startsWith(`01-optional:${trucks.id}:`)).length, 12)
  assert.equal(Object.keys(state.counters).filter((id) => id.startsWith(`01-optional:${wagons.id}:`)).length, 14)
  assert.equal(Object.keys(state.counters).filter((id) => id.startsWith(`01-optional:${fortress.id}:`)).length, 1)
  const sovietSupply = choices.find((choice) => choice.side === 'soviet' && choice.kind === 'supply')
  assert.ok(sovietSupply)
  assert.equal(sovietSupply.preset.length, 5)
  for (const hex of sovietSupply.preset) {
    assert.ok((state.supplyDumps.soviet[hex] ?? 0) >= 4, `HQ ${hex} received a 01 supply point`)
  }
})

test('scenario 01 opening accepts a player placement instead of the reviewed preset', async () => {
  const loaded = await data()
  const choices = dnieperOpeningChoices(loaded)
  const hedgehogs = choices.find((choice) => choice.kind === 'hedgehog')
  const sovietSupply = choices.find((choice) => choice.side === 'soviet' && choice.kind === 'supply')
  const axisSupply = choices.find((choice) => choice.side === 'axis' && choice.kind === 'supply')
  const trucks = choices.find((choice) => choice.kind === 'transport' && choice.definition.endsWith('tp_003'))
  assert.ok(hedgehogs && sovietSupply && axisSupply && trucks)

  const hedgehogAlternatives = hedgehogs.candidates
    .filter((hex) => !hedgehogs.preset.includes(hex)).slice(0, hedgehogs.count)
  const supplyAlternatives = sovietSupply.candidates.slice(-sovietSupply.count)
  const axisSupplyAlternatives = axisSupply.candidates.slice(-axisSupply.count)
  const truckAlternatives = trucks.candidates.slice(20, 20 + trucks.count)
  assert.equal(hedgehogAlternatives.length, hedgehogs.count)
  assert.equal(supplyAlternatives.length, sovietSupply.count)
  assert.equal(axisSupplyAlternatives.length, axisSupply.count)
  assert.equal(truckAlternatives.length, trucks.count)

  const opening = prepareDnieperBoard(loaded, { placements: {
    [hedgehogs.id]: hedgehogAlternatives,
    [sovietSupply.id]: supplyAlternatives,
    [axisSupply.id]: axisSupplyAlternatives,
    [trucks.id]: truckAlternatives,
  } })
  const baseline = openCampaignMatch(prepareDnieperBoard(loaded), createRngState(1)).state
  const state = openCampaignMatch(opening, createRngState(1)).state
  const fixedHedgehogs = new Set(loaded.setup.initialHedgehogs.map(({ hex }) => hex))
  const optionalHedgehogs = Object.keys(state.hedgehogs).filter((hex) => !fixedHedgehogs.has(hex))
  assert.deepEqual(optionalHedgehogs.sort(), [...hedgehogAlternatives].sort())
  for (const hex of supplyAlternatives) {
    assert.equal(state.supplyDumps.soviet[hex], (baseline.supplyDumps.soviet[hex] ?? 0) + 4)
  }
  for (const hex of axisSupplyAlternatives) {
    assert.equal(state.supplyDumps.axis[hex], (baseline.supplyDumps.axis[hex] ?? 0) + 4)
  }
  assert.equal(Object.keys(state.counters).filter((id) => id.startsWith(`01-optional:${trucks.id}:`)).length, 12)
  for (const [index, hex] of truckAlternatives.entries()) {
    assert.equal(state.counters[`01-optional:${trucks.id}:${index + 1}`].location.hex, hex)
  }
})

test('scenario 01 opening rejects counts, destinations and hedgehog duplicates outside the choice contract', async () => {
  const loaded = await data()
  const choices = dnieperOpeningChoices(loaded)
  const hedgehogs = choices.find((choice) => choice.kind === 'hedgehog')
  assert.ok(hedgehogs)
  assert.throws(() => prepareDnieperBoard(loaded, { placements: {
    [hedgehogs.id]: hedgehogs.preset.slice(0, -1),
  } }), /needs 5 placements/)
  assert.throws(() => prepareDnieperBoard(loaded, { placements: {
    [hedgehogs.id]: [...hedgehogs.preset.slice(0, -1), 'Z99.99'],
  } }), /rejects destination/)
  assert.throws(() => prepareDnieperBoard(loaded, { placements: {
    [hedgehogs.id]: [hedgehogs.preset[0], hedgehogs.preset[0], ...hedgehogs.preset.slice(1, 4)],
  } }), /distinct hexes/)
})

test('scenario 01 opening runs the prescribed first-turn pre-turn without consuming a weather die', async () => {
  const loaded = await data()
  const record = openCampaignMatch(prepareDnieperBoard(loaded), createRngState(2))
  const context = { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: (hex) => hex, arrivalSites: () => [] },
    reinforcementBlockers: () => [] }
  const send = (current, type, fields = {}, side = 'soviet') => submitCampaignMatch(current, side,
    { id: `${type}:${current.revision}`, expectedRevision: current.revision, action: { type, ...fields } }, context).record
  const weather = send(record, 'determine-campaign-weather')
  assert.equal(weather.state.cursor.segment, 'random-event')
  assert.equal(weather.state.rng.drawCount, 0)
  const event = send(weather, 'roll-campaign-event')
  assert.equal(event.state.cursor.phase, 'aircraft-refit')
  assert.equal(event.state.cursor.phasing, 'soviet')
  assert.equal(event.state.cursor.first, 'soviet')
  assert.equal(event.state.rng.drawCount, 1)
  assert.ok(event.state.cursor.phase)
})

test('dnieper ground board reports an end-of-segment 4.8a overstack', async () => {
  const loaded = await data()
  const state = openCampaignMatch(prepareDnieperBoard(loaded), createRngState(1)).state
  const board = dnieperGroundMovementBoard(loaded.playable, loaded.terrain, loaded.catalog.definitions)
  const counters = Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`stack:${index}`, {
    definition: 'stack-test', kind: 'land', side: 'soviet', location: { kind: 'map', hex: 'D39.30' }, currentRe: 1,
  }]))
  assert.deepEqual(board.endBlockers?.({ ...state, counters }, 'soviet'), ['overstack:D39.30:11'])
})
