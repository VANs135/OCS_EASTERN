import assert from 'node:assert/strict'
import test from 'node:test'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { campaignHexKey } from '../src/import/hex-id.ts'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { createCampaignOrdinaryMovementBoard } from '../src/match/campaign-movement-board.ts'
import { campaignFortressBoards } from '../src/match/campaign-fortress-board.ts'

// §2.4a：地图库城市格集（Major/Minor City）＋hexControl 城市归属＋距城两格敌战斗单位＋剧本要塞池＋城禁出。
const hexes = ['A1.01', 'A1.02', 'A1.03', 'A1.04']
const index = indexTtwCampaignMap({ items: [
  { hex_id: 'A1.01', seam_twin: null, seam_primary: null, city_hex: true, city_name: 'Kiev', city_level: 'Major City' },
  { hex_id: 'A1.02', seam_twin: null, seam_primary: null, city_hex: true, city_name: 'Kiev', city_level: 'Major City' },
  { hex_id: 'A1.03', seam_twin: null, seam_primary: null, city_hex: true, city_name: 'Village X', city_level: 'Village' },
  { hex_id: 'A1.04', seam_twin: null, seam_primary: null },
] }, { items: [['A1.01', 'A1.02'], ['A1.02', 'A1.03'], ['A1.03', 'A1.04']].map(([hex_a, hex_b]) =>
  ({ edge_key: `${hex_a}|${hex_b}`, hex_a, hex_b })) })

const map = { ...index, resolveHex: (hex) => index.canonicalByHex.get(campaignHexKey(hex)) }
const unit = (hex, side = 'axis', extra = {}) => ({ kind: 'land', mode: 'combat', side, definition: 'foot', location: { kind: 'map', hex }, ...extra })
const board = campaignFortressBoards({
  map, cityOf: index.cityOf, citySites: index.cities,
  isCombatUnit: (state, id) => state.counters[id]?.kind === 'land' && state.counters[id].definition !== 'supply',
  fortressUnits: [{ kind: 'german', definition: 'ge-fort', re: 1 }, { kind: 'german', definition: 'ge-fort-2', re: 1 },
    { kind: 'rumanian', definition: 'rum-fort', re: 1 }],
  withinRumania: () => true,
})
const reinforcement = { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] }
const groundProfile = { combat: true, attackCapable: true, inCombatMode: true, outOfSupply: false,
  moveMa: 4, moveMobility: 'leg', drawMobility: 'leg', singleTransportPoint: false }
const context = (patch = {}) => ({ reinforcement, fortressBoard: board, groundMovement: createCampaignOrdinaryMovementBoard({
  map, profileOf: (state, id) => ({ ...groundProfile, combat: state.counters[id].definition !== 'supply' }),
  moveProfile: () => ({ ma: 4, mobility: 'leg', fuelReady: true }), terrainAt: () => ['Open'],
  crossingAt: () => ({ barrier: 'none', routes: [] }), entryRequiresResolution: () => false, inTrace: () => true,
  exitRefusal: board.exitRefusal, ...patch }) })

function game(counters = {}, patch = {}) {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 4, counters, supplyDumps: {} }, 41)
  return { ...record, state: { ...record.state, cursor: { phase: 'movement', first: 'axis', phasing: 'axis' },
    movementSegment: 'movement', weather: { ground: 'dry', flight: 'none' },
    hexControl: { 'A1.1': 'axis', 'A1.2': 'axis' }, ...patch } }
}
let seq = 0
const submit = (record, action, side = 'axis') => submitCampaignMatch(record, side,
  { id: `fortress-board-${seq++}`, expectedRevision: record.revision, action }, context()).record

test('the board derives a fortress-eligible city from map data, control and an enemy within two hexes (§2.4a)', () => {
  const state = game({ soviet: unit('A1.04', 'soviet') }).state
  assert.deepEqual(board.cityOf(state, 'A1.01'), { city: 'Kiev', hexes: ['A1.1', 'A1.2'] })
  assert.equal(board.cityOf(state, 'A1.03'), undefined)
  assert.equal(board.axisControlsCity(state, 'Kiev'), true)
  assert.equal(board.enemyCombatWithin2(state, 'Kiev'), true)
  assert.deepEqual(board.fortressUnit(state, 'german'), { definition: 'ge-fort', re: 1 })
  // a village is not a fortifiable city; a city without enemy nearby is refused
  assert.equal(board.cityOf(state, 'A1.03'), undefined)
  assert.equal(board.enemyCombatWithin2({ ...state, counters: {} }, 'Kiev'), false)
  // an on-map fortress definition leaves the pool
  const placed = game({ 'fortress:A1.1': unit('A1.01', 'axis', { definition: 'ge-fort' }) }).state
  assert.deepEqual(board.fortressUnit(placed, 'german'), { definition: 'ge-fort-2', re: 1 })
})

test('declaring through the command places the unit and hedgehog on the mapped city (§2.4a)', () => {
  const declared = submit(game({ soviet: unit('A1.04', 'soviet') }),
    { type: 'declare-campaign-fortress', city: 'Kiev', hex: 'A1.01', fortress: 'german' })
  assert.equal(declared.state.counters['fortress:A1.1'].definition, 'ge-fort')
  assert.equal(declared.state.hedgehogs['A1.1'].level, 1)
  assert.deepEqual(declared.state.fortresses, [{ city: 'Kiev', hexes: ['A1.1', 'A1.2'], sinceTurn: 4 }])
})

test('Axis ground units may not walk out of a fortress city, while Soviet units are unaffected (§2.4a)', () => {
  const record = game({ march: unit('A1.01') }, { fortresses: [{ city: 'Kiev', hexes: ['A1.1', 'A1.2'], sinceTurn: 3 }] })
  const state = record.state
  assert.equal(board.exitRefusal(state, 'march', 'A1.1', 'A1.1'), null)
  assert.equal(board.exitRefusal(state, 'march', 'A1.1', 'A1.3'), 'fortress-city-no-exit')
  assert.equal(board.exitRefusal({ ...state, counters: { ...state.counters, march: unit('A1.01', 'soviet') } },
    'march', 'A1.1', 'A1.3'), null)
  assert.throws(() => submit(record, { type: 'move-campaign-ground', movers: [{ id: 'march' }], path: ['A1.02', 'A1.03'] }),
    /fortress-city-no-exit/)
  const inside = submit(game({ march: unit('A1.01') },
    { fortresses: [{ city: 'Kiev', hexes: ['A1.1', 'A1.2'], sinceTurn: 3 }] }),
  { type: 'move-campaign-ground', movers: [{ id: 'march' }], path: ['A1.02'] })
  assert.equal(inside.state.counters.march.location.hex, 'A1.2')
})
