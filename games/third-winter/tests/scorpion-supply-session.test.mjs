import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { attritionLoss } from '@ocs-eastern/series/attrition'
import { createRngState } from '@ocs-eastern/series/rng'
import { scorpionMap } from '../src/import/scorpion-map.ts'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'
import { scorpionSessionBoxFrame } from '../src/view/scorpion-boxes.ts'
import { scorpionMapStacks } from '../src/view/scorpion-map-counters.ts'
import { scorpionSupplyNetwork } from '../src/ttw/scorpion/supply-trace.ts'
import { scorpionSupplyPosition } from '../src/match/scorpion-supply-position.ts'

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
  assert.equal(moved.state.railControl['s10.02'], undefined)
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

function transportDefinition(points, side = 'axis') {
  const key = `fixture-truck:${side}:${points}`
  assets.catalog.definitions.set(key, { key, kind: 'transport', source: { name: `Truck ${points}`, side,
    faces: { combat: { asset: 'truck.png', maColor: 'black', stats: { move: 45, transport: points } } } } })
  return key
}

function ordinaryTruck(hex, points, tokens = 0, side = 'axis') {
  return counter(hex, { side, combat: false, mobility: 'truck', allowance: 45, transportCargoTokens: tokens,
    definition: transportDefinition(points, side) })
}

test('transport repacking conserves points and cargo and preserves only the selected ongoing movement', () => {
  const a = 's1.03'
  const b = 's1.04'
  transportDefinition(3)
  const start = fixture({ first: ordinaryTruck(a, 2, 3), second: ordinaryTruck(a, 1, 1) })
  const repack = (unitIds, divisions, continueWith) => ({ type: 'repack-transport', unitIds, divisions, continueWith })
  assert.throws(() => submit(start, repack(['first', 'second'], [{ points: 3, tokens: 3 }])), /Keep all/)
  const merged = submit(start, repack(['first', 'second'], [{ points: 3, tokens: 4 }]))
  const moved = submit(merged, { type: 'ground-move', unitId: 'first', path: [b] })
  const stored = moved.state.groundActivity.spent.first
  const split = submit(moved, repack(['first'], [{ points: 2, tokens: 4 }, { points: 1, tokens: 0 }], 1))
  const continuation = split.state.groundActivity.transport.unitId
  assert.equal(split.state.groundActivity.spent[continuation], stored)
  assert.equal(split.state.units.first.transportCargoTokens, 4)
  assert.throws(() => submit(split, { type: 'ground-move', unitId: 'first', path: [a] }), /unavailable/)
  assert.equal(submit(split, { type: 'ground-move', unitId: continuation, path: [a] }).state.units[continuation].hex, a)
})

function extenderFixture() {
  transportDefinition(5)
  assets.catalog.aliases.set('Supply Extender - Truck 20MP', [{ source: { faces: { combat: { asset: 'extender.png' } } } }])
  return fixture({ first: ordinaryTruck('s1.04', 2), second: ordinaryTruck('s1.04', 3) })
}

test('five unloaded Axis points form only where supplied and can flip and move separately next phase', () => {
  const start = extenderFixture()
  const action = { type: 'form-extender', unitIds: ['first', 'second'] }
  const overSpent = { ...start, state: { ...start.state, groundActivity: { turn: 2, phasing: 'axis', phase: 'movement',
    spent: { first: 23 }, airlifted: [] } } }
  assert.throws(() => submit(overSpent, action), /half of its printed MA/)
  const loaded = { ...start, state: { ...start.state, units: { ...start.state.units, first: ordinaryTruck('s1.04', 2, 1) } } }
  assert.throws(() => submit(loaded, action), /five unloaded/)
  const isolated = { ...start, state: { ...start.state, units: { first: ordinaryTruck('s10.01', 2), second: ordinaryTruck('s10.01', 3) } } }
  assert.throws(() => submit(isolated, action), /connect to trace/)
  const axle = submit(start, action)
  assert.equal(axle.state.groundActivity.spent.first, 22.5)
  assert.equal(axle.state.units.first.extender.range, 20)
  assert.equal(scorpionMapStacks(axle.state, assets.catalog, [])[0].pages[0][0].asset, 'extender.png')
  const later = { ...axle, state: { ...axle.state, cursor: { ...axle.state.cursor, turn: 3 }, moved: [] } }
  assert.throws(() => submit(later, { type: 'ground-move', unitId: 'first', path: ['s1.03'] }), /unavailable/)
  const collapsed = submit(later, { type: 'collapse-extender', unitId: 'first', destination: 's1.03' })
  assert.equal(collapsed.state.units.first.hex, 's1.03')
  assert.equal(collapsed.state.units.first.extender, undefined)
  assert.ok(collapsed.state.moved.includes('first'))
  const flipped = submit(later, { type: 'dismantle-extender', unitId: 'first', divisions: [2, 3] })
  for (const id of Object.keys(flipped.state.units)) assert.equal(flipped.state.groundActivity.spent[id], 22.5)
  const first = submit(flipped, { type: 'ground-move', unitId: 'first', path: ['s1.03'] })
  const second = Object.keys(first.state.units).find((id) => id !== 'first')
  assert.equal(submit(first, { type: 'ground-move', unitId: second, path: ['s1.03'] }).state.units[second].hex, 's1.03')
})

