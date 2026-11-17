import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { submitScorpionInitiative } from '../src/match/scorpion-pre-turn.ts'
import { openScorpionTurn } from '../src/ttw/scorpion/pre-turn.ts'
import { answerRetention, rollInitiative } from '../src/ttw/scorpion/initiative-step.ts'
import { scorpionWeather } from '../src/ttw/scorpion/weather.ts'

function dice(...faces) {
  return () => {
    const face = faces.shift()
    assert.notEqual(face, undefined, 'Unexpected dice roll')
    return face
  }
}

test('Scorpion turn 1 starts Soviet without an initiative question', () => {
  const turn = openScorpionTurn(1, scorpionWeather(1, false, dice()), 0, 'soviet', 10, 'soviet')
  assert.deepEqual(turn.step, { kind: 'player-turn', first: 'soviet', retention: 'soviet' })
  assert.equal(turn.vp, 0)
})

test('from Feb 1 the river penalty is capped at four and ignored on Thaw', () => {
  const freeze = scorpionWeather(3, false, dice(1, 5, 5))
  const turn = openScorpionTurn(3, freeze, 0, 'soviet', 10, 'soviet')
  assert.equal(turn.vp, -4)
  assert.equal(turn.step.kind, 'retention')
  assert.deepEqual(openScorpionTurn(3, freeze, -1, 'soviet', 10, 'soviet').step,
    { kind: 'ended', result: { outcome: 'axis', level: 'major' } })
  const thaw = scorpionWeather(3, false, dice(6))
  assert.equal(openScorpionTurn(3, thaw, 0, 'soviet', 10, 'soviet').vp, 0)
})

test('Feb 19 first Thaw ends the game before initiative, awarding the reroll counter', () => {
  const turn = openScorpionTurn(8, scorpionWeather(8, false, dice()), 10, 'axis', 4, 'soviet')
  assert.deepEqual(turn.step, { kind: 'ended', result: { outcome: 'soviet', level: 'minor' } })
})

test('POV and duplicate authority check preserve a single on-map SP payment', () => {
  const turn = openScorpionTurn(2, scorpionWeather(2, false, dice(3, 3)), 0, 'soviet', 0, 'soviet')
  const land = { side: 'soviet', tokens: 5, location: 'on-map' }
  const offMap = { ...land, location: 'off-map' }
  const state = { turn, dumps: { land, offMap } }
  const command = { id: 'retain', expectedRevision: 0, action: { type: 'retain-initiative', dumpId: 'land' } }
  const record = { state, revision: 0, receipts: [] }

  assert.throws(() => submitScorpionInitiative(record, 'axis', command), /cannot answer/)
  assert.throws(() => submitScorpionInitiative(record, 'soviet',
    { ...command, action: { ...command.action, dumpId: 'offMap' } }), /on-map/)
  assert.throws(() => answerRetention(turn, 'soviet', 'pay', {side: 'soviet', tokens: 3}), /requires one SP/)
  const paid = submitScorpionInitiative(record, 'soviet', command).record
  assert.equal(paid.state.dumps.land.tokens, 1)
  const restored = JSON.parse(JSON.stringify(paid))
  const retried = submitScorpionInitiative(restored, 'soviet', command)
  assert.equal(retried.record.state.dumps.land.tokens, 1)
  const active = submitScorpionInitiative(retried.record, 'soviet', {
    id: 'order', expectedRevision: 1, action: { type: 'choose-first', first: 'axis' },
  }).record
  assert.deepEqual(active.state.turn.step, { kind: 'player-turn', first: 'axis', retention: 'soviet' })
})

test('normal rolls retry ties, transfer the retention option, then close it after Axis declines', () => {
  const weather = scorpionWeather(2, false, dice(3, 3))
  const turn = openScorpionTurn(2, weather, 0, 'soviet', 0, 'soviet')
  const rolling = answerRetention(turn, 'soviet', 'roll').turn
  assert.equal(rollInitiative(rolling, dice(3, 3, 1, 5)), rolling)
  const axisWins = rollInitiative(rolling, dice(6, 6, 1, 1))
  assert.deepEqual(axisWins.step, { kind: 'choose-order', responder: 'axis', retention: 'axis' })
  const next = openScorpionTurn(3, weather, 0, 'axis', 0, 'soviet')
  const closed = rollInitiative(answerRetention(next, 'axis', 'roll').turn, dice(6, 6, 1, 1))
  assert.deepEqual(closed.step, { kind: 'choose-order', responder: 'axis', retention: 'closed' })
})
