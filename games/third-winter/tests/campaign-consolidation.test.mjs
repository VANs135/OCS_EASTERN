import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { scheduledCampaignReinforcements } from '../src/match/campaign-reinforcement-actions.ts'
import { campaignReinforcementAtCursor } from '../src/match/campaign-reinforcement-phase.ts'
import { projectCampaignMatch } from '../src/view/campaign-match-view.ts'

const sameFaces = { combatFaceKey: 'combat|open|12|4|3|leg', moveFaceKey: 'move|open|5|3|8|leg', printedSteps: 4 }
const campaignUnit = (stepsLost, attributes = {}) => ({ definition: 'infantry', kind: 'land', side: 'soviet',
  location: { kind: 'map', hex: 'A4.02' }, currentRe: 4 - stepsLost, stepsLost, ...attributes })
const configured = { reinforcement: {
  schedule: new Map(), bindings: new Map(), resolveHex: (hex) => hex === 'C4.34' ? 'A4.2' : hex.replace('.0', '.'),
  arrivalSites: () => [], consolidation: {
    profileOf: ({ counters }, id) => ({ ...sameFaces, ...(counters[id].definition === 'different-combat' ? { combatFaceKey: 'different' } : {}),
      ...(counters[id].definition === 'different-move' ? { moveFaceKey: 'different' } : {}),
      ...(counters[id].definition === 'one-step' ? { printedSteps: 1 } : {}) }),
    boxOf: (id) => id === 'RVGK-1' || id === 'RVGK-2' ? { id, kind: 'rvgk' }
      : id === 'off-map' ? { id, kind: 'off-map' } : undefined,
  },
}, reinforcementBlockers: () => [] }

const command = (record, action) => ({ id: `${action.type}:${record.revision}`, expectedRevision: record.revision, action })
const send = (record, action, side = 'soviet', context = configured) =>
  submitCampaignMatch(record, side, command(record, action), context).record
const merge = (keepId = 'keep', removeId = 'remove') => ({ type: 'consolidate-campaign-units', keepId, removeId })

function scheduled(counters) {
  let record = openCampaignMatch({ turn: 1, counters, when: { scenarioId: '02-gotterdammerung', date: '1944-01-26' },
    opening: { first: 'soviet', weather: { ground: 'freeze', flight: 'none' } } }, 2)
  for (const type of ['determine-campaign-weather', 'roll-campaign-event', 'complete-campaign-refit',
    'complete-campaign-reinforcement-opening']) record = send(record, { type })
  return record
}
const rebuildWindow = (counters) => send(scheduled(counters), { type: 'complete-scheduled-reinforcements' })
const ownOptions = (record, context = configured) => projectCampaignMatch(record, 'soviet', context).active.consolidation

test('§13.9-1 consolidates two equivalent multi-step units across map aliases through the campaign command', () => {
  const units = { keep: campaignUnit(2, { outOfSupply: true }), remove: campaignUnit(3, { location: { kind: 'map', hex: 'C4.34' } }),
    enemy: campaignUnit(1, { side: 'axis' }) }
  const record = rebuildWindow(units)
  assert.deepEqual(ownOptions(record).groups, [[{ counterId: 'keep', steps: 2, printedSteps: 4 },
    { counterId: 'remove', steps: 1, printedSteps: 4 }]])
  assert.equal(projectCampaignMatch(record, 'axis', configured).active, null)
  assert.throws(() => send(record, merge(), 'axis'), /not open for this side/)
  const request = command(record, merge())
  const result = submitCampaignMatch(record, 'soviet', request, configured).record
  assert.equal(result.state.reinforcement.window.segment, 'rebuild-consolidate')
  assert.equal(result.state.counters.keep.currentRe, 3)
  assert.equal(result.state.counters.keep.stepsLost, 1)
  assert.equal(result.state.counters.keep.outOfSupply, true)
  assert.deepEqual(result.state.counters.remove.location, { kind: 'consolidated' })
  assert.equal(result.state.rng.drawCount, record.state.rng.drawCount)
  assert.equal(ownOptions(result).groups.length, 0)
  assert.deepEqual(ownOptions(result).lastResult, { keepId: 'keep', removeId: 'remove', stepsAfter: 3, overflowLost: 0 })
  assert.equal(submitCampaignMatch(result, 'soviet', request, configured).duplicate, true)
  assert.throws(() => submitCampaignMatch(result, 'soviet', { ...request, id: 'stale-consolidation' }, configured), /Stale match revision/)
  assert.throws(() => send(result, merge()), /not-present/)
})

