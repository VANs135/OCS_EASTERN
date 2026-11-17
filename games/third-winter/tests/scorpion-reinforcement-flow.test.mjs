import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { openScorpionTurn } from '../src/ttw/scorpion/pre-turn.ts'
import { startScorpionPlayerTurns, advanceScorpionPhase } from '../src/match/scorpion-player-turn.ts'
import { submitScorpionReinforcement } from '../src/match/scorpion-reinforcement.ts'

const entry = { id: 'arrival', destinations: ['s22.02'], definition: 'unit', side: 'soviet', turn: 1 }
const alert = { id: 'a2', definition: 'alert' }
const board = {
  catalog: [entry],
  supplySources: { soviet: new Set(['s22.02']), axis: new Set(['s1.03']) },
  controlOf: (hex) => hex.startsWith('s22') ? 'soviet' : 'axis',
  arrivalDestinations: () => ['s22.02'],
  alertDestinations: () => ['s1.03'],
}
const freeze = { ground: 'freeze', flight: 'limited', thawSeen: false, endGame: false }
const noDraw = () => { throw new Error('Unexpected random draw') }

function recordAt(cursor, availableAlerts = []) {
  return { revision: 0, receipts: [], state: {
    cursor, window: null, arrival: { placed: [], mobilized: [], sovietVp: 0 }, arrivalsOnMap: [],
    dumps: {}, pax: { axis: 0, soviet: 0 }, availableAlerts, placedAlerts: [], victory: null,
  } }
}
function command(record, id, action) {
  return { id, expectedRevision: record.revision, action }
}

test('Scorpion turn 1 places fixed arrivals and supply, then reaches movement without rolling', () => {
  const pre = openScorpionTurn(1, freeze, 0, 'soviet', 0, 'soviet')
  let record = recordAt(startScorpionPlayerTurns(pre))
  const apply = (id, action) => {
    record = submitScorpionReinforcement(record, 'soviet', command(record, id, action), board, noDraw, noDraw).record
  }
  assert.throws(() => submitScorpionReinforcement(record, 'axis', command(record, 'open', { type: 'complete-refit' }), board, noDraw, noDraw), /side/)
  apply('open', { type: 'complete-refit' })
  assert.equal(record.state.window.fixedTokens, 8)
  assert.throws(() => apply('skip', { type: 'finish-scheduled-arrivals' }), /scheduled arrivals/)
  apply('arrival', { type: 'place-arrival', arrivalId: entry.id, hex: 's22.02' })
  assert.throws(() => apply('skip', { type: 'finish-scheduled-arrivals' }), /scheduled supply/)
  apply('supply', { type: 'place-supply', tokens: 8, target: { kind: 'hex', id: 's22.02' } })
  apply('finish', { type: 'finish-scheduled-arrivals' })
  assert.equal(record.state.window.dice, null)
  apply('close', { type: 'complete-reinforcement' })
  assert.equal(record.state.cursor.phase, 'movement')
  assert.equal(record.state.dumps['soviet:hex:s22.02'].tokens, 8)
  assert.equal(record.state.arrivalsOnMap[0].hex, 's22.02')
})

test('second player gets a separate phase; restoring an award and retrying does not roll again', () => {
  const first = { turn: 3, first: 'soviet', phasing: 'soviet', phase: 'cleanup', retention: 'closed' }
  const second = advanceScorpionPhase(first, 'soviet')
  assert.equal(second.phasing, 'axis')
  let record = recordAt(second, [{ id: 'a1', definition: 'alert' }, alert])
  const submit = (cmd, roll = noDraw, draw = noDraw) =>
    submitScorpionReinforcement(record, 'axis', cmd, board, roll, draw)
  const apply = (id, action) => { record = submit(command(record, id, action)).record }
  apply('open', { type: 'complete-refit' })
  apply('fixed', { type: 'place-supply', tokens: 8, target: { kind: 'hex', id: 's1.03' } })
  const award = command(record, 'award', { type: 'finish-scheduled-arrivals' })
  record = JSON.parse(JSON.stringify(submit(award, () => 3, (size) => size - 1).record))
  const resubmitted = submit(award)
  assert.equal(resubmitted.duplicate, true)
  assert.equal(resubmitted.record.state.pax.axis, 1)
  assert.deepEqual(resubmitted.record.state.window.pendingAlert, alert)
  assert.throws(() => apply('close', { type: 'complete-reinforcement' }), /variable/)
  apply('alert', { type: 'place-alert', hex: 's1.03' })
  apply('variable', { type: 'place-supply', tokens: 20, target: { kind: 'air-box' } })
  apply('close', { type: 'complete-reinforcement' })
  assert.equal(record.state.cursor.phase, 'movement')
  assert.equal(record.state.dumps['axis:hex:s1.03'].tokens, 8)
  assert.equal(record.state.dumps['axis:air-box'].tokens, 20)
  assert.deepEqual(record.state.availableAlerts.map(({id}) => id), ['a1'])
  assert.equal(advanceScorpionPhase({ ...second, phase: 'cleanup' }, 'axis'), null)
})
