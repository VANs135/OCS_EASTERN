import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hedgehogWorkRefusal, hedgehogNextLevel, hedgehogWorkTokenCost,
  HEDGEHOG_BUILD_COST_TOKENS, HEDGEHOG_STANDARD_MAX_LEVEL } from '../src/hedgehog-work.ts'

const base = { operation: 'build', onMap: true, side: 'soviet', enemyInHex: false,
  levelChangedThisTurn: false, localRe: 0, engineerWithin2: false }

test('work requires a stationary local RE or an engineer within two hexes (OCS 16.0c, 13.8d)', () => {
  assert.equal(hedgehogWorkRefusal({ ...base, localRe: 1 }), null)
  assert.equal(hedgehogWorkRefusal({ ...base, engineerWithin2: true }), null)
  assert.equal(hedgehogWorkRefusal(base), 'hedgehog-workers-required')
  assert.equal(hedgehogWorkRefusal({ ...base, onMap: false, localRe: 1 }), 'hedgehog-hex-off-map')
  assert.equal(hedgehogWorkRefusal({ ...base, enemyInHex: true, localRe: 1 }), 'hedgehog-enemy-in-hex')
})

test('a hedgehog owned by the other side must be captured first, and only one level change per turn (OCS 16.0b-c)', () => {
  assert.equal(hedgehogWorkRefusal({ ...base, current: { side: 'axis', level: 1 }, localRe: 1 }), 'hedgehog-enemy-owned')
  assert.equal(hedgehogWorkRefusal({ ...base, current: { side: 'soviet', level: 1 }, localRe: 1 }), null)
  assert.equal(hedgehogWorkRefusal({ ...base, current: { side: 'soviet', level: 1 }, localRe: 1, levelChangedThisTurn: true }), 'hedgehog-once-per-turn')
})

test('build caps at the work maximum and reduce needs an existing level (OCS 16.0a-b; caps injected)', () => {
  assert.equal(HEDGEHOG_STANDARD_MAX_LEVEL, 2)
  assert.equal(hedgehogWorkRefusal({ ...base, current: { side: 'soviet', level: 2 }, localRe: 1 }), 'hedgehog-level-illegal')
  assert.equal(hedgehogWorkRefusal({ ...base, current: { side: 'soviet', level: 2 }, localRe: 1, maxLevel: 3 }), null)
  assert.equal(hedgehogWorkRefusal({ ...base, operation: 'reduce', localRe: 1 }), 'hedgehog-level-illegal')
  assert.equal(hedgehogWorkRefusal({ ...base, operation: 'reduce', current: { side: 'soviet', level: 1 }, localRe: 1 }), null)
})

test('level transitions step one at a time and building costs 8T (OCS 16.0b)', () => {
  assert.equal(HEDGEHOG_BUILD_COST_TOKENS, 8)
  assert.equal(hedgehogWorkTokenCost('build'), 8)
  assert.equal(hedgehogWorkTokenCost('reduce'), 0)
  assert.equal(hedgehogNextLevel('build', 0), 1)
  assert.equal(hedgehogNextLevel('build', 1), 2)
  assert.equal(hedgehogNextLevel('reduce', 2), 1)
  assert.equal(hedgehogNextLevel('reduce', 1), null)
})