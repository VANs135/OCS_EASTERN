import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { campaignBarrageBlockers } from '../src/match/campaign-barrage.ts'

const hexes = ['A1.1', 'A2.1', 'A3.1', 'A4.1', 'A5.1', 'A6.1']
const map = {
  resolveHex: (hex) => hexes.includes(hex) ? hex : undefined,
  neighbors(hex) { const index = hexes.indexOf(hex); return index < 0 ? [] : [hexes[index - 1], hexes[index + 1]].filter(Boolean) },
}
const distance = (a, b) => Math.abs(hexes.indexOf(a) - hexes.indexOf(b))
// 列 0 恒为 '1'（1 损失＋DG），列 1 恒为 '-'（无损失），便于断言移位。
const table = { columns: ['1-2', '3-6'], costs: [1, 1], matrix: Array.from({ length: 11 }, () => ['1', '-']) }

const arty = (side, hex, definition = 'arty') => ({ kind: 'land', side, definition, location: { kind: 'map', hex }, currentRe: 1, mode: 'combat' })
const target = (side, hex, props = {}) => ({ kind: 'land', side, definition: 'inf', location: { kind: 'map', hex }, currentRe: 1, mode: 'combat', ...props })

const stepsOf = (state, id) => {
  const counter = state.counters[id]
  return counter?.location.kind === 'map' && (counter.kind === 'land' || counter.kind === 'hq') ? counter.currentRe ?? 1 : undefined
}
const board = {
  map, table, distance,
  profileOf: (state, id) => ({ combat: state.counters[id].kind !== 'transport', attackCapable: true,
    inCombatMode: state.counters[id].mode === 'combat', outOfSupply: false, moveMa: 4, moveMobility: 'leg', drawMobility: 'leg', singleTransportPoint: false }),
  barrageProfile: (state, id) => state.counters[id].definition === 'arty' ? { strength: 2, range: 3, independentRe: false, phaseEligible: true }
    : state.counters[id].definition === 'heavy' ? { strength: 4, range: 3, independentRe: false, phaseEligible: true } : undefined,
  stepsOf,
  printedReOf: (state, id) => state.counters[id].currentRe ?? 1,
  terrainAt: () => ['Open'],
  hedgehogAt: () => 0,
  canUseSupply: (_state, _side, _unitId, key, hqId) => key === 'dump:A1.1' || (hqId === 'hq1' && key === 'dump:A2.1'),
  losses: { stepsOf, reAfterLoss: (state, id, losses) => state.counters[id].currentRe - losses,
    hqKindOf: (state, id) => state.counters[id].hqKind },
}

function start(counters, { phasing = 'axis', dumps = { axis: { 'A1.1': 2 }, soviet: {} }, segment = 'shooting' } = {}) {
  const opened = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 2, counters, supplyDumps: dumps }, 623)
  const record = { ...opened, state: { ...opened.state, weather: { ground: 'dry', flight: 'none' },
    cursor: { phase: 'combat', phasing, first: 'axis' }, lateTurnSegment: segment } }
  const context = { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] },
    barrage: board, lateSegmentEndBlockers: (_state, _actor, seg) => seg === 'shooting' ? campaignBarrageBlockers(_state) : [] }
  return { record, context }
}
const command = (record, action) => ({ id: `barrage:${record.revision}`, expectedRevision: record.revision, action })
const submit = (record, context, action, side = record.state.cursor.phasing) => submitCampaignMatch(record, side, command(record, action), context).record
const declare = (more = {}) => ({ type: 'declare-campaign-barrage', target: 'A3.1', batteries: [{ unitId: 'gun' }],
  supply: { kind: 'direct', payments: [{ source: { kind: 'dump', hex: 'A1.1' }, tokens: 1 }] }, ...more })
const terrain = { type: 'choose-campaign-barrage-terrain', terrain: 'Open' }
const loss = (unitId = 'victim', steps = 1) => ({ type: 'assign-campaign-barrage-loss', allocation: [{ unitId, steps }] })

