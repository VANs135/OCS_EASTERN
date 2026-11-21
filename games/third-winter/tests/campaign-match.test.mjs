import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { initialWeatherHistory } from '../src/ttw/campaign/weather.ts'
import { projectCampaignMatch } from '../src/view/campaign-match-view.ts'

const context = { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: (hex) => hex,
  arrivalSites: () => [] }, reinforcementBlockers: () => [] }
const when = { scenarioId: '01', date: '1943-09-26' }
const opening = { weather: { ground: 'dry', flight: 'normal' }, first: 'soviet' }
const make = (date, seed, fields = {}) => openCampaignMatch({ turn: 1, when: { ...when, date }, counters: {}, ...fields }, seed)
const command = (record, type, fields = {}) => ({ id: `${type}:${record.revision}`, expectedRevision: record.revision, action: { type, ...fields } })
const send = (record, type, fields = {}, side = 'soviet', configured = context) =>
  submitCampaignMatch(record, side, command(record, type, fields), configured).record
const view = (record, side, configured = context) => projectCampaignMatch(record, side, configured)

test('campaign scenario opening, scheduled arrival, each reinforcement check and movement use one record', () => {
  const arrival = { id: 'arrival', ref: 'test-infantry', side: 'soviet', status: 'classified', definition: 'infantry',
    counterKind: 'land', operation: { kind: 'arrival', channel: { kind: 'fixed-hex', hex: 'B6.04', printedHex: 'B6.04' } } }
  const configured = { ...context, reinforcement: { ...context.reinforcement,
    schedule: new Map([[1, { soviet: [arrival], axis: [] }]]), bindings: new Map([['arrival', ['replacement']]]),
    supplyTable: () => [{ kind: 'soviet-supply', tokens: 4 }],
    supplyPlacementPlan: () => [{ pool: 'soviet-supply', tokens: 4, sites: [{ hex: 'B6.04', side: 'soviet', maxTokens: 4 }] }],
    replacementTable: () => ({ pax: 1, air: 0, eq: [], ally: 0, special: true }), specialReplacementTable: () => ['pontoon'],
  } }
  const initial = make(when.date, 2, { opening, counters: {
    replacement: { definition: 'infantry', kind: 'land', side: 'soviet', location: { kind: 'available' } },
    axisSecret: { definition: 'infantry', kind: 'land', side: 'axis', location: { kind: 'box', box: 'axis-private' } },
  } })
  const weather = send(initial, 'determine-campaign-weather')
  assert.equal(weather.state.rng.drawCount, 0, 'scenario opening uses prescribed weather')
  assert.equal(weather.state.cursor.segment, 'random-event')
  assert.throws(() => send(weather, 'roll-campaign-initiative'), /not due/)
  const ready = send(weather, 'roll-campaign-event')
  assert.deepEqual(ready.state.cursor, { first: 'soviet', phasing: 'soviet', phase: 'aircraft-refit' })
  assert.equal(ready.state.rng.drawCount, 1, 'no-event and scenario first player consume only one die')
  assert.throws(() => send(ready, 'complete-campaign-refit', {}, 'axis'), /active side/)
  const atOpening = send(ready, 'complete-campaign-refit', {}, 'soviet', configured)
  assert.equal(view(atOpening, 'soviet').segment, 'opening')
  assert.equal(view(atOpening, 'axis').active, null)
  assert.throws(() => send(atOpening, 'complete-scheduled-reinforcements'), /Ordinary campaign reinforcement/)
  assert.throws(() => send(atOpening, 'complete-campaign-reinforcement-opening', {}, 'soviet', { reinforcement: configured.reinforcement }),
    /opening rules are not configured/)
  const blocked = { ...configured, reinforcementBlockers: (_, stage) => stage === 'opening' ? ['front-posture-due'] : ['front-regrouping-due'] }
  assert.deepEqual(view(atOpening, 'soviet', blocked).active.blockers, ['front-posture-due'])
  assert.throws(() => send(atOpening, 'complete-campaign-reinforcement-opening', {}, 'soviet', blocked), /obligations are outstanding/)
  let record = send(atOpening, 'complete-campaign-reinforcement-opening', {}, 'soviet', configured)
  assert.equal(view(record, 'axis', configured).segment, 'scheduled')
  assert.equal(view(record, 'axis', configured).active, null)
  assert.deepEqual(view(record, 'soviet', configured).own.counters.map(({ id }) => id), ['replacement'])
  assert.throws(() => send(record, 'complete-scheduled-reinforcements', {}, 'soviet', configured), /outstanding/)
  record = send(record, 'execute-scheduled-reinforcement', { orderId: 'arrival', placements: [{ counterId: 'replacement', hex: 'B6.04' }] }, 'soviet', configured)
  record = send(record, 'complete-scheduled-reinforcements', {}, 'soviet', configured)
  assert.throws(() => send(record, 'complete-campaign-rebuilds', {}, 'soviet', configured), /not active/)
  record = send(record, 'roll-campaign-supply', {}, 'soviet', configured)
  assert.equal(view(record, 'soviet', configured).active.step, 'place-supply')
  record = send(record, 'place-campaign-supply', { placements: [{ pool: 'soviet-supply', hex: 'B6.04', tokens: 4 }] }, 'soviet', configured)
  record = send(record, 'roll-campaign-replacements', {}, 'soviet', configured)
  const special = command(record, 'roll-campaign-special-replacement')
  record = submitCampaignMatch(record, 'soviet', special, configured).record
  assert.equal(submitCampaignMatch(record, 'soviet', special, configured).duplicate, true)
  assert.deepEqual(record.state.reinforcement.window.rolls.map(({ check, before, after }) => [check, before, after]),
    [['supply', 1, 3], ['replacements', 3, 5], ['special-replacement', 5, 6]])
  assert.throws(() => send(record, 'complete-campaign-reinforcement', {}, 'soviet', configured), /closing is not active/)
  record = send(record, 'complete-campaign-rebuilds', {}, 'soviet', configured)
  assert.throws(() => send(record, 'complete-campaign-reinforcement', {}, 'soviet', blocked), /closing obligations/)
  const movement = send(record, 'complete-campaign-reinforcement', {}, 'soviet', configured)
  assert.deepEqual(movement.state.cursor, { first: 'soviet', phasing: 'soviet', phase: 'movement' })
  assert.equal(view(movement, 'soviet', configured).segment, 'breakout')
  assert.deepEqual(movement.state.counters.replacement.location, { kind: 'map', hex: 'B6.04' })
  assert.equal(movement.state.supplyDumps.soviet['B6.04'], 4)
  assert.equal(movement.state.reinforcement.window.replacementAward.pax, 1)
  assert.equal(movement.receipts.length, movement.revision)
})

