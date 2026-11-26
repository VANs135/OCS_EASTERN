import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyTtwReplacementHoldings, ttwPointRejection, ttwPointSavable, ttwRebuildDestinationKinds } from '../src/ttw/campaign/rebuild.ts'

const unit = (more = {}) => ({ isAircraft: false, nation: 'Ge', ar: 2, isGermanTiger: false, isAlert: false, ...more })

test('only Pax and Ally bank across turns; Air and Eq expire (TTW 1.7a)', () => {
  assert.deepEqual(emptyTtwReplacementHoldings(), { pax: 0, ally: 0 })
  assert.equal(ttwPointSavable('pax'), true)
  assert.equal(ttwPointSavable('ally'), true)
  assert.equal(ttwPointSavable('air'), false)
  assert.equal(ttwPointSavable('eq'), false)
})

test('Air rebuilds aircraft only and ground points never rebuild aircraft (TTW 1.7a)', () => {
  assert.equal(ttwPointRejection('air', unit({ isAircraft: true })), null)
  assert.equal(ttwPointRejection('air', unit()), 'air-rebuilds-aircraft-only')
  assert.equal(ttwPointRejection('pax', unit({ isAircraft: true })), 'ground-point-cannot-rebuild-aircraft')
  assert.equal(ttwPointRejection('eq', unit({ isAircraft: true }), 4), 'ground-point-cannot-rebuild-aircraft')
})

test('Eq rebuilds a unit of the awarded AR or lower, never a German Tiger (TTW 1.7a)', () => {
  assert.equal(ttwPointRejection('eq', unit({ ar: 3 }), 4), null)
  assert.equal(ttwPointRejection('eq', unit({ ar: 4 }), 4), null)
  assert.equal(ttwPointRejection('eq', unit({ ar: 5 }), 4), 'unit-ar-exceeds-awarded-eq-ar')
  assert.equal(ttwPointRejection('eq', unit({ ar: 2 })), 'eq-requires-an-awarded-ar')
  assert.equal(ttwPointRejection('eq', unit({ isGermanTiger: true }), 5), 'eq-cannot-rebuild-german-tiger')
})

test('Ally rebuilds only Rumanian or Hungarian units (TTW 1.7a)', () => {
  assert.equal(ttwPointRejection('ally', unit({ nation: 'Rum' })), null)
  assert.equal(ttwPointRejection('ally', unit({ nation: 'Hun' })), null)
  assert.equal(ttwPointRejection('ally', unit({ nation: 'Ge' })), 'ally-rebuilds-rumanian-or-hungarian-only')
  assert.equal(ttwPointRejection('pax', unit({ nation: 'Ge' })), null)
})

test('Axis ground rebuilds at an HQ (Alert also a Kessel HQ), Soviet ground at RVGK, aircraft at an airbase', () => {
  assert.deepEqual(ttwRebuildDestinationKinds('axis', unit()), ['axis-hq'])
  assert.deepEqual(ttwRebuildDestinationKinds('axis', unit({ isAlert: true })), ['axis-hq', 'kessel-hq'])
  assert.deepEqual(ttwRebuildDestinationKinds('soviet', unit()), ['rvgk'])
  assert.deepEqual(ttwRebuildDestinationKinds('axis', unit({ isAircraft: true })), ['airbase'])
  assert.deepEqual(ttwRebuildDestinationKinds('soviet', unit({ isAircraft: true })), ['airbase'])
})