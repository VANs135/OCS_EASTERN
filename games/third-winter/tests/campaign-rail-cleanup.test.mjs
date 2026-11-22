import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { createCampaignBreakoutBoard } from '../src/match/campaign-breakout-board.ts'
import { createCampaignOrdinaryMovementBoard } from '../src/match/campaign-movement-board.ts'
import { projectCampaignMatch, projectCampaignRailTransport } from '../src/view/campaign-match-view.ts'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { campaignMapInPlayArea } from '../src/ttw/campaign/play-area.ts'

const hexes = Array.from({ length: 9 }, (_, i) => `A${i + 1}.01`)
const map = campaignMapInPlayArea(indexTtwCampaignMap({ items: hexes.map((hex_id) => ({ hex_id })) }, {
  items: [[1, 2], [2, 3], [3, 4], [2, 5], [2, 6], [6, 7], [7, 8]].map(([from, to]) => ({
    hex_a: hexes[from - 1], hex_b: hexes[to - 1], edge_key: `${from}|${to}`,
  })),
}), { kind: 'all-map' })
const unit = (side, hex, mode = 'move') => ({ side, kind: 'land', definition: 'foot', currentRe: 1, mode, location: { kind: 'map', hex } })
const railNetwork = { edge(from, to) {
  if (from === 'A2.1' && to === 'A6.1') return undefined
  return { gauge: from === 'A1.1' || from === 'A6.1' ? 'broad' : 'standard', multiTrack: false }
},
  initialGaugeJunctions: ['A2.1', 'A7.1'] }
const profileOf = () => ({ combat: true, attackCapable: true, inCombatMode: false, outOfSupply: false,
  moveMa: 4, moveMobility: 'leg', drawMobility: 'leg', singleTransportPoint: false })
const traceCost = () => null
const supplyFacts = () => ({ sources: new Set(['A1.01']), controlled: new Set(['A1.01', 'A3.01']), headquarters: [],
  detrainable: (hex) => ['A1.1', 'A3.1'].includes(hex) })
const groundMovement = createCampaignOrdinaryMovementBoard({ map, railNetwork, profileOf, moveProfile: () => ({ ma: 4, mobility: 'leg', fuelReady: true }),
  terrainAt: () => ['Open'], crossingAt: () => ({ barrier: 'none', routes: [] }), entryRequiresResolution: () => false,
  supply: { traceCost, facts: supplyFacts } })
const breakoutBoard = createCampaignBreakoutBoard({ map, railNetwork, profileOf, traceCost,
  movementCost: () => 1, distance: () => 2, supply: () => ({ ...supplyFacts(), inTrace: (_, options) => options.length > 0,
    firstTurnWithoutTrace: () => true }) })
const config = {
  groundMovement, breakoutBoard, exploitationEndBlockers: () => [],
  reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] },
  railTransport: { capacity: () => 4, ordinaryCargo: () => true, controlBlocksAt: () => false, trainbustingAt: () => false },
  railCleanup: { sovietNetworkStarts(state) { assert.equal(state.cursor.phase, 'cleanup'); return ['A1.01'] },
    axisSuppliedByKessel: (_, id) => id === 'pocket', distance: (from, to) => to === 'A9.1' ? 2 : from === 'A5.1' ? 20 : 21 },
}

function exploitation(side = 'soviet', before) {
  const opening = before ?? openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 2,
    counters: { freight: unit('soviet', 'A1.01'), draw: unit('soviet', 'A4.01'), line: unit('axis', 'A8.01'), pocket: unit('axis', 'A9.01') } }, 193)
  return { ...opening, state: { ...opening.state, lateTurnSegment: 'ground-combat', cursor: { phase: 'exploitation', first: 'axis', phasing: side } } }
}

const end = (record) => ({ id: `exploitation-${record.revision}`, expectedRevision: record.revision, action: { type: 'complete-campaign-exploitation' } })

