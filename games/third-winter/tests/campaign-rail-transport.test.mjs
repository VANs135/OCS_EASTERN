import assert from 'node:assert/strict'
import { test } from 'node:test'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { createCampaignOrdinaryMovementBoard } from '../src/match/campaign-movement-board.ts'
import { newCampaignReinforcementWindow } from '../src/match/campaign-reinforcement-flow.ts'
import { campaignMapInPlayArea } from '../src/ttw/campaign/play-area.ts'
import { projectCampaignMatch, projectCampaignRailLoading, projectCampaignRailTransport } from '../src/view/campaign-match-view.ts'

const hexes = Array.from({ length: 7 }, (_, i) => `D${12 + i}.03`)
const map = campaignMapInPlayArea(indexTtwCampaignMap({ items: hexes.map((hex_id) => ({ hex_id })) }, {
  items: hexes.slice(1).map((hex_b, i) => ({ edge_key: `${i}`, hex_a: hexes[i], hex_b })),
}), { kind: 'all-map' })
const land = (hex, props = {}) => ({ kind: 'land', definition: 'infantry', side: 'axis', mode: 'move', currentRe: 1,
  location: { kind: 'map', hex }, ...props })

function rules(rail = {}, ground = {}) {
  return {
    reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] },
    reinforcementBlockers: () => [], movementBarrageBlockers: () => [],
    groundMovement: createCampaignOrdinaryMovementBoard({ map, terrainAt: () => ['Open'], crossingAt: () => ({ barrier: 'none', routes: [] }),
      profileOf: (state, id) => ({ combat: state.counters[id].kind !== 'transport', attackCapable: true,
        inCombatMode: state.counters[id].mode === 'combat', outOfSupply: false, moveMa: 4, moveMobility: 'leg',
        drawMobility: 'leg', singleTransportPoint: true }),
      moveProfile: () => ({ ma: 4, mobility: 'leg', fuelReady: true }), entryRequiresResolution: () => false,
      inTrace: () => true, endBlockers: () => [], ...ground }),
    railTransport: { capacity: (_, side) => side === 'axis' ? 2 : 4, ordinaryCargo: (_, id) => id !== 'special',
      edge: () => ({ usableGauge: true, multiTrack: true }), controlBlocksAt: () => false,
      detrainable: () => true, trainbustingAt: () => false, ...rail },
  }
}

function beforeMovement(counters, supplyDumps, record, side = 'axis') {
  const opening = record ?? openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 3, counters, supplyDumps }, 686)
  return { ...opening, state: { ...opening.state, weather: { ground: 'dry', flight: 'none' },
    cursor: { phase: 'reinforcement', first: 'axis', phasing: side },
    reinforcement: { stage: 'closing', window: newCampaignReinforcementWindow() } } }
}

const command = (record, action) => ({ id: `test-${record.revision}`, expectedRevision: record.revision, action })
const submit = (record, action, config, side = record.state.cursor.phasing) => submitCampaignMatch(record, side, command(record, action), config).record
const begin = (record, config) => submit(record, { type: 'complete-campaign-reinforcement' }, config)
const normal = (record, config) => submit(begin(record, config), { type: 'complete-campaign-breakout' }, config)
const rail = (path, counterIds = [], supplyTokens = 0, moveFaceIds = []) => ({ type: 'transport-campaign-rail', path, counterIds, supplyTokens, moveFaceIds })
const march = (id, to) => ({ type: 'move-campaign-ground', movers: [{ id }], path: [to] })
const ferry = (from, unitIds = [], supplyTokens = 0) => ({ type: 'use-campaign-kherson-ferry', from, unitIds, supplyTokens })

