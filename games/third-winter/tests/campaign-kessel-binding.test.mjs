import assert from 'node:assert/strict'
import test from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { campaignKesselOptions } from '../src/match/campaign-kessel.ts'

const linearMap = {
  resolveHex: (h) => (Number.isInteger(+h) && +h >= 0 && +h <= 30 ? String(h) : undefined),
  neighbors: (h) => [Number(h) - 1, Number(h) + 1].filter((n) => n >= 0 && n <= 30).map(String),
}
const board = {
  isKesselHq: (s, id) => id === 'kessel',
  unit: () => ({ mode: 'move', mobility: 'leg' }),
  step: () => ({ costAll: false, unbridgedVolga: false, unnegatedEzoc: false }),
  easting: (h) => Number(h),
}
function game() {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 1,
    counters: { kessel: { id: 'kessel', side: 'axis', location: { kind: 'map', hex: '10' }, stepsLost: 0, mode: 'move', kind: 'hq', definition: 'kessel-hq' } }, supplyDumps: {} }, 200)
  record.state.cursor = { phase: 'movement', phasing: 'axis', first: 'axis' }
  record.state.movementSegment = 'movement'
  return record
}
const ctx = { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: (h) => h, arrivalSites: () => [] }, groundMovement: { map: linearMap }, kesselBoard: board }
let seq = 0
const move = (record, path) => submitCampaignMatch(record, 'axis', { id: `kessel-move-${seq++}`, expectedRevision: record.revision,
  action: { type: 'kessel-campaign-free-move', counterId: 'kessel', path } }, ctx).record

test('Kessel free move ≤4 hexes within 2, no further east, one Kessel per turn (§2.3a B)', () => {
  const west = move(game(), ['9', '8'])
  assert.equal(west.state.counters.kessel.location.hex, '8')
  assert.equal(west.state.kesselFreeMove.turn, 1)
  // a second Kessel benefit in the same turn is refused (free move consumed its movement)
  assert.throws(() => move(west, ['7']), /already moved/)
  // moving further east is refused
  assert.throws(() => move(game(), ['11', '12']), /no-further-east/)
  // more than four hexes is refused
  assert.throws(() => move(game(), ['9', '8', '7', '6', '5']), /one to four hexes/)
})

test('Kessel free move rejects out-of-radius, must-stop steps, and exposes UI options', () => {
  // beyond two hexes from the Kessel HQ
  assert.throws(() => move(game(), ['7']), /within two hexes/)
  // an All-cost step in the middle must stop there
  const stopBoard = { ...board, step: (s, id, from, to) => ({ costAll: to === '9', unbridgedVolga: false, unnegatedEzoc: false }) }
  const stopCtx = { ...ctx, kesselBoard: stopBoard }
  const record = game()
  assert.throws(() => submitCampaignMatch(record, 'axis', { id: 'k-stop', expectedRevision: record.revision,
    action: { type: 'kessel-campaign-free-move', counterId: 'kessel', path: ['9', '8'] } }, stopCtx).record, /must-stop/)
  const options = campaignKesselOptions(game().state, 'axis', board)
  assert.deepEqual(options.kessels.map((k) => k.hex), ['10'])
  assert.equal(options.freeMoveUsedThisTurn, false)
})