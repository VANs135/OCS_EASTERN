import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'

const hexes = ['A1.1', 'A2.1', 'A3.1', 'A4.1']
const map = {
  resolveHex: (hex) => hexes.includes(hex) ? hex : undefined,
  neighbors(hex) { const i = hexes.indexOf(hex); return i < 0 ? [] : [hexes[i - 1], hexes[i + 1]].filter(Boolean) },
}
const distance = (a, b) => Math.abs(hexes.indexOf(a) - hexes.indexOf(b))
const rows = ['1 or less', '2-3', '4-5', '6-7', '8-9', '10-11', '12', '13+']
const cols = ['1:2', '1:1', '2:1', '3:1']
const makeTable = (code) => ({ diceRows: rows, terrainColumns: { Open: cols, Close: cols, 'Very Close': cols, 'Extr Close': cols },
  matrix: rows.map(() => cols.map(() => code)) })
const unit = (side, hex, definition, props = {}) => ({ kind: 'land', side, definition, location: { kind: 'map', hex }, currentRe: 1, mode: 'combat', ...props })
const stepsOf = (state, id) => state.counters[id]?.location.kind === 'map' ? state.counters[id].currentRe ?? 1 : undefined

function start(counters, { phase = 'movement', mp = 4, cost = 1, moved = false, ground = 'dry', table } = {}) {
  const opened = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 2, counters, supplyDumps: { axis: { 'A2.1': 2 }, soviet: { 'A3.1': 2 } } }, 623)
  const record = { ...opened, state: { ...opened.state, weather: { ground, flight: 'none' },
    cursor: { phase, phasing: 'axis', first: 'axis' }, movementSegment: 'movement' } }
  const board = {
    map, distance, table: table ?? makeTable('A DL1'),
    profileOf: (state, id) => ({ combat: true, attackCapable: true, inCombatMode: state.counters[id].mode === 'combat',
      outOfSupply: false, moveMa: 4, moveMobility: 'leg', drawMobility: 'leg', singleTransportPoint: false }),
    combatProfile: (state, id) => ({ strength: state.counters[id].definition === 'atk' ? 3 : 1, combatClass: 'leg', antiTank: 0,
      actionRating: 3, printedRe: state.counters[id].currentRe ?? 1, artilleryDivision: false, attackCapable: true }),
    losses: { stepsOf, reAfterLoss: (state, id, l) => state.counters[id].currentRe - l },
    terrainAt: () => ['Open'], hedgehogAt: () => 0,
    canUseSupply: (_s, _side, _id, key) => key.startsWith('dump:'),
    stepCost: (_s, _id, a, b) => distance(a, b) === 1 ? 1 : null,
    stackingReAt: (state, hex) => Object.values(state.counters).reduce((s, c) => s + (c.location.kind === 'map' && c.location.hex === hex ? c.currentRe ?? 1 : 0), 0),
    exploitEligible: () => true,
    overrunMp: () => mp, overrunEntryCost: () => cost, hasMoved: () => moved,
  }
  const context = { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] }, combat: board }
  return { record, context }
}
const command = (record, action) => ({ id: `ov:${record.revision}`, expectedRevision: record.revision, action })
const submit = (record, context, action, side = 'axis') => submitCampaignMatch(record, side, command(record, action), context).record
const declare = (more = {}) => ({ type: 'declare-campaign-overrun', target: 'A3.1', attackers: ['atk'],
  payments: [{ unitId: 'atk', source: { kind: 'dump', hex: 'A2.1' }, tokens: 1 }], ...more })
const defend = { type: 'defend-campaign-combat', payments: [{ source: { kind: 'dump', hex: 'A3.1' }, tokens: 1 }] }
const rating = (unitId) => ({ type: 'select-campaign-combat-rating', unitId })
const terrain = { type: 'choose-campaign-combat-terrain', terrain: 'Open', attackingTerrain: { 'A2.1': 'Open' } }
const resolve = (more = {}) => ({ type: 'resolve-campaign-combat', lossOrder: [], optionLosses: 0, ...more })

function toDefenderResult(record, context) {
  let r = submit(record, context, declare())
  r = submit(r, context, defend, 'soviet')
  r = submit(r, context, rating('atk'))
  r = submit(r, context, rating('def'), 'soviet')
  r = submit(r, context, terrain, 'soviet')
  r = submit(r, context, resolve())
  return submit(r, context, resolve({ lossOrder: ['def'] }), 'soviet')
}

test('an overrun declares in the movement segment, rolls and forces all survivors into the target (OCS 8.0/8.1)', () => {
  const { record, context } = start({ atk: unit('axis', 'A2.1', 'atk'), def: unit('soviet', 'A3.1', 'def') })
  const declared = submit(record, context, declare())
  assert.equal(declared.state.combat.overrun, true)
  assert.deepEqual(declared.state.overrunMarch, { remaining: { atk: 1 }, enteredHex: false })
  const resolved = toDefenderResult(record, context)
  assert.equal(resolved.state.combat.step, 'advance')
  assert.throws(() => submit(resolved, context, { type: 'advance-campaign-combat', unitIds: [] }), /All surviving overrun participants/)
  const entered = submit(resolved, context, { type: 'advance-campaign-combat', unitIds: ['atk'] })
  assert.deepEqual(entered.state.counters.atk.location, { kind: 'map', hex: 'A3.1' })
  assert.equal(entered.state.combat, null)
  assert.equal(entered.state.overrunMarch.enteredHex, true)
  assert.equal(entered.state.overrunMarch.remaining.atk, 1)
})

test('overrun gates MP, entry cost, mode, prior movement, phase and thaw', () => {
  const counters = { atk: unit('axis', 'A2.1', 'atk'), def: unit('soviet', 'A3.1', 'def') }
  const lowMp = start(counters, { mp: 2 })
  assert.throws(() => submit(lowMp.record, lowMp.context, declare()), /at least 3 MP/)
  const highCost = start(counters, { cost: 4 })
  assert.throws(() => submit(highCost.record, highCost.context, declare()), /entry costing at most 3/)
  const dg = start({ ...counters, atk: { ...counters.atk, disorganized: true } })
  assert.throws(() => submit(dg.record, dg.context, declare()), /eligible stacked attackers/)
  const moved = start(counters, { moved: true })
  assert.throws(() => submit(moved.record, moved.context, declare()), /eligible stacked attackers/)
  const wrongPhase = start(counters, { phase: 'combat' })
  assert.throws(() => submit(wrongPhase.record, wrongPhase.context, declare()), /active Movement Segment/)
  const thaw = start(counters, { ground: 'thaw' })
  assert.throws(() => submit(thaw.record, thaw.context, declare()), /active Movement Segment/)
})

test('an overrun grants no exploit marker even with an e result (OCS 9.13b)', () => {
  const { record, context } = start({ atk: unit('axis', 'A2.1', 'atk'), def: unit('soviet', 'A3.1', 'def') }, { table: makeTable('A e3 DL1') })
  let r = submit(record, context, declare())
  r = submit(r, context, defend, 'soviet')
  r = submit(r, context, rating('atk'))
  r = submit(r, context, rating('def'), 'soviet')
  r = submit(r, context, terrain, 'soviet')
  r = submit(r, context, resolve())
  assert.equal(r.state.counters.atk.exploiting, undefined)
})