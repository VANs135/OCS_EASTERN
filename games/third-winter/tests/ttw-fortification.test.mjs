import assert from 'node:assert/strict'
import test from 'node:test'
import { TTW_HEDGEHOG_MAX_LEVEL, ttwHedgehogBuildLevelValid, ttwHedgehogCaptureReducedLevel,
  FORTRESS_DECLARATION_HEDGEHOG_LEVEL, fortressDeclarationEligible, fortressSecondUnitAllowed,
  fortressStatusEnds, airStripCapturedToPool } from '../src/ttw/campaign/fortification.ts'

test('hedgehogs cap at Level-2 and drop one level when captured (§1.1b)', () => {
  assert.equal(TTW_HEDGEHOG_MAX_LEVEL, 2)
  assert.equal(ttwHedgehogBuildLevelValid(1), true)
  assert.equal(ttwHedgehogBuildLevelValid(2), true)
  assert.equal(ttwHedgehogBuildLevelValid(0), false)
  assert.equal(ttwHedgehogBuildLevelValid(3), false)
  assert.equal(ttwHedgehogCaptureReducedLevel(2), 1)
  assert.equal(ttwHedgehogCaptureReducedLevel(1), 0)
  assert.equal(ttwHedgehogCaptureReducedLevel(0), 0)
})

test('fortress declaration needs controlled city, enemy within 2 and an available fortress unit (§2.4a)', () => {
  const base = { axisControlsCity: true, enemyCombatWithin2: true, fortressInAvailablePool: true }
  assert.equal(fortressDeclarationEligible(base), true)
  assert.equal(fortressDeclarationEligible({ ...base, axisControlsCity: false }), false)
  assert.equal(fortressDeclarationEligible({ ...base, enemyCombatWithin2: false }), false)
  assert.equal(fortressDeclarationEligible({ ...base, fortressInAvailablePool: false }), false)
  // Rumanian fortress only within Rumania
  assert.equal(fortressDeclarationEligible({ ...base, isRumanianFortress: true, withinRumania: true }), true)
  assert.equal(fortressDeclarationEligible({ ...base, isRumanianFortress: true, withinRumania: false }), false)
  assert.equal(FORTRESS_DECLARATION_HEDGEHOG_LEVEL, 1)
  assert.equal(fortressSecondUnitAllowed('Kiev'), true)
  assert.equal(fortressSecondUnitAllowed('Odessa'), true)
  assert.equal(fortressSecondUnitAllowed('Poltava'), true)
  assert.equal(fortressSecondUnitAllowed('Kharkov'), false)
  assert.equal(fortressStatusEnds({ everyCityHexSovietControlled: true }), true)
  assert.equal(fortressStatusEnds({ everyCityHexSovietControlled: false }), false)
})

test('air strips return to the pool when occupied by an attack-capable Soviet unit (§2.2h)', () => {
  assert.equal(airStripCapturedToPool({ occupiedByAttackCapableSoviet: true }), true)
  assert.equal(airStripCapturedToPool({ occupiedByAttackCapableSoviet: false }), false)
})