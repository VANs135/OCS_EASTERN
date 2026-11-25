import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { advance, createRngState, nextUint32, pickIndex, replayFrom, roll1d6, roll2d6, rollDice, verifyRngState } from '../src/rng.ts'

test('jumping to a draw matches sequential draws without changing the sequence', () => {
  for (const seed of [0, 42, 0xffffffff, 20260913]) {
    const start = createRngState(seed)
    let stepped = start
    for (let count = 0; count <= 64; count += 1) {
      assert.deepEqual(advance(start, count), stepped)
      assert.deepEqual(replayFrom(seed, count), stepped)
      assert.equal(verifyRngState(stepped), true)
      stepped = nextUint32(stepped).rng
    }
    const long = advance(start, 2 ** 32 + 11)
    const short = advance(start, 11)
    assert.equal(long.state, short.state)
    assert.equal(verifyRngState(long), true)
    assert.equal(nextUint32(long).value, nextUint32(short).value)
  }
})

test('separate rolls consume successive draws and remain reproducible', () => {
  const seed = createRngState(20260913)
  const first = roll1d6(seed)
  const second = roll2d6(first.rng)
  const combined = rollDice(seed, 3)
  assert.deepEqual([...first.value.faces, ...second.value.faces], combined.value.faces)
  assert.deepEqual(combined.rng, second.rng)
  assert.ok(second.rng.drawCount > first.rng.drawCount)
  assert.equal(seed.drawCount, 0)
})

test('invalid unsigned states and counters cannot enter the replay or sampling loops', () => {
  const start = createRngState(7)
  assert.equal(verifyRngState({ ...start, seed: 2 ** 32 + 7 }), false)
  assert.equal(verifyRngState({ ...start, state: 2 ** 32 + 7 }), false)
  assert.equal(verifyRngState({ ...start, drawCount: Number.MAX_SAFE_INTEGER + 1 }), false)
  assert.equal(verifyRngState({ ...start, drawCount: -1 }), false)
  assert.throws(() => replayFrom(7, Infinity), RangeError)
  assert.throws(() => pickIndex(start, 2 ** 32 + 1), RangeError)
  assert.deepEqual(pickIndex(start, 2 ** 32), nextUint32(start))
  const last = replayFrom(7, Number.MAX_SAFE_INTEGER)
  assert.equal(verifyRngState(last), true)
  assert.throws(() => nextUint32(last), RangeError)
  assert.throws(() => advance(last, 1), RangeError)
})
