import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  RVGK_MINIMUMS, rvgkAutoTraceSupply, rvgkConsolidationAllowed, rvgkEnterEligible, rvgkForcedExit,
  rvgkFormationCounts, rvgkMarkerMaps, rvgkMarkerRailValid, rvgkMinimumsMet, rvgkReleaseEligible,
} from '../src/ttw/rvgk.ts'

// TTW §3.5 RVGK：标记/最低编成/入盒/强制出盒/释放。
const full = { tankMechCorps: 6, cavalryCorps: 1, artyKatyDivisions: 2, infantryDivisions: 3, tankArmyHq: 1 }

test('RVGK marker maps, rail validity and box minimums (§3.5a/b)', () => {
  assert.deepEqual(rvgkMarkerMaps('rvgk-1'), ['C', 'D'])
  assert.deepEqual(rvgkMarkerMaps('rvgk-2'), ['A', 'B'])
  assert.equal(rvgkMarkerRailValid({ detrainableEnd: true, within10AxisCombat: false }), true)
  assert.equal(rvgkMarkerRailValid({ detrainableEnd: true, within10AxisCombat: true }), false)
  assert.equal(rvgkMarkerRailValid({ detrainableEnd: false, within10AxisCombat: false }), false)
  assert.equal(rvgkMinimumsMet(full).ok, true)
  assert.deepEqual(rvgkMinimumsMet({ ...full, tankMechCorps: 5 }).missing, ['tankMechCorps'])
  assert.equal(RVGK_MINIMUMS.infantryDivisions, 3)
  assert.equal(rvgkFormationCounts({ anyUnitInBox: true, restInBoxOrDead: true, noneOnMap: true }), true)
  assert.equal(rvgkFormationCounts({ anyUnitInBox: true, restInBoxOrDead: true, noneOnMap: false }), false)
})

test('entering, auto trace, forced exit and release gates (§3.5c/d)', () => {
  assert.equal(rvgkEnterEligible({ sovietReinforcementPhase: true, within20: true, stratReachable: true }), true)
  assert.equal(rvgkEnterEligible({ sovietReinforcementPhase: true, within20: false, stratReachable: true }), false)
  assert.equal(rvgkAutoTraceSupply(), true)
  assert.equal(rvgkConsolidationAllowed(), false)
  assert.equal(rvgkForcedExit({ axisCombatWithin5: true }), true)
  assert.equal(rvgkForcedExit({ axisCombatWithin5: false }), false)
  const base = { sovietMovementStart: true, within5: true, minimumsMaintained: true, fullStrength: true,
    enteredThisTurn: false, independent: false, withTankArmyHq: false, independentRe: 0 }
  assert.equal(rvgkReleaseEligible(base), true)
  assert.equal(rvgkReleaseEligible({ ...base, enteredThisTurn: true }), false)
  assert.equal(rvgkReleaseEligible({ ...base, fullStrength: false }), false)
  assert.equal(rvgkReleaseEligible({ ...base, independent: true, withTankArmyHq: false }), false)
  assert.equal(rvgkReleaseEligible({ ...base, independent: true, withTankArmyHq: true, independentRe: 5 }), true)
  assert.equal(rvgkReleaseEligible({ ...base, independent: true, withTankArmyHq: true, independentRe: 6 }), false)
})