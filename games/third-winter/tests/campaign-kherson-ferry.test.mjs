import assert from 'node:assert/strict'
import { test } from 'node:test'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { createCampaignBreakoutBoard } from '../src/match/campaign-breakout-board.ts'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { createCampaignOrdinaryMovementBoard } from '../src/match/campaign-movement-board.ts'
import { newCampaignReinforcementWindow } from '../src/match/campaign-reinforcement-flow.ts'
import { campaignMapInPlayArea } from '../src/ttw/campaign/play-area.ts'
import { projectCampaignKhersonFerry, projectCampaignMatch } from '../src/view/campaign-match-view.ts'

const hexes = ['D12.03', 'D13.03', 'D14.03', 'D15.03', 'D16.03', 'D17.03']
const railFerryKey = 'D14.3|D15.3'
function riverMap(link = true, playable = hexes) {
  return campaignMapInPlayArea(indexTtwCampaignMap({ items: hexes.map((hex_id) => ({ hex_id })) },
    { items: hexes.slice(1).flatMap((hex_b, i) => link || i !== 2 ? [{ edge_key: `${i}`, hex_a: hexes[i], hex_b }] : []) }),
  { kind: 'hex-list', hexes: playable })
}

const land = (hex, extra = {}) => ({ side: 'axis', definition: 'ground', kind: 'land', currentRe: 1, mode: 'move', location: { kind: 'map', hex }, ...extra })
const profileOf = (state, id) => ({ combat: state.counters[id].kind !== 'transport', attackCapable: state.counters[id].kind !== 'transport',
  inCombatMode: state.counters[id].mode === 'combat', outOfSupply: false, moveMa: 5, moveMobility: 'leg', drawMobility: 'leg', singleTransportPoint: false })
const costForTerrain = (_, _id, from, to) => [from, to].sort().join('|') === railFerryKey
  ? { barrier: 'volga', bridge: 'intact', routes: ['rail'] } : { barrier: 'none', routes: [] }
function config(map = riverMap(), extra = {}) {
  const groundMovement = createCampaignOrdinaryMovementBoard({ map, profileOf, moveProfile: () => ({ ma: 5, mobility: 'leg', fuelReady: true }),
    terrainAt: () => ['Open'], crossingAt: costForTerrain, inTrace: () => true,
    entryRequiresResolution: () => false, endBlockers: () => [], ...extra })
  return { groundMovement, reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] },
    reinforcementBlockers: () => [], movementBarrageBlockers: () => [] }
}

function opening(counters, supplyDumps = { axis: {}, soviet: {} }, ice = false) {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 3, counters, supplyDumps }, 19)
  return { ...record, state: { ...record.state, weather: { ground: 'freeze', flight: 'none' },
    weatherHistory: { ...record.state.weatherHistory, ice }, cursor: { phase: 'reinforcement', first: 'axis', phasing: 'axis' },
    reinforcement: { stage: 'closing', window: newCampaignReinforcementWindow() } } }
}

const command = (record, action) => ({ id: `step-${record.revision}`, expectedRevision: record.revision, action })
const submit = (record, action, rules, seat = record.state.cursor.phasing) => submitCampaignMatch(record, seat, command(record, action), rules).record
const begin = (record, rules) => submit(record, { type: 'complete-campaign-reinforcement' }, rules)
const normal = (record, rules) => submit(begin(record, rules), { type: 'complete-campaign-breakout' }, rules)
const ferry = (from, unitIds = [], supplyTokens = 0, moveFaceIds = []) => ({ type: 'use-campaign-kherson-ferry', from, unitIds, supplyTokens, moveFaceIds })
const ground = (id, path) => ({ type: 'move-campaign-ground', movers: [{ id }], path })

