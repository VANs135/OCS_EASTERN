import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { attritionLoss } from '@ocs-eastern/series/attrition'
import { createRngState } from '@ocs-eastern/series/rng'
import { scorpionMap } from '../src/import/scorpion-map.ts'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'
import { scorpionSessionBoxFrame } from '../src/view/scorpion-boxes.ts'
import { scorpionMapStacks } from '../src/view/scorpion-map-counters.ts'

const hexes = ['s1.03', 's1.04', 's10.01', 's10.02', 's15.08', 's15.09']
const map = scorpionMap(hexes.map((hex_id) => ({ hex_id, on_map: true, terrains_present: ['Open'] })),
  [['s1.03', 's1.04'], ['s10.01', 's10.02']].map(([hex_a, hex_b]) => ({ hex_a, hex_b,
    edge_terrain: 'none', road_present: false, rail_present: false, bridge: false })))
const assets = { map, catalog: { definitions: new Map([
  ['alert', { source: { abilities: ['alert_battalion'] } }],
  ['infantry', { source: { name: 'Infantry', side: 'axis', faces: { combat: { asset: 'infantry.png' } } } }],
]), aliases: new Map(['Turn', 'Ground', 'Flight', 'Soviet VPs Tracker'].map((marker) =>
  [marker, [{ kind: 'marker', source: { faces: { combat: { asset: `${marker}.png` } } } }]])) } }
const board = { supplyRail: { railGauge: () => 'axis' } }
const counter = (hex, fields = {}) => ({ side: 'axis', hex, printedRe: 1, stepsLost: 0, actionRating: 0,
  attackCapable: true, fueled: false, combat: true, allowance: 3, mobility: 'leg', definition: 'infantry', ...fields })
const dump = (tokens) => ({ location: 'on-map', side: 'axis', tokens })
const fixture = (units, dumps = {}) => ({ revision: 0, receipts: [], state: { kind: 'playing', units, dumps,
  cursor: { turn: 2, first: 'axis', phasing: 'axis', phase: 'movement', retention: 'axis' },
  turn: { number: 2, weather: { ground: 'freeze', flight: 'normal' }, vp: 0, step: { kind: 'player-turn', first: 'axis' } },
  rng: createRngState(42), moved: [], pieces: [], airBases: [], availableAlerts: [], railControl: {},
  arrival: { placed: [], mobilized: [], sovietVp: 0 }, victory: null, supply: null,
} })
const command = (record, action) => ({ id: `supply-${record.revision}`, expectedRevision: record.revision, action })
const submit = (record, action) => submitScorpionSession(record, 'axis', command(record, action), assets, board).record

test('movement and a one-token fuel debit are accepted atomically', () => {
  const dumpId = 'axis:hex:s10.01'
  const start = fixture({ tank: counter('s10.01', { mobility: 'track' }) }, { [dumpId]: dump(2) })
  const move = { type: 'ground-move', unitId: 'tank', path: ['s10.02'], fuelDumpId: dumpId }
  assert.throws(() => submit(start, { ...move, fuelDumpId: undefined }), /fueled/)
  assert.throws(() => submit(start, { ...move, path: ['s1.04'] }), /passable/)
  assert.equal(start.state.dumps[dumpId].tokens, 2)
  const moved = submit(start, move)
  assert.equal(moved.state.dumps[dumpId].tokens, 1)
  assert.equal(moved.state.units.tank.hex, 's10.02')
  assert.equal(moved.state.railControl['s10.02'], 'axis')
  assert.equal(submitScorpionSession(moved, 'axis', command(start, move), assets, board).duplicate, true)
  assert.equal(submit(moved, { type: 'complete-movement' }).state.units.tank.fueled, false)
})

test('a split formation chooses one trace anchor, with stocked feeding and assigned attrition', () => {
  const start = fixture({ left: counter('s1.04', { formation: 'panzers' }),
    right: counter('s10.01', { formation: 'panzers', printedRe: 3, outOfSupply: true }),
    lost: counter('s15.08'), alert: counter('s15.09', { definition: 'alert' }) },
  { 'axis:hex:s10.01': dump(1), 'axis:hex:s10.02': dump(1) })
  let record = submit(start, { type: 'complete-movement' })
  assert.equal(record.state.supply.splits.length, 1)
  assert.throws(() => submit(record, { type: 'check-attrition' }), /trace choices/)
  record = submit(record, { type: 'choose-formation-trace', formation: 'panzers', anchor: 'direct:s1.03' })
  const payments = [{ dumpId: 'axis:hex:s10.01', portions: [{ unitId: 'right', re: 2 }] },
    { dumpId: 'axis:hex:s10.02', portions: [{ unitId: 'right', re: 1 }] }]
  assert.throws(() => submit(record, { type: 'feed-units', payments: payments.slice(0, 1) }), /current RE/)
  assert.equal(record.state.dumps['axis:hex:s10.01'].tokens, 1)
  record = submit(record, { type: 'feed-units', payments })
  assert.equal(record.state.dumps['axis:hex:s10.02'].tokens, 0)
  assert.throws(() => submit(record, { type: 'feed-units', payments }), /with tokens|cannot eat/)
  record = submit(record, { type: 'check-attrition' })
  assert.equal(record.state.rng.drawCount, 4)
  assert.equal(record.state.units.right.outOfSupply, false)
  assert.equal(record.state.units.lost.outOfSupply, true)
  assert.throws(() => submit(record, { type: 'complete-supply' }), /Resolve attrition/)
  record = submit(record, { type: 'assign-attrition', hex: 's15.08', allocation: [{ unitId: 'lost', steps: 1 }] })
  record = submit(record, { type: 'assign-attrition', hex: 's15.09', allocation: [{ unitId: 'alert', steps: 1 }] })
  assert.equal(record.state.arrival.sovietVp, 2)
  assert.equal(record.state.pieces[0].location.kind, 'dead-pile')
  assert.deepEqual(record.state.availableAlerts, [{ id: 'alert', definition: 'alert' }])
  assert.equal(record.state.units.lost, undefined)
  const frame = scorpionSessionBoxFrame(record.state, assets.catalog)
  assert.equal(frame.inventories.find(({ cell }) => cell === 19).counters[0].id, 'lost')
  assert.equal(frame.trackers.find(({ id }) => id === 'vp').cell, 35)
  assert.equal(submit(record, { type: 'complete-supply' }).state.cursor.phase, 'reaction')
})