test('Scorpion blocks Soviet ordinary truck conversion under TTW 3.6', () => {
  const base = fixture({ truck: ordinaryTruck('s1.04', 5, 0, 'soviet') })
  const record = { ...base, state: { ...base.state, cursor: { ...base.state.cursor, phasing: 'soviet' } } }
  const action = { type: 'form-extender', unitIds: ['truck'] }
  assert.throws(() => submitScorpionSession(record, 'soviet', command(record, action), assets, board), /TTW 3.6/)
})

test('forced Extender collapse displaces only to a supplied hex or falls back to Transport Point capture', () => {
  const start = submit(extenderFixture(), { type: 'form-extender', unitIds: ['first', 'second'] })
  const raid = (blockSource) => {
    const attacker = counter('s1.03', { side: 'soviet', disorganized: true })
    const units = { ...start.state.units, attacker,
      ...(blockSource ? { block: counter('s1.03', { side: 'soviet' }) } : {}) }
    // With a fresh opposing Movement phase, record a fully supplied or isolated retreat destination.
    const cursor = { ...start.state.cursor, phasing: 'soviet' }
    const record = { ...start, state: { ...start.state, units, cursor, moved: [] } }
    const action = { type: 'ground-move', unitId: 'attacker', path: ['s1.04'] }
    return submitScorpionSession(record, 'soviet', command(record, action), assets, {
      ...board, movement: () => ({ enemyCombat: () => false, enemySupplySource: () => false, unnegatedEnemyZoc: () => false }),
    }).record
  }
  const pending = raid(false)
  assert.deepEqual(pending.state.capture.extenders[0].destinations, ['s1.03'])
  assert.equal(pending.state.capture.transports.length, 0)
  assert.throws(() => submit(pending, { type: 'settle-capture', aircraft: [], extenders: [{ id: 'first', destination: 's10.01' }] }), /supplied displacement/)
  const displaced = submit(JSON.parse(JSON.stringify(pending)),
    { type: 'settle-capture', aircraft: [], extenders: [{ id: 'first', destination: 's1.03' }] })
  assert.equal(displaced.state.units.first.hex, 's1.03')
  assert.equal(displaced.state.units.first.extender, undefined)
  assert.equal(displaced.state.rng.drawCount, start.state.rng.drawCount)
  const fallen = raid(true)
  assert.equal(fallen.state.units.first.extender, undefined)
  assert.equal(fallen.state.capture.transports[0].members[0].points, 5)
  assert.equal(fallen.state.rng.drawCount, start.state.rng.drawCount + 1)
})

test('Extender chains can connect a forward rail line to supply without creating a cargo route', () => {
  const hexes = Array.from({ length: 10 }, (_, col) => ({ hex_id: `s${col + 1}.04`, on_map: true,
    terrains_present: [col === 9 ? 'Village' : 'Open'], ...(col === 9 ? { city_level: 'Village' } : {}) }))
  const networkMap = scorpionMap(hexes, hexes.slice(1).map(({ hex_id }, i) => ({ hex_a: hexes[i].hex_id, hex_b: hex_id,
    edge_terrain: 'none', road_present: false, rail_present: i === 8, ...(i === 8 ? { rail_class: 'single' } : {}), bridge: false })))
  const extenders = [{ hex: 's4.04', range: 2, mobility: 'leg' }, { hex: 's7.04', range: 2, mobility: 'leg' },
    { hex: 's8.04', range: 0, mobility: 'leg' }].reverse()
  const position = { side: 'axis', controlled: new Set(['s10.04']), detrainableFacilities: new Set(), headquarters: [],
    enemyCombat: new Set(), unnegatedEnemyZoc: new Set(), railGauge: () => 'axis', weather: 'freeze', extenders }
  const connected = scorpionSupplyNetwork(networkMap, { ...position, sources: new Set(['s1.04']) })
  assert.ok(connected.trace('s10.04').some(({ source }) => source === 's10.04'))
  assert.equal(connected.canUseDump('s10.04', 's1.04'), false)
  assert.deepEqual(scorpionSupplyNetwork(networkMap, { ...position, sources: new Set() }).trace('s10.04'), [])
})

