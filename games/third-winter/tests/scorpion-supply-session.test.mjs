import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { attritionLoss } from '@ocs-eastern/series/attrition'
import { createRngState } from '@ocs-eastern/series/rng'
import { scorpionMap } from '../src/import/scorpion-map.ts'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'
import { scorpionSessionBoxFrame } from '../src/view/scorpion-boxes.ts'

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
  rng: createRngState(42), moved: [], pieces: [], availableAlerts: [], railControl: {},
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
