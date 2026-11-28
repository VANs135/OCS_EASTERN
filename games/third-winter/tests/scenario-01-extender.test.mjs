import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRngState } from '@ocs-eastern/series/rng'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { prepareCampaignSetup } from '../src/import/campaign-setup.ts'
import { loadThirdWinterV2Units } from '../src/import/unit-v2.ts'
import { campaignMapInPlayArea, ttwCampaignPlayArea } from '../src/ttw/campaign/play-area.ts'
import { dnieperOpeningChoices, prepareDnieperBoard } from '../src/match/dnieper-opening.ts'
import { dnieperExtenderBoard } from '../src/match/dnieper-extender.ts'
import { openCampaignMatch } from '../src/match/campaign-match.ts'
import { applyCampaignTurn } from '../src/match/campaign-match.ts'
import { campaignExtenderCollapseDestinations, campaignExtenderCollapseOptions, campaignExtenderHexOptions,
  collapseCampaignExtender, convertCampaignExtender, flipCampaignExtender } from '../src/match/campaign-extender.ts'

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

const truckDefinition = (definition) => definition.endsWith('tp_003')

test('scenario 01 real Axis truck points form and flip an extender; Soviet truck conversion is refused', async () => {
  const loaded = await scenario01()
  const choices = dnieperOpeningChoices(loaded)
  const trucks = choices.find((choice) => choice.kind === 'transport' && truckDefinition(choice.definition))
  assert.ok(trucks, 'scenario 01 has the real Axis 1-point truck pool')

  const opening = prepareDnieperBoard(loaded)
  const record = openCampaignMatch(opening, createRngState(1))
  const state = record.state
  const truckIds = Object.keys(state.counters)
    .filter((id) => id.startsWith(`01-optional:${trucks.id}:`))
    .slice(0, 5)
  assert.equal(truckIds.length, 5)
  const city = 'B41.06'
  const hex = loaded.playable.resolveHex(city)
  assert.ok(hex, 'B41.06 is a real 01 city hex')
  assert.equal(loaded.map.cityOf(city)?.city !== undefined, true, 'B41.06 is a real city')
  // The five counters are moved together as an explicit test placement: 12/1-point
  // trucks are a real 01 pool, but the reviewed preset splits them across four cities.
  const counters = { ...state.counters }
  for (const id of truckIds) counters[id] = { ...counters[id], location: { kind: 'map', hex } }
  const base = {
    ...state,
    counters,
    cursor: { first: 'soviet', phasing: 'axis', phase: 'movement' },
    movementSegment: 'movement',
  }

  const board = {
    map: loaded.playable,
    transports(state, side, hex) {
      return Object.entries(state.counters)
        .filter(([, counter]) => counter.side === side && counter.kind === 'transport' &&
          counter.location.kind === 'map' && loaded.playable.resolveHex(counter.location.hex) === hex)
        .map(([id, counter]) => ({
          id,
          kind: truckDefinition(counter.definition) ? 'truck' : 'wagon',
          points: counter.transportPoints ?? 0,
          ma: truckDefinition(counter.definition) ? 45 : 10,
          mpSpent: 0,
          loaded: (counter.transportCargoTokens ?? 0) > 0,
        }))
    },
    placeTransport(state, side, facts) {
      const id = `test:placed:${Object.keys(state.counters).length + 1}`
      return {
        ...state,
        counters: {
          ...state.counters,
          [id]: { definition: trucks.definition, kind: 'transport', side,
            location: { kind: 'map', hex: facts.hex }, transportPoints: facts.points,
            transportCargoTokens: 0, mode: 'move' },
        },
      }
    },
  }

  const options = campaignExtenderHexOptions(base, 'axis', hex, board)
  const truckOption = options.options.find((option) => option.kind === 'truck')
  assert.ok(truckOption, 'the real truck stack offers a truck extender')
  assert.equal(truckOption.count, 1)
  assert.equal(truckOption.consumedPoints, 5)

  const converted = convertCampaignExtender(base, 'axis',
    { type: 'convert-campaign-extender', hex, kind: 'truck', count: 1 }, board)
  assert.equal(converted.extenders.length, 1)
  assert.deepEqual(converted.extenders[0].side, 'axis')
  assert.equal(converted.extenders[0].kind, 'truck')
  assert.equal(converted.extenders[0].hex, hex)
  assert.equal(converted.extenders[0].range, 20)
  assert.equal(Object.keys(converted.counters).filter((id) => truckIds.includes(id)).length, 0)

  const flipped = flipCampaignExtender(converted, 'axis', { type: 'flip-campaign-extender', id: converted.extenders[0].id }, board)
  assert.equal(flipped.extenders.length, 0)
  const placed = Object.entries(flipped.counters).filter(([id]) => id.startsWith('test:placed:'))
  assert.equal(placed.length, 1)
  assert.equal(placed[0][1].transportPoints, 5)
  assert.equal(placed[0][1].location.hex, hex)

  const soviet = { ...base, cursor: { first: 'soviet', phasing: 'soviet', phase: 'movement' } }
  assert.throws(() => convertCampaignExtender(soviet, 'soviet',
    { type: 'convert-campaign-extender', hex, kind: 'truck', count: 1 }, board),
  /soviet-normal-truck-extender-forbidden/)
  assert.throws(() => convertCampaignExtender({ ...base, cursor: { first: 'soviet', phasing: 'axis', phase: 'supply' } },
    'axis', { type: 'convert-campaign-extender', hex, kind: 'truck', count: 1 }, board),
  /Extender conversion needs your movement, reaction or exploitation segment/)
})