test('the dedicated ferry combines reduced unit RE, loose supply and loaded transport point capacity in either direction', () => {
  const rules = config(riverMap(), { moveProfile: () => ({ ma: 7, mobility: 'track', fuelReady: false }) })
  const start = opening({ tank: land('D14.03', { mode: 'combat', currentRe: 1.5 }),
    truck: land('D15.03', { kind: 'transport', currentRe: undefined, transportPoints: 1, transportCargoTokens: 4 }) },
  { axis: { 'D14.3': 6, 'D15.3': 3 }, soviet: { 'D17.3': 4 } })
  const order = ferry('D14.03', ['tank'], 2, ['tank'])
  assert.throws(() => submit(begin(start, rules), order, rules), /window-closed/)
  const record = normal(start, rules)
  assert.equal(projectCampaignMatch(record, 'soviet', rules).khersonFerry, null)
  assert.throws(() => submit(record, order, rules, 'soviet'), /window-closed/)
  assert.throws(() => submit(record, ferry('D14.03', ['tank'], 2), rules), /counter-ineligible/)
  assert.throws(() => submit(record, ferry('D14.03', ['tank'], 7, ['tank']), rules), /ferry-supply-unavailable/)
  assert.throws(() => submit(record, ferry('D14.03', ['tank'], 6, ['tank', 'truck']), rules), /invalid-cargo/)
  assert.deepEqual(projectCampaignKhersonFerry(record, 'axis', order, rules),
    { revision: record.revision, ok: true, from: 'D14.3', to: 'D15.3', re: 2, remainingRe: 1 })
  const receipt = command(record, order)
  const first = submitCampaignMatch(record, 'axis', receipt, rules).record
  assert.equal(first.state.counters.tank.mode, 'move')
  assert.equal(first.state.counters.tank.location.hex, 'D15.3')
  assert.deepEqual(first.state.supplyDumps, { axis: { 'D14.3': 4, 'D15.3': 5 }, soviet: { 'D17.3': 4 } })
  assert.throws(() => submit(first, ground('tank', ['D16.03']), rules), /counter-cannot-spend-mp/)
  assert.throws(() => submit(first, ferry('D15.03', ['truck'], 1), rules), /crossing-capacity/)
  const second = submit(first, ferry('D15.03', ['truck']), rules)
  assert.equal(second.state.counters.truck.location.hex, 'D14.3')
  assert.equal(second.state.counters.truck.transportCargoTokens, 4)
  assert.deepEqual(second.state.groundMovement.crossedReByHexside, { [railFerryKey]: 3 })
  assert.throws(() => submit(second, ferry('D14.03', [], 1), rules), /crossing-capacity/)
  assert.equal(second.state.rng.drawCount, record.state.rng.drawCount)
  assert.equal(submitCampaignMatch(second, 'axis', receipt, rules).duplicate, true)
})

test('ferry loading checks phase-start bank and original loose supply and excludes incoming cargo', () => {
  const rules = config()
  const record = normal(opening({ arrived: land('D13.03'), dg: land('D14.03', { disorganized: true }) },
    { axis: { 'D14.3': 5 }, soviet: {} }), rules)
  const moved = submit(record, ground('arrived', ['D14.03']), rules)
  assert.throws(() => submit(moved, ferry('D14.03', ['arrived']), rules), /counter-ineligible/)
  assert.throws(() => submit(moved, ferry('D14.03', ['dg'], 0, ['dg']), rules), /counter-ineligible/)
  const sent = submit(moved, ferry('D14.03', [], 3), rules)
  assert.throws(() => submit(sent, ferry('D15.03', [], 1), rules), /ferry-supply-unavailable/)
  const replenished = { ...sent, state: { ...sent.state, supplyDumps: { ...sent.state.supplyDumps, axis: { 'D14.3': 4, 'D15.3': 3 } } } }
  assert.throws(() => submit(replenished, ferry('D14.03', [], 3), rules), /ferry-supply-unavailable/)
  assert.equal(replenished.state.supplyDumps.axis['D14.3'], 4)
})

