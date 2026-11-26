import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'

// TTW 1.4c 战斗侧绑定：跨伏尔加级河/赫尔松渡口攻击资格、渡轮×¼、撤退枚举、推进每河岸每阶段≤3RE。
const hexes = ['A1.1', 'A2.1', 'A3.1', 'A4.1', 'A5.1']
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

// 每测试注入的跨河事实（无序边键）。
let crossings = {}
const pairKey = (a, b) => [a, b].sort().join('|')
const board = {
  map, distance,
  table: makeTable('A e3 DL1'),
  profileOf: (state, id) => ({ combat: true, attackCapable: true, inCombatMode: state.counters[id].mode === 'combat',
    outOfSupply: false, moveMa: 4, moveMobility: 'leg', drawMobility: 'leg', singleTransportPoint: false }),
  combatProfile: (state, id) => ({ strength: 3, combatClass: 'leg', antiTank: 0, actionRating: 3,
    printedRe: state.counters[id].currentRe ?? 1, artilleryDivision: false, attackCapable: true,
    mobility: state.counters[id].definition === 'tank' ? 'track' : 'leg' }),
  losses: { stepsOf, reAfterLoss: (state, id, losses) => state.counters[id].currentRe - losses },
  terrainAt: () => ['Open'],
  hedgehogAt: () => 0,
  canUseSupply: (_s, _side, _id, key) => key.startsWith('dump:'),
  stepCost: (_s, _id, from, to) => distance(from, to) === 1 ? 1 : null,
  stackingReAt: (state, hex) => Object.values(state.counters).reduce((sum, c) => sum + (c.location.kind === 'map' && c.location.hex === hex ? c.currentRe ?? 1 : 0), 0),
  exploitEligible: (state, id) => state.counters[id].exploiting === true,
  riverCrossing: (_state, from, to) => crossings[pairKey(from, to)] ?? null,
}
function start(counters, { phase = 'combat', table } = {}) {
  const opened = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 2, counters, supplyDumps: { axis: { 'A2.1': 4 }, soviet: { 'A3.1': 4 } } }, 623)
  const record = { ...opened, state: { ...opened.state, weather: { ground: 'dry', flight: 'none' }, cursor: { phase, phasing: 'axis', first: 'axis' }, lateTurnSegment: 'ground-combat' } }
  return { record, context: { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] }, combat: { ...board, table: table ?? board.table } } }
}
const command = (record, action) => ({ id: `volga:${record.revision}`, expectedRevision: record.revision, action })
const submit = (record, context, action, side = record.state.cursor.phasing) => submitCampaignMatch(record, side, command(record, action), context).record
const declare = (target, attackers, tokens = 1) => ({ type: 'declare-campaign-combat', target, attackers,
  payments: attackers.map((id) => ({ unitId: id, source: { kind: 'dump', hex: 'A2.1' }, tokens })) })
const defend = (tokens = 1) => ({ type: 'defend-campaign-combat', payments: [{ source: { kind: 'dump', hex: 'A3.1' }, tokens }] })
const rating = (unitId) => ({ type: 'select-campaign-combat-rating', unitId })
const terrain = (from) => ({ type: 'choose-campaign-combat-terrain', terrain: 'Open', attackingTerrain: { [from]: 'Open' } })
const resolve = (more = {}) => ({ type: 'resolve-campaign-combat', lossOrder: [], optionLosses: 0, ...more })
const volga = (over = {}) => ({ kind: 'volga', bank: 'east', crossing: { bridge: 'blown', friendlyFerry: true, ice: false, ...over } })

test('1.4c attack eligibility: blown bridge + ferry lets Leg attack but not Track; intact bridge lets any', () => {
  crossings = { [pairKey('A2.1', 'A3.1')]: volga() }
  const leg = start({ atk: unit('axis', 'A2.1', 'atk'), def: unit('soviet', 'A3.1', 'def') })
  assert.equal(submit(leg.record, leg.context, declare('A3.1', ['atk'])).state.combat.step, 'defender-supply')
  const track = start({ tank: unit('axis', 'A2.1', 'tank'), def: unit('soviet', 'A3.1', 'def') })
  assert.throws(() => submit(track.record, track.context, declare('A3.1', ['tank'])), /river crossing/)
  crossings = { [pairKey('A2.1', 'A3.1')]: volga({ bridge: 'intact', friendlyFerry: false }) }
  const intact = start({ tank: unit('axis', 'A2.1', 'tank'), def: unit('soviet', 'A3.1', 'def') })
  assert.equal(submit(intact.record, intact.context, declare('A3.1', ['tank'])).state.combat.step, 'defender-supply')
})

test('1.4c no bridge, no ferry, no ice rejects Leg; Kherson ferry is Leg-only', () => {
  crossings = { [pairKey('A2.1', 'A3.1')]: volga({ bridge: 'none', friendlyFerry: false, ice: false }) }
  const none = start({ atk: unit('axis', 'A2.1', 'atk'), def: unit('soviet', 'A3.1', 'def') })
  assert.throws(() => submit(none.record, none.context, declare('A3.1', ['atk'])), /river crossing/)
  crossings = { [pairKey('A2.1', 'A3.1')]: { kind: 'kherson', bank: 'east', crossing: { bridge: 'none', friendlyFerry: false, ice: false } } }
  const leg = start({ atk: unit('axis', 'A2.1', 'atk'), def: unit('soviet', 'A3.1', 'def') })
  assert.equal(submit(leg.record, leg.context, declare('A3.1', ['atk'])).state.combat.step, 'defender-supply')
  const track = start({ tank: unit('axis', 'A2.1', 'tank'), def: unit('soviet', 'A3.1', 'def') })
  assert.throws(() => submit(track.record, track.context, declare('A3.1', ['tank'])), /river crossing/)
})

