import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { applyCampaignCombatLosses } from '../src/match/campaign-combat-losses.ts'
import { ARMY_HQ_DESTROYED_VP } from '../src/ttw/combat-special.ts'

const hexes = ['A1.1', 'A2.1', 'A3.1', 'A4.1', 'A5.1', 'A6.1']
const map = {
  resolveHex: (hex) => hexes.includes(hex) ? hex : undefined,
  neighbors(hex) { const index = hexes.indexOf(hex); return index < 0 ? [] : [hexes[index - 1], hexes[index + 1]].filter(Boolean) },
}
const distance = (a, b) => Math.abs(hexes.indexOf(a) - hexes.indexOf(b))
// 合成 CRT：全格同码 ⇒ 列移位与掷骰行不影响结果，便于断言结算义务。
const rows = ['1 or less', '2-3', '4-5', '6-7', '8-9', '10-11', '12', '13+']
const cols = ['1:2', '1:1', '2:1', '3:1']
const makeTable = (code) => ({ diceRows: rows, terrainColumns: { Open: cols, Close: cols, 'Very Close': cols, 'Extr Close': cols },
  matrix: rows.map(() => cols.map(() => code)) })

const unit = (side, hex, definition, props = {}) => ({ kind: 'land', side, definition, location: { kind: 'map', hex }, currentRe: 1, mode: 'combat', ...props })
const stepsOf = (state, id) => {
  const counter = state.counters[id]
  return counter?.location.kind === 'map' && counter.kind === 'land' ? counter.currentRe ?? 1 : undefined
}
const strengthOf = (definition) => definition === 'atk' ? 3 : 1
const board = {
  map, distance,
  table: makeTable('A e3 DL1'),
  profileOf: (state, id) => ({ combat: true, attackCapable: true, inCombatMode: state.counters[id].mode === 'combat',
    outOfSupply: false, moveMa: 4, moveMobility: 'leg', drawMobility: 'leg', singleTransportPoint: false }),
  combatProfile: (state, id) => ({ strength: strengthOf(state.counters[id].definition), combatClass: 'leg', antiTank: 0,
    actionRating: 3, printedRe: state.counters[id].currentRe ?? 1, artilleryDivision: false, attackCapable: true }),
  losses: { stepsOf, reAfterLoss: (state, id, losses) => state.counters[id].currentRe - losses },
  terrainAt: () => ['Open'],
  hedgehogAt: () => 0,
  canUseSupply: (_state, _side, _id, key) => key.startsWith('dump:'),
  stepCost: (_state, _id, from, to) => distance(from, to) === 1 ? 1 : null,
  stackingReAt: (state, hex) => Object.values(state.counters).reduce((sum, c) =>
    sum + (c.location.kind === 'map' && c.location.hex === hex ? c.currentRe ?? 1 : 0), 0),
  exploitEligible: (state, id) => state.counters[id].exploiting === true,
}

function start(counters, { phasing = 'axis', phase = 'combat', dumps = { axis: { 'A2.1': 2 }, soviet: { 'A3.1': 2 } }, table } = {}) {
  const opened = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 2, counters, supplyDumps: dumps }, 623)
  const record = { ...opened, state: { ...opened.state, weather: { ground: 'dry', flight: 'none' },
    cursor: { phase, phasing, first: 'axis' }, lateTurnSegment: 'ground-combat' } }
  const context = { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] },
    combat: { ...board, table: table ?? board.table } }
  return { record, context }
}
const command = (record, action) => ({ id: `combat:${record.revision}`, expectedRevision: record.revision, action })
const submit = (record, context, action, side = record.state.cursor.phasing) => submitCampaignMatch(record, side, command(record, action), context).record
const declare = (more = {}) => ({ type: 'declare-campaign-combat', target: 'A3.1', attackers: ['atk'],
  payments: [{ unitId: 'atk', source: { kind: 'dump', hex: 'A2.1' }, tokens: 1 }], ...more })
