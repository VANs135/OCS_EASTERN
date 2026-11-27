import assert from 'node:assert/strict'
import { test } from 'node:test'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { createCampaignOrdinaryMovementBoard } from '../src/match/campaign-movement-board.ts'
import { campaignGroundMovementOptions } from '../src/match/campaign-ground-movement.ts'
import { kirovogradReleaseRule } from '../src/match/kirovograd-release.ts'
import { newCampaignReinforcementWindow } from '../src/match/campaign-reinforcement-flow.ts'
import { campaignMapInPlayArea } from '../src/ttw/campaign/play-area.ts'
import { projectCampaignGroundDestinations, projectCampaignGroundRoute, projectCampaignMatch, projectCampaignRailLoading, projectCampaignRailTransport } from '../src/view/campaign-match-view.ts'

const hexes = Array.from({ length: 7 }, (_, i) => `D${12 + i}.03`)
const map = campaignMapInPlayArea(indexTtwCampaignMap({ items: hexes.map((hex_id) => ({ hex_id })) }, {
  items: hexes.slice(1).map((hex_b, i) => ({ edge_key: `${i}`, hex_a: hexes[i], hex_b })),
}), { kind: 'all-map' })
const land = (hex, props = {}) => ({ kind: 'land', definition: 'infantry', side: 'axis', mode: 'move', currentRe: 1,
  location: { kind: 'map', hex }, ...props })

