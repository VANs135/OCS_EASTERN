import { strict as assert } from 'node:assert'
import { test } from 'node:test'
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