test('the OCS attrition table uses unsupplied steps and its large-stack modifier', () => {
  assert.equal(attritionLoss(4, 5, [4, 4]), 0)
  assert.equal(attritionLoss(5, 5, [4, 4]), 2)
  assert.equal(attritionLoss(5, 5, [5, 5]), 5)
  assert.equal(attritionLoss(1, 0, [6, 6]), 1)
})

test('mandatory internal recovery allows a partial upgrade and spends an unusable token before attrition', () => {
  const dumpId = 'axis:hex:s10.01'
  const offRange = 'axis:hex:s15.08'
  let record = submit(fixture({
    division: counter('s10.01', { printedRe: 3, stepsLost: 1, internalStocks: 'exhausted' }),
    detached: counter('s1.03', { internalStocks: 'low' }),
  }, { [dumpId]: dump(5), [offRange]: dump(2) }), { type: 'complete-movement' })
  assert.throws(() => submit(record, { type: 'check-attrition' }), /Recover affordable/)
  assert.throws(() => submit(record, { type: 'recover-internal-stocks', unitId: 'division',
    payments: [{ dumpId, tokens: 2 }] }), /exact token cost/)
  record = submit(record, { type: 'recover-internal-stocks', unitId: 'division', payments: [{ dumpId, tokens: 4 }] })
  assert.equal(record.state.units.division.internalStocks, 'low')
  assert.equal(record.state.dumps[dumpId].tokens, 1)
  record = submit(record, { type: 'check-attrition' })
  assert.equal(record.state.dumps[dumpId].tokens, 0)
  assert.equal(record.state.dumps[offRange].tokens, 2)
  assert.equal(record.state.units.division.internalStocks, 'low')
  assert.equal(record.state.units.detached.internalStocks, 'low')
})

test('formation fuel covers only recipients of the chosen source and lasts until friendly Cleanup', () => {
  const dumpId = 'axis:hex:s10.01'
  const formation = 'armor'
  const start = fixture({
    first: counter('s10.01', { formation, mobility: 'track' }),
    second: counter('s10.02', { formation, mobility: 'track' }),
    remote: counter('s1.03', { formation, mobility: 'track' }),
    other: counter('s10.01', { formation: 'other', mobility: 'track' }),
  }, { [dumpId]: dump(5) })
  const action = { type: 'fuel-formation', formation, payments: [{ dumpId, tokens: 4 }] }
  const paid = submit(start, action)
  assert.deepEqual(paid.state.formationFuel[0].recipients, ['first', 'second'])
  assert.equal(paid.state.dumps[dumpId].tokens, 1)
  assert.throws(() => submit(paid, action), /active formation fuel/)
  const moved = submit(paid, { type: 'ground-move', unitId: 'first', path: ['s10.02'] })
  assert.equal(moved.state.units.first.fueled, true)
  const supply = submit(moved, { type: 'complete-movement' })
  assert.equal(supply.state.units.first.fueled, false)
  const later = { ...supply, state: { ...supply.state, cursor: { ...supply.state.cursor, phase: 'exploitation' },
    units: { ...supply.state.units, second: { ...supply.state.units.second, exploit: true } }, moved: [] } }
  const advanced = submit(later, { type: 'ground-move', unitId: 'second', path: ['s10.01'] })
  assert.equal(advanced.state.dumps[dumpId].tokens, 1)
  const cleanup = submit(advanced, { type: 'complete-exploitation' })
  assert.deepEqual(submit(cleanup, { type: 'complete-cleanup' }).state.formationFuel, [])
})