const defend = (more = {}) => ({ type: 'defend-campaign-combat', payments: [{ source: { kind: 'dump', hex: 'A3.1' }, tokens: 1 }], ...more })
const rating = (unitId) => ({ type: 'select-campaign-combat-rating', unitId })
const terrain = (attackingTerrain = { 'A2.1': 'Open' }) => ({ type: 'choose-campaign-combat-terrain', terrain: 'Open', attackingTerrain })
const resolve = (more = {}) => ({ type: 'resolve-campaign-combat', lossOrder: [], optionLosses: 0, ...more })

// 推进到「守方选地形」之前（攻方已付补给、双方已选 AR）。
function toTerrain(record, context, { atk = 'atk', def = 'def', defendMore } = {}) {
  let r = submit(record, context, declare({ attackers: [atk], payments: [{ unitId: atk, source: { kind: 'dump', hex: 'A2.1' }, tokens: 1 }] }))
  r = submit(r, context, defend(defendMore), 'soviet')
  r = submit(r, context, rating(atk))
  return submit(r, context, rating(def), 'soviet')
}

test('a regular attack settles the defender loss, grants an exploit marker and advances (OCS 9.0/9.13b)', () => {
  const { record, context } = start({ atk: unit('axis', 'A2.1', 'atk'), def: unit('soviet', 'A3.1', 'def') })
  let r = toTerrain(record, context)
  r = submit(r, context, terrain(), 'soviet')
  assert.equal(r.state.combat.step, 'attacker-result')
  r = submit(r, context, resolve())                       // 攻方 Ao0 o0：无损失无选项
  assert.equal(r.state.counters.atk.exploiting, true)     // e3，AR3≥3，战斗阶段
  assert.equal(r.state.combat.step, 'defender-result')
  r = submit(r, context, resolve({ lossOrder: ['def'] }), 'soviet')  // 守方 DL1：1 步全毁
  assert.deepEqual(r.state.counters.def.location, { kind: 'dead-pile' })
  assert.equal(r.state.combat.step, 'advance')
  r = submit(r, context, { type: 'advance-campaign-combat', unitIds: ['atk'] })
  assert.deepEqual(r.state.counters.atk.location, { kind: 'map', hex: 'A3.1' })
  assert.equal(r.state.combat, null)
  assert.deepEqual(r.state.combatTargets, ['A3.1'])
})

test('an attacker option becomes a retreat and the defender may ignore its option (OCS 9.10c/9.12)', () => {
  const { record, context } = start({ inf: unit('axis', 'A2.1', 'inf'), def: unit('soviet', 'A3.1', 'def') },
    { table: makeTable('Ao1 DL1o2') })
  let r = toTerrain(record, context, { atk: 'inf' })
  r = submit(r, context, terrain(), 'soviet')
  // 攻方 o1 选撤退 1 格（A2.1→A1.1），不吃损失。
  r = submit(r, context, resolve({ retreats: [{ units: ['inf'], path: ['A1.1'] }] }))
  assert.deepEqual(r.state.counters.inf.location, { kind: 'map', hex: 'A1.1' })
  assert.equal(r.state.combat.defenderMayIgnore, true)
  assert.equal(r.state.combat.attackerRetreated, true)
  // 守方忽略选项，仅吃强制 DL1。
  r = submit(r, context, resolve({ lossOrder: ['def'], ignoreDefenderOption: true }), 'soviet')
  assert.deepEqual(r.state.counters.def.location, { kind: 'dead-pile' })
  assert.equal(r.state.combat, null)                      // 攻方已撤退 ⇒ 不推进
})

test('attack supply costs one token per surviving step or the unit internal stocks (OCS 12.4)', () => {
  const base = { atk: unit('axis', 'A2.1', 'atk'), def: unit('soviet', 'A3.1', 'def') }
  const wrong = start(base)
  assert.throws(() => submit(wrong.record, wrong.context, declare({ payments: [{ unitId: 'atk', source: { kind: 'dump', hex: 'A2.1' }, tokens: 2 }] })),
    /one token per surviving step/)
  const none = start(base)
  assert.throws(() => submit(none.record, none.context, declare({ payments: [] })), /one token per surviving step/)
  const internal = start(base, { dumps: { axis: {}, soviet: { 'A3.1': 2 } } })
  const paid = submit(internal.record, internal.context, declare({ payments: [], internalUnitIds: ['atk'] }))
  assert.equal(paid.state.counters.atk.internalStocks, 'low')
  const obtainable = start(base)
  assert.throws(() => submit(obtainable.record, obtainable.context, declare({ payments: [], internalUnitIds: ['atk'] })),
    /can obtain its required on-map combat supply/)
})

