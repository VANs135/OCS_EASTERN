import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { loadScorpionMap } from '../src/import/scorpion-map-files.ts'
import { scorpionMap } from '../src/import/scorpion-map.ts'
import { scorpionStepCost } from '../src/ttw/scorpion/terrain-cost.ts'
import { scorpionTraceOptions } from '../src/ttw/scorpion/supply-trace.ts'
import { submitScorpionGroundMove } from '../src/match/scorpion-movement.ts'
import { submitScorpionTraceCheck } from '../src/match/scorpion-ground-supply.ts'

const hex = (hex_id, terrains_present = ['Open'], city_level = null) => ({
  hex_id, on_map: true, terrains_present, city_level,
})
const edge = (hex_a, hex_b, extra = {}) => ({
  hex_a, hex_b, edge_terrain: 'none', road_present: false, rail_present: false, bridge: false, ...extra,
})
const hexes = [hex('S1.01'), hex('S1.02', ['Forest', 'Open']), hex('S1.03'), hex('S1.04', ['Minor City'], 'Minor City')]
const edges = [
  edge('S1.01', 'S1.02', { road_present: true, road_subclass: 'Secondary Road', bridge: true,
    edge_terrain: 'river', river_class: 'major', seam_dup_primary: false }),
  edge('S1.02', 'S1.03', { edge_terrain: 'river', river_class: 'minor' }),
  edge('S1.03', 'S1.04', { rail_present: true, rail_class: 'single' }),
]
const map = scorpionMap(hexes, edges)
const empty = new Set()

test('new crop is the only map source; primary flags from A–D do not remove local edges', async () => {
  const requested = []
  const loaded = await loadScorpionMap(async (...path) => {
    requested.push(path.join('/'))
    return { items: path[1].includes('hexes') ? hexes : edges }
  })
  assert.deepEqual(requested, ['地图数据库/map_hexes_scorpion.json', '地图数据库/map_edges_scorpion.json'])
  assert.deepEqual(loaded.neighbors('S1.2'), ['s1.01', 's1.03'])
  assert.deepEqual(loaded.hexes.get('s1.02').terrains, ['Forest', 'Open'])
  assert.equal(loaded.edge('s1.02', 's1.01').bridge, true)
  assert.throws(() => scorpionMap(hexes, [...edges, edge('S1.01', 'S1.03')]), /edge/)
  assert.throws(() => scorpionMap(hexes, [...edges, edge('S1.01', 'S2.01')]), /edge/)
})

test('movement follows the new graph and TEC, with an unbridged freeze river cost', () => {
  assert.equal(scorpionStepCost(map, 's1.01', 's1.02', 'truck', 'freeze'), 0.5)
  assert.equal(scorpionStepCost(map, 's1.02', 's1.03', 'truck', 'freeze'), 4)
  assert.equal(scorpionStepCost(map, 's1.01', 's1.03', 'leg', 'freeze'), null)
  const cursor = { turn: 1, first: 'soviet', phasing: 'soviet', phase: 'movement', retention: 'soviet' }
  const infantry = { side: 'soviet', hex: 's1.01', combat: true, mobility: 'leg', allowance: 3, fueled: false }
  const initial = { revision: 0, receipts: [], state: { cursor, units: { infantry }, moved: [], trace: null } }
  const cmd = { id: 'move', expectedRevision: 0, action: { unitId: 'infantry', path: ['s1.02', 's1.03'] } }
  const board = { map, weather: 'freeze', enemyCombat: () => false,
    enemySupplySource: () => false, unnegatedEnemyZoc: () => false }
  assert.throws(() => submitScorpionGroundMove(initial, 'axis', cmd, board), /unavailable/)
  assert.throws(() => submitScorpionGroundMove(initial, 'soviet', cmd, { ...board, weather: 'thaw' }), /unavailable/)
  const moved = submitScorpionGroundMove(initial, 'soviet', cmd, board).record
  assert.equal(moved.state.units.infantry.hex, 's1.03')
  assert.equal(submitScorpionGroundMove(moved, 'soviet', cmd, board).duplicate, true)
  const readTraceFacts = () => ({ side: 'soviet', sources: new Set(['s1.04']), controlled: empty,
    enemyCombat: empty, unnegatedEnemyZoc: empty, railGauge: () => 'axis', detrainableFacilities: empty,
    headquarters: [], weather: 'freeze' })
  const advance = submitScorpionTraceCheck(moved, 'soviet',
    { id: 'supply', expectedRevision: 1, action: { type: 'complete-movement' } }, map, readTraceFacts)
  assert.equal(advance.record.state.cursor.phase, 'supply')
  assert.deepEqual(advance.record.state.trace.infantry, [{ kind: 'direct', from: 's1.03', source: 's1.04' }])
})

test('rail and trace check control, ZOC, rail gauge and Kessel dispatch independently', () => {
  const traceMap = scorpionMap([hex('S1.01'), hex('S1.02'), hex('S1.03', ['Village', 'Open'], 'Village'), hex('S1.04')],
    [
      edge('S1.01', 'S1.02', { rail_present: true, rail_class: 'single' }),
      edge('S1.02', 'S1.03', { rail_present: true, rail_class: 'single' }),
      edge('S1.03', 'S1.04'),
    ])
  const state = { side: 'axis', sources: new Set(['s1.01']), controlled: new Set(['s1.03']),
    enemyCombat: empty, unnegatedEnemyZoc: empty, railGauge: () => 'axis', detrainableFacilities: empty,
    headquarters: [{ hex: 's1.03', throwRange: 0, mobility: 'leg', kessel: true }], weather: 'freeze' }
  const sources = (changes) => scorpionTraceOptions(traceMap, { ...state, ...changes }, 's1.04')
  assert(sources({}).some((x) => x.kind === 'direct' && x.source === 's1.03'))
  assert(!sources({ railGauge: () => 'soviet' }).some((x) => x.kind === 'direct' && x.source === 's1.03'))
  assert(!sources({ controlled: empty }).some((x) => x.kind === 'direct' && x.source === 's1.03'))
  assert(!sources({ unnegatedEnemyZoc: new Set(['s1.02']) }).some((x) => x.kind === 'direct' && x.source === 's1.03'))
  assert(sources({ sources: empty }).some((x) => x.kind === 'kessel'))
})
