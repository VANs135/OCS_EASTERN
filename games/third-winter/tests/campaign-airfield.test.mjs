import assert from 'node:assert/strict'
import test from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { settleCampaignAirstripCapture } from '../src/match/campaign-airfield.ts'

const map = { resolveHex: (h) => h }
const board = (patch = {}) => ({ map,
  worker: (s, id) => ({ hex: s.counters[id]?.location?.hex ?? '99', combat: true, stationary: true, re: 4, engineerAt: () => true }),
  airstripPool: () => ['strip-1', 'strip-2'], ...patch })

function game(patch = {}) {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 6,
    counters: { A: { definition: 'A', kind: 'land', side: 'axis', location: { kind: 'map', hex: '10' } } },
    supplyDumps: { axis: { 10: 8 } } }, 400)
  record.state.cursor = { phase: 'movement', phasing: 'axis', first: 'axis' }
  record.state.movementSegment = 'movement'
  Object.assign(record.state, patch)
  return record
}
let seq = 0
const work = (record, action, b = board(), side = 'axis') => submitCampaignMatch(record, side,
  { id: `airfield-${seq++}`, expectedRevision: record.revision, action: { type: 'work-campaign-airfield', ...action } },
  { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: (h) => h, arrivalSites: () => [] }, airfieldWork: b }).record

test('an engineer builds one air-base level per turn for 4T (OCS 15.2)', () => {
  const built = work(game(), { operation: 'build', hex: '10', unitIds: ['A'], payments: [{ hex: '10', tokens: 4 }] })
  assert.equal(built.state.airBases[0].level, 1)
  assert.equal(built.state.airBases[0].side, 'axis')
  assert.equal(built.state.supplyDumps.axis['10'], 4)
  assert.equal(built.state.airfieldBuiltAt['10'], 6)
  assert.deepEqual(built.state.groundMovement.moved, ['A'])
  // one level per turn
  const twice = game({ airBases: [{ hex: '10', side: 'axis', level: 1 }], airfieldBuiltAt: { 10: 6 } })
  assert.throws(() => work(twice, { operation: 'build', hex: '10', unitIds: ['A'], payments: [{ hex: '10', tokens: 4 }] }), /once-per-turn/)
  // upgrading an existing strip costs 3T
  const strip = game({ airBases: [{ hex: '10', side: 'axis', level: 0, strip: 'strip-1' }] })
  const upgraded = work(strip, { operation: 'build', hex: '10', unitIds: ['A'], payments: [{ hex: '10', tokens: 3 }] })
  assert.equal(upgraded.state.airBases[0].level, 1)
  assert.equal(upgraded.state.supplyDumps.axis['10'], 5)
})

test('air bases cap at level 3 and an engineer is mandatory (OCS 15.2)', () => {
  const capped = game({ airBases: [{ hex: '10', side: 'axis', level: 3 }] })
  assert.throws(() => work(capped, { operation: 'build', hex: '10', unitIds: ['A'], payments: [{ hex: '10', tokens: 4 }] }), /max-level/)
  const noEngineer = board({ worker: (s, id) => ({ hex: '10', combat: true, stationary: true, re: 4, engineerAt: () => false }) })
  assert.throws(() => work(game(), { operation: 'build', hex: '10', unitIds: ['A'], payments: [{ hex: '10', tokens: 4 }] }, noEngineer), /engineer-required/)
})

test('reducing is free, needs level 2+, and strips are an Axis job costing 1T (OCS 15.2, TTW 2.2h)', () => {
  const reduced = work(game({ airBases: [{ hex: '10', side: 'axis', level: 2 }] }), { operation: 'reduce', hex: '10', unitIds: ['A'] })
  assert.equal(reduced.state.airBases[0].level, 1)
  assert.equal(reduced.state.supplyDumps.axis['10'], 8)
  assert.throws(() => work(game({ airBases: [{ hex: '10', side: 'axis', level: 1 }] }), { operation: 'reduce', hex: '10', unitIds: ['A'] }), /level-illegal/)
  // build a strip in an empty hex
  const strip = work(game(), { operation: 'build-strip', hex: '10', unitIds: ['A'], payments: [{ hex: '10', tokens: 1 }] })
  assert.equal(strip.state.airBases[0].level, 0)
  assert.equal(strip.state.airBases[0].strip, 'strip-1')
  assert.equal(strip.state.supplyDumps.axis['10'], 7)
  // Soviet may not build strips (checked in the Soviet movement segment)
  const sovietTurn = game({ counters: { A: { definition: 'A', kind: 'land', side: 'soviet', location: { kind: 'map', hex: '10' } } },
    supplyDumps: { soviet: { 10: 4 } } })
  sovietTurn.state.cursor = { phase: 'movement', phasing: 'soviet', first: 'axis' }
  assert.throws(() => work(sovietTurn, { operation: 'build-strip', hex: '10', unitIds: ['A'], payments: [{ hex: '10', tokens: 1 }] }, board(), 'soviet'), /axis-only/)
  // no strip counter left
  const emptyPool = board({ airstripPool: () => [] })
  assert.throws(() => work(game(), { operation: 'build-strip', hex: '10', unitIds: ['A'], payments: [{ hex: '10', tokens: 1 }] }, emptyPool), /pool-empty/)
})

test('a strip occupied by an attack-capable Soviet unit returns to the pool (§2.2h)', () => {
  const state = { counters: {}, airBases: [{ hex: '10', side: 'axis', level: 0, strip: 'strip-1' }, { hex: '11', side: 'axis', level: 2 }] }
  const kept = settleCampaignAirstripCapture(state, () => false)
  assert.equal(kept.airBases.length, 2)
  const captured = settleCampaignAirstripCapture(state, (hex) => hex === '10')
  assert.equal(captured.airBases[0].strip, undefined) // marker returned to the pool, hex still holds a level-0 field
  assert.equal(captured.airBases[1].level, 2)
})

test('payments must be exact and reachable (OCS 15.2)', () => {
  assert.throws(() => work(game(), { operation: 'build', hex: '10', unitIds: ['A'], payments: [{ hex: '10', tokens: 1 }] }), /exactly 4/)
  const unreachable = board({ canPay: () => false })
  assert.throws(() => work(game(), { operation: 'build', hex: '10', unitIds: ['A'], payments: [{ hex: '10', tokens: 4 }] }, unreachable), /reach/)
})