import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { airMissionSegments, allowsBarrageSource } from '@ocs-eastern/series/fire-timing'
import { createRngState, rollDice, verifyRngState } from '@ocs-eastern/series/rng'
import { matchRowIndex } from '@ocs-eastern/series/tables/lookup'
import { crtLookup } from '@ocs-eastern/series/tables/crt'

test('same seed as the pinned reuse baseline produces the same dice', () => {
  const draw = rollDice(createRngState(20260913), 8)
  assert.deepEqual(draw.value.faces, [5, 4, 3, 3, 1, 2, 1, 4])
  assert.equal(verifyRngState(draw.rng), true)
})

test('lookup uses explicit data, preserving dice ranges', () => {
  assert.equal(matchRowIndex(['2-4', '5-8', '9-12'], 5), 1)
  const table = { diceRows: ['2-4', '5+'], terrainColumns: { Open: ['1:2', '1:1'] },
    matrix: [['a', 'b'], ['c', 'd']] }
  assert.equal(crtLookup(5, 'Open', '2:1', table).code, 'd')
})

test('SOP distinguishes movement missions, normal barrage and the interception response', () => {
  assert.equal(airMissionSegments['hip-shoot'], 'movement')
  assert.equal(airMissionSegments['fighter-sweep'], 'movement')
  assert.equal(airMissionSegments.transport, 'movement')
  assert.equal(airMissionSegments['air-drop'], 'movement')
  assert.equal(airMissionSegments['base-transfer'], 'movement')
  assert.equal(airMissionSegments.barrage, 'barrage')
  assert.equal(airMissionSegments.trainbusting, 'barrage')
  assert.equal(airMissionSegments.interception, 'intercept-response')

  const sources = ['artillery', 'air', 'naval']
  const allowed = (phase) => sources.filter((source) => allowsBarrageSource(phase, source))
  assert.deepEqual(allowed('movement'), ['air', 'naval'])
  assert.deepEqual(allowed('combat'), ['artillery'])
  assert.deepEqual(allowed('reaction'), sources)
  assert.deepEqual(allowed('exploitation'), sources)
  assert.deepEqual(allowed('supply'), [])
})