test('Soviet Cleanup uses one opening snapshot, ignores Kessel, and excludes 20-hex and isolated candidates', () => {
  const start = exploitation()
  const action = end(start)
  assert.throws(() => submitCampaignMatch(start, 'axis', action, config), /not open for this side/)
  assert.throws(() => submitCampaignMatch(start, 'soviet', action, { ...config, exploitationEndBlockers: () => ['outstanding'] }), /obligations/)
  assert.throws(() => submitCampaignMatch(start, 'soviet', action, { ...config, railCleanup: undefined }), /cleanup board/)
  const axis = exploitation('axis')
  assert.equal(submitCampaignMatch(axis, 'axis', end(axis), config).record.state.railGaugeByEdge, undefined)
  const cleaned = submitCampaignMatch(start, 'soviet', action, config).record
  assert.equal(cleaned.state.cursor.phase, 'cleanup')
  assert.deepEqual(cleaned.state.railGaugeByEdge, { 'A2.1|A3.1': 'broad' })
  assert.deepEqual(projectCampaignMatch(cleaned, 'axis', config).sovietConvertedEdges, ['A2.1|A3.1'])
  assert.ok(projectCampaignMatch(cleaned, 'soviet', config).railheads.some(({ hex }) => hex === 'A3.1'))
  assert.equal(cleaned.state.rng.drawCount, start.state.rng.drawCount)
  assert.equal(submitCampaignMatch(cleaned, 'soviet', action, config).duplicate, true)
  assert.equal(start.state.railGaugeByEdge, undefined)
  const later = exploitation('soviet', { ...cleaned, state: { ...cleaned.state, turn: cleaned.state.turn + 1 } })
  assert.deepEqual(submitCampaignMatch(later, 'soviet', end(later), config).record.state.cleanup.sovietConvertedEdges, ['A3.1|A4.1'])
})

test('an extender can connect a railway for trace without qualifying that branch for freight', () => {
  const start = exploitation()
  const state = { ...start.state, cursor: { ...start.state.cursor, phase: 'movement' }, movementSegment: 'movement',
    counters: { ...start.state.counters, freight: unit('soviet', 'A7.01') } }
  const connectedByExtender = createCampaignOrdinaryMovementBoard({ ...groundMovement, terrainAt: () => ['Open'],
    crossingAt: () => ({ barrier: 'none', routes: [] }), supply: {
      traceCost: (_, from, to) => [from, to].sort().join('|') === 'A2.1|A6.1' ? 1 : null,
      facts: () => ({ sources: new Set(['A1.01']), controlled: new Set(['A6.01', 'A7.01']), headquarters: [],
        detrainable: (hex) => ['A6.1', 'A7.1'].includes(hex), extenders: [{ hex: 'A6.01', range: 1, mobility: 'leg' }] }),
    } })
  const trace = connectedByExtender.traceSupply(state, 'soviet')
  assert.equal(trace.network.hasConnectedUnloadSite('A7.1'), true)
  const haul = { type: 'transport-campaign-rail', path: ['A7.01', 'A6.01'], counterIds: ['freight'], supplyTokens: 0 }
  assert.equal(projectCampaignRailTransport({ ...start, state }, 'soviet', haul, { ...config, groundMovement: connectedByExtender }).reason,
    'rail-boarding-unavailable')
})

test('converted gauge connects breakout trace, strategic move trace and railway stations through the same board', () => {
  const start = exploitation()
  assert.equal(breakoutBoard(start.state, 'soviet').unitFacts('draw').hasTrace, false)
  const movement = (record) => ({ ...record, state: { ...record.state, movementSegment: 'movement',
    cursor: { ...record.state.cursor, phase: 'movement' } } })
  const freight = { type: 'transport-campaign-rail', path: ['A1.01', 'A2.01', 'A3.01'], counterIds: ['freight'], supplyTokens: 0 }
  assert.equal(projectCampaignRailTransport(movement(start), 'soviet', freight, config).reason, 'rail-wrong-gauge')
  const cleaned = submitCampaignMatch(start, 'soviet', end(start), config).record
  assert.equal(breakoutBoard(cleaned.state, 'soviet').unitFacts('draw').hasTrace, true)
  assert.equal(groundMovement.inTrace(cleaned.state, 'draw', 'A4.1'), true)
  assert.equal(projectCampaignRailTransport(movement(cleaned), 'soviet', freight, config).ok, true)
  const lostControl = createCampaignOrdinaryMovementBoard({ ...groundMovement, terrainAt: () => ['Open'],
    crossingAt: () => ({ barrier: 'none', routes: [] }), supply: { traceCost, facts: () => ({ ...supplyFacts(), controlled: new Set(['A1.01']) }) } })
  assert.equal(projectCampaignRailTransport(movement(cleaned), 'soviet', freight, { ...config, groundMovement: lostControl }).reason,
    'rail-unloading-unavailable')
})
