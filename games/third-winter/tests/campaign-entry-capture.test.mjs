import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rollDie } from '@ocs-eastern/series/rng'
import { capturedAmount } from '@ocs-eastern/series/tables/capture'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'

// 进格夺取钩子：推进/突袭进格 afterCombat=true、撤退进格 false；夺取判定由绑定层注入（此处用 series 夺取向量表）。
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
const stepsOf = (state, id) => { const c = state.counters[id]; return c?.location.kind === 'map' && c.kind === 'land' ? c.currentRe ?? 1 : undefined }
const resolveEntry = (state, side, hex, ids, afterCombat) => {
  const owner = side === 'axis' ? 'soviet' : 'axis'
  const tokens = state.supplyDumps[owner]?.[hex] ?? 0
  const record = { hex, side, afterCombat, ids: [...ids] }
  if (!tokens) return { ...state, entryLog: [...(state.entryLog ?? []), record] }
  const draw = rollDie(state.rng)
  const taken = capturedAmount(tokens, 'dump', draw.value)
  const supplyDumps = { ...state.supplyDumps, [owner]: { ...state.supplyDumps[owner] } }
  delete supplyDumps[owner][hex]
  if (taken) supplyDumps[side] = { ...supplyDumps[side], [hex]: (supplyDumps[side]?.[hex] ?? 0) + taken }
  return { ...state, rng: draw.rng, supplyDumps, entryLog: [...(state.entryLog ?? []), { ...record, taken, destroyed: tokens - taken }] }
}
const board = {
  map, distance, table: makeTable('A e3 DL1'),
  profileOf: (state, id) => ({ combat: true, attackCapable: true, inCombatMode: state.counters[id].mode === 'combat',
    outOfSupply: false, moveMa: 4, moveMobility: 'leg', drawMobility: 'leg', singleTransportPoint: false }),
  combatProfile: (state, id) => ({ strength: 3, combatClass: 'leg', antiTank: 0, actionRating: 3,
    printedRe: state.counters[id].currentRe ?? 1, artilleryDivision: false, attackCapable: true, mobility: 'leg' }),
  losses: { stepsOf, reAfterLoss: (state, id, losses) => state.counters[id].currentRe - losses },
  terrainAt: () => ['Open'], hedgehogAt: () => 0,
  canUseSupply: (_s, _side, _id, key) => key.startsWith('dump:'),
  stepCost: (_s, _id, from, to) => distance(from, to) === 1 ? 1 : null,
  stackingReAt: (state, hex) => Object.values(state.counters).reduce((sum, c) => sum + (c.location.kind === 'map' && c.location.hex === hex ? c.currentRe ?? 1 : 0), 0),
  exploitEligible: (state, id) => state.counters[id].exploiting === true,
  resolveEntry,
}
function start(counters, { dumps = { axis: { 'A2.1': 2 }, soviet: { 'A3.1': 4 } }, table } = {}) {
  const opened = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 2, counters, supplyDumps: dumps }, 623)
  const record = { ...opened, state: { ...opened.state, weather: { ground: 'dry', flight: 'none' }, cursor: { phase: 'combat', phasing: 'axis', first: 'axis' }, lateTurnSegment: 'ground-combat' } }
  return { record, context: { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] }, combat: { ...board, table: table ?? board.table } } }
}
const command = (record, action) => ({ id: `entry:${record.revision}`, expectedRevision: record.revision, action })
const submit = (record, context, action, side = record.state.cursor.phasing) => submitCampaignMatch(record, side, command(record, action), context).record
const declare = () => ({ type: 'declare-campaign-combat', target: 'A3.1', attackers: ['atk'], payments: [{ unitId: 'atk', source: { kind: 'dump', hex: 'A2.1' }, tokens: 1 }] })
const defend = () => ({ type: 'defend-campaign-combat', payments: [{ source: { kind: 'dump', hex: 'A3.1' }, tokens: 1 }] })
const rating = (id) => ({ type: 'select-campaign-combat-rating', unitId: id })
const terrain = () => ({ type: 'choose-campaign-combat-terrain', terrain: 'Open', attackingTerrain: { 'A2.1': 'Open' } })
const resolve = (more = {}) => ({ type: 'resolve-campaign-combat', lossOrder: [], optionLosses: 0, ...more })
function toResolve(record, context) {
  let r = submit(record, context, declare())
  r = submit(r, context, defend(), 'soviet')
  r = submit(r, context, rating('atk'))
  r = submit(r, context, rating('def'), 'soviet')
  r = submit(r, context, terrain(), 'soviet')
  return submit(r, context, resolve())
}

test('advance into the defender hex resolves entry capture with afterCombat=true', () => {
  const { record, context } = start({ atk: unit('axis', 'A2.1', 'atk'), def: unit('soviet', 'A3.1', 'def') })
  let r = toResolve(record, context)
  r = submit(r, context, resolve({ lossOrder: ['def'] }), 'soviet')
  r = submit(r, context, { type: 'advance-campaign-combat', unitIds: ['atk'] })
  const entry = r.state.entryLog.at(-1)
  assert.equal(entry.hex, 'A3.1')
  assert.equal(entry.afterCombat, true)
  assert.deepEqual(entry.ids, ['atk'])
  assert.equal(entry.taken + entry.destroyed, 3)          // 守方已付 1T，余 3T 被夺取判定
  assert.equal(r.state.supplyDumps.soviet['A3.1'], undefined)
  assert.equal(r.state.supplyDumps.axis['A3.1'], entry.taken)
})

test('retreat entry resolves capture with afterCombat=false', () => {
  const { record, context } = start({ atk: unit('axis', 'A2.1', 'atk'), def: unit('soviet', 'A3.1', 'def') },
    { dumps: { axis: { 'A2.1': 2 }, soviet: { 'A3.1': 4, 'A1.1': 2 } }, table: makeTable('Ao1 DL1') })
  let r = submit(record, context, declare())
  r = submit(r, context, defend(), 'soviet')
  r = submit(r, context, rating('atk'))
  r = submit(r, context, rating('def'), 'soviet')
  r = submit(r, context, terrain(), 'soviet')
  r = submit(r, context, resolve({ retreats: [{ units: ['atk'], path: ['A1.1'] }] }))
  const entry = r.state.entryLog.at(-1)
  assert.equal(entry.hex, 'A1.1')
  assert.equal(entry.afterCombat, false)
  assert.equal(entry.taken + entry.destroyed, 2)
  assert.equal(r.state.supplyDumps.soviet['A1.1'], undefined)
})