test('the banks require Normal river conditions and raw enemy ZOC on neither end', () => {
  const rules = config()
  const both = { user: land('D14.03'), covering: land('D15.03', { mode: 'combat' }), enemy: land('D16.03', { side: 'soviet', mode: 'combat' }) }
  const zoc = normal(opening(both), rules)
  const held = submit(zoc, { type: 'hold-campaign-ground-zoc', counterId: 'covering' }, rules)
  assert.throws(() => submit(held, ferry('D14.03', ['user']), rules), /enemy-zoc-at-ferry/)
  const atOrigin = normal(opening({ user: both.user, enemy: land('D13.03', { side: 'soviet', mode: 'combat' }) }), rules)
  assert.throws(() => submit(atOrigin, ferry('D14.03', ['user']), rules), /enemy-zoc-at-ferry/)
  const frozen = normal(opening({ user: both.user }, undefined, true), rules)
  assert.throws(() => submit(frozen, ferry('D14.03', ['user']), rules), /river-not-normal/)
  const open = normal(opening({ user: both.user }), rules)
  assert.throws(() => submit(open, ground('user', ['D15.03']), rules), /impassable/)
  assert.equal(submit(open, ferry('D14.03', ['user']), rules).state.counters.user.location.hex, 'D15.3')
  const partial = config(riverMap(true, hexes.filter((hex) => hex !== 'D15.03')))
  assert.throws(() => submit(normal(opening({ user: both.user }), partial), ferry('D14.03', ['user']), partial), /ferry-outside-play-area/)
  const sovietStart = opening({ user: land('D15.03', { side: 'soviet' }) })
  const otherSide = { ...sovietStart, state: { ...sovietStart.state, cursor: { ...sovietStart.state.cursor, phasing: 'soviet' } } }
  assert.equal(submit(normal(otherSide, rules), ferry('D15.03', ['user']), rules).state.counters.user.location.hex, 'D14.3')
  const offBank = { ...otherSide, state: { ...otherSide.state, counters: { user: land('D16.03', { side: 'soviet' }) } } }
  assert.equal(submit(normal(offBank, rules), ground('user', ['D15.03']), rules).state.groundMovement.interruption, undefined)
})

test('ordinary pontoon movement and special ferry freight share the Volga hexside ceiling', () => {
  const rules = config()
  const scenario = opening({ pontoon: land('D14.03'), foot: land('D14.03', { currentRe: 2 }),
    truck: land('D15.03', { currentRe: 1 }) }, { axis: { 'D15.3': 4 }, soviet: {} })
  const marker = { id: 'pontoon-ferry', hex: 'D14.3', side: 'axis', pontoonId: 'pontoon' }
  const record = normal({ ...scenario, state: { ...scenario.state, ferries: [marker] } }, rules)
  const foot = submit(record, ground('foot', ['D15.03']), rules)
  assert.deepEqual(foot.state.groundMovement.usedFerryIds, ['pontoon-ferry'])
  assert.throws(() => submit(foot, ferry('D15.03', ['truck'], 1), rules), /crossing-capacity/)
  assert.deepEqual(submit(foot, ferry('D15.03', ['truck']), rules).state.groundMovement.crossedReByHexside, { [railFerryKey]: 3 })
})

test('trace supply gains a rail-only bank connection and retains normal gauge, occupation and ZOC checks', () => {
  const map = riverMap(false)
  const rails = new Set(['D12.3|D13.3', 'D13.3|D14.3', 'D15.3|D16.3'])
  const make = (broken = false) => createCampaignBreakoutBoard({ map, profileOf, distance: () => 0,
    movementCost: () => null, traceCost: () => null, supply: () => ({
      sources: new Set(['D12.03']), controlled: new Set(['D16.03']), headquarters: [],
      railCanTrace: (a, b) => rails.has([a, b].sort().join('|')) && !(broken && [a, b].includes('D15.3')),
      detrainable: (hex) => hex === 'D16.3', inTrace: (_, choices) => choices.length > 0, firstTurnWithoutTrace: () => true,
    }),
  })
  const counters = { east: land('D17.03') }
  const position = make()(opening(counters).state, 'axis')
  assert.equal(position.unitFacts('east').hasTrace, true)
  assert.equal(position.neighbors('D14.3').includes('D15.3'), false)
  assert.equal(position.canCross('D14.3', 'D15.3', 'leg'), false)
  assert.equal(make(true)(opening(counters).state, 'axis').unitFacts('east').hasTrace, false)
  assert.equal(make()(opening(counters, undefined, true).state, 'axis').unitFacts('east').hasTrace, false)
  const enemy = land('D17.03', { side: 'soviet', mode: 'combat' })
  const own = land('D15.03')
  assert.equal(make()(opening({ own, enemy }).state, 'axis').unitFacts('own').hasTrace, false)
  const guard = land('D16.03', { mode: 'move' })
  assert.equal(make()(opening({ own, enemy, guard }).state, 'axis').unitFacts('own').hasTrace, true)
})
