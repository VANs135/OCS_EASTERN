import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRngState, rollDie } from '@ocs-eastern/series/rng'
import { capturedAmount } from '@ocs-eastern/series/tables/capture'
import { captureCampaignDump } from '../src/match/campaign-dump-capture.ts'

const board = { attackCapable: (_state, id) => id === 'atk' }
const state = (dumps = { axis: {}, soviet: { 'D5.23': 4 } }) => ({
  rng: createRngState(623),
  supplyDumps: dumps,
})

test('9.14b dump capture uses one die and moves the captured portion to the captor', () => {
  const before = state()
  const draw = rollDie(before.rng)
  const taken = capturedAmount(4, 'dump', draw.value)
  const after = captureCampaignDump(before, 'axis', 'D5.23', ['atk'], board)
  assert.equal(after.supplyDumps.soviet['D5.23'], undefined)
  assert.equal(after.supplyDumps.axis['D5.23'], taken)
  assert.equal(after.rng.drawCount, before.rng.drawCount + 1)
})

test('a non-attack-capable entering unit does not trigger 9.14b and keeps the dump', () => {
  const before = state()
  assert.equal(captureCampaignDump(before, 'axis', 'D5.23', ['transport'], board), before)
  assert.equal(before.rng.drawCount, 0)
})

test('a hex without an enemy dump is a no-op and keeps the RNG untouched', () => {
  const before = state()
  assert.equal(captureCampaignDump(before, 'axis', 'D6.24', ['atk'], board), before)
})
