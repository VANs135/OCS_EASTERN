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

const deadPile = { kind: 'dead-pile' }
const groundFormation = (formationId) => ({ formationId, role: 'ground' })
const organic = (formationId, cargoCapacityTokens = 4) => ({ formationId, role: 'organic-transport', cargoCapacityTokens })
const formationContext = (profiles) => ({ ...configured, reinforcement: { ...configured.reinforcement, consolidation: {
  ...configured.reinforcement.consolidation,
  formationOf: (state, id) => profiles[state.counters[id].definition],
  profileOf: (state, id) => state.counters[id].kind === 'transport'
    ? { printedSteps: 0, combatFaceKey: 'truck-front', moveFaceKey: 'truck-move-45' }
    : configured.reinforcement.consolidation.profileOf(state, id),
} } })
const exchange = (fieldId, replacementId) => ({ type: 'exchange-campaign-formation-unit', fieldId, replacementId })

test('§13.9-2 exchanges two formations’ identities, preserving state and a single copy of loaded supply', () => {
  const truck = (definition, location, tokens, extra = {}) => ({ definition, kind: 'transport', side: 'soviet', location,
    transportCargoTokens: tokens, ...extra })
  const onMap = { kind: 'map', hex: 'A4.02' }
  const counters = { field: truck('organic-a', onMap, 3, { mode: 'reserve', outOfSupply: true }),
    replacement: truck('organic-b', deadPile, 0), wrong: truck('organic-a', deadPile, 0),
    tooSmall: truck('small', deadPile, 0), enemy: truck('organic-b', deadPile, 0, { side: 'axis' }) }
  const context = formationContext({ 'organic-a': organic('formation-a'), 'organic-b': organic('formation-b'), small: organic('small', 2) })
  const record = rebuildWindow(counters)
  const own = projectCampaignMatch(record, 'soviet', context).active.formationExchange
  assert.deepEqual(own.choices, [{ fieldId: 'field', replacementIds: ['replacement'] }])
  assert.equal(projectCampaignMatch(record, 'axis', context).active, null)
  assert.throws(() => send(record, exchange('field', 'wrong'), 'soviet', context), /same-formation/)
  assert.throws(() => send(record, exchange('field', 'tooSmall'), 'soviet', context), /transport-cargo/)
  assert.throws(() => send(record, exchange('field', 'enemy'), 'soviet', context), /friendly-ground/)
  const request = command(record, exchange('field', 'replacement'))
  const result = submitCampaignMatch(record, 'soviet', request, context).record
  assert.deepEqual(result.state.counters.field, { definition: 'organic-a', side: 'soviet', kind: 'transport', location: deadPile })
  assert.deepEqual(result.state.counters.replacement, truck('organic-b', onMap, 3, { mode: 'reserve', outOfSupply: true }))
  assert.equal(result.state.rng.drawCount, record.state.rng.drawCount)
  assert.equal(submitCampaignMatch(result, 'soviet', request, context).duplicate, true)
  const projected = projectCampaignMatch(result, 'soviet', context)
  assert.deepEqual(projected.active.formationExchange.lastResult, { fieldId: 'field', replacementId: 'replacement' })
  assert.equal(projected.own.counters.find(({ id }) => id === 'replacement').transportCargoTokens, 3)
})

