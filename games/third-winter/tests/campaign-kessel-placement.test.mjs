import assert from 'node:assert/strict'
import test from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { newCampaignReinforcementWindow } from '../src/match/campaign-reinforcement-flow.ts'
import { campaignKesselPlacementOptions, scheduleCampaignKesselReturn, KESSEL_RETURN_TURNS } from '../src/match/campaign-kessel-placement.ts'

const friendlyCombatAt = (s, hex) => Object.values(s.counters).some((c) =>
  c.side === 'axis' && c.kind === 'land' && c.location.kind === 'map' && c.location.hex === hex && c.mode === 'combat')
const board = {
  resolveHex: (h) => (Number.isInteger(+h) && +h >= 0 && +h <= 30 ? String(h) : undefined),
  isKesselHq: (s, id) => id === 'kessel',
  friendlyCombatAt,
}
function game(location = { kind: 'available' }, turn = 1) {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn,
    counters: {
      kessel: { id: 'kessel', side: 'axis', location, stepsLost: 0, mode: 'combat', kind: 'hq', definition: 'kessel-hq' },
      guard: { id: 'guard', side: 'axis', location: { kind: 'map', hex: '10' }, stepsLost: 0, mode: 'combat', kind: 'land', definition: 'inf' },
    }, supplyDumps: {} }, 200)
  record.state.cursor = { phase: 'reinforcement', phasing: 'axis', first: 'axis' }
  record.state.reinforcement = { stage: 'ordinary', window: newCampaignReinforcementWindow() }
  return record
}
const ctx = { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: (h) => h, arrivalSites: () => [] }, kesselPlacement: board }
let seq = 0
const send = (record, action, side = 'axis') => submitCampaignMatch(record, side,
  { id: `kessel-place-${seq++}`, expectedRevision: record.revision, action }, ctx).record

test('Kessel HQ places with a friendly combat unit in the Axis reinforcement phase (§2.3a)', () => {
  const placed = send(game(), { type: 'place-campaign-kessel', kesselId: 'kessel', hex: '10' })
  assert.deepEqual(placed.state.counters.kessel.location, { kind: 'map', hex: '10' })
  assert.equal(placed.state.counters.kessel.mode, 'combat')
  const options = campaignKesselPlacementOptions(placed.state, 'axis', board)
  assert.deepEqual(options.placeable, [])
  assert.deepEqual(options.onMap, [{ id: 'kessel', hex: '10' }])
  // no friendly combat unit at the destination is refused
  assert.throws(() => send(game(), { type: 'place-campaign-kessel', kesselId: 'kessel', hex: '12' }), /friendly combat unit/)
  // not the Axis reinforcement phase is refused
  const wrongPhase = game(); wrongPhase.state.cursor = { phase: 'movement', phasing: 'axis', first: 'axis' }
  assert.throws(() => send(wrongPhase, { type: 'place-campaign-kessel', kesselId: 'kessel', hex: '10' }), /not open for this side/)
})

test('Kessel HQ removal schedules a three-turn return; re-place is blocked until due (§2.3a)', () => {
  const onMap = game({ kind: 'map', hex: '10' })
  const removed = send(onMap, { type: 'remove-campaign-kessel', kesselId: 'kessel' })
  assert.deepEqual(removed.state.counters.kessel.location, { kind: 'available' })
  assert.equal(removed.state.kesselReturn.kessel, 1 + KESSEL_RETURN_TURNS)
  // cannot re-place before the return is due
  assert.throws(() => send(removed, { type: 'place-campaign-kessel', kesselId: 'kessel', hex: '10' }), /three turns/)
  const pending = campaignKesselPlacementOptions(removed.state, 'axis', board)
  assert.deepEqual(pending.pending, [{ id: 'kessel', availableTurn: 4 }])
  // once due (turn 4), it places again and the schedule clears
  const due = game({ kind: 'available' }, 4); due.state.kesselReturn = { kessel: 4 }
  const back = send(due, { type: 'place-campaign-kessel', kesselId: 'kessel', hex: '10' })
  assert.deepEqual(back.state.counters.kessel.location, { kind: 'map', hex: '10' })
  assert.equal(back.state.kesselReturn.kessel, undefined)
})

test('destruction schedules a return from the dead pile; UI projection separates placeable/on-map/pending', () => {
  const record = game({ kind: 'dead-pile' }, 2)
  record.state = scheduleCampaignKesselReturn(record.state, 'kessel')
  assert.equal(record.state.kesselReturn.kessel, 2 + KESSEL_RETURN_TURNS)
  assert.throws(() => send(record, { type: 'place-campaign-kessel', kesselId: 'kessel', hex: '10' }), /three turns/)
  record.state.turn = 5
  const back = send(record, { type: 'place-campaign-kessel', kesselId: 'kessel', hex: '10' })
  assert.deepEqual(back.state.counters.kessel.location, { kind: 'map', hex: '10' })
  // Soviet side gets no Axis Kessel projection
  assert.equal(campaignKesselPlacementOptions(game().state, 'soviet', board), null)
})