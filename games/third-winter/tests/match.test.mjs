import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { acceptCommand } from '@ocs-eastern/match-core/command-log'
import { applyVolgaAction } from '../src/match/volga-session.ts'
import { actingSide, nextPlayerPhase, playerPhases } from '@ocs-eastern/series/turn'
import { scorpionFinalVictory, scorpionSuddenDeath } from '../src/ttw/scorpion/victory.ts'

test('OCS 2.2 has eight player phases and the opposing side takes Reaction', () => {
  assert.equal(playerPhases.length, 8)
  assert.equal(nextPlayerPhase('movement'), 'supply')
  assert.equal(nextPlayerPhase('cleanup'), null)
  assert.equal(actingSide('axis', 'reaction'), 'soviet')
  assert.equal(actingSide('axis', 'combat'), 'axis')
})

test('Scorpion uses strictly outside sudden-death bounds and scores the reroll counter at the end', () => {
  assert.equal(scorpionSuddenDeath(2, -5), null)
  assert.equal(scorpionSuddenDeath(3, -4), null)
  assert.equal(scorpionSuddenDeath(3, 19), null)
  assert.deepEqual(scorpionSuddenDeath(3, 20), {outcome: 'soviet', level: 'major'})
  assert.deepEqual(scorpionFinalVictory(10, 'soviet'), {outcome: 'soviet', level: 'minor'})
  assert.deepEqual(scorpionFinalVictory(5, 'axis'), {outcome: 'axis', level: 'minor'})
})

test('authority reopens a paused move and acknowledges a resent answer once', () => {
  const start = { revision: 0, receipts: [], state: {
    units: { infantry: { side: 'soviet', combat: true, hex: 'approach' } },
    movementSide: 'soviet',
    interruption: { bridges: [{ id: 'D24.4|D25.4', ends: ['D24.4', 'D25.4'],
      condition: 'intact', firstApproach: 'unseen' }], queue: [], continuation: null },
  } }
  const move = { id: 'm1', expectedRevision: 0, action: { type: 'move-step', unit: 'infantry', to: 'D24.4' } }
  const apply = (state, side, action) => applyVolgaAction(state, side, action, () => true)
  const paused = JSON.parse(JSON.stringify(acceptCommand(start, 'soviet', move, apply).record))
  assert.equal(paused.state.units.infantry.hex, 'D24.4')
  assert.equal(paused.state.interruption.queue[0].responder, 'axis')
  const answer = { id: 'r1', expectedRevision: 1, action: {
    type: 'bridge-answer', bridgeId: 'D24.4|D25.4', answer: 'destroy',
  } }
  assert.throws(() => acceptCommand(paused, 'soviet', answer, apply), /seat/)
  const completed = acceptCommand(paused, 'axis', answer, apply)
  assert.equal(completed.record.state.interruption.bridges[0].condition, 'destroyed')
  assert.equal(acceptCommand(completed.record, 'axis', answer, apply).acknowledgedRevision, 2)
  assert.equal(acceptCommand(completed.record, 'axis', answer, apply).record.receipts.length, 2)
  assert.throws(() => acceptCommand(completed.record, 'axis', {...answer, id: 'r2'}, apply), /Stale/)
})
