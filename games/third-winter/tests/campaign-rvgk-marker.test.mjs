import assert from 'node:assert/strict'
import test from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'

const board = {
  resolveHex: (h) => (Number.isInteger(+h) && +h >= 0 && +h <= 30 ? String(h) : undefined),
  detrainable: (s, hex) => ['12', '20', '25'].includes(hex),
  routeWithin10AxisCombat: (s, from, to) => to === '5',
  mapOf: (hex) => (Number(hex) <= 15 ? 'C' : 'A'),
  railCapacityRemaining: () => 10,
}
function game() {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 1, counters: {}, supplyDumps: {} }, 200)
  record.state.cursor = { phase: 'movement', phasing: 'soviet', first: 'axis' }
  record.state.rvgkMarkers = { 'rvgk-1': '10', 'rvgk-2': '20' }
  return record
}
const ctx = { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: (h) => h, arrivalSites: () => [] }, rvgkMarker: board }
let seq = 0
const move = (record, box, hex, b = board) => submitCampaignMatch(record, 'soviet',
  { id: `rvgk-marker-${seq++}`, expectedRevision: record.revision, action: { type: 'move-campaign-rvgk-marker', box, hex } },
  { ...ctx, rvgkMarker: b }).record

test('RVGK marker rails to a detrainable hex on its map, spending 5 RE (§3.5a)', () => {
  const moved = move(game(), 'rvgk-1', '12')
  assert.equal(moved.state.rvgkMarkers['rvgk-1'], '12')
  assert.equal(moved.state.groundMovement.railCapacitySpent, 5)
  // RVGK-2 stays on Map A/B
  const moved2 = move(game(), 'rvgk-2', '25')
  assert.equal(moved2.state.rvgkMarkers['rvgk-2'], '25')
})

test('RVGK marker move refuses non-detrainable, Axis-proximate, wrong-map and over-capacity targets', () => {
  assert.throws(() => move(game(), 'rvgk-1', '11'), /detrainable/)        // not detrainable
  assert.throws(() => move(game(), 'rvgk-1', '5'), /10 hexes/)            // within 10 of Axis combat
  assert.throws(() => move(game(), 'rvgk-1', '20'), /Map C\/D/)           // RVGK-1 may not end on Map A
  assert.throws(() => move(game(), 'rvgk-2', '12'), /Map A\/B/)           // RVGK-2 may not end on Map C
  const lowCap = { ...board, railCapacityRemaining: () => 3 }
  assert.throws(() => move(game(), 'rvgk-1', '12', lowCap), /rail capacity/)
  // not the Soviet movement phase is refused
  const wrong = game(); wrong.state.cursor = { phase: 'movement', phasing: 'axis', first: 'axis' }
  assert.throws(() => move(wrong, 'rvgk-1', '12'), /Soviet movement phase/)
})