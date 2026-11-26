import assert from 'node:assert/strict'
import { test } from 'node:test'
import { airfieldWorkRefusal, airfieldWorkTokenCost, airfieldNextLevel,
  AIRBASE_MAX_LEVEL, AIRBASE_BUILD_COST_TOKENS, AIRSTRIP_BUILD_COST_TOKENS } from '../src/airfield-work.ts'

const base = { operation: 'build', side: 'axis', onMap: true, enemyInHex: false,
  changedThisTurn: false, engineerWithin2: true, localRe: 0, stripInPool: true }

test('building an air base requires an engineer, one level per turn, up to level 3 (OCS 15.2-4)', () => {
  assert.equal(AIRBASE_MAX_LEVEL, 3)
  assert.equal(airfieldWorkRefusal(base), null)
  assert.equal(airfieldWorkRefusal({ ...base, engineerWithin2: false }), 'airfield-engineer-required')
  assert.equal(airfieldWorkRefusal({ ...base, current: { side: 'axis', level: 3 } }), 'airfield-max-level')
  assert.equal(airfieldWorkRefusal({ ...base, changedThisTurn: true }), 'airfield-once-per-turn')
  assert.equal(airfieldWorkRefusal({ ...base, enemyInHex: true }), 'airfield-enemy-in-hex')
  assert.equal(airfieldWorkRefusal({ ...base, current: { side: 'soviet', level: 1 } }), 'airfield-enemy-owned')
})

test('reducing needs an engineer or a stationary local RE and never drops below level 1 (OCS 15.2)', () => {
  const reduce = { ...base, operation: 'reduce' }
  assert.equal(airfieldWorkRefusal({ ...reduce, current: { side: 'axis', level: 2 } }), null)
  assert.equal(airfieldWorkRefusal({ ...reduce, current: { side: 'axis', level: 1 } }), 'airfield-level-illegal')
  assert.equal(airfieldWorkRefusal({ ...reduce, current: { side: 'axis', level: 2 }, engineerWithin2: false, localRe: 0 }), 'airfield-workers-required')
  assert.equal(airfieldWorkRefusal({ ...reduce, current: { side: 'axis', level: 2 }, engineerWithin2: false, localRe: 1 }), null)
})

test('air strips are an Axis engineer job in an empty hex, from the counter pool (OCS 15.2, TTW 2.2h)', () => {
  const strip = { ...base, operation: 'build-strip' }
  assert.equal(airfieldWorkRefusal(strip), null)
  assert.equal(airfieldWorkRefusal({ ...strip, side: 'soviet' }), 'airfield-strip-axis-only')
  assert.equal(airfieldWorkRefusal({ ...strip, current: { side: 'axis', level: 1 } }), 'airfield-strip-needs-empty-hex')
  assert.equal(airfieldWorkRefusal({ ...strip, stripInPool: false }), 'airfield-strip-pool-empty')
})

test('costs and levels: build 4T (3T over a strip), reduce free, strip 1T to level 0', () => {
  assert.equal(AIRBASE_BUILD_COST_TOKENS, 4)
  assert.equal(AIRSTRIP_BUILD_COST_TOKENS, 1)
  assert.equal(airfieldWorkTokenCost('build'), 4)
  assert.equal(airfieldWorkTokenCost('build', { side: 'axis', level: 0, strip: true }), 3)
  assert.equal(airfieldWorkTokenCost('reduce'), 0)
  assert.equal(airfieldWorkTokenCost('build-strip'), 1)
  assert.equal(airfieldNextLevel('build', 0), 1)
  assert.equal(airfieldNextLevel('build', 2), 3)
  assert.equal(airfieldNextLevel('build', 3), 3)
  assert.equal(airfieldNextLevel('reduce', 2), 1)
  assert.equal(airfieldNextLevel('reduce', 1), 1)
  assert.equal(airfieldNextLevel('build-strip', 0), 0)
})