test('mixed freight moves atomically and spends the active side’s capacity once', () => {
  const config = rules({ trainbustingAt: (_, _side, hex) => hex === 'D13.3' })
  const opening = beforeMovement({ foot: land('D12.03', { mode: 'combat' }), truck: land('D12.03', { kind: 'transport', transportCargoTokens: 4 }),
    dg: land('D12.03', { disorganized: true }), special: land('D12.03'), reserve: land('D13.03') },
  { axis: { 'D12.3': 3 }, soviet: {} })
  const order = rail(['D12.03', 'D13.03', 'D14.03'], ['foot', 'truck'], 2, ['foot'])
  assert.throws(() => submit(begin(opening, config), order, config), /window-closed/)
  const record = normal(opening, config)
  assert.equal(projectCampaignMatch(record, 'soviet', config).railTransport, null)
  assert.deepEqual(projectCampaignRailLoading(record, 'soviet', 'D12.03', config), { revision: record.revision, ok: false, reason: 'window-closed' })
  assert.throws(() => submit(record, order, config, 'soviet'), /window-closed/)
  assert.deepEqual(projectCampaignRailLoading(record, 'axis', 'D12.03', config).counters,
    [{ id: 'foot', needsMoveFace: true, equivalent: 0.5 }, { id: 'truck', needsMoveFace: false, equivalent: 1 }])
  assert.throws(() => submit(record, { ...order, moveFaceIds: [] }, config), /counter-ineligible-for-rail/)
  assert.throws(() => submit(record, { ...order, counterIds: ['foot', 'foot'] }, config), /invalid-cargo/)
  assert.throws(() => submit(record, { ...order, supplyTokens: 3 }, config), /rail-capacity-exceeded/)
  assert.deepEqual(projectCampaignRailTransport(record, 'axis', order, config), { revision: record.revision, ok: true,
    from: 'D12.3', to: 'D14.3', equivalent: 2, factor: 1, cost: 2, remainingCapacity: 0 })

  const moved = submit(record, order, config)
  assert.equal(moved.state.counters.foot.location.hex, 'D14.3')
  assert.equal(moved.state.counters.foot.mode, 'move')
  assert.equal(moved.state.counters.truck.transportCargoTokens, 4)
  assert.deepEqual(moved.state.supplyDumps.axis, { 'D12.3': 1, 'D14.3': 2 })
  assert.deepEqual(projectCampaignMatch(moved, 'axis', config).railTransport, { capacity: 2, remainingCapacity: 0 })
  assert.equal(moved.state.rng.drawCount, record.state.rng.drawCount)
  assert.equal(submitCampaignMatch(moved, 'axis', command(record, order), config).duplicate, true)
  assert.throws(() => submitCampaignMatch(moved, 'axis', { ...command(record, order), id: 'stale-rail' }, config), /Stale match revision/)
  assert.throws(() => submit(moved, march('foot', 'D13.03'), config), /counter-cannot-spend-mp/)
  assert.throws(() => submit(moved, rail(['D13.03', 'D14.03'], ['reserve']), config), /rail-capacity-exceeded/)
  const soviet = normal(beforeMovement(undefined, undefined, moved, 'soviet'), config)
  assert.deepEqual(projectCampaignMatch(soviet, 'soviet', config).railTransport, { capacity: 4, remainingCapacity: 4 })
  assert.equal(projectCampaignMatch(soviet, 'axis', config).railTransport, null)
})

test('ground approach may use half MA at most and consumes the railway move for the remainder of the phase', () => {
  const config = rules({}, { moveProfile: (_, id) => ({ ma: id === 'tooFar' ? 1 : 2, mobility: 'leg', fuelReady: true }) })
  const record = normal(beforeMovement({ foot: land('D12.03'), tooFar: land('D12.03'), flippedLate: land('D12.03', { mode: 'combat' }) }), config)
  let approached = record
  for (const id of ['foot', 'tooFar', 'flippedLate']) approached = submit(approached, march(id, 'D13.03'), config)
  const path = ['D13.03', 'D14.03']
  assert.throws(() => submit(approached, rail(path, ['tooFar']), config), /counter-ineligible-for-rail/)
  assert.throws(() => submit(approached, rail(path, ['flippedLate'], 0, ['flippedLate']), config), /counter-ineligible-for-rail/)
  const moved = submit(approached, rail(path, ['foot']), config)
  assert.equal(moved.state.groundMovement.railCapacitySpent, 0.25)
  assert.throws(() => submit(moved, rail(path.toReversed(), ['foot']), config), /counter-ineligible-for-rail/)
})

