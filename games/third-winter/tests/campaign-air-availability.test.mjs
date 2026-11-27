import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aircraftAvailabilityRefusal } from '../src/match/campaign-air-availability.ts'

test('Scenario Book p.62 aircraft availability is inclusive and only gates sorties', () => {
  assert.equal(aircraftAvailabilityRefusal({ kind: 'aircraft', availableThrough: 3 }, 1), null)
  assert.equal(aircraftAvailabilityRefusal({ kind: 'aircraft', availableThrough: 3 }, 3), null)
  assert.equal(aircraftAvailabilityRefusal({ kind: 'aircraft', availableThrough: 3 }, 4), 'scenario-aircraft-not-available-this-turn')
  assert.equal(aircraftAvailabilityRefusal({ kind: 'aircraft' }, 9), null)
  assert.equal(aircraftAvailabilityRefusal({ kind: 'land' }, 1), 'scenario-aircraft-counter-required')
  assert.equal(aircraftAvailabilityRefusal(undefined, 1), 'scenario-aircraft-counter-required')
})
