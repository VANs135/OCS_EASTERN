import assert from 'node:assert/strict'
import test from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'

const map = { resolveHex: (h) => h }
const board = (patch = {}) => ({ map, traceAt: (state, side, hex) => hex === '10', ...patch })

function game(window = { segment: 'rebuild-consolidate', specialReplacements: ['hedgehog'] }, patch = {}) {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 6, counters: {} }, 700)
  record.state.cursor = { phase: 'reinforcement', phasing: 'axis', first: 'axis' }
  record.state.reinforcement = { stage: 'ordinary', window: { settledOrders: [], rolls: [], ...window } }
  Object.assign(record.state, patch)
  return record
}
let seq = 0
const place = (record, action, b = board()) => submitCampaignMatch(record, 'axis',
  { id: `hh-${seq++}`, expectedRevision: record.revision, action: { type: 'place-campaign-special-hedgehog', ...action } },
  { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: (h) => h, arrivalSites: () => [] },
    specialHedgehog: b }).record

test('an HH result places a level-1 hedgehog in a trace-supply hex (TTW 1.7b)', () => {
  const placed = place(game(), { index: 0, hex: '10' })
  assert.deepEqual(placed.state.hedgehogs['10'], { side: 'axis', level: 1 })
  assert.deepEqual(placed.state.reinforcement.window.specialReplacements, [])
  assert.deepEqual(placed.state.reinforcement.window.lastSpecialHedgehog, { index: 0, hex: '10' })
  // no result left to spend twice
  assert.throws(() => place(placed, { index: 0, hex: '10' }), /invalid-result-index/)
})

test('HH may not raise an existing hedgehog and must land in trace supply (TTW 1.7b)', () => {
  const existing = game(undefined, { hedgehogs: { 10: { side: 'soviet', level: 2 } } })
  assert.throws(() => place(existing, { index: 0, hex: '10' }), /cannot-increase/)
  assert.throws(() => place(game(), { index: 0, hex: '11' }), /not-in-trace-supply/)
})

test('only an actual HH result and the rebuild window may place the hedgehog (TTW 1.7b)', () => {
  assert.throws(() => place(game({ segment: 'rebuild-consolidate', specialReplacements: ['artillery'] }), { index: 0, hex: '10' }),
    /result-is-not-HH/)
  const movement = game()
  movement.state.cursor = { phase: 'movement', phasing: 'axis', first: 'axis' }
  assert.throws(() => place(movement, { index: 0, hex: '10' }), /reinforcement is not open/)
  const rebuilds = game({ segment: 'scheduled', specialReplacements: ['hedgehog'] })
  assert.throws(() => place(rebuilds, { index: 0, hex: '10' }), /rebuild window/)
})
