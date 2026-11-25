import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { counterPoolCapacity } from '../src/counter-pool.ts'

test('a scenario quantity overrides defaults, including zero; absence remains unknown', () => {
  assert.deepEqual(counterPoolCapacity(5, undefined), { count: 5, source: 'default' })
  assert.deepEqual(counterPoolCapacity(5, 2), { count: 2, source: 'scenario' })
  assert.deepEqual(counterPoolCapacity(5, 0), { count: 0, source: 'scenario' })
  assert.deepEqual(counterPoolCapacity(undefined, 3), { count: 3, source: 'scenario' })
  assert.equal(counterPoolCapacity(undefined, undefined), undefined)
  assert.throws(() => counterPoolCapacity(3, -1), /Invalid/)
  assert.throws(() => counterPoolCapacity(1.5, undefined), /Invalid/)
})