test('HQ fuel follows the HQ and checks independent status and the phase’s one throw origin', () => {
  const dumpId = 'axis:hex:s10.01'
  const start = fixture({
    hq: counter('s10.01', { mobility: 'truck', headquarters: { throwRange: 4, mobility: 'truck' } }),
    first: counter('s10.01', { mobility: 'track' }), second: counter('s10.02', { mobility: 'track' }),
    division: counter('s10.01', { mobility: 'track', printedRe: 2, stepsLost: 1 }),
  }, { [dumpId]: dump(4) })
  const buy = { type: 'fuel-headquarters', headquartersId: 'hq', payments: [{ dumpId, tokens: 4 }] }
  const paid = submit(start, buy)
  const move = (unitId, hex) => ({ type: 'ground-move', unitId, path: [hex], fuelHeadquartersId: 'hq' })
  assert.throws(() => submit(paid, move('division', 's10.02')), /independent unit/)
  const thrown = submit(paid, move('first', 's10.02'))
  const hqMoved = submit(thrown, { type: 'ground-move', unitId: 'hq', path: ['s10.02'] })
  assert.throws(() => submit(hqMoved, move('second', 's10.01')), /another hex/)
  // If the HQ moves before the first throw, its destination is the allowed origin instead.
  const hqFirst = submit(paid, { type: 'ground-move', unitId: 'hq', path: ['s10.02'] })
  const accepted = submit(hqFirst, move('second', 's10.01'))
  assert.equal(accepted.state.headquartersFuel[0].used.hex, 's10.02')
  assert.equal(accepted.state.dumps[dumpId].tokens, 0)
})

test('a transport can load, pay fuel during its pause and unload, with shared MP and no same-phase reload', () => {
  const origin = 's10.01'
  const target = 's10.02'
  const truckDef = { source: { name: 'Truck', faces: { combat: { asset: 'truck.png', stats: { transport: 1 } } } } }
  assets.catalog.definitions.set('truck', truckDef)
  assets.catalog.aliases.set('Supply Ton 1T', [{ source: { faces: { combat: { asset: 'supply1.png' } } } }])
  assets.catalog.aliases.set('Supply Ton 2T', [{ source: { faces: { combat: { asset: 'supply.png' } } } }])
  const truck = counter(origin, { combat: false, definition: 'truck', mobility: 'truck', allowance: 45 })
  const start = fixture({ truck, relay: { ...truck, hex: target }, tank: counter(target, { mobility: 'track' }) },
    { [`axis:hex:${origin}`]: dump(4) })
  let record = submit(start, { type: 'load-transport', unitId: 'truck', tokens: 3 })
  assert.equal(record.state.groundActivity.spent.truck, 5)
  record = submit(record, { type: 'ground-move', unitId: 'truck', path: [target] })
  record = submit(record, { type: 'fuel-from-paused-transport', unitId: 'tank', transportId: 'truck' })
  assert.equal(record.state.units.truck.transportCargoTokens, 2)
  assert.equal(record.state.units.tank.fueled, true)
  record = submit(record, { type: 'unload-transport', unitId: 'truck', tokens: 2 })
  assert.equal(record.state.groundActivity.spent.truck, 11)
  assert.equal(record.state.units.truck.transportCargoTokens, 0)
  assert.throws(() => submit(record, { type: 'load-transport', unitId: 'relay', tokens: 1 }), /loadable supply/)
  const stack = scorpionMapStacks(record.state, assets.catalog, []).find(({ hex }) => hex === target).pages.flat()
  assert.ok(stack.some(({ id, badges }) => id === 'truck' && badges.some(({ text }) => text === '空')))
  assert.ok(stack.some(({ id }) => id === `axis:hex:${target}:1`))
  const returned = submit(record, { type: 'ground-move', unitId: 'truck', path: [origin] })
  assert.equal(returned.state.units.truck.hex, origin)
  const tankMoved = submit(record, { type: 'ground-move', unitId: 'tank', path: [origin] })
  assert.throws(() => submit(tankMoved, { type: 'ground-move', unitId: 'truck', path: [origin] }), /unavailable/)
})

test('only the matching formation can use an organic truck, whose load does not force internal stock recovery', () => {
  const origin = 's10.01'
  assets.catalog.definitions.set('organic', { source: { faces: { combat: { stats: { transport: 1 } } } } })
  const start = fixture({
    organic: counter(origin, { combat: false, definition: 'organic', organicTruck: 'full', mobility: 'truck', allowance: 45, formation: 'armor' }),
    tank: counter(origin, { formation: 'armor', mobility: 'track', internalStocks: 'low' }),
    guest: counter(origin, { formation: 'other', mobility: 'track' }),
  })
  const move = (unitId) => ({ type: 'ground-move', unitId, path: ['s10.02'], fuelDumpId: 'organic' })
  assert.throws(() => submit(start, move('guest')), /outside draw or throw/)
  assert.throws(() => submit(start, { type: 'unload-transport', unitId: 'organic', tokens: 1 }), /Organic trucks cannot unload/)
  const walked = submit(start, move('tank'))
  assert.equal(walked.state.units.organic.transportCargoTokens, 3)
  const supply = submit(walked, { type: 'complete-movement' })
  const checked = submit(supply, { type: 'check-attrition' })
  assert.equal(checked.state.units.organic.transportCargoTokens, 3)
  assert.equal(checked.state.units.tank.internalStocks, 'low')
})
