import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  FRONT_MIN_ARMY_HQS, armyHqAssignmentComplete, assignedHqMayDrawAcrossBoundary,
  frontBoundarySupplyMayLeave, frontMinimumComposition,
} from '../src/ttw/front-boundaries.ts'

// TTW §3.3b：编属/最低编成/补给越界（几何由剧本注入）。
const full = { assignedArmyHqsInBoundary: 4, tankCorpsInThrow: true, mechOrCavCorpsInThrow: true, artyOrKatyDivisionInThrow: true }

test('front minimum composition requires four assigned army HQs plus the three corps (§3.3b C)', () => {
  assert.equal(FRONT_MIN_ARMY_HQS, 4)
  assert.equal(frontMinimumComposition(full).ok, true)
  assert.deepEqual(frontMinimumComposition({ ...full, assignedArmyHqsInBoundary: 3 }).missing, ['army-hqs'])
  assert.deepEqual(frontMinimumComposition({ ...full, tankCorpsInThrow: false, artyOrKatyDivisionInThrow: false }).missing,
    ['tank-corps', 'arty-or-katy-division'])
  assert.equal(frontMinimumComposition({ ...full, assignedArmyHqsInBoundary: 8 }).ok, true) // 无上限
})

test('army HQ assignment must be complete during reinforcement (§3.3b B)', () => {
  assert.equal(armyHqAssignmentComplete([{ assigned: true }, { assigned: true }]), true)
  assert.equal(armyHqAssignmentComplete([{ assigned: true }, { assigned: false }]), false)
  assert.equal(armyHqAssignmentComplete([]), true)
})

test('supply within the command radius may not cross the boundary except a loaded organic truck (§3.3b E)', () => {
  const base = { sourceWithinCommandRadius: true, crossesBoundary: true, organicTruckWithFormation: false, tokens: 1 }
  assert.equal(frontBoundarySupplyMayLeave(base), false)
  assert.equal(frontBoundarySupplyMayLeave({ ...base, organicTruckWithFormation: true, tokens: 1 }), true)
  assert.equal(frontBoundarySupplyMayLeave({ ...base, organicTruckWithFormation: true, tokens: 2 }), false)
  assert.equal(frontBoundarySupplyMayLeave({ ...base, crossesBoundary: false }), true)
  assert.equal(frontBoundarySupplyMayLeave({ ...base, sourceWithinCommandRadius: false }), true)
  assert.equal(assignedHqMayDrawAcrossBoundary(), false)
})