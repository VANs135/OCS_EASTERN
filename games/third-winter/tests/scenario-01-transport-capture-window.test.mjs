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
import { applyCampaignTurn, openCampaignMatch } from '../src/match/campaign-match.ts'
import { beginCampaignTransportCapture, campaignTransportCaptureOptions } from '../src/match/campaign-transport-capture.ts'
import { projectCampaignMatch } from '../src/view/campaign-match-view.ts'

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

function distances(map, from) {
  const distance = new Map([[from, 0]])
  const queue = [from]
  for (let index = 0; index < queue.length; index += 1) {
    const hex = queue[index]
    for (const neighbor of map.neighbors(hex)) {
      if (distance.has(neighbor)) continue
      distance.set(neighbor, distance.get(hex) + 1)
      queue.push(neighbor)
    }
  }
  return distance
}

test('scenario 01 real truck points settle 9.14c with owner choice and displacement', async () => {
  const loaded = await scenario01()
  const { map, playable, setupRaw } = loaded
  const marker = setupRaw.markers.find((row) => row.ref === 'Truck Points' && row.at.map === 'B' &&
    row.at.col === 35 && row.at.row === 17)
  assert.ok(marker)
  const hex = `B${marker.at.col}.${marker.at.row}`
  const state = openCampaignMatch(prepareDnieperBoard(loaded), createRngState(1)).state
  const trucks = Object.entries(state.counters).filter(([, counter]) => counter.kind === 'transport' &&
    counter.side === 'soviet' && counter.location.kind === 'map' && counter.location.hex === hex &&
    counter.definition.endsWith(':tp_013'))
  assert.equal(trucks.length, 2)
  const axisDefinition = Object.values(state.counters).find((counter) => counter.kind === 'transport' &&
    counter.definition.endsWith(':tp_003'))?.definition
  const sovietDefinition = trucks[0][1].definition
  assert.ok(axisDefinition)

  let serial = 0
  let distanceFrom
  let distanceMap
  const board = {
    map: playable,
    distance(from, to) {
      if (distanceFrom !== from) { distanceFrom = from; distanceMap = distances(map, from) }
      return distanceMap.get(to) ?? Infinity
    },
    hexes: [...playable.availableHexes],
    transports(state, owner, hex) {
      return Object.entries(state.counters).filter(([, counter]) => counter.kind === 'transport' &&
        counter.side === owner && counter.location.kind === 'map' && counter.location.hex === hex &&
        counter.definition.endsWith(':tp_013'))
        .map(([id, counter]) => ({ id, kind: 'trucks', points: counter.transportPoints,
          tokens: counter.transportCargoTokens ?? 0 }))
    },
    placeTransport(state, side, facts) {
      const id = `test:transport:${serial += 1}`
      return { ...state, counters: { ...state.counters, [id]: {
        definition: side === 'axis' ? axisDefinition : sovietDefinition, kind: 'transport', side,
        location: { kind: 'map', hex: facts.hex }, transportPoints: facts.points,
        transportCargoTokens: facts.tokens, mode: 'move' } } }
    },
  }

  const capture = beginCampaignTransportCapture(state, 'axis', 'soviet', hex, board, () => 3)
  assert.equal(capture.groups.length, 1)
  assert.equal(capture.groups[0].capturedPoints, 1)
  const window = { ...state, transportCapture: capture }
  const adjacent = playable.neighbors(hex).find((candidate) => playable.availableHexes.has(candidate))
  assert.ok(adjacent)
  const options = campaignTransportCaptureOptions(window, 'soviet', board)
  assert.equal(options.groups.length, 1)
  assert.equal(options.groups[0].items.length, 2)
  assert.equal(options.groups[0].capturedPoints, 1)
  assert.equal(options.groups[0].displacedTo.includes(adjacent), true)
  assert.equal(campaignTransportCaptureOptions(window, 'axis', board), null)
  const settled = applyCampaignTurn(window, 'soviet', { type: 'resolve-campaign-transport-capture',
    choices: [{ kind: 'trucks', capturedIds: [trucks[0][0]], displacedTo: adjacent }] }, { transportCapture: board })
  assert.equal(settled.transportCapture, undefined)
  const projected = projectCampaignMatch({ state: { ...window,
    cursor: { first: 'soviet', phasing: 'soviet', phase: 'movement' } }, revision: 0 },
  'soviet', { transportCapture: board })
  assert.equal(projected.transportCapture.groups[0].kind, 'trucks')
  assert.equal(projected.transportCapture.groups[0].capturedPoints, 1)
  assert.equal(settled.counters[trucks[0][0]], undefined)
  assert.equal(settled.counters[trucks[1][0]], undefined)
  const capturedCounters = Object.entries(settled.counters).filter(([, counter]) => counter.kind === 'transport' &&
    counter.side === 'axis' && counter.location.kind === 'map' && counter.location.hex === hex)
  const displacedCounters = Object.entries(settled.counters).filter(([id, counter]) => id.startsWith('test:transport:') &&
    counter.kind === 'transport' && counter.side === 'soviet' && counter.location.kind === 'map' &&
    counter.location.hex === adjacent)
  assert.equal(capturedCounters.length, 1)
  assert.equal(capturedCounters[0][1].transportPoints, 1)
  assert.equal(displacedCounters.length, 1)
  assert.equal(displacedCounters[0][1].transportPoints, 1)

  assert.throws(() => applyCampaignTurn(window, 'soviet', { type: 'resolve-campaign-transport-capture',
    choices: [] }, { transportCapture: board }), /one transport capture outcome/)
  assert.throws(() => applyCampaignTurn(window, 'soviet', { type: 'resolve-campaign-transport-capture',
    choices: [{ kind: 'trucks', capturedIds: [trucks[0][0], trucks[1][0]], displacedTo: adjacent }] },
  { transportCapture: board }), /match the group dice result/)
  assert.throws(() => applyCampaignTurn(window, 'soviet', { type: 'resolve-campaign-transport-capture',
    choices: [{ kind: 'trucks', capturedIds: [trucks[0][0]] }] }, { transportCapture: board }),
  /in-range displacement/)
})