test('campaign ordinary initiative logs each side and redraws both on a tie', () => {
  let record = make('1944-01-29', 8)
  record = send(record, 'determine-campaign-weather')
  assert.deepEqual(record.state.preTurnRolls.map(({ check, dice }) => [check, dice.faces]),
    [['ground-weather', [4]], ['flight-weather', [4, 2]]])
  record = send(record, 'roll-campaign-event')
  const tied = send(record, 'roll-campaign-initiative')
  assert.equal(tied.state.cursor.winner, null)
  assert.throws(() => send(tied, 'choose-campaign-first', { first: 'axis' }), /initiative winner/)
  const winner = send(tied, 'roll-campaign-initiative', {}, 'axis')
  assert.deepEqual(winner.state.preTurnRolls.slice(-4).map(({ check, before, after }) => [check, before, after]),
    [['axis-initiative', 4, 6], ['soviet-initiative', 6, 8], ['axis-initiative', 8, 10], ['soviet-initiative', 10, 12]])
  assert.equal(view(winner, 'axis').actor, 'soviet')
  assert.throws(() => send(winner, 'choose-campaign-first', { first: 'axis' }, 'axis'), /initiative winner/)
  assert.equal(send(winner, 'choose-campaign-first', { first: 'axis' }).state.cursor.phasing, 'axis')
  assert.equal(view(winner, 'axis').rng, undefined)
})

test('scenario 02 on 26 January still skips both normal reinforcement rolls in the campaign session', () => {
  const initial = make('1944-01-26', 2, { when: { scenarioId: '02-gotterdammerung', date: '1944-01-26' },
    opening: { weather: { ground: 'freeze', flight: 'none' }, first: 'soviet' } })
  const weather = send(initial, 'determine-campaign-weather')
  const first = send(weather, 'roll-campaign-event')
  const opening = send(first, 'complete-campaign-refit')
  const scheduled = send(opening, 'complete-campaign-reinforcement-opening')
  const closed = send(scheduled, 'complete-scheduled-reinforcements')
  assert.equal(view(closed, 'soviet').segment, 'rebuild-consolidate')
  assert.equal(closed.state.rng.drawCount, 1)
  assert.throws(() => send(closed, 'roll-campaign-supply'), /not available/)
  assert.throws(() => send(closed, 'roll-campaign-replacements'), /not available/)
})

test('a drawn random event is retained with its ordered dice and holds initiative', () => {
  const weather = send(make(when.date, 1, { opening }), 'determine-campaign-weather')
  const event = send(weather, 'roll-campaign-event')
  assert.deepEqual(view(event, 'axis').event, { table: 'common', code: 46 })
  assert.equal(view(event, 'soviet').step, 'await-event-effect')
  assert.deepEqual(event.state.preTurnRolls.map(({ check, dice }) => [check, dice.faces]),
    [['event-category', [2]], ['event-code', [4, 6]]])
  assert.throws(() => send(event, 'roll-campaign-event'), /not available/)
  assert.throws(() => send(event, 'roll-campaign-initiative'), /not due/)
  assert.equal(event.state.rng.drawCount, 3)
})

test('third April Mud ends before flight and ice removes the ferry marker when it starts', () => {
  const ferry = { id: 'pontoon', side: 'soviet', hexside: ['A1.01', 'A2.02'] }
  const initial = make('1944-04-08', 8, { weatherHistory: { ...initialWeatherHistory, aprilMudRun: 2 }, ferries: [ferry] })
  const ended = send(initial, 'determine-campaign-weather')
  assert.deepEqual(ended.state.cursor, { phase: 'ended', reason: 'april-mud' })
  assert.deepEqual(view(ended, 'axis').weather, { ground: 'mud', flight: null })
  assert.equal(ended.state.rng.drawCount, 1)
  assert.throws(() => send(ended, 'roll-campaign-event'), /pre-turn has ended/)

  const pendingIce = make('1943-12-08', 1, { weatherHistory: { ...initialWeatherHistory, freezeRun: 3, iceNextTurn: true }, ferries: [ferry] })
  const iced = send(pendingIce, 'determine-campaign-weather')
  assert.equal(view(iced, 'soviet').ice, true)
  assert.deepEqual(iced.state.ferries, [])
  assert.equal(pendingIce.state.ferries.length, 1)
})

test('Thaw opens the Simulcast boundary instead of a normal player turn', () => {
  const weather = send(make('1944-01-29', 20), 'determine-campaign-weather')
  assert.deepEqual(weather.state.weather, { ground: 'thaw', flight: 'none' })
  const ready = send(weather, 'roll-campaign-event')
  assert.equal(view(ready, 'axis').step, 'await-simulcast')
  assert.throws(() => send(ready, 'complete-campaign-refit'), /campaign player turn/)
})
