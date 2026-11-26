import assert from 'node:assert/strict'
import { test } from 'node:test'
import { barrageVolleyStrength } from '../src/tables/barrage.ts'

const battery = (patch = {}) => ({
  id: 'a', strength: 12, printedRe: 3, independentRe: true, remainingSteps: 3, usedRe: 0, barrageFactor: 1, ...patch,
})

test('independent-RE artillery fires proportionally to its firing RE (OCS 10.0)', () => {
  assert.deepEqual(barrageVolleyStrength([battery()]), { strength: 12, batteries: [{ id: 'a', re: 3 }] })
  assert.deepEqual(barrageVolleyStrength([battery({ remainingSteps: 2 })]), { strength: 8, batteries: [{ id: 'a', re: 2 }] })
  assert.deepEqual(barrageVolleyStrength([battery({ firingRe: 1 })]), { strength: 4, batteries: [{ id: 'a', re: 1 }] })
  assert.deepEqual(barrageVolleyStrength([battery({ barrageFactor: 0.5 })]), { strength: 6, batteries: [{ id: 'a', re: 3 }] })
})

test('RE already fired this phase reduces the available volley (OCS 10.0)', () => {
  assert.deepEqual(barrageVolleyStrength([battery({ usedRe: 1 })]), { strength: 8, batteries: [{ id: 'a', re: 2 }] })
  assert.throws(() => barrageVolleyStrength([battery({ usedRe: 1, firingRe: 3 })]), /eligible unused artillery RE/)
  assert.throws(() => barrageVolleyStrength([battery({ usedRe: 3 })]), /eligible unused artillery RE/)
})

test('non-independent artillery fires once per phase at full strength (OCS 10.0)', () => {
  const once = battery({ id: 'b', strength: 6, printedRe: 2, independentRe: false, remainingSteps: 1 })
  assert.deepEqual(barrageVolleyStrength([once]), { strength: 6, batteries: [{ id: 'b', re: 1 }] })
  assert.throws(() => barrageVolleyStrength([{ ...once, usedRe: 1 }]), /eligible unused artillery RE/)
})

test('volley strength sums batteries and rejects invalid firing RE (OCS 10.0)', () => {
  const summed = barrageVolleyStrength([battery({ firingRe: 1 }), battery({ id: 'b', strength: 6, printedRe: 1, firingRe: 1 })])
  assert.equal(summed.strength, 10)
  assert.deepEqual(summed.batteries, [{ id: 'a', re: 1 }, { id: 'b', re: 1 }])
  assert.throws(() => barrageVolleyStrength([battery({ firingRe: 0 })]), /eligible unused artillery RE/)
  assert.throws(() => barrageVolleyStrength([battery({ firingRe: 1.5 })]), /eligible unused artillery RE/)
  assert.throws(() => barrageVolleyStrength([battery({ firingRe: 4 })]), /eligible unused artillery RE/)
})