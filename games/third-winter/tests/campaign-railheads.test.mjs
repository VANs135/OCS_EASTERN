import assert from 'node:assert/strict'
import test from 'node:test'
import { campaignRailheads } from '../src/match/campaign-rail-network.ts'

const keyOf = (a, b) => [a, b].sort().join('|')

function board(edges) {
  const graph = new Map()
  const link = (a, b) => {
    const list = graph.get(a) ?? []
    if (!list.includes(b)) list.push(b)
    graph.set(a, list)
  }
  for (const [a, b] of edges) link(a, b), link(b, a)
  return { map: { resolveHex: (hex) => hex, neighbors: (hex) => graph.get(hex) ?? [] },
    network: { edge: () => ({ gauge: 'standard', multiTrack: false }), initialGaugeJunctions: ['A'] } }
}

function state(edges) {
  return { railGaugeByEdge: Object.fromEntries(edges.map(([a, b, gauge]) => [keyOf(a, b), gauge])) }
}

test('a gauge boundary is a derived railhead; a pure single-gauge line has none', () => {
  const { map, network } = board([['A', 'B'], ['B', 'C'], ['C', 'D']])
  assert.deepEqual(campaignRailheads(state([['A', 'B', 'standard'], ['B', 'C', 'broad'], ['C', 'D', 'broad']]), map, network)
    .map(({ hex }) => hex), ['B'])
  assert.deepEqual(campaignRailheads(state([['A', 'B', 'broad'], ['B', 'C', 'broad'], ['C', 'D', 'broad']]), map, network), [])
})

test('advancing the gauge moves the railhead; the opening junction is not retained', () => {
  const { map, network } = board([['A', 'B'], ['B', 'C'], ['C', 'D']])
  const initial = state([['A', 'B', 'broad'], ['B', 'C', 'broad'], ['C', 'D', 'standard']])
  assert.deepEqual(campaignRailheads(initial, map, network).map(({ hex }) => hex), ['C'])
  const advanced = state([['A', 'B', 'broad'], ['B', 'C', 'broad'], ['C', 'D', 'broad']])
  assert.deepEqual(campaignRailheads(advanced, map, network), [])
})

test('branches keep one head at each gauge end rather than a marker at every boundary hex', () => {
  const { map, network } = board([['A', 'B'], ['B', 'C'], ['B', 'E'], ['C', 'D'], ['E', 'F'], ['F', 'G']])
  assert.deepEqual(campaignRailheads(state([
    ['A', 'B', 'standard'], ['B', 'C', 'broad'], ['B', 'E', 'broad'],
    ['C', 'D', 'broad'], ['E', 'F', 'broad'], ['F', 'G', 'standard'],
  ]), map, network).map(({ hex }) => hex), ['B', 'F'])
})
