import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extenderConversionRefusal, extenderConversionOptions, planExtenderConversion,
  EXTENDER_REQUIRED_POINTS } from '../src/extender-conversion.ts'

const point = (patch = {}) => ({ id: 't', kind: 'truck', points: 5, ...patch })

test('conversion needs a movement segment and 5 same-kind convertible points (OCS 12.7a)', () => {
  assert.equal(EXTENDER_REQUIRED_POINTS, 5)
  assert.equal(extenderConversionRefusal({ segment: 'movement', entries: [point()] }), null)
  assert.equal(extenderConversionRefusal({ segment: 'supply', entries: [point()] }), 'extender-wrong-segment')
  assert.equal(extenderConversionRefusal({ segment: 'movement', entries: [point({ points: 4 })] }), 'extender-insufficient-points')
  // mixed kinds do not pool: 3 truck + 3 wagon is not 5 of one kind
  assert.equal(extenderConversionRefusal({ segment: 'movement', entries: [point({ points: 3 }), point({ id: 'w', kind: 'wagon', points: 3 })] }), 'extender-insufficient-points')
})

test('loaded points must unload first and over-spent points cannot pool (OCS 12.7d/e)', () => {
  // 3 usable + 3 loaded would reach 5 only by counting the loaded one
  assert.equal(extenderConversionRefusal({ segment: 'movement', entries: [point({ points: 3 }), point({ id: 'l', points: 3, loaded: true })] }), 'extender-loaded-must-unload')
  // 3 usable + 3 with insufficient remaining MA (ma 20, spent 15 -> 5 left < 10)
  assert.equal(extenderConversionRefusal({ segment: 'movement', entries: [point({ points: 3 }), point({ id: 's', points: 3, ma: 20, mpSpent: 15 })] }), 'extender-insufficient-ma')
})

test('options count whole extenders per kind with remainder (OCS 12.7a)', () => {
  const options = extenderConversionOptions({ entries: [point({ points: 7 }), point({ id: 'w', kind: 'wagon', points: 5 })] })
  assert.deepEqual(options, [
    { kind: 'truck', count: 1, consumedPoints: 5, remainder: 2 },
    { kind: 'wagon', count: 1, consumedPoints: 5, remainder: 0 },
  ])
})

test('plan consumes exactly 5 per extender, keeps the leftover and charges each point half its own MA (OCS 12.7a/e)', () => {
  // 3 + 3 truck -> 1 extender: remove both (6), consume 5, leave 1; each point pays half its own MA
  const plan = planExtenderConversion({ kind: 'truck', count: 1, entries: [point({ id: 'a', points: 3, ma: 20 }), point({ id: 'b', points: 3, ma: 10 })] })
  assert.equal(plan.consumedPoints, 5)
  assert.equal(plan.extenderCount, 1)
  assert.equal(plan.removedPoints, 6)
  assert.equal(plan.leftoverPoints, 1)
  assert.deepEqual(plan.leftoverPlacement, [1])
  assert.equal(plan.totalCostMa, 10 + 5) // 20/2 + 10/2, per point
  // 5 + 3 truck -> 1 extender: minimal subset removes only the 5, leaving 3
  const plan2 = planExtenderConversion({ kind: 'truck', count: 1, entries: [point({ id: 'a', points: 5 }), point({ id: 'b', points: 3 })] })
  assert.deepEqual(plan2.swaps, [{ transportUnitId: 'a', points: 5 }])
  assert.equal(plan2.leftoverPoints, 0)
})

test('plan refuses loaded-only shortfall and non-positive count (OCS 12.7d)', () => {
  assert.equal(planExtenderConversion({ kind: 'truck', count: 0, entries: [point()] }), 'extender-count-positive')
  assert.equal(planExtenderConversion({ kind: 'truck', count: 1, entries: [point({ points: 3 }), point({ id: 'l', points: 3, loaded: true })] }), 'extender-loaded-must-unload')
  assert.equal(planExtenderConversion({ kind: 'truck', count: 1, entries: [point({ points: 4 })] }), 'extender-insufficient-points')
})