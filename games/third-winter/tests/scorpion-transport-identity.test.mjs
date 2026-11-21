import assert from 'node:assert/strict'
import { test } from 'node:test'
import { replaceScorpionTransport } from '../src/match/scorpion-transport-points.ts'

test('splitting transport never overwrites an existing counter when the serial is stale', () => {
  const existing = { side: 'axis', hex: 's1.01', transportCargoTokens: 4 }
  const state = { cursor: { turn: 1, phasing: 'axis', phase: 'movement' },
    units: { selected: { side: 'axis' }, 'transport:axis:1': existing }, moved: [] }
  const result = replaceScorpionTransport(state, ['selected'], [{ side: 'axis' }, { side: 'axis' }], 2, { ended: false })
  assert.equal(result.units['transport:axis:1'], existing)
  assert.equal(Object.keys(result.units).length, 3)
  assert.ok(result.units['transport:axis:2'])
  assert.equal(result.nextTransportSerial, 3)
  assert.equal(state.units['transport:axis:2'], undefined)
})
