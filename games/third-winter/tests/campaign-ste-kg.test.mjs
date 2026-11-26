import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  STE_COUNT, sovietNormalExtenderAllowed, steCanConvertToTruckPoints, steCleanupMovingToReady,
  steDeployFromReady, steForcedToMoving, stePickupToMoving,
} from '../src/ttw/ste.ts'
import {
  KG_MAX_RE, kgCreateValid, kgDensityRe, kgExempt126f, kgFormationFuelingAllowed, kgMarkerStays,
  kgPlaces2T, kgReactionCount, kgReactionFueledThisPhaseOnly, kgUnitEligible,
} from '../src/ttw/kg.ts'

// TTW §3.6 STE：持有盒流转与限制。
test('STE holding-box flow and limits (§3.6)', () => {
  assert.equal(STE_COUNT, 2)
  assert.equal(sovietNormalExtenderAllowed(), false)
  assert.equal(steCanConvertToTruckPoints(), false)
  assert.equal(stePickupToMoving({ movementPhase: true, onMap: true }), true)
  assert.equal(stePickupToMoving({ movementPhase: false, onMap: true }), false)
  assert.equal(steCleanupMovingToReady({ sovietCleanupPhase: true, section: 'moving' }), true)
  assert.equal(steCleanupMovingToReady({ sovietCleanupPhase: true, section: 'ready' }), false)
  assert.equal(steDeployFromReady({ sovietMovementPhase: true, section: 'ready' }), true)
  assert.equal(steDeployFromReady({ sovietMovementPhase: true, section: 'moving' }), false)
  assert.equal(steForcedToMoving({ axisCombatEntersHex: true }), true)
})

// TTW §2.4e KG：编成/豁免/反应能力。
test('Kampfgruppe composition, exemptions and reaction capability (§2.4e)', () => {
  assert.equal(kgUnitEligible({ german: true, truckOrTrackMa: true, stackedWithMarker: true }), true)
  assert.equal(kgUnitEligible({ german: false, truckOrTrackMa: true, stackedWithMarker: true }), false)
  assert.equal(kgUnitEligible({ german: true, truckOrTrackMa: false, stackedWithMarker: true }), false)
  assert.equal(KG_MAX_RE, 3)
  assert.equal(kgDensityRe(5), 3)
  assert.equal(kgDensityRe(2), 2)
  assert.equal(kgCreateValid({ movementPhase: true, eligibleUnitStacked: true }), true)
  assert.equal(kgMarkerStays(1), true)
  assert.equal(kgMarkerStays(0), false)
  assert.equal(kgExempt126f(), true)
  assert.equal(kgFormationFuelingAllowed(), true)
  assert.equal(kgReactionCount(5), 2)
  assert.equal(kgReactionCount(6), 3)
  assert.equal(kgReactionFueledThisPhaseOnly(), true)
  assert.equal(kgPlaces2T({ movedOrAttackedThisReaction: true }), true)
  assert.equal(kgPlaces2T({ movedOrAttackedThisReaction: false }), false)
})