test('a barrage declares, rolls and settles its mandatory loss into the dead pile (OCS 10.0)', () => {
  const { record, context } = start({ gun: arty('axis', 'A1.1'), victim: target('soviet', 'A3.1') })
  const declared = submit(record, context, declare())
  assert.equal(declared.state.barrage.cost, 1)
  assert.equal(declared.state.supplyDumps.axis['A1.1'], 1)
  assert.throws(() => submit(declared, context, terrain, 'axis'), /targeted player/)
  const rolled = submit(declared, context, terrain, 'soviet')
  assert.equal(rolled.state.barrage.lossesDue, 1)
  assert.equal(rolled.state.counters.victim.disorganized, true)
  assert.equal(rolled.state.rng.drawCount - declared.state.rng.drawCount, 2)
  const settled = submit(rolled, context, loss(), 'soviet')
  assert.deepEqual(settled.state.counters.victim.location, { kind: 'dead-pile' })
  assert.equal(settled.state.barrage, null)
  assert.equal(settled.state.barrageHistory.length, 1)
  assert.equal(settled.state.sovietVp, 0)
})

test('a target hex may be barraged only once per phase and only in the shooting segment (OCS 10.0e)', () => {
  const { record, context } = start({ gun: arty('axis', 'A1.1'), victim: target('soviet', 'A3.1') })
  const settled = submit(submit(submit(record, context, declare()), context, terrain, 'soviet'), context, loss(), 'soviet')
  assert.throws(() => submit(settled, context, declare()), /once per phase/)
  const wrongSegment = start({ gun: arty('axis', 'A1.1'), victim: target('soviet', 'A3.1') }, { segment: 'ground-combat' })
  assert.throws(() => submit(wrongSegment.record, wrongSegment.context, declare()), /shooting segment/)
  const wrongActor = start({ gun: arty('axis', 'A1.1'), victim: target('soviet', 'A3.1') })
  assert.throws(() => submit(wrongActor.record, wrongActor.context, declare(), 'soviet'), /shooting segment/)
})

test('artillery must be in range and the column cost must be paid (OCS 10.0)', () => {
  const far = start({ gun: arty('axis', 'A1.1'), victim: target('soviet', 'A6.1') })
  assert.throws(() => submit(far.record, far.context, declare({ target: 'A6.1' })), /printed range/)
  const poor = start({ gun: arty('axis', 'A1.1'), victim: target('soviet', 'A3.1') }, { dumps: { axis: {}, soviet: {} } })
  assert.throws(() => submit(poor.record, poor.context, declare()), /cannot cover payment/)
  const hq = start({ gun: arty('axis', 'A1.1'), victim: target('soviet', 'A3.1') }, { dumps: { axis: { 'A2.1': 1 }, soviet: {} } })
  const paid = submit(hq.record, hq.context, declare({ supply: { kind: 'hq', hqId: 'hq1', payments: [{ source: { kind: 'dump', hex: 'A2.1' }, tokens: 1 }] } }))
  assert.equal(paid.state.supplyDumps.axis['A2.1'], undefined)
})

test('a missing spotter shifts three columns left (OCS 10.0b)', () => {
  // 强度 4 → 列 1；密度 2 → 移位 0。有观察员留列 1（'-'），无观察员 −3 夹到列 0（'1'）。
  const counters = { gun: arty('axis', 'A1.1', 'heavy'), victim: target('soviet', 'A3.1', { currentRe: 2 }) }
  const spotted = start({ ...counters, spotter: target('axis', 'A2.1') })
  const noSpot = start(counters)
  const spottedRoll = submit(submit(spotted.record, spotted.context, declare()), spotted.context, terrain, 'soviet')
  assert.equal(spottedRoll.state.barrage, null)
  const darkRoll = submit(submit(noSpot.record, noSpot.context, declare()), noSpot.context, terrain, 'soviet')
  assert.equal(darkRoll.state.barrage.lossesDue, 1)
})

