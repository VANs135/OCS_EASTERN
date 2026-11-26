import assert from 'node:assert/strict'
import test from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { campaignHedgehogLevel } from '../src/match/campaign-hedgehogs.ts'

const map = { resolveHex: (h) => (Number.isInteger(+h) && +h >= 0 && +h <= 30 ? String(h) : undefined) }
const workerOf = (facts) => (state, id) => facts[id.toLowerCase()] ?? {
  hex: state.counters[id]?.location?.hex ?? '99', combat: true, stationary: true, re: 4, engineerAt: () => false }
/** 工人事实注入器：按 id 指定工程能力/静止与否。 */
const board = (workers = {}) => ({ map, worker: workerOf(workers) })

function game(patch = {}) {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 3,
    counters: { A: { definition: 'A', kind: 'land', side: 'axis', location: { kind: 'map', hex: '10' } } },
    supplyDumps: { axis: { 10: 8 } } }, 200)
  record.state.cursor = { phase: 'movement', phasing: 'axis', first: 'axis' }
  record.state.movementSegment = 'movement'
  Object.assign(record.state, patch)
  return record
}
let seq = 0
const work = (record, action, b) => submitCampaignMatch(record, 'axis',
  { id: `hedgehog-${seq++}`, expectedRevision: record.revision, action: { type: 'work-campaign-hedgehog', ...action } },
  { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: (h) => h, arrivalSites: () => [] }, hedgehogWork: b }).record

test('a stationary local RE builds one hedgehog level for 8 transport points (OCS 16.0b)', () => {
  const b = board()
  const built = work(game(), { operation: 'build', hex: '10', unitIds: ['A'], payments: [{ hex: '10', tokens: 8 }] }, b)
  assert.equal(built.state.hedgehogs['10'].level, 1)
  assert.equal(built.state.hedgehogs['10'].side, 'axis')
  assert.equal(built.state.supplyDumps.axis['10'], undefined) // all 8 tokens consumed
  assert.equal(built.state.hedgehogBuiltAt['10'], 3)
  assert.deepEqual(built.state.groundMovement.moved, ['A'])
  assert.equal(campaignHedgehogLevel(built.state, '10', b), 1)
})

test('building is refused without workers, under enemy occupation, at the cap, and twice in a turn (OCS 16.0b-c)', () => {
  // no workers at the hex
  const far = board({ a: { hex: '20', combat: true, stationary: true, re: 4, engineerAt: () => false } })
  assert.throws(() => work(game(), { operation: 'build', hex: '10', unitIds: ['A'], payments: [{ hex: '10', tokens: 8 }] }, far), /workers/)
  // enemy unit occupies the hex
  const occupied = game(); occupied.state.counters.E = { definition: 'E', kind: 'land', side: 'soviet', location: { kind: 'map', hex: '10' } }
  assert.throws(() => work(occupied, { operation: 'build', hex: '10', unitIds: ['A'], payments: [{ hex: '10', tokens: 8 }] }, board()), /enemy-in-hex/)
  // already Level-2 (TTW 1.1b cap)
  const capped = game({ hedgehogs: { 10: { side: 'axis', level: 2 } } })
  assert.throws(() => work(capped, { operation: 'build', hex: '10', unitIds: ['A'], payments: [{ hex: '10', tokens: 8 }] }, board()), /level-illegal/)
  // once per turn
  const done = game({ hedgehogs: { 10: { side: 'axis', level: 1 } }, hedgehogBuiltAt: { 10: 3 } })
  assert.throws(() => work(done, { operation: 'build', hex: '10', unitIds: ['A'], payments: [{ hex: '10', tokens: 8 }] }, board()), /once-per-turn/)
})

test('an engineer within two hexes may work alone and reducing is free (OCS 13.8d, 16.0c)', () => {
  const engineer = board({ a: { hex: '11', combat: true, stationary: true, re: 1, engineerAt: (hex) => hex === '10' } })
  const built = work(game(), { operation: 'build', hex: '10', unitIds: ['A'], payments: [{ hex: '10', tokens: 8 }] }, engineer)
  assert.equal(built.state.hedgehogs['10'].level, 1)
  // reduce Level-2 to Level-1 with no payment
  const reduced = work(game({ hedgehogs: { 10: { side: 'axis', level: 2 } } }), { operation: 'reduce', hex: '10', unitIds: ['A'] }, board())
  assert.equal(reduced.state.hedgehogs['10'].level, 1)
  assert.equal(reduced.state.supplyDumps.axis['10'], 8) // untouched
  // reducing Level-1 removes the hedgehog
  const removed = work(game({ hedgehogs: { 10: { side: 'axis', level: 1 } } }), { operation: 'reduce', hex: '10', unitIds: ['A'] }, board())
  assert.equal(removed.state.hedgehogs['10'], null)
  assert.equal(campaignHedgehogLevel(removed.state, '10', board()), 0)
  // nothing to reduce
  assert.throws(() => work(game(), { operation: 'reduce', hex: '10', unitIds: ['A'] }, board()), /level-illegal/)
})

test('payments must be exact, affordable and reachable by the workers (OCS 16.0b)', () => {
  assert.throws(() => work(game(), { operation: 'build', hex: '10', unitIds: ['A'], payments: [{ hex: '10', tokens: 4 }] }, board()), /exactly 8/)
  const short = game({ supplyDumps: { axis: {} } })
  assert.throws(() => work(short, { operation: 'build', hex: '10', unitIds: ['A'], payments: [{ hex: '10', tokens: 8 }] }, board()), /too few/)
  const unreachable = { ...board(), canPay: () => false }
  assert.throws(() => work(game(), { operation: 'build', hex: '10', unitIds: ['A'], payments: [{ hex: '10', tokens: 8 }] }, unreachable), /reach/)
})