test('§13.9-3 permits independent to formation only and checks the location and both faces', () => {
  const onMap = { kind: 'map', hex: 'A4.02' }
  const context = formationContext({ independent: groundFormation(null), 'formation-b': groundFormation('B'),
    'different-move': groundFormation('C'), blocked: groundFormation('D'), 'regular-truck': { formationId: null, role: 'regular-transport' },
    'organic-truck': organic('B') })
  const counters = { field: campaignUnit(2, { definition: 'independent', mode: 'move' }),
    member: campaignUnit(4, { definition: 'formation-b', location: deadPile }),
    independent: campaignUnit(4, { definition: 'independent', location: deadPile }),
    wrongFaces: campaignUnit(4, { definition: 'different-move', location: deadPile }),
    blocked: campaignUnit(4, { definition: 'blocked', location: deadPile, internalStocks: 'low' }),
    rvgk: campaignUnit(2, { definition: 'independent', location: { kind: 'box', box: 'RVGK-2' } }),
    truck: { definition: 'regular-truck', kind: 'transport', side: 'soviet', location: onMap, transportCargoTokens: 2, mode: 'move' },
    organicTruck: { definition: 'organic-truck', kind: 'transport', side: 'soviet', location: deadPile } }
  const record = rebuildWindow(counters)
  assert.throws(() => send(record, exchange('field', 'wrongFaces'), 'soviet', context), /different-printed-faces/)
  assert.throws(() => send(record, exchange('field', 'blocked'), 'soviet', context), /stocks-low-or-exhausted/)
  assert.throws(() => send(record, exchange('rvgk', 'member'), 'soviet', context), /forbidden-in-rvgk/)
  assert.throws(() => send(scheduled(counters), exchange('field', 'member'), 'soviet', context), /window is not open/)
  const result = send(record, exchange('field', 'member'), 'soviet', context)
  assert.deepEqual(result.state.counters.member, campaignUnit(2, { definition: 'formation-b', mode: 'move' }))
  assert.throws(() => send(result, exchange('member', 'independent'), 'soviet', context), /not-a-formation-member/)
  const truck = send(result, exchange('truck', 'organicTruck'), 'soviet', context).state.counters.organicTruck
  assert.deepEqual(truck, { ...counters.truck, definition: 'organic-truck' })
})

const air = (fields = {}) => ({ definition: 'fighter', kind: 'aircraft', side: 'axis',
  location: { kind: 'box', box: 'off-map' }, stepsLost: 1, active: false, ...fields })
const airContext = { ...configured, aircraftConsolidation: {
  boxOf: configured.reinforcement.consolidation.boxOf,
  profileOf: (state, id) => ({ typeAndValuesKey: state.counters[id].definition,
    printedSteps: state.counters[id].definition === 'one-step' ? 1 : 2 }),
} }
const mergeAir = (removeId = 'remove') => ({ type: 'consolidate-campaign-aircraft', keepId: 'keep', removeId })

test('§13.9-4 combines equivalent reduced aircraft in Movement and keeps its activation state', () => {
  const counters = { keep: air(), remove: air(), active: air({ active: true }), different: air({ definition: 'different-fighter' }),
    full: air({ stepsLost: 0 }), one: air({ definition: 'one-step', stepsLost: 0 }),
    elsewhere: air({ location: { kind: 'map', hex: 'A4.02' } }), rival: air({ side: 'soviet' }) }
  const rebuild = rebuildWindow(counters)
  const closing = send(rebuild, { type: 'complete-campaign-rebuilds' })
  const record = send(closing, { type: 'complete-campaign-reinforcement' })
  assert.equal(record.state.cursor.phase, 'movement')
  const own = projectCampaignMatch(record, 'axis', airContext)
  assert.deepEqual(own.aircraftConsolidation.groups, [['keep', 'remove']])
  assert.deepEqual(projectCampaignMatch(record, 'soviet', airContext).aircraftConsolidation.groups, [])
  assert.throws(() => send(record, mergeAir(), 'soviet', airContext), /friendly-aircraft/)
  assert.throws(() => send(record, mergeAir('rival'), 'axis', airContext), /friendly-aircraft/)
  assert.throws(() => send(record, mergeAir('active'), 'axis', airContext), /different-aircraft-status/)
  assert.throws(() => send(record, mergeAir('different'), 'axis', airContext), /different-aircraft-type-or-values/)
  assert.throws(() => send(record, mergeAir('full'), 'axis', airContext), /aircraft-is-not-reduced/)
  assert.throws(() => send(record, mergeAir('one'), 'axis', airContext), /aircraft-is-not-reduced/)
  assert.throws(() => send(record, mergeAir('elsewhere'), 'axis', airContext), /different-location/)
  const request = command(record, mergeAir())
  const result = submitCampaignMatch(record, 'axis', request, airContext).record
  assert.equal(result.state.counters.keep.stepsLost, 0)
  assert.equal(result.state.counters.keep.active, false)
  assert.deepEqual(result.state.counters.remove.location, { kind: 'consolidated' })
  assert.equal(result.state.rng.drawCount, record.state.rng.drawCount)
  assert.equal(submitCampaignMatch(result, 'axis', request, airContext).duplicate, true)
})
