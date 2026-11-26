import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  LUFTFLOTTE_AIRLIFT_RANGE, LUFTFLOTTE_MIN_DISTANCE, luftflotteAirlift, luftflotteDisplacedWhenAlone,
  luftflotteMustMove, luftflotteValidHex,
} from '../src/ttw/luftflotte-hq.ts'

// TTW §2.2b Luftflotte HQ：驻格/强制位移/独自被攻位移/每局一次空运补给。
test('Luftflotte hex validity and forced displacement (§2.2b)', () => {
  assert.equal(LUFTFLOTTE_MIN_DISTANCE, 10)
  const base = { villageCityOrFriendlyAirBase: true, distanceToInSupplySovietCombat: 10 }
  assert.equal(luftflotteValidHex(base), true)
  assert.equal(luftflotteValidHex({ ...base, distanceToInSupplySovietCombat: 9 }), false)
  assert.equal(luftflotteValidHex({ ...base, villageCityOrFriendlyAirBase: false }), false)
  assert.equal(luftflotteMustMove({ sovietCombatWithin10: true }), true)
  assert.equal(luftflotteMustMove({ sovietCombatWithin10: false }), false)
  assert.equal(luftflotteDisplacedWhenAlone({ attacked: true, aloneInHex: true }), true)
  assert.equal(luftflotteDisplacedWhenAlone({ attacked: true, aloneInHex: false }), false)
})

test('once-per-game airlift places 2 SP on an air base or 1 SP elsewhere within 60 hexes (§2.2b)', () => {
  assert.equal(LUFTFLOTTE_AIRLIFT_RANGE, 60)
  const base = { usedThisGame: false, friendlyHex: true, within60: true, airBase: true }
  assert.deepEqual(luftflotteAirlift(base), { ok: true, sp: 2 })
  assert.deepEqual(luftflotteAirlift({ ...base, airBase: false }), { ok: true, sp: 1 })
  assert.deepEqual(luftflotteAirlift({ ...base, usedThisGame: true }), { ok: false, sp: 0 })
  assert.deepEqual(luftflotteAirlift({ ...base, within60: false }), { ok: false, sp: 0 })
  assert.deepEqual(luftflotteAirlift({ ...base, friendlyHex: false }), { ok: false, sp: 0 })
})