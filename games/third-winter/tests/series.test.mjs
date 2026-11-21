import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { airMissionSegments, allowsBarrageSource } from '@ocs-eastern/series/fire-timing'
import { groundModeEffect, groundModeMovementFactor } from '@ocs-eastern/series/modes'
import { createRngState, rollDice, verifyRngState } from '@ocs-eastern/series/rng'
import { matchRowIndex } from '@ocs-eastern/series/tables/lookup'
import { crtLookup } from '@ocs-eastern/series/tables/crt'
import { zocAffectsAction } from '@ocs-eastern/series/zoc'

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

test('OCS 5.7–5.10 resolve movement, combat and ZOC from the current face and marker', () => {
  const combat = { face: 'combat' }
  const move = { face: 'move' }
  const reserve = { ...combat, marker: 'reserve' }
  const exploit = { ...combat, marker: 'exploit' }
  const dg = { ...combat, marker: 'dg', released: true }
  const strat = { ...move, marker: 'strat' }
  const released = { ...combat, released: true }
  const scale = (state, phase = 'movement') => groundModeMovementFactor(state, phase)
  assert.deepEqual([scale(combat), scale(reserve), scale(strat), scale(dg), scale(exploit, 'exploitation')], [1, 0.25, 2, 0.5, 0.5])
  assert.deepEqual([scale(reserve, 'reaction'), scale(released, 'reaction'), scale(released, 'exploitation')], [0, 0.5, 1])
  assert.deepEqual([scale(dg, 'reaction'), scale({ ...exploit, released: true }, 'exploitation')], [0.5, 0.5])
  const zoc = (state) => groundModeEffect(state).keepsCombatZoc
  assert.deepEqual([combat, move, reserve, strat, dg, released, exploit, { ...exploit, face: 'move' }].map(zoc),
    [true, false, false, false, false, true, true, false])
  const effects = (state) => {
    const { attackFactor, defenseFactor, barrageFactor, actionRatingFactor, actionRatingModifier, canAttack, canBarrage, canOverrun } = groundModeEffect(state)
    return [attackFactor, defenseFactor, barrageFactor, actionRatingFactor, actionRatingModifier, canAttack, canBarrage, canOverrun]
  }
  assert.deepEqual(effects(reserve), [1, 0.5, 1, 1, 0, false, false, false])
  assert.deepEqual(effects(strat), [0, 0, 0, 0, 0, false, false, false])
  assert.deepEqual(effects(dg), [0.5, 0.5, 0.5, 1, -1, true, true, false])
})

test('OCS 4.5a and 9.12e classify the same covered hex by action', () => {
  for (const action of ['truckMovement', 'truckSupply', 'railSupply', 'portSupply', 'aircraftRefit']) {
    assert.equal(zocAffectsAction(action, false, false), false, action)
    assert.equal(zocAffectsAction(action, true, false), true, action)
    assert.equal(zocAffectsAction(action, true, true), false, action)
  }
  for (const action of ['railTransport', 'railConversion', 'shipping', 'reserveMode', 'stratMode', 'stratMovement', 'rebuild', 'retreat']) {
    assert.equal(zocAffectsAction(action, false, true), false, action)
    assert.equal(zocAffectsAction(action, true, true), true, action)
  }
})
