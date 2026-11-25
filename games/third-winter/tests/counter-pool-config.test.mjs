import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { unitCatalog } from '../src/import/unit-catalog.ts'
import { readAggregateCounterPool, readCounterPoolRows } from '../src/import/counter-pool-rows.ts'
import { readScorpionBreakdownCounts, readScorpionBreakdowns } from '../src/import/scorpion-breakdown-config.ts'

const definition = (id, name, side, re) => ({ id, name, side, re, faces: { combat: null, move: null } })
const catalog = unitCatalog([{ kind: 'land', file: 'synthetic', rows: [
  definition('parent', 'Parent', 'axis', 3), definition('a', 'A', 'axis', 1),
  definition('b', 'B', 'axis', 1), definition('c', 'C', 'soviet', 1),
] }])

test('configured counters accept the scenario override and use explicit defaults for unlisted types', () => {
  const overrides = readScorpionBreakdownCounts({ axis: [{ ref: 'A', count: 0 }], soviet: [{ ref: 'C', count: 4 }] }, catalog.aliases)
  const config = { parents: [{ definition: 'land:id:parent', pool: 'pool-one' }], counters: [
    { definition: 'land:id:a', pool: 'pool-one', copies: 7 },
    { definition: 'land:id:b', pool: 'pool-one', copies: 5 },
    { definition: 'land:id:c', pool: 'pool-two' },
  ] }
  const { rules } = readScorpionBreakdowns(config, catalog.definitions, overrides)
  assert.deepEqual([...rules.counters.values()].map(({ copies }) => copies), [0, 5, 4])
  assert.throws(() => readScorpionBreakdowns(config, catalog.definitions), /Missing breakdown capacity/)
  assert.throws(() => readScorpionBreakdowns({ ...config, counters: config.counters.slice(0, 2) }, catalog.definitions, overrides), /Missing breakdown pool membership/)
})

test('pool rows reject unresolved, wrong-seat, duplicate and invalid quantities', () => {
  const resolve = (ref) => ['A', 'Alias A'].includes(ref) ? 'land:id:a' : undefined
  assert.throws(() => readCounterPoolRows([{ ref: 'A', count: 1 }, { ref: 'Alias A', count: 2 }], resolve, 'test'), /duplicate/)
  assert.throws(() => readCounterPoolRows([{ ref: 'A', count: '1' }], resolve, 'test'), /quantity/)
  assert.throws(() => readScorpionBreakdownCounts({ soviet: [{ ref: 'A', count: 1 }] }, catalog.aliases), /Unresolved/)
})

test('an aggregate pool keeps one capacity for several definitions', () => {
  const resolve = (ref, side) => side === 'axis' ? ref : undefined
  const raw = { side: 'axis', refs: ['A', 'B', 'C'], default_max: 9, available: 2 }
  const pool = readAggregateCounterPool(raw, resolve, 'test')
  assert.deepEqual(pool.capacity, { count: 2, source: 'scenario' })
  assert.deepEqual(pool.definitions, ['A', 'B', 'C'])
  assert.deepEqual(readAggregateCounterPool({ ...raw, available: undefined }, resolve, 'test').capacity, { count: 9, source: 'default' })
  assert.throws(() => readAggregateCounterPool({ ...raw, refs: ['A', 'A'] }, resolve, 'test'), /duplicate/)
})