test('a multi-step defender takes a step loss in place (OCS 9.11)', () => {
  const { record, context } = start({ gun: arty('axis', 'A1.1'), victim: target('soviet', 'A3.1', { currentRe: 3 }) })
  const rolled = submit(submit(record, context, declare()), context, terrain, 'soviet')
  const settled = submit(rolled, context, loss('victim', 1), 'soviet')
  assert.equal(settled.state.counters.victim.currentRe, 2)
  assert.equal(settled.state.counters.victim.stepsLost, 1)
  assert.deepEqual(settled.state.counters.victim.location, { kind: 'map', hex: 'A3.1' })
})

test('destroyed Axis HQs score Soviet VP and record free rebuild or Corps recovery (TTW 2.3b-d/5.0a)', () => {
  const hq = (kind) => ({ kind: 'hq', side: 'axis', definition: `hq-${kind}`, location: { kind: 'map', hex: 'A3.1' }, currentRe: 1, mode: 'combat', hqKind: kind })
  const army = start({ gun: arty('soviet', 'A1.1'), victim: hq('army') }, { phasing: 'soviet', dumps: { axis: {}, soviet: { 'A1.1': 2 } } })
  const armySettled = submit(submit(submit(army.record, army.context, declare()), army.context, terrain, 'axis'), army.context, loss(), 'axis')
  assert.equal(armySettled.state.sovietVp, 1)
  assert.deepEqual(armySettled.state.hqRecoveries.map(({ kind, result }) => ({ kind, result })), [{ kind: 'army', result: 'free-rebuild' }])
  const group = start({ gun: arty('soviet', 'A1.1'), victim: hq('army-group') }, { phasing: 'soviet', dumps: { axis: {}, soviet: { 'A1.1': 2 } } })
  const groupSettled = submit(submit(submit(group.record, group.context, declare()), group.context, terrain, 'axis'), group.context, loss(), 'axis')
  assert.equal(groupSettled.state.sovietVp, 2)
  const corps = start({ gun: arty('soviet', 'A1.1'), victim: hq('corps') }, { phasing: 'soviet', dumps: { axis: {}, soviet: { 'A1.1': 2 } } })
  const corpsSettled = submit(submit(submit(corps.record, corps.context, declare()), corps.context, terrain, 'axis'), corps.context, loss(), 'axis')
  const recovery = corpsSettled.state.hqRecoveries[0]
  assert.equal(recovery.kind, 'corps')
  assert.ok(recovery.die >= 1 && recovery.die <= 6)
  assert.equal(recovery.result, recovery.die <= 3 ? 'free-rebuild' : 'dead-pile')
  assert.equal(corpsSettled.state.sovietVp, 0)
})

test('barrage loss allocation rejects wrong totals, outsiders and over-capacity (OCS 10.0a)', () => {
  const { record, context } = start({ gun: arty('axis', 'A1.1'), victim: target('soviet', 'A3.1'), outsider: target('soviet', 'A4.1') })
  const rolled = submit(submit(record, context, declare()), context, terrain, 'soviet')
  assert.throws(() => submit(rolled, context, loss('victim', 2), 'soviet'), /mandatory barrage losses/)
  assert.throws(() => submit(rolled, context, loss('outsider', 1), 'soviet'), /target hex/)
  assert.throws(() => submit(rolled, context, { type: 'assign-campaign-barrage-loss', allocation: [] }, 'soviet'), /mandatory barrage losses/)
})

test('a pending barrage blocks the shooting segment end and a rejected command changes nothing', () => {
  const { record, context } = start({ gun: arty('axis', 'A1.1'), victim: target('soviet', 'A3.1') })
  const declared = submit(record, context, declare())
  assert.throws(() => submit(declared, context, { type: 'complete-campaign-late-segment', segment: 'shooting' }), /obligations are outstanding/)
  const before = declared.revision
  assert.throws(() => submit(declared, context, declare()), /once per phase|shooting segment/)
  assert.equal(declared.revision, before)
  const settled = submit(submit(declared, context, terrain, 'soviet'), context, loss(), 'soviet')
  const advanced = submit(settled, context, { type: 'complete-campaign-late-segment', segment: 'shooting' })
  assert.equal(advanced.state.lateTurnSegment, 'ground-combat')
})