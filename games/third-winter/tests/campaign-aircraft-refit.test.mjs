import assert from 'node:assert/strict'
import { test } from 'node:test'
import { campaignRefitOptions, refitCampaignAircraft } from '../src/match/campaign-aircraft-refit.ts'

const context = { aircraftRefit: { bases: () => [], offMapBoxes: (_state, side) => [`09:${side}:air`] } }
const state = {
  cursor: { phase: 'aircraft-refit', phasing: 'soviet' },
  counters: { 'air-1': { kind: 'aircraft', side: 'soviet', location: { kind: 'box', box: '09:soviet:air' }, active: false } },
}

test('Scenario 9 off-map aircraft refit free of supply points', () => {
  const options = campaignRefitOptions(state, 'soviet', context)
  assert.deepEqual(options.bases.map(({ base, limit }) => ({ base, limit })), [
    { base: { kind: 'off-map', box: '09:soviet:air' }, limit: 1 },
  ])
  const refitted = refitCampaignAircraft(state, 'soviet', { type: 'refit-campaign-aircraft',
    base: { kind: 'off-map', box: '09:soviet:air' }, unitIds: ['air-1'] }, context)
  assert.equal(refitted.counters['air-1'].active, true)
  assert.deepEqual(refitted.refittedBases, ['box:09:soviet:air'])
})

test('Scenario 9 off-map refit rejects a supply source payment', () => {
  assert.throws(() => refitCampaignAircraft(state, 'soviet', { type: 'refit-campaign-aircraft',
    base: { kind: 'off-map', box: '09:soviet:air' }, unitIds: ['air-1'],
    source: { kind: 'dump', hex: 'A1.1' } }, context), /free/)
})

test('Scenario 9 aircraft past availableThrough are not refitted', () => {
  const expired = { ...state, turn: 4,
    counters: { 'air-1': { ...state.counters['air-1'], availableThrough: 3 } } }
  assert.deepEqual(campaignRefitOptions(expired, 'soviet', context).bases, [])
})