test('defending stack supply is 1T at ≤1 RE and 2T above, or declined (OCS 12.4)', () => {
  const counters = { atk: unit('axis', 'A2.1', 'atk'), def: unit('soviet', 'A3.1', 'def', { currentRe: 2 }) }
  const short = start(counters, { dumps: { axis: { 'A2.1': 2 }, soviet: { 'A3.1': 2 } } })
  let r = submit(short.record, short.context, declare())
  assert.throws(() => submit(r, short.context, defend(), 'soviet'), /full defending stack cost/)
  const full = start(counters, { dumps: { axis: { 'A2.1': 2 }, soviet: { 'A3.1': 2 } } })
  r = submit(full.record, full.context, declare())
  const supplied = submit(r, full.context, defend({ payments: [{ source: { kind: 'dump', hex: 'A3.1' }, tokens: 2 }] }), 'soviet')
  assert.equal(supplied.state.combat.defenseSupplied, true)
  const declined = start(counters)
  r = submit(declined.record, declined.context, declare())
  const unsupplied = submit(r, declined.context, { type: 'defend-campaign-combat', payments: [] }, 'soviet')
  assert.equal(unsupplied.state.combat.defenseSupplied, false)
})

test('rating and terrain steps enforce side and order, and a rejected command changes nothing', () => {
  const { record, context } = start({ atk: unit('axis', 'A2.1', 'atk'), def: unit('soviet', 'A3.1', 'def') })
  const declared = submit(record, context, declare())
  assert.throws(() => submit(declared, context, rating('atk'), 'soviet'), /correct order/)
  const before = declared.revision
  assert.throws(() => submit(declared, context, terrain(), 'soviet'), /defender chooses terrain/)
  assert.equal(declared.revision, before)
  let r = submit(declared, context, defend(), 'soviet')
  assert.throws(() => submit(r, context, terrain(), 'axis'), /defender chooses terrain/)
  r = submit(r, context, rating('atk'))
  r = submit(r, context, rating('def'), 'soviet')
  assert.throws(() => submit(r, context, resolve(), 'soviet'), /other side must resolve/)
})

test('exploitation attacks require release and grant no exploit marker (OCS 9.13b)', () => {
  const counters = { atk: unit('axis', 'A2.1', 'atk'), def: unit('soviet', 'A3.1', 'def') }
  const locked = start(counters, { phase: 'exploitation' })
  assert.throws(() => submit(locked.record, locked.context, declare()), /eligible, unused/)
  const released = start({ atk: { ...counters.atk, exploiting: true }, def: counters.def }, { phase: 'exploitation' })
  let r = toTerrain(released.record, released.context)
  r = submit(r, released.context, terrain(), 'soviet')
  r = submit(r, released.context, resolve())
  assert.equal(r.state.combat.step, 'defender-result')
  // 进击阶段非战斗阶段 ⇒ e3 不另授标记；入场释放标记保持。
  assert.equal(r.state.counters.atk.exploiting, true)
})

