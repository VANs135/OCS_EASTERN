import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRngState } from '@ocs-eastern/series/rng'
import { captureCampaignHedgehog } from '../src/match/campaign-hedgehogs.ts'
import { resolveCampaignEntryCapture } from '../src/match/campaign-entry-capture.ts'

const board = { attackCapable: (_state, id) => id === 'atk' }

test('9.14e level-2 hedgehog is reduced to level 1 under the entering side', () => {
  const state = { counters: {}, hedgehogs: { 'A1.1': { side: 'axis', level: 2 } }, turn: 3 }
  const after = captureCampaignHedgehog(state, 'soviet', 'A1.1', ['atk'], board)
  assert.deepEqual(after.hedgehogs['A1.1'], { side: 'soviet', level: 1 })
})

test('9.14e level-1 hedgehog is removed, and a non-attack unit does not trigger it', () => {
  const level1 = { counters: {}, hedgehogs: { 'A1.1': { side: 'axis', level: 1 } }, turn: 3 }
  assert.equal(captureCampaignHedgehog(level1, 'soviet', 'A1.1', ['atk'], board).hedgehogs['A1.1'], null)
  assert.equal(captureCampaignHedgehog(level1, 'soviet', 'A1.1', ['supply'], board), level1)
})

test('entry capture composes 9.14b dump and 9.14e hedgehog without touching the other objects', () => {
  const state = { counters: {}, hedgehogs: { 'A1.1': { side: 'axis', level: 2 } }, turn: 3,
    supplyDumps: { axis: { 'A1.1': 3 }, soviet: {} }, rng: createRngState(623) }
  const after = resolveCampaignEntryCapture(state, 'soviet', 'A1.1', ['atk'], board)
  assert.deepEqual(after.hedgehogs['A1.1'], { side: 'soviet', level: 1 })
  assert.equal(after.supplyDumps.axis['A1.1'], undefined)
})