test('1.4c retreat: blown Volga bank is not retreatable unless frozen; Kherson never retreatable', () => {
  crossings = { [pairKey('A3.1', 'A4.1')]: volga() }
  const counters = { atk: unit('axis', 'A2.1', 'atk'), def: unit('soviet', 'A3.1', 'def', { currentRe: 2 }) }
  const frozen = start(counters, { table: makeTable('A DL1o1') })
  let r = submit(frozen.record, frozen.context, declare('A3.1', ['atk']))
  r = submit(r, frozen.context, defend(2), 'soviet')
  r = submit(r, frozen.context, rating('atk'))
  r = submit(r, frozen.context, rating('def'), 'soviet')
  r = submit(r, frozen.context, terrain('A2.1'), 'soviet')
  r = submit(r, frozen.context, resolve())
  assert.throws(() => submit(r, frozen.context, resolve({ lossOrder: ['def'], retreats: [{ units: ['def'], path: ['A4.1'] }] }), 'soviet'), /retreat/i)
  crossings = { [pairKey('A3.1', 'A4.1')]: volga({ ice: true }) }
  const ice = start(counters, { table: makeTable('A DL1o1') })
  let q = submit(ice.record, ice.context, declare('A3.1', ['atk']))
  q = submit(q, ice.context, defend(2), 'soviet')
  q = submit(q, ice.context, rating('atk'))
  q = submit(q, ice.context, rating('def'), 'soviet')
  q = submit(q, ice.context, terrain('A2.1'), 'soviet')
  q = submit(q, ice.context, resolve())
  q = submit(q, ice.context, resolve({ lossOrder: ['def'], retreats: [{ units: ['def'], path: ['A4.1'] }] }), 'soviet')
  assert.deepEqual(q.state.counters.def.location, { kind: 'map', hex: 'A4.1' })
})

test('1.4c advance ledger: 3 RE per Volga bank per phase, reset across phases', () => {
  crossings = { [pairKey('A2.1', 'A3.1')]: volga({ bridge: 'intact' }), [pairKey('A3.1', 'A4.1')]: volga({ bridge: 'intact' }) }
  const opened = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 2,
    counters: { atk: unit('axis', 'A2.1', 'atk', { currentRe: 3 }), atk2: unit('axis', 'A2.1', 'atk', { currentRe: 1 }),
      def: unit('soviet', 'A3.1', 'def'), atk3: unit('axis', 'A3.1', 'atk', { currentRe: 1, exploiting: true }), def2: unit('soviet', 'A4.1', 'def') },
    supplyDumps: { axis: { 'A2.1': 6 }, soviet: { 'A3.1': 4 } } }, 623)
  const record = { ...opened, state: { ...opened.state, weather: { ground: 'dry', flight: 'none' }, cursor: { phase: 'combat', phasing: 'axis', first: 'axis' }, lateTurnSegment: 'ground-combat' } }
  const context = { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] }, combat: board }
  // 第一场（战斗阶段）：3+1=4>3 拒绝整堆推进；仅推 3RE 合法。
  let r = submit(record, context, { type: 'declare-campaign-combat', target: 'A3.1', attackers: ['atk', 'atk2'],
    payments: [{ unitId: 'atk', source: { kind: 'dump', hex: 'A2.1' }, tokens: 3 }, { unitId: 'atk2', source: { kind: 'dump', hex: 'A2.1' }, tokens: 1 }] })
  r = submit(r, context, { type: 'defend-campaign-combat', payments: [{ source: { kind: 'dump', hex: 'A3.1' }, tokens: 1 }] }, 'soviet')
  r = submit(r, context, rating('atk'))
  r = submit(r, context, rating('def'), 'soviet')
  r = submit(r, context, terrain('A2.1'), 'soviet')
  r = submit(r, context, resolve())
  r = submit(r, context, resolve({ lossOrder: ['def'] }), 'soviet')
  assert.throws(() => submit(r, context, { type: 'advance-campaign-combat', unitIds: ['atk', 'atk2'] }), /3 RE/)
  r = submit(r, context, { type: 'advance-campaign-combat', unitIds: ['atk'] })
  assert.deepEqual(r.state.volgaAdvance, { phase: 'combat', re: { east: 3 } })
  // 第二场（进击阶段）：账本跨阶段重置，1RE 合法。
  const exploit = { ...r, state: { ...r.state, cursor: { phase: 'exploitation', phasing: 'axis', first: 'axis' } } }
  let t = submit(exploit, context, declare('A4.1', ['atk3'], 1))
  t = submit(t, context, { type: 'defend-campaign-combat', payments: [{ source: { kind: 'dump', hex: 'A3.1' }, tokens: 1 }] }, 'soviet')
  t = submit(t, context, rating('atk3'))
  t = submit(t, context, rating('def2'), 'soviet')
  t = submit(t, context, terrain('A3.1'), 'soviet')
  t = submit(t, context, resolve())
  t = submit(t, context, resolve({ lossOrder: ['def2'] }), 'soviet')
  t = submit(t, context, { type: 'advance-campaign-combat', unitIds: ['atk3'] })
  assert.deepEqual(t.state.volgaAdvance, { phase: 'exploitation', re: { east: 1 } })
})