test('scenario 01 real Axis extender collapses to a traced hex and flips to 5 truck points', async () => {
  const loaded = await scenario01()
  const choices = dnieperOpeningChoices(loaded)
  const trucks = choices.find((choice) => choice.kind === 'transport' && truckDefinition(choice.definition))
  assert.ok(trucks)
  const opening = prepareDnieperBoard(loaded)
  const record = openCampaignMatch(opening, createRngState(1))
  const state = record.state
  const truckIds = Object.keys(state.counters)
    .filter((id) => id.startsWith(`01-optional:${trucks.id}:`))
    .slice(0, 5)
  const city = 'B41.06'
  const hex = loaded.playable.resolveHex(city)
  const counters = { ...state.counters }
  for (const id of truckIds) counters[id] = { ...counters[id], location: { kind: 'map', hex } }
  const base = { ...state, counters,
    cursor: { first: 'soviet', phasing: 'axis', phase: 'movement' }, movementSegment: 'movement' }

  const board = {
    map: loaded.playable,
    transports(state, side, hex) {
      return Object.entries(state.counters)
        .filter(([, counter]) => counter.side === side && counter.kind === 'transport' &&
          counter.location.kind === 'map' && loaded.playable.resolveHex(counter.location.hex) === hex)
        .map(([id, counter]) => ({ id, kind: truckDefinition(counter.definition) ? 'truck' : 'wagon',
          points: counter.transportPoints ?? 0, ma: truckDefinition(counter.definition) ? 45 : 10,
          mpSpent: 0, loaded: (counter.transportCargoTokens ?? 0) > 0 }))
    },
    placeTransport(state, side, facts) {
      const id = `test:collapse:${Object.keys(state.counters).length + 1}`
      return { ...state, counters: { ...state.counters, [id]: { definition: trucks.definition,
        kind: 'transport', side, location: { kind: 'map', hex: facts.hex },
        transportPoints: facts.points, transportCargoTokens: 0, mode: 'move' } } }
    },
    hasTrace(_state, side, hex) { return side === 'axis' && hex !== loaded.playable.resolveHex('D60.19') },
  }

  const converted = convertCampaignExtender(base, 'axis',
    { type: 'convert-campaign-extender', hex, kind: 'truck', count: 1 }, board)
  const extender = converted.extenders[0]
  const destination = loaded.playable.resolveHex('B42.06')
  const choicesForCollapse = campaignExtenderCollapseDestinations(converted, 'axis', extender.id, board)
  assert.equal(choicesForCollapse.includes(destination), true, 'B42.06 is inside the real truck range and traced')
  const collapseOptions = campaignExtenderCollapseOptions(converted, 'axis', board)
  assert.equal(collapseOptions.extenders.length, 1)
  assert.equal(collapseOptions.extenders[0].destinations.includes(destination), true)

  const collapsed = collapseCampaignExtender(converted, 'axis',
    { type: 'collapse-campaign-extender', id: extender.id, destination }, board)
  assert.equal(collapsed.extenders.length, 0)
  const placed = Object.entries(collapsed.counters).filter(([id]) => id.startsWith('test:collapse:'))
  assert.equal(placed.length, 1)
  assert.equal(placed[0][1].transportPoints, 5)
  assert.equal(placed[0][1].location.hex, destination)
  assert.equal(collapsed.groundMovement.moved.includes(extender.id), true)
  const action = { type: 'collapse-campaign-extender', id: extender.id, destination }
  const viaTurn = applyCampaignTurn(converted, 'axis', action, { extenderWork: board })
  assert.equal(viaTurn.extenders.length, 0)
  assert.equal(viaTurn.counters[Object.keys(viaTurn.counters).find((id) => id.startsWith('test:collapse:'))].location.hex,
    destination)
  assert.throws(() => collapseCampaignExtender({ ...converted, cursor: { ...converted.cursor, phase: 'reaction' } },
    'axis', { type: 'collapse-campaign-extender', id: extender.id, destination }, board),
  /your movement segment/)
  assert.throws(() => collapseCampaignExtender(converted, 'axis',
    { type: 'collapse-campaign-extender', id: extender.id, destination: 'D60.19' }, board),
  /supply trace/)
  assert.throws(() => collapseCampaignExtender({ ...converted, weather: { ...converted.weather, ground: 'thaw' } },
    'axis', { type: 'collapse-campaign-extender', id: extender.id, destination }, board),
  /your movement segment/)
  assert.throws(() => collapseCampaignExtender({ ...converted,
    groundMovement: { ...converted.groundMovement, moved: [extender.id] } }, 'axis',
  { type: 'collapse-campaign-extender', id: extender.id, destination }, board),
  /already acted/)
})