test('§13.9-1 caps excess steps, can use a confirmed off-map box, and never creates a dead-pile entry', () => {
  const box = { kind: 'box', box: 'off-map' }
  const record = rebuildWindow({ keep: campaignUnit(1, { location: box }), remove: campaignUnit(1, { location: box }) })
  const result = send(record, merge())
  assert.equal(result.state.counters.keep.stepsLost, 0)
  assert.equal(result.state.counters.keep.currentRe, 4)
  assert.equal(ownOptions(result).lastResult.overflowLost, 2)
  const following = scheduled(result.state.counters)
  const state = campaignReinforcementAtCursor(following.state)
  const withdraw = { id: 'withdraw', side: 'soviet', definition: 'infantry', counterKind: 'land', status: 'classified',
    operation: { kind: 'withdraw' } }
  const reinforcements = { ...configured.reinforcement, bindings: new Map([['withdraw', ['remove']]]),
    schedule: new Map([[1, { axis: [], soviet: [withdraw] }]]) }
  assert.equal(scheduledCampaignReinforcements(state, reinforcements)[0].status, 'counter-unavailable')
})

test('consolidation rejects wrong windows, unknown facts, dissimilar faces, stock markers and both RVGK boxes', () => {
  const keep = campaignUnit(2)
  const record = rebuildWindow({ keep, remove: campaignUnit(1, { disorganized: true }),
    exhausted: campaignUnit(1, { internalStocks: 'exhausted' }), low: campaignUnit(1, { internalStocks: 'low' }),
    combat: campaignUnit(1, { definition: 'different-combat' }), move: campaignUnit(1, { definition: 'different-move' }),
    elsewhere: campaignUnit(1, { location: { kind: 'map', hex: 'A5.02' } }),
    unknown: campaignUnit(1, { stepsLost: undefined }), enemy: campaignUnit(1, { side: 'axis' }),
    one: campaignUnit(0, { definition: 'one-step', currentRe: 1 }),
    mismatch: campaignUnit(1, { currentRe: 2 }),
    firstBox: campaignUnit(1, { location: { kind: 'box', box: 'RVGK-1' } }),
    secondBox: campaignUnit(1, { location: { kind: 'box', box: 'RVGK-2' } }),
  })
  const expected = { keep: /same-unit/, remove: /disorganized/, exhausted: /stocks-low-or-exhausted/, low: /stocks-low-or-exhausted/,
    combat: /different-printed-faces/, move: /different-printed-faces/, elsewhere: /different-location/,
    unknown: /missing-or-invalid-step-losses/, enemy: /friendly-ground-unit/, one: /not-a-multi-step-unit/,
    mismatch: /step-losses-and-re-disagree/, firstBox: /forbidden-in-rvgk/, secondBox: /forbidden-in-rvgk/ }
  for (const [remove, reason] of Object.entries(expected)) assert.throws(() => send(record, merge('keep', remove)), reason)
  assert.deepEqual(ownOptions(record).groups, [])
  assert.ok(ownOptions(record).rejected.some(({ counterId, reason }) => counterId === 'firstBox' && reason === 'consolidation-forbidden-in-rvgk'))
  assert.equal(record.state.counters.keep, keep)
  assert.equal(record.state.rng.drawCount, 1)
  assert.throws(() => send(scheduled({ keep }), merge()), /window is not open/)
  assert.throws(() => send(send(record, { type: 'complete-campaign-rebuilds' }), merge()), /Ordinary campaign reinforcement is not open/)
  const missing = { ...configured, reinforcement: { ...configured.reinforcement, consolidation: undefined } }
  assert.equal(ownOptions(record, missing).configured, false)
  assert.throws(() => send(record, merge(), 'soviet', missing), /profiles are not configured/)
})
