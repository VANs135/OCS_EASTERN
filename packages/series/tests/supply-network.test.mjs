import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { supplyNetwork } from '../src/supply-network.ts'

function board(adjacency, { stations = [], rail = [], costs = {}, counts = {} } = {}) {
  const rails = new Set(rail.flatMap(([a, b]) => [`${a}:${b}`, `${b}:${a}`]))
  return {
    hasHex: (hex) => Object.hasOwn(adjacency, hex),
    neighbors: (hex) => adjacency[hex] ?? [],
    railCanTrace: (from, to) => {
      counts.rail = (counts.rail ?? 0) + 1
      return rails.has(`${from}:${to}`)
    },
    detrainable: (hex) => stations.includes(hex),
    traceCost: (from, to) => {
      counts.cost = (counts.cost ?? 0) + 1
      const key = `${from}:${to}`
      return Object.hasOwn(costs, key) ? costs[key] : 1
    },
  }
}

const position = (overrides = {}) => ({ sources: new Set(), controlled: new Set(), enemyCombat: new Set(),
  unnegatedEnemyZoc: new Set(), headquarters: [], ...overrides })

test('lazy rail and extender closure preserves source order and never self-connects a disconnected cycle', () => {
  const adjacency = { start: ['station'], station: ['start', 'link'], link: ['station', 'end'],
    end: ['link', 'unit'], unit: ['end'], isolatedA: ['isolatedB'], isolatedB: ['isolatedA'] }
  const counts = {}
  const map = board(adjacency, { stations: ['station', 'end'], rail: [['start', 'station']], counts })
  const state = position({ sources: new Set(['start']), controlled: new Set(['station', 'end']), extenders: [
    { hex: 'end', range: 0, mobility: 'leg' }, { hex: 'link', range: 0, mobility: 'leg' },
    { hex: 'isolatedA', range: 0, mobility: 'leg' }, { hex: 'isolatedB', range: 0, mobility: 'leg' },
  ] })
  const network = supplyNetwork(map, state)
  assert.equal(network.canDrawDump('unit', 'end', 'leg'), true)
  assert.equal(counts.rail ?? 0, 0, 'physical supply does not build the rail network')
  assert.deepEqual(network.trace('unit', 'leg').map(({ source }) => source), ['start', 'station', 'link', 'end'])
  assert.ok(counts.rail > 0)
  assert.equal(network.hasConnectedUnloadSite('station'), true)
  assert.equal(network.hasConnectedUnloadSite('end'), false)
  assert.deepEqual(network.trace('isolatedA'), [])
  assert.equal(network.canConnectExtender({ hex: 'isolatedB', range: 0, mobility: 'leg' }), false)
})

test('final adjacency, directional costs, mobility and occupation still determine the same options', () => {
  const adjacency = { unit: ['via'], via: ['unit', 'hq'], hq: ['via'], first: ['via'], second: ['via'], blocked: ['via'] }
  const state = position({ sources: new Set(['second', 'first', 'blocked']), enemyCombat: new Set(['blocked']),
    unnegatedEnemyZoc: new Set(['via']), headquarters: [{ id: 'normal', hex: 'hq', throwRange: 1, mobility: 'leg' },
      { id: 'local', hex: 'hq', throwRange: 1, mobility: 'leg', selfContained: true }] })
  const map = board(adjacency, { costs: { 'unit:via': 'all' } })
  const network = supplyNetwork(map, state)
  const expected = [
    { kind: 'direct', from: 'unit', source: 'second' }, { kind: 'direct', from: 'unit', source: 'first' },
    { kind: 'hq', from: 'hq', source: 'second', headquarters: 'normal' }, { kind: 'hq', from: 'hq', source: 'first', headquarters: 'normal' },
    { kind: 'self-contained', from: 'hq', source: 'hq', headquarters: 'local' },
  ]
  assert.deepEqual(network.trace('unit', 'leg'), expected)
  assert.deepEqual(network.trace('unit', 'truck'), expected.slice(2))
  for (const hex of Object.keys(adjacency)) for (const mobility of ['leg', 'truck', 'track']) {
    assert.equal(network.hasTrace(hex, mobility), network.trace(hex, mobility).length > 0)
  }
  assert.equal(network.canDrawDump('unit', 'first', 'truck'), false)
  assert.equal(network.canUseDumpVia('normal', 'unit', 'first'), true)
  assert.equal(network.canUseDump('unit', 'blocked', 'leg'), false)
  assert.equal(network.inThrowRange('local', 'unit'), true)
  const different = supplyNetwork(map, { ...state, unnegatedEnemyZoc: new Set() })
  assert.deepEqual(different.trace('unit', 'truck'), expected)
  assert.deepEqual(network.trace('unit', 'truck'), expected.slice(2))
})

test('queries on the same snapshot share cost lookups and do not share returned mutable rows', () => {
  const adjacency = { a: ['b'], b: ['a', 'c'], c: ['b'] }
  const counts = {}
  const map = board(adjacency, { counts })
  const network = supplyNetwork(map, position({ sources: new Set(['a']) }))
  const first = network.trace('c', 'truck')
  const used = counts.cost
  first[0].source = 'changed'
  assert.deepEqual(network.trace('c', 'truck'), [{ kind: 'direct', from: 'c', source: 'a' }])
  assert.equal(counts.cost, used)
  network.trace('b', 'truck')
  assert.equal(counts.cost, used, 'shared directed edge costs are reused across origins')
})

test('reverse coverage agrees with forward queries on directed edges, all-cost steps, zero costs and HQ coverage', () => {
  const adjacency = { source: ['end'], end: [], zero: ['end'], all: ['zero'], earlier: ['all'],
    normal: ['zero'], blocked: ['zero'], hq: ['zone'], zone: [], final: ['zone'], isolated: [] }
  const incomingNeighbors = (hex) => Object.keys(adjacency).filter((from) => adjacency[from].includes(hex))
  const map = { ...board(adjacency, { costs: { 'all:zero': 'all', 'zero:end': 0, 'normal:zero': 4.5 } }), incomingNeighbors }
  const state = position({ sources: new Set(['source']), unnegatedEnemyZoc: new Set(['blocked']),
    headquarters: [{ id: 'local', hex: 'hq', throwRange: 1, mobility: 'truck', selfContained: true }] })
  const network = supplyNetwork(map, state)
  assert.equal(network.hasTrace('all'), true)
  assert.equal(network.hasTrace('earlier'), false, 'an all-cost edge is only a valid first step')
  assert.equal(network.hasTrace('final'), true)
  assert.equal(network.hasTrace('blocked', 'truck'), false)
  assert.equal(network.hasTrace('blocked', 'leg'), true)
  for (const mobility of ['truck', 'leg', 'track']) {
    network.prepareTraceCoverage(mobility)
    for (const hex of Object.keys(adjacency)) assert.equal(network.hasTrace(hex, mobility), network.trace(hex, mobility).length > 0, `${hex} ${mobility}`)
  }
})

test('fractional costs outside exact half points keep the forward result', () => {
  const adjacency = { a: ['b'], b: ['a', 'c'], c: ['b'] }
  const map = { ...board(adjacency, { costs: { 'c:b': 0.1 } }), incomingNeighbors: (hex) => adjacency[hex] ?? [] }
  const network = supplyNetwork(map, position({ sources: new Set(['a']) }))
  network.prepareTraceCoverage('truck')
  for (const hex of Object.keys(adjacency)) assert.equal(network.hasTrace(hex), network.trace(hex).length > 0)
})