test('scenario 01 production extender board forms and flips to the real 5-point Axis truck', async () => {
  const loaded = await scenario01()
  const choices = dnieperOpeningChoices(loaded)
  const trucks = choices.find((choice) => choice.kind === 'transport' && truckDefinition(choice.definition))
  assert.ok(trucks)
  const opening = prepareDnieperBoard(loaded)
  const state = openCampaignMatch(opening, createRngState(1)).state
  const truckIds = Object.keys(state.counters)
    .filter((id) => id.startsWith(`01-optional:${trucks.id}:`))
    .slice(0, 5)
  const hex = loaded.playable.resolveHex('B41.06')
  const counters = { ...state.counters }
  for (const id of truckIds) counters[id] = { ...counters[id], location: { kind: 'map', hex } }
  const base = { ...state, counters,
    cursor: { first: 'soviet', phasing: 'axis', phase: 'movement' }, movementSegment: 'movement' }
  const board = dnieperExtenderBoard(loaded.playable, loaded.catalog.definitions)
  const options = campaignExtenderHexOptions(base, 'axis', hex, board)
  assert.equal(options.options.find((option) => option.kind === 'truck')?.consumedPoints, 5)
  const converted = convertCampaignExtender(base, 'axis',
    { type: 'convert-campaign-extender', hex, kind: 'truck', count: 1 }, board)
  const flipped = flipCampaignExtender(converted, 'axis',
    { type: 'flip-campaign-extender', id: converted.extenders[0].id }, board)
  const placed = Object.entries(flipped.counters).filter(([id]) => id.startsWith('extender:transport:axis:truck:'))
  assert.equal(placed.length, 1)
  assert.equal(placed[0][1].transportPoints, 5)
  assert.equal(placed[0][1].definition, 'transport:id:tp_007')
  assert.equal(placed[0][1].location.hex, hex)
})
