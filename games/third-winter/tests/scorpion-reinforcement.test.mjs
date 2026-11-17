import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { rollScorpionVariableReinforcements } from '../src/ttw/scorpion/reinforcement-supply.ts'
import { placeScorpionArrival } from '../src/ttw/scorpion/arrival.ts'
import { placeScorpionSupply } from '../src/ttw/scorpion/supply-placement.ts'

function dice(...faces) {
  return () => {
    const face = faces.shift()
    assert.notEqual(face, undefined, 'Unexpected dice roll')
    return face
  }
}

test('Scorpion turn 1 spends no dice on either side’s variable reinforcements', () => {
  for (const side of ['axis', 'soviet']) {
    assert.deepEqual(rollScorpionVariableReinforcements(1, side, dice()), {
      sp: 0, pax: 0, alert: 0, dice: null,
    })
  }
})

test('Axis receives one Pax, one Alert entitlement and 4, 5 or 6 SP from its own chart', () => {
  assert.deepEqual(rollScorpionVariableReinforcements(2, 'axis', dice(1, 2)), {
    sp: 4, pax: 1, alert: 1, dice: [1, 2],
  })
  assert.equal(rollScorpionVariableReinforcements(2, 'axis', dice(5, 5)).sp, 5)
  assert.equal(rollScorpionVariableReinforcements(2, 'axis', dice(5, 6)).sp, 6)
})

test('Soviet roll of 8 awards 7 SP per the Scorpion map ruling', () => {
  assert.equal(rollScorpionVariableReinforcements(2, 'soviet', dice(3, 4)).sp, 6)
  assert.deepEqual(rollScorpionVariableReinforcements(2, 'soviet', dice(4, 4)), {
    sp: 7, pax: 0, alert: 0, dice: [4, 4],
  })
})

test('optional formations charge each side five VP once, at the first accepted arrival', () => {
  const start = { placed: [], mobilized: [], sovietVp: 0 }
  const unit = { id: 'A', side: 'axis', turn: 4, destinations: ['s15.01'], optionalForce: 'axis-24-panzer' }
  const allowed = ['s15.01']
  assert.throws(() => placeScorpionArrival(start, unit, 3, 'axis', 's15.01', allowed), /turn/)
  assert.throws(() => placeScorpionArrival(start, unit, 4, 'axis', 's1.03', allowed), /destination/)
  assert.throws(() => placeScorpionArrival(start, unit, 4, 'axis', 's15.01', []), /destination/)
  const paid = placeScorpionArrival(start, unit, 5, 'axis', 's15.01', allowed)
  assert.equal(paid.sovietVp, 5)
  assert.throws(() => placeScorpionArrival(paid, unit, 5, 'axis', 's15.01', allowed), /unavailable/)
  const next = placeScorpionArrival(paid, {...unit, id: 'B'}, 6, 'axis', 's15.01', allowed)
  assert.equal(next.sovietVp, 5)
  const soviet = { id: 'S', side: 'soviet', turn: 2, destinations: ['s22.09'], optionalForce: 'soviet-5-guards-cavalry' }
  assert.equal(placeScorpionArrival(next, soviet, 6, 'soviet', 's22.09', soviet.destinations).sovietVp, 0)
})

test('ordinary scheduled arrivals are restricted to their own side and turn', () => {
  const start = { placed: [], mobilized: [], sovietVp: 0 }
  const unit = { id: '1', side: 'soviet', turn: 1, destinations: ['s1.12'] }
  const allowed = unit.destinations
  assert.throws(() => placeScorpionArrival(start, unit, 1, 'axis', 's1.12', allowed), /side/)
  assert.throws(() => placeScorpionArrival(start, unit, 2, 'soviet', 's1.12', allowed), /turn/)
  assert.deepEqual(placeScorpionArrival(start, unit, 1, 'soviet', 's1.12', allowed).placed, ['1'])
  // A blocked map-edge arrival can be directed to an eligible substitute under OCS 13.6b.
  assert.deepEqual(placeScorpionArrival(start, unit, 1, 'soviet', 's1.13', ['s1.13']).placed, ['1'])
})

test('the SP award is split among legal sources or the own air box', () => {
  const pool = { side: 'axis', tokensLeft: 20 }
  const sources = new Set(['s1.03', 's1.06'])
  const hex = { kind: 'hex', id: 's1.03', controlledBy: 'axis' }
  const remaining = placeScorpionSupply(pool, hex, 12, sources)
  assert.equal(remaining.tokensLeft, 8)
  assert.equal(placeScorpionSupply(remaining, {kind: 'air-box', side: 'axis'}, 8, sources).tokensLeft, 0)
  assert.throws(() => placeScorpionSupply(remaining, {kind: 'air-box', side: 'soviet'}, 8, sources), /source/)
  assert.throws(() => placeScorpionSupply(remaining, {...hex, controlledBy: 'soviet'}, 8, sources), /source/)
  assert.throws(() => placeScorpionSupply(remaining, hex, 9, sources), /award/)
})