test('the last ground unit across an empty detraining hex determines rail trace, even after leaving', () => {
  const town = 's1.04'
  const ids = ['s1.03', town, 's1.05', 's2.04', 's2.03']
  const map = scorpionMap(ids.map((hex_id) => ({ hex_id, on_map: true,
    terrains_present: [hex_id === town ? 'Village' : 'Open'], ...(hex_id === town ? { city_level: 'Village' } : {}) })),
  ids.filter((hex) => hex !== town).map((hex_b) => ({ hex_a: town, hex_b, edge_terrain: 'none', road_present: false,
    rail_present: hex_b === 's1.03', ...(hex_b === 's1.03' ? { rail_class: 'single' } : {}), bridge: false })))
  const setup = { ...assets, map }
  const rail = { railGauge: () => 'axis', controlOf: () => 'soviet' }
  const first = fixture({ first: ordinaryTruck('s1.03', 1), second: ordinaryTruck('s2.04', 1, 0, 'soviet') })
  first.state.railControl[town] = 'soviet'
  const traceFrom = (record) => scorpionSupplyNetwork(map, scorpionSupplyPosition(record.state, map, 'axis', rail))
    .trace('s1.05').map(({ source }) => source)
  assert.ok(!traceFrom(first).includes(town))
  const march = { type: 'ground-move', unitId: 'first', path: ['S01.04', 's1.05'] }
  const passed = submitScorpionSession(first, 'axis', command(first, march), setup, { supplyRail: rail }).record
  assert.equal(passed.state.railControl[town], 'axis')
  assert.ok(traceFrom(passed).includes(town))
  const restored = JSON.parse(JSON.stringify(passed))
  restored.state.cursor.phasing = 'soviet'
  restored.state.moved = []
  const reply = { type: 'ground-move', unitId: 'second', path: [town, 's2.03'] }
  const retaken = submitScorpionSession(restored, 'soviet', command(restored, reply), setup, { supplyRail: rail }).record
  assert.equal(retaken.state.railControl[town], 'soviet')
  assert.equal(retaken.state.railControl['s1.05'], undefined)
  assert.ok(!traceFrom(retaken).includes(town))
})

test('ordinary track tests occupancy, ZOC and gauge independently of persistent site control', () => {
  const source = 's1.03', track = 's1.04', town = 's1.05', flank = 's2.04'
  const map = scorpionMap([source, track, town, flank].map((hex_id) => ({ hex_id, on_map: true,
    terrains_present: [hex_id === town ? 'Village' : 'Open'], ...(hex_id === town ? { city_level: 'Village' } : {}) })),
  [[source, track], [track, town], [track, flank]].map(([hex_a, hex_b]) => ({ hex_a, hex_b, edge_terrain: 'none',
    road_present: false, rail_present: hex_b !== flank, ...(hex_b !== flank ? { rail_class: 'single' } : {}), bridge: false })))
  const { state } = fixture({ invader: counter(flank, { side: 'soviet', disorganized: true }) })
  state.railControl = { [track]: 'soviet', [town]: 'axis' }
  const railGauge = () => 'axis'
  const townTraces = (position, gauge = railGauge) => scorpionSupplyNetwork(map,
    scorpionSupplyPosition(position, map, 'axis', { railGauge: gauge })).trace(town).some((entry) => entry.source === town)
  assert.equal(townTraces(state), true)
  assert.equal(townTraces({ ...state, units: { invader: { ...state.units.invader, hex: track } } }), false)
  assert.equal(townTraces({ ...state, units: { invader: { ...state.units.invader, disorganized: false } } }), false)
  assert.equal(townTraces(state, (from, to) => from === track && to === town ? 'soviet' : 'axis'), false)
  assert.equal(townTraces({ ...state, railControl: { ...state.railControl, [source]: 'soviet' } }), false)
})