function rules(rail = {}, ground = {}, gameMap = map) {
  const { network, ...railRules } = rail
  return {
    reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: gameMap.resolveHex, arrivalSites: () => [] },
    reinforcementBlockers: () => [], movementBarrageBlockers: () => [],
    groundMovement: createCampaignOrdinaryMovementBoard({ map: gameMap, terrainAt: () => ['Open'], crossingAt: () => ({ barrier: 'none', routes: [] }),
      railNetwork: { edge: () => ({ gauge: 'standard', multiTrack: true }), isRepairUnit: (_, id) => ['engineer', 'rider'].includes(id), ...network },
      profileOf: (state, id) => ({ combat: state.counters[id].kind !== 'transport', attackCapable: true,
        inCombatMode: state.counters[id].mode === 'combat', outOfSupply: false, moveMa: 4, moveMobility: 'leg',
        drawMobility: 'leg', singleTransportPoint: true }),
      moveProfile: () => ({ ma: 4, mobility: 'leg', fuelReady: true }), entryRequiresResolution: () => false,
      inTrace: () => true, endBlockers: () => [], ...ground }),
    railTransport: { capacity: (_, side) => side === 'axis' ? 2 : 4, ordinaryCargo: (_, id) => id !== 'special',
      controlBlocksAt: () => false, detrainable: () => true, trainbustingAt: () => false, ...railRules },
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
  assert.throws(() => submit(record, order, rules({ network: { edge: () => ({ gauge: 'broad', multiTrack: false }) } })), /rail-wrong-gauge/)
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

test('compatible-gauge rail freight is independent of the ground-movement bridge decision', () => {
  const bridge = 'D13.3|D14.3'
  const config = rules({ network: { edge: () => ({ gauge: 'broad', multiTrack: true }) } }, { crossingAt: (_, _id, from, to) => [from, to].sort().join('|') === bridge
    ? { barrier: 'volga', bridge: 'intact', routes: ['rail'] } : { barrier: 'none', routes: [] } })
  const opening = beforeMovement({ foot: land('D12.03', { side: 'soviet' }) }, undefined, undefined, 'soviet')
  const record = normal(opening, config)
  const order = rail(['D12.03', 'D13.03', 'D14.03'], ['foot'])
  assert.equal(projectCampaignGroundRoute(record, 'soviet', march('foot', 'D13.03'), config).pause.kind, 'volga-bridge-demolition')
  assert.equal(submit(record, order, config).state.groundMovement.interruption, undefined)
  const blown = { ...record, state: { ...record.state, volgaBridgeDecisions: { [bridge]: 'blown' } } }
  assert.equal(submit(blown, order, config).state.counters.foot.location.hex, 'D14.3')
  const across = { type: 'move-campaign-ground', movers: [{ id: 'foot' }], path: ['D13.03', 'D14.03'] }
  assert.equal(projectCampaignGroundRoute(blown, 'soviet', across, config).reason, 'insufficient-mp')
})

const branchHexes = ['D12.03', 'D13.03', 'D14.03', 'D13.04', 'D13.05']
const branchMap = campaignMapInPlayArea(indexTtwCampaignMap({ items: branchHexes.map((hex_id) => ({ hex_id })) }, {
  items: [['D12.03', 'D13.03'], ['D13.03', 'D14.03'], ['D13.03', 'D13.04'], ['D13.04', 'D13.05']]
    .map(([hex_a, hex_b], i) => ({ edge_key: `b${i}`, hex_a, hex_b })),
}), { kind: 'all-map' })

const keyOf = (a, b) => [a, b].sort().join('|')
const engineerMove = (id, hex, connections) => ({ type: 'move-campaign-ground',
  movers: [{ id, railWork: [{ step: 1, connections }] }], path: [hex] })

test('ground rail costs the same as a track regardless of gauge; conversion updates both directions and railhead projection', () => {
  const frontier = 'D13.3|D14.3'
  const config = rules({ network: { initialGaugeJunctions: ['D13.3'], edge: (a, b) => ({
    gauge: keyOf(a, b) === frontier ? 'broad' : 'standard', multiTrack: false,
  }) } }, { crossingAt: () => ({ barrier: 'none', routes: ['rail'] }), terrainAt: () => ['Forest'] })
  const record = normal(beforeMovement({ engineer: land('D12.03', { mode: 'combat' }), foot: land('D12.03'),
    rider: land('D12.03', { mode: 'combat' }), back: land('D14.03') }), config)
  record.state.initialRailheadMarkers = [{ side: 'axis', hex: 'D13.3' }]
  const trip = rail(['D12.03', 'D13.03', 'D14.03'], ['foot'])
  const ground = { type: 'move-campaign-ground', movers: [{ id: 'foot' }], path: trip.path.slice(1) }
  assert.equal(projectCampaignGroundRoute(record, 'axis', ground, config).placements[0].spent, 2)
  assert.equal(projectCampaignRailTransport(record, 'axis', trip, config).reason, 'rail-wrong-gauge')
  assert.deepEqual(projectCampaignMatch(record, 'axis', config).railheads.map(({ hex }) => hex), ['D13.3'])
  assert.throws(() => submit(record, engineerMove('foot', 'D13.03', ['D14.03']), config), /rail-repair-unit-required/)
  const work = engineerMove('engineer', 'D13.03', ['D14.03'])
  assert.equal(projectCampaignGroundRoute(record, 'axis', work, config).placements[0].spent, 1)
  assert.deepEqual(projectCampaignGroundRoute(record, 'axis', work, config).railGaugeChanges, [{ edge: frontier, gauge: 'standard' }])
  const changed = submit(record, work, config)
  assert.deepEqual(changed.state.railGaugeByEdge, { [frontier]: 'standard' })
  assert.deepEqual(changed.state.initialRailheadMarkers, [{ side: 'axis', hex: 'D13.3' }])
  assert.deepEqual(changed.state.groundMovement.railConversionCount, { engineer: 1 })
  assert.deepEqual(projectCampaignMatch(changed, 'axis', config).railheads, [])
  assert.equal(projectCampaignRailTransport(changed, 'axis', trip, config).ok, true)
  assert.equal(projectCampaignRailTransport(changed, 'axis', rail(trip.path.toReversed(), ['back']), config).ok, true)
  assert.throws(() => submit(changed, rail(trip.path.slice(1), ['engineer']), config), /rail-conversion-no-leapfrog/)
  const rode = submit(changed, rail(trip.path, ['rider']), config)
  assert.throws(() => submit(rode, engineerMove('rider', 'D13.03', ['D12.03']), config), /rail-conversion-no-leapfrog/)
})

test('rail repair may board off station in combat mode and resume with its unspent MP', () => {
  const config = rules({ detrainable: () => false, network: { edge: (a, b) => ({
    gauge: keyOf(a, b) === 'D17.3|D18.3' ? 'broad' : 'standard', multiTrack: false,
  }) } })
  const record = normal(beforeMovement({ engineer: land('D15.03', { mode: 'combat' }), ordinary: land('D16.03') }), config)
  const approach = submit(record, march('engineer', 'D16.03'), config)
  const path = ['D16.03', 'D17.03']
  assert.equal(projectCampaignRailLoading(approach, 'axis', 'D16.03', config).counters.length, 1)
  assert.throws(() => submit(approach, rail(path, ['ordinary']), config), /rail-boarding-unavailable/)
  const rode = submit(approach, rail(path, ['engineer']), config)
  assert.equal(rode.state.counters.engineer.mode, 'combat')
  assert.equal(rode.state.groundMovement.railRepairRides.engineer.spent, 1)
  const work = engineerMove('engineer', 'D18.03', ['D17.03'])
  const destination = projectCampaignGroundDestinations(rode, 'axis', { id: 'engineer' }, config).destinations.find(({ hex }) => hex === 'D18.3')
  assert.equal(destination.spent, 2)
  assert.equal(projectCampaignGroundRoute(rode, 'axis', work, config).placements[0].spent, 2)
  assert.equal(submit(rode, work, config).state.railGaugeByEdge['D17.3|D18.3'], 'standard')
})

test('active conversion needs a combat-face repair unit and obeys raw ZOC and each unit’s current MA', () => {
  const config = rules({ network: { edge: () => ({ gauge: 'broad', multiTrack: false }) } }, {
    crossingAt: () => ({ barrier: 'none', routes: ['road'] }),
    moveProfile: () => ({ ma: 2, mobility: 'leg', fuelReady: true }),
  })
  const combatEngineer = land('D15.03', { mode: 'combat' })
  const normalTurn = normal(beforeMovement({ engineer: combatEngineer }), config)
  const path = ['D16.03', 'D17.03', 'D18.03']
  const railWork = ['D15.03', 'D16.03', 'D17.03'].map((hex, step) => ({ step: step + 1, connections: [hex] }))
  const order = { type: 'move-campaign-ground', movers: [{ id: 'engineer', railWork }], path }
  assert.equal(projectCampaignGroundRoute(normalTurn, 'axis', order, config).reason, 'rail-conversion-limit')
  assert.equal(normalTurn.state.railGaugeByEdge, undefined)
  const limited = submit(normalTurn, { ...order, movers: [{ id: 'engineer', railWork: railWork.slice(0, 2) }] }, config)
  assert.equal(limited.state.groundMovement.railConversionCount.engineer, 2)

  const marked = normal(beforeMovement({ engineer: { ...combatEngineer, disorganized: true } }), config)
  const one = engineerMove('engineer', 'D16.03', ['D15.03'])
  assert.equal(submit(marked, one, config).state.railGaugeByEdge['D15.3|D16.3'], 'standard')
  assert.equal(projectCampaignGroundRoute(normalTurn, 'axis', { ...one, movers: [{ ...one.movers[0], mode: 'move' }] }, config).reason,
    'rail-conversion-combat-face-required')

  const threatened = normal(beforeMovement({ engineer: combatEngineer, guard: land('D16.03'),
    enemy: land('D17.03', { side: 'soviet', mode: 'combat' }) }), config)
  const held = submit(threatened, { type: 'hold-campaign-ground-zoc', counterId: 'guard' }, config)
  assert.equal(projectCampaignGroundRoute(held, 'axis', one, config).reason, 'rail-conversion-enemy-zoc')
})

test('rail conversion changes the whole entered hex, not just the selected approach edge', () => {
  const config = rules({ network: { edge: () => ({ gauge: 'broad', multiTrack: false }) } }, {}, branchMap)
  const record = normal(beforeMovement({ engineer: land('D12.03', { mode: 'combat' }) }), config)
  const moved = submit(record, engineerMove('engineer', 'D13.03', ['D14.03']), config)
  assert.equal(moved.state.groundMovement.railConversionCount.engineer, 1)
  assert.deepEqual(Object.keys(moved.state.railGaugeByEdge).sort(),
    ['D12.3|D13.3', 'D13.3|D13.4', 'D13.3|D14.3'])
})

test('a counter held by a scenario release rule can neither board a train nor march', () => {
  const config = rules()
  const record = normal(beforeMovement({ foot: land('D12.03', { mode: 'combat' }),
    corps: land('D12.03', { held: 'ttw-scenario-9:29th-tank-corps' }) }, { axis: { 'D12.3': 3 }, soviet: {} }), config)
  assert.deepEqual(projectCampaignRailLoading(record, 'axis', 'D12.03', config).counters.map(({ id }) => id), ['foot'])
  assert.throws(() => submit(record, rail(['D12.03', 'D13.03'], ['corps']), config), /counter-ineligible-for-rail/)
  assert.throws(() => submit(record, march('corps', 'D13.03'), config), /counter-held/)
  assert.deepEqual(projectCampaignMatch(record, 'axis', config).movement.heldIds, ['corps'])
  assert.ok(!projectCampaignMatch(record, 'axis', config).movement.availableIds.includes('corps'))
})

test('rail movement settles the scenario release: a German unit detraining within range frees the corps, a Soviet combat unit railing into the city liberates it', () => {
  const hold = 'ttw-scenario-9:29th-tank-corps'
  const definitions = new Map([['infantry', { key: 'infantry', kind: 'land', source: { side: 'axis', nation: 'Ge' } }]])
  const release = kirovogradReleaseRule({ map, definitions, kirovogradHex: 'D18.03' })
  const config = rules({}, { releases: release })
  const sovietConfig = rules({ network: { edge: () => ({ gauge: 'broad', multiTrack: true }) } }, { releases: release })
  const heldIds = (state) => Object.keys(state.counters).filter((id) => state.counters[id].held === hold)
  const corps = land('D12.03', { side: 'soviet', held: hold })
  // The corps sits at D12.03; D17.03 is five hexes away, D18.03 six. A German unit rails from D18.03 into range.
  const far = normal(beforeMovement({ tk: corps, ge: land('D18.03') }), config)
  assert.deepEqual(heldIds(far.state), ['tk'])
  const near = submit(far, rail(['D18.03', 'D17.03'], ['ge']), config)
  assert.deepEqual(heldIds(near.state), [])
  // A Soviet rifle railing into the city liberates it; a truck railing in does not.
  const rifle = normal(beforeMovement({ tk: corps, rifle: land('D16.03', { side: 'soviet' }) }, undefined, undefined, 'soviet'), sovietConfig)
  const liberated = submit(rifle, rail(['D16.03', 'D17.03', 'D18.03'], ['rifle']), sovietConfig, 'soviet')
  assert.deepEqual(heldIds(liberated.state), [])
  const truck = normal(beforeMovement({ tk: corps, truck: land('D16.03', { side: 'soviet', kind: 'transport', transportPoints: 1 }) }, undefined, undefined, 'soviet'), sovietConfig)
  const notLiberated = submit(truck, rail(['D16.03', 'D17.03', 'D18.03'], ['truck']), sovietConfig, 'soviet')
  assert.deepEqual(heldIds(notLiberated.state), ['tk'])
})

test('Axis Army HQ rails as 1 RE and need not detrain at a station; Army Group HQ still requires one (§2.3b/c)', () => {
  const hqRail = (_, id) => id === 'armyHq' ? { railRe: 1, waiveDetrainable: true }
    : id === 'agHq' ? { railRe: 1, waiveDetrainable: false } : undefined
  const config = rules({ detrainable: () => false, hqRail })
  const record = normal(beforeMovement({ armyHq: land('D12.03', { kind: 'hq', mode: 'combat', currentRe: undefined }),
    agHq: land('D12.03', { kind: 'hq', mode: 'combat', currentRe: undefined }), foot: land('D12.03') }), config)
  // ordinary freight and the non-waived Army Group HQ cannot board off-station
  assert.throws(() => submit(record, rail(['D12.03', 'D13.03'], ['foot']), config), /rail-boarding-unavailable/)
  assert.throws(() => submit(record, rail(['D12.03', 'D13.03'], ['agHq'], 0, ['agHq']), config), /rail-boarding-unavailable/)
  // the Army HQ boards off-station and counts as 1 RE (equivalent 0.5; one-edge cost 0.25)
  assert.deepEqual(projectCampaignRailLoading(record, 'axis', 'D12.03', config).counters, [{ id: 'armyHq', needsMoveFace: true, equivalent: 0.5 }])
  const order = rail(['D12.03', 'D13.03'], ['armyHq'], 0, ['armyHq'])
  assert.equal(projectCampaignRailTransport(record, 'axis', order, config).cost, 0.25)
  const moved = submit(record, order, config)
  assert.equal(moved.state.counters.armyHq.location.hex, 'D13.3')
  assert.equal(moved.state.counters.armyHq.mode, 'move')
})

test('Axis Army/Army Group HQ cannot ground march — rail only (§2.3b/c)', () => {
  const config = rules({}, { railOnly: (_, id) => id === 'armyHq' || id === 'agHq' })
  const record = normal(beforeMovement({ armyHq: land('D12.03', { kind: 'hq', mode: 'move' }), foot: land('D12.03') }), config)
  assert.throws(() => submit(record, march('armyHq', 'D13.03'), config), /hq-rail-only/)
  assert.ok(!campaignGroundMovementOptions(record.state, 'axis', config.groundMovement).availableIds.includes('armyHq'))
  // an ordinary unit still marches
  assert.equal(submit(record, march('foot', 'D13.03'), config).state.counters.foot.location.hex, 'D13.3')
})