test('rail rejects bad gauge, unapproved stations, raw ZOC and an unresolved entry before changing the board', () => {
  const opening = beforeMovement({ foot: land('D12.03'), guard: land('D14.03'),
    enemy: land('D15.03', { side: 'soviet', mode: 'combat' }) })
  const config = rules()
  const record = normal(opening, config)
  const held = submit(record, { type: 'hold-campaign-ground-zoc', counterId: 'guard' }, config)
  assert.equal(projectCampaignRailTransport(held, 'axis', rail(['D12.03', 'D13.03', 'D14.03'], ['foot']), config).reason, 'rail-enemy-zoc')
  const order = rail(['D12.03', 'D13.03'], ['foot'])
  assert.throws(() => submit(record, order, rules({ edge: () => ({ usableGauge: false, multiTrack: false }) })), /rail-wrong-gauge/)
  assert.throws(() => submit(record, order, rules({ detrainable: (_, _side, hex) => hex === 'D13.3' })), /rail-boarding-unavailable/)
  assert.throws(() => submit(record, order, rules({ detrainable: (_, _side, hex) => hex === 'D12.3' })), /rail-unloading-unavailable/)
  assert.throws(() => submit(record, order, rules({}, { entryRequiresResolution: () => true })), /rail-entry-unresolved/)
  assert.equal(record.state.counters.foot.location.hex, 'D12.03')
})

test('Kherson freight cannot transfer to a train and rail receipts cannot replace the original ferry stock', () => {
  const config = rules()
  const record = normal(beforeMovement({ foot: land('D14.03') }, { axis: { 'D13.3': 4, 'D14.3': 4, 'D15.3': 1 }, soviet: {} }), config)
  assert.throws(() => submit(record, rail(['D14.03', 'D15.03'], ['foot']), config), /rail-not-connected/)
  const ferried = submit(record, ferry('D14.03', ['foot'], 2), config)
  const departure = ['D15.03', 'D16.03']
  assert.throws(() => submit(ferried, rail(departure, ['foot']), config), /counter-ineligible-for-rail/)
  assert.throws(() => submit(ferried, rail(departure, [], 2), config), /rail-supply-unavailable/)
  assert.equal(projectCampaignRailLoading(ferried, 'axis', 'D15.03', config).supplyTokens, 1)
  const sent = submit(ferried, rail(departure, [], 1), config)
  assert.equal(sent.state.supplyDumps.axis['D15.3'], 2)
  const emptied = submit(sent, rail(['D14.03', 'D13.03'], [], 2), config)
  const refilled = submit(emptied, rail(['D13.03', 'D14.03'], [], 2), config)
  assert.equal(refilled.state.supplyDumps.axis['D14.3'], 2)
  assert.throws(() => submit(refilled, ferry('D14.03', [], 1), config), /ferry-supply-unavailable/)
})

test('rail cannot bypass a first-entry bridge decision or use a destroyed railroad bridge', () => {
  const bridge = 'D13.3|D14.3'
  const config = rules({}, { crossingAt: (_, _id, from, to) => [from, to].sort().join('|') === bridge
    ? { barrier: 'volga', bridge: 'intact', routes: ['rail'] } : { barrier: 'none', routes: [] } })
  const opening = beforeMovement({ foot: land('D12.03', { side: 'soviet' }) }, undefined, undefined, 'soviet')
  const record = normal(opening, config)
  const order = rail(['D12.03', 'D13.03', 'D14.03'], ['foot'])
  assert.equal(projectCampaignRailTransport(record, 'soviet', order, config).reason, 'rail-bridge-response-unavailable')
  assert.throws(() => submit(record, order, config), /rail-bridge-response-unavailable/)
  assert.equal(record.state.groundMovement.railCapacitySpent, undefined)
  const kept = { ...record, state: { ...record.state, volgaBridgeDecisions: { [bridge]: 'kept' } } }
  assert.equal(submit(kept, order, config).state.counters.foot.location.hex, 'D14.3')
  const blown = { ...record, state: { ...record.state, volgaBridgeDecisions: { [bridge]: 'blown' } } }
  assert.equal(projectCampaignRailTransport(blown, 'soviet', order, config).reason, 'rail-not-connected')
})
