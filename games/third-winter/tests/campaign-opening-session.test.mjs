import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { openCampaignSession, submitCampaignSessionCommand } from '../src/match/campaign-opening-session.ts'
import { projectCampaignSession } from '../src/view/campaign-opening-session-view.ts'

const piece = (side, definition, hex) => ({ side, definition, kind: 'land', location: hex ? { kind: 'map', hex } : { kind: 'available' } })
const opening = { turn: 1, when: { scenarioId: 'synthetic', date: '1944-01-29' }, counters: {
  first: piece('axis', 'first-private', 'A'), second: piece('soviet', 'second-private', 'B'),
  pool1: piece('axis', 'left-stock-a'), pool2: piece('axis', 'left-stock-b'), pool3: piece('axis', 'left-stock-c'),
} }
const context = {
  setupPlan: { pools: { local: { side: 'axis', counterIds: ['pool1', 'pool2', 'pool3'] } }, steps: [
    { id: 'place', side: 'axis', kind: 'place', counterId: 'first', destinations: ['A', 'C'] },
    { id: 'draw', side: 'axis', kind: 'draw', pool: 'local', count: 2, hex: 'A' },
    { id: 'confirm-left', side: 'axis', kind: 'confirm' }, { id: 'confirm-right', side: 'soviet', kind: 'confirm' },
  ] },
  setupRules: { isHex: (hex) => ['A', 'B', 'C'].includes(hex), place: (counter, hex) => ({ ...counter, location: { kind: 'map', hex } }) },
  turn: { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: (hex) => hex, arrivalSites: () => [] } },
}
const envelope = (record, action) => ({ id: `command-${record.revision}`, expectedRevision: record.revision, action })
const submit = (record, side, action) => submitCampaignSessionCommand(record, side, envelope(record, action), context).record

test('one match record carries setup choices, private draws, receipt history and random state into the turn', () => {
  const initial = openCampaignSession(opening, context, 17)
  assert.equal(projectCampaignSession(initial, 'axis', context).segment, 'placement')
  const hidden = projectCampaignSession(initial, 'soviet', context)
  assert.equal(hidden.active, null)
  assert.deepEqual(hidden.own.counters.map(({ id }) => id), ['second'])
  assert.throws(() => submit(initial, 'axis', { type: 'determine-campaign-weather' }), /Complete setup/)
  const placed = submit(initial, 'axis', { type: 'setup-place', stepId: 'place', hex: 'C' })
  const request = envelope(placed, { type: 'setup-draw', stepId: 'draw' })
  const drawn = submitCampaignSessionCommand(placed, 'axis', request, context).record
  const saved = JSON.parse(JSON.stringify(drawn))
  assert.equal(submitCampaignSessionCommand(saved, 'axis', request, context).duplicate, true)
  assert.throws(() => submitCampaignSessionCommand(saved, 'axis', { ...request, id: 'different' }, context), /Stale match revision/)
  assert.equal(projectCampaignSession(saved, 'axis', context).setupDraws.length, 2)
  assert.deepEqual(projectCampaignSession(saved, 'soviet', context).setupDraws, [])
  const ready = submit(saved, 'axis', { type: 'setup-confirm', stepId: 'confirm-left' })
  const started = submit(ready, 'soviet', { type: 'setup-confirm', stepId: 'confirm-right' })
  assert.equal(started.state.kind, 'playing')
  assert.equal(started.revision, 4)
  assert.equal(started.receipts.length, 4)
  assert.deepEqual(started.state.turn.rng, saved.state.setup.rng)
  assert.equal(started.state.turn.counters.first.location.hex, 'C')
  assert.ok(started.state.setupDraws.every(({ counterId }) => started.state.turn.counters[counterId].location.hex === 'A'))
  assert.deepEqual(projectCampaignSession(started, 'soviet', context).setupDraws, [])
  assert.throws(() => submit(started, 'soviet', { type: 'setup-confirm', stepId: 'confirm-right' }), /already complete/)
  const weather = submit(started, 'soviet', { type: 'determine-campaign-weather' })
  assert.equal(weather.revision, 5)
  assert.equal(weather.state.turn.preTurnRolls[0].before, saved.state.setup.rng.drawCount)
})