test('retreat routes must end the full option distance and avoid enemy-start hexes (OCS 9.12)', () => {
  const counters = { atk: unit('axis', 'A3.1', 'inf'), def: unit('soviet', 'A4.1', 'def') }
  const wrongDistance = start(counters, { dumps: { axis: { 'A3.1': 2 }, soviet: { 'A4.1': 2 } }, table: makeTable('Ao1 DL1') })
  let r = submit(wrongDistance.record, wrongDistance.context, declare({ target: 'A4.1', payments: [{ unitId: 'atk', source: { kind: 'dump', hex: 'A3.1' }, tokens: 1 }] }))
  r = submit(r, wrongDistance.context, { type: 'defend-campaign-combat', payments: [{ source: { kind: 'dump', hex: 'A4.1' }, tokens: 1 }] }, 'soviet')
  r = submit(r, wrongDistance.context, rating('atk'))
  r = submit(r, wrongDistance.context, rating('def'), 'soviet')
  r = submit(r, wrongDistance.context, { type: 'choose-campaign-combat-terrain', terrain: 'Open', attackingTerrain: { 'A3.1': 'Open' } }, 'soviet')
  assert.throws(() => submit(r, wrongDistance.context, resolve({ retreats: [{ units: ['atk'], path: ['A2.1', 'A1.1'] }] })),
    /full option distance/)
  const enemyHex = start({ inf: unit('axis', 'A2.1', 'inf'), def: unit('soviet', 'A3.1', 'def') }, { table: makeTable('Ao1 DL1') })
  let q = toTerrain(enemyHex.record, enemyHex.context, { atk: 'inf' })
  q = submit(q, enemyHex.context, terrain(), 'soviet')
  assert.throws(() => submit(q, enemyHex.context, resolve({ retreats: [{ units: ['inf'], path: ['A3.1'] }] })), /illegal hex/)
})

test('a multi-step defender takes mandatory losses in place (OCS 9.11)', () => {
  const { record, context } = start({ atk: unit('axis', 'A2.1', 'atk'), def: unit('soviet', 'A3.1', 'def', { currentRe: 3 }) },
    { table: makeTable('A DL2') })
  let r = toTerrain(record, context, { defendMore: { payments: [{ source: { kind: 'dump', hex: 'A3.1' }, tokens: 2 }] } })
  r = submit(r, context, terrain(), 'soviet')
  r = submit(r, context, resolve())
  r = submit(r, context, resolve({ lossOrder: ['def', 'def'] }), 'soviet')
  assert.equal(r.state.counters.def.currentRe, 1)
  assert.equal(r.state.counters.def.stepsLost, 2)
  assert.deepEqual(r.state.counters.def.location, { kind: 'map', hex: 'A3.1' })
})

test('an Axis Army HQ forced to retreat is destroyed instead, with free rebuild and VP (§2.3b D/E)', () => {
  const hqStepsOf = (state, id) => { const c = state.counters[id]; return c?.location.kind === 'map' ? (c.currentRe ?? 1) : undefined }
  const lossBoard = { stepsOf: hqStepsOf, reAfterLoss: (s, id, l) => s.counters[id].currentRe - l,
    hqKindOf: (s, id) => s.counters[id].kind === 'hq' ? 'army' : undefined }
  const { record, context } = start({ hq: unit('axis', 'A2.1', 'army-hq', { kind: 'hq' }), def: unit('soviet', 'A3.1', 'def') },
    { table: makeTable('Ao1 DL1o2') })
  context.combat = { ...context.combat,
    losses: { stepsOf: hqStepsOf, reAfterLoss: (s, id, l) => s.counters[id].currentRe - l,
      hqKindOf: (s, id) => s.counters[id].kind === 'hq' ? 'army' : undefined },
    retreatDestroyed: (state, id) => state.counters[id]?.kind === 'hq' && state.counters[id].side === 'axis',
    destroyOnRetreat: (state, ids) => applyCampaignCombatLosses(state, new Map(ids.map((id) => [id, hqStepsOf(state, id)])), lossBoard) }
  let r = toTerrain(record, context, { atk: 'hq' })
  r = submit(r, context, terrain(), 'soviet')
  r = submit(r, context, resolve({ retreats: [] }))
  assert.deepEqual(r.state.counters.hq.location, { kind: 'dead-pile' })
  assert.equal(r.state.sovietVp, ARMY_HQ_DESTROYED_VP)
  assert.equal(r.state.hqRecoveries.length, 1)
  assert.equal(r.state.hqRecoveries[0].kind, 'army')
  assert.equal(r.state.hqRecoveries[0].result, 'free-rebuild')
  assert.equal(r.state.combat.attackerRetreated, true)
})