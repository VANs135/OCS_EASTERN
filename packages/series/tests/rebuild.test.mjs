import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addRepl, canAffordRepl, rebuildRejection, rebuildRestoredSteps, subtractRepl } from '../src/rebuild.ts'

const candidate = (patch = {}) => ({ id: 'u', rebuildable: true, isBreakdown: false, inDeadPile: true, steps: 0, printedSteps: 4, ...patch })

test('only a rebuildable dead-pile or reduced non-breakdown counter may rebuild (OCS 13.5b-c)', () => {
  assert.equal(rebuildRejection(candidate()), null)
  assert.equal(rebuildRejection(candidate({ inDeadPile: false, steps: 2 })), null)
  assert.equal(rebuildRejection(candidate({ rebuildable: false })), 'unit-not-rebuildable')
  assert.equal(rebuildRejection(candidate({ isBreakdown: true })), 'breakdown-returns-to-pool')
  assert.equal(rebuildRejection(candidate({ inDeadPile: false, steps: 4 })), 'unit-not-reduced')
  assert.equal(rebuildRejection(candidate({ printedSteps: 0 })), 'invalid-printed-steps')
  assert.equal(rebuildRejection(candidate({ steps: 5 })), 'invalid-current-steps')
  assert.equal(rebuildRejection(candidate({ steps: -1 })), 'invalid-current-steps')
})

test('a dead-pile counter returns to printed strength and a reduced one restores up to printed (OCS 13.5b)', () => {
  assert.equal(rebuildRestoredSteps(candidate()), 4)
  assert.equal(rebuildRestoredSteps(candidate({ inDeadPile: false, steps: 1 })), 4)
  assert.equal(rebuildRestoredSteps(candidate({ inDeadPile: false, steps: 1 }), 2), 3)
  assert.equal(rebuildRestoredSteps(candidate({ inDeadPile: false, steps: 1 }), 99), 4)
  assert.equal(rebuildRestoredSteps(candidate({ inDeadPile: false, steps: 2 }), 0), 2)
})

test('the neutral balance adds, affords and subtracts per resource key', () => {
  const ledger = { pax: 3, ally: 1 }
  assert.equal(canAffordRepl(ledger, { pax: 2, ally: 1 }), true)
  assert.equal(canAffordRepl(ledger, { pax: 4 }), false)
  assert.equal(canAffordRepl(ledger, { air: 1 }), false)
  assert.deepEqual(addRepl(ledger, { pax: 2, air: 1 }), { pax: 5, ally: 1, air: 1 })
  assert.deepEqual(subtractRepl(ledger, { pax: 2, ally: 1 }), { pax: 1, ally: 0 })
  assert.throws(() => subtractRepl(ledger, { pax: 4 }), /Insufficient replacement points/)
})