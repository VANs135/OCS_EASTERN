import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ARMY_HQ_SUPPLY_CAP_PER_TURN, SOVIET_VP_PER_ARMY_HQ_DESTROYED, armyGroupHqValidHex, armyGroupMayCreateSpecialDump,
  armyGroupSpPlacement, armyHqDestroyedOnRetreat, armyHqEngineerCapable, armyGroupHqEngineerCapable,
  axisHqRailOnly, corpsHqRecovery,
} from '../src/ttw/axis-hq.ts'

// TTW §2.3b–e：轴心 HQ 本体移动/补给/工程/重建/恢复掷骰。
test('Army/Army Group HQ rail-only movement and hex/engineer restrictions (§2.3b/c)', () => {
  assert.equal(axisHqRailOnly(true), true)
  assert.equal(axisHqRailOnly(false), false)
  assert.equal(armyGroupHqValidHex({ majorOrMinorCity: true }), true)
  assert.equal(armyGroupHqValidHex({ majorOrMinorCity: false }), false)
  assert.equal(armyHqEngineerCapable(), true)
  assert.equal(armyGroupHqEngineerCapable(), false)
  assert.equal(ARMY_HQ_SUPPLY_CAP_PER_TURN, 3)
})

test('Army HQ retreat destruction, free rebuild and VP; Army Group SP placement (§2.3b/c)', () => {
  assert.equal(armyHqDestroyedOnRetreat(true), true)
  assert.equal(armyHqDestroyedOnRetreat(false), false)
  assert.equal(SOVIET_VP_PER_ARMY_HQ_DESTROYED, 1)
  const base = { combatMode: true, spStackedAtMovementStart: true, withinThrow: true }
  assert.equal(armyGroupSpPlacement(base), true)
  assert.equal(armyGroupSpPlacement({ ...base, combatMode: false }), false)
  assert.equal(armyGroupSpPlacement({ ...base, withinThrow: false }), false)
  assert.equal(armyGroupMayCreateSpecialDump('combat'), true)
  assert.equal(armyGroupMayCreateSpecialDump('move'), false)
})

test('Corps HQ recovery die: 1-3 rebuilt, 4-6 dead (§2.3d)', () => {
  assert.equal(corpsHqRecovery(1), 'rebuilt')
  assert.equal(corpsHqRecovery(3), 'rebuilt')
  assert.equal(corpsHqRecovery(4), 'dead')
  assert.equal(corpsHqRecovery(6), 'dead')
  assert.throws(() => corpsHqRecovery(0), /1-6 die/)
  assert.throws(() => corpsHqRecovery(7), /1-6 die/)
})