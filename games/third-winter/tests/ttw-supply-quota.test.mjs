import assert from 'node:assert/strict'
import test from 'node:test'
import { AXIS_ARMY_HQ_SP_CAP, SOVIET_FRONT_HQ_MANDATORY_SP, ARMY_GROUP_CARRY_SP, SOVIET_FIXED_SUPPLY_HEXES,
  axisArmyHqSpWithinCap, sovietFrontMandatoryMet, sovietRemainingSpValidHex, armyGroupCarryWithinCap,
  armyGroupSpecialDumpAllowed, TOKENS_PER_SP, ttwSupplySiteQuota } from '../src/ttw/campaign/supply-quota.ts'

test('Axis Army HQ placement cap is 3 SP per turn (§2.3b B)', () => {
  assert.equal(AXIS_ARMY_HQ_SP_CAP, 3)
  assert.equal(axisArmyHqSpWithinCap(3), true)
  assert.equal(axisArmyHqSpWithinCap(0), true)
  assert.equal(axisArmyHqSpWithinCap(4), false)
  assert.equal(axisArmyHqSpWithinCap(-1), false)
})

test('each Front HQ must receive 2 SP; remaining SP go to valid locations (§3.1b)', () => {
  assert.equal(SOVIET_FRONT_HQ_MANDATORY_SP, 2)
  assert.equal(sovietFrontMandatoryMet([{ sp: 2 }, { sp: 3 }]), true)
  assert.equal(sovietFrontMandatoryMet([{ sp: 2 }, { sp: 1 }]), false)
  assert.equal(sovietFrontMandatoryMet([]), true)
  // fixed hexes include Kharkov/Kiev
  assert.ok(SOVIET_FIXED_SUPPLY_HEXES.includes('B59.10'))
  assert.ok(SOVIET_FIXED_SUPPLY_HEXES.includes('B5.24'))
  const base = { isFrontHqHex: false, isFixedHex: false, isMapDSouthEdgeRoadRail: false, sovietControl: false }
  assert.equal(sovietRemainingSpValidHex({ ...base, isFrontHqHex: true }), true)
  assert.equal(sovietRemainingSpValidHex({ ...base, isFixedHex: true }), true)
  assert.equal(sovietRemainingSpValidHex({ ...base, isMapDSouthEdgeRoadRail: true, sovietControl: true }), true)
  assert.equal(sovietRemainingSpValidHex({ ...base, isMapDSouthEdgeRoadRail: true, sovietControl: false }), false)
  assert.equal(sovietRemainingSpValidHex(base), false)
})

test('Army Group HQ carries 1 SP and special dumps require Combat Mode (§2.3c D)', () => {
  assert.equal(ARMY_GROUP_CARRY_SP, 1)
  assert.equal(armyGroupCarryWithinCap(1), true)
  assert.equal(armyGroupCarryWithinCap(2), false)
  assert.equal(armyGroupSpecialDumpAllowed('combat'), true)
  assert.equal(armyGroupSpecialDumpAllowed('move'), false)
})

test('placement site quotas in tokens: Army HQ capped 3 SP, Front HQ mandatory 2 SP, Army Group residual (§2.3b B/§2.3c B/§3.1b)', () => {
  assert.equal(TOKENS_PER_SP, 4)
  // Axis Army HQ site capped at 3 SP = 12 tokens, bounded by pool
  assert.deepEqual(ttwSupplySiteQuota('axis-army-hq', 40), { minTokens: 0, maxTokens: 12 })
  assert.deepEqual(ttwSupplySiteQuota('axis-army-hq', 8), { minTokens: 0, maxTokens: 8 })
  // Army Group HQ gets the pool residual (no per-site cap)
  assert.deepEqual(ttwSupplySiteQuota('axis-army-group-hq', 40), { minTokens: 0, maxTokens: 40 })
  assert.deepEqual(ttwSupplySiteQuota('axis-air-base', 40), { minTokens: 0, maxTokens: 40 })
  // Soviet Front HQ mandatory 2 SP = 8 tokens, max bounded by pool
  assert.deepEqual(ttwSupplySiteQuota('soviet-front-hq', 40), { minTokens: 8, maxTokens: 40 })
  assert.deepEqual(ttwSupplySiteQuota('soviet-front-hq', 4), { minTokens: 4, maxTokens: 4 })
  assert.deepEqual(ttwSupplySiteQuota('soviet-fixed-hex', 40), { minTokens: 0, maxTokens: 40 })
})