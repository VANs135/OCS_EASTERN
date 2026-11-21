import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { projectCampaignMatch } from '../src/view/campaign-match-view.ts'

const context = { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: (hex) => hex,
  arrivalSites: () => [] }, reinforcementBlockers: () => [] }
const counter = (hex, fields = {}) => ({ definition: 'unit', kind: 'land', side: 'soviet',
  location: { kind: 'map', hex }, ...fields })
const movement = (counters, seed) => {
  const start = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 3, counters }, seed)
  return { ...start, state: { ...start.state, cursor: { first: 'soviet', phasing: 'soviet', phase: 'movement' }, movementSegment: 'breakout' } }
}
const cmd = (record, type, fields = {}) => ({ id: `${type}:${record.revision}`, expectedRevision: record.revision, action: { type, ...fields } })
const send = (record, configured, type, fields, side = 'soviet') => submitCampaignMatch(record, side, cmd(record, type, fields), configured).record
const attempt = (record, configured, counterId, side) => send(record, configured, 'attempt-campaign-breakout', { counterId }, side)
const facts = (partial = {}) => ({ combat: true, singleTransportPoint: false, moveMa: 4, mobility: 'truck', hasTrace: false,
  firstTurnWithoutTrace: false, ...partial })
const route = (partial = {}) => ({ ...context, breakoutBoard: () => ({
  unitFacts: (id) => facts({ hasTrace: id === 'friend' }), neighbors: (hex) => ({ a: ['b'], b: ['c'] })[hex] ?? [],
  canCross: () => true, enemyCombatAt: () => false, unnegatedEnemyZocAt: () => false, distance: () => 15, ...partial,
}) })

test('campaign breakout independently checks route and combat unit distance before drawing', () => {
  const start = movement({ stranded: counter('a'), friend: counter('c') }, 2)
  assert.throws(() => attempt(start, route({ distance: () => 16 }), 'stranded'), /within-15/)
  assert.throws(() => attempt(start, route({ canCross: () => false }), 'stranded'), /no-passable-path/)
  assert.throws(() => attempt(start, route({ enemyCombatAt: (hex) => hex === 'b' }), 'stranded'), /no-passable-path/)
  assert.throws(() => attempt(start, route({ unnegatedEnemyZocAt: (hex) => hex === 'b' }), 'stranded'), /no-passable-path/)
  assert.throws(() => attempt(start, route(), 'stranded', 'axis'), /not open for this side/)
  assert.throws(() => attempt(start, route(), 'friend'), /has-trace-supply/)
  assert.equal(start.state.rng.drawCount, 0)

  const track = route({ unnegatedEnemyZocAt: (hex) => hex === 'b',
    unitFacts: (id) => facts({ hasTrace: id === 'friend', mobility: 'track' }) })
  assert.deepEqual(projectCampaignMatch(start, 'soviet', track).breakout.options.eligibleIds, ['stranded'])
  assert.equal(projectCampaignMatch(start, 'axis', track).breakout, null)
  const result = attempt(start, track, 'stranded')
  assert.deepEqual(result.state.counters.stranded.location, { kind: 'breakout-return', turn: 8 })
  const [roll] = result.state.breakoutRolls
  assert.deepEqual([roll.attempt, roll.returnDie, roll.before, roll.after], [6, 5, 0, 2])
  const retried = submitCampaignMatch(result, 'soviet', cmd(start, 'attempt-campaign-breakout', { counterId: 'stranded' }), track)
  assert.equal(retried.duplicate, true)
  assert.equal(retried.record.state.rng.drawCount, 2)
  const moved = send(result, track, 'complete-campaign-breakout')
  assert.equal(projectCampaignMatch(moved, 'soviet', track).segment, 'movement')
  assert.throws(() => attempt(moved, track, 'stranded'), /not open/)
})

test('one transport point can use the first-turn exception and failure goes to the dead pile on one die', () => {
  const transport = counter('a', { kind: 'transport' })
  const start = movement({ truck: transport }, 1)
  const port = route({ unitFacts: () => facts({ combat: false, singleTransportPoint: true, firstTurnWithoutTrace: true }) })
  assert.throws(() => attempt(start, route({ unitFacts: () => facts({ combat: false, singleTransportPoint: true }) }), 'truck'), /not-eligible/)
  const result = attempt(start, port, 'truck')
  assert.equal(result.state.counters.truck.location.kind, 'dead-pile')
  assert.equal(result.state.breakoutRolls[0].drm, 1)
  assert.equal(result.state.rng.drawCount, 1)
})

test('scheduled returns use the side’s own TTW HQ rules and preserve current strength', () => {
  for (const side of ['axis', 'soviet']) {
    const other = side === 'axis' ? 'soviet' : 'axis'
    const due = counter('a', { side, currentRe: 2, internalStocks: 'low', location: { kind: 'breakout-return', turn: 4 } })
    const start = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-08' }, turn: 4, counters: {
      due, later: { ...due, location: { kind: 'breakout-return', turn: 5 } }, enemy: { ...due, side: other },
      correct: counter('b', { kind: 'hq', side }), wrong: counter('c', { kind: 'hq', side }),
      rival: counter('d', { kind: 'hq', side: other }), pocket: counter('e', { kind: 'hq', side }),
    } }, 2)
    const record = { ...start, state: { ...start.state, cursor: { phase: 'reinforcement', first: side, phasing: side },
      reinforcement: { stage: 'ordinary', window: { segment: 'scheduled', settledOrders: [], rolls: [] } } } }
    const configured = { ...context, breakoutReturns: { unitFacts: () => ({ nationality: 'same' }),
      hqFacts: (_, id) => ({ nationality: id === 'wrong' ? 'different' : 'same', inTrace: true,
        engineerCapable: id !== 'wrong' && id !== 'pocket', kessel: id === 'pocket' }), canPlace: () => true } }
    assert.equal(projectCampaignMatch(record, other, configured).active, null)
    assert.deepEqual(projectCampaignMatch(record, side, configured).active.breakoutReturns,
      [{ counterId: 'due', choices: [{ hqId: 'correct', hex: 'b' }] }])
    assert.throws(() => send(record, configured, 'complete-scheduled-reinforcements', {}, side), /must be placed/)
    assert.throws(() => send(record, configured, 'return-campaign-breakout', { counterId: 'due', hqId: 'wrong' }, side), /legal return HQ/)
    const placed = send(record, configured, 'return-campaign-breakout', { counterId: 'due', hqId: 'correct' }, side)
    assert.equal(placed.state.counters.due.currentRe, 2)
    assert.equal(placed.state.counters.due.internalStocks, undefined)
    assert.deepEqual(placed.state.counters.due.location, { kind: 'map', hex: 'b' })
    assert.equal(send(placed, configured, 'complete-scheduled-reinforcements', {}, side).state.reinforcement.window.segment, 'supply')
  }
})
