import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createRngState } from '@ocs-eastern/series/rng'
import { scorpionMap } from '../src/import/scorpion-map.ts'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'
import { localChoices, localRoster } from '../desktop/local/actions.mjs'
import { localMenu } from '../desktop/local/interaction.mjs'
import { refitBaseAt, refitDraft, refitChoiceLabels, toggleRefitSelection } from '../desktop/local/refit.mjs'

// Acceptance board for 「机场批量整备」. The rules already take a batch; these cases pin that the
// batch charges once, that the once-per-base guard still holds, and that the desktop draft hands
// the rule layer exactly one command for several aircraft.

const pairs = [['s10.01', 's10.02'], ['s10.02', 's10.03'], ['s15.08', 's15.09'], ['s15.09', 's15.10']]
const map = scorpionMap([...new Set(pairs.flat())].map((hex_id) => ({ hex_id, on_map: true, terrains_present: ['Open'] })),
  pairs.map(([hex_a, hex_b]) => ({ hex_a, hex_b, edge_terrain: 'none', road_present: false, rail_present: false, bridge: false })))
const definitions = new Map(Array.from({ length: 8 }, (_, index) => [`counter-${index}`, { source: { name: `飞机 ${index}` } }]))
const assets = { map, catalog: { definitions } }
const board = { supplyRail: { railGauge: () => 'axis' } }

const plane = (id, hex, active, extra = {}) => ({ id, side: 'soviet', kind: 'aircraft', definition: `counter-${extra.index ?? 0}`,
  location: hex === undefined ? { kind: 'off-map-air' } : { kind: 'hex', hex }, active, reduced: false, ...extra })

// An enemy combat unit exerts ZOC on its neighbouring hexes when it is attack-capable and in supply.
const enemy = (hex) => ({ side: 'axis', hex, combat: true, attackCapable: true, printedRe: 1, stepsLost: 0,
  mobility: 'leg', actionRating: 4, strength: 4, combatClass: 'other', antiTank: 0, fueled: false, allowance: 3,
  definition: 'enemy' })

function refitState({ phase = 'aircraft-refit', weather = 'freeze', bases = [{ side: 'soviet', hex: 's10.02', level: 1 }],
  pieces = [], dumps = { 'soviet:hex:s10.01': { side: 'soviet', location: 'on-map', tokens: 10 } }, units = {} } = {}) {
  return { revision: 0, receipts: [], state: { kind: 'playing', units,
    cursor: { turn: 1, first: 'soviet', phasing: 'soviet', phase, retention: 'soviet' },
    turn: { number: 1, weather: { ground: weather, flight: 'none' }, vp: 0, thawSeen: false,
      step: { kind: 'player-turn', first: 'soviet', retention: 'soviet' } },
    rng: createRngState(1), dumps, moved: [], pieces, availableAlerts: [], railControl: {}, rerollHolder: null,
    airBases: bases, combat: null, arrivalsOnMap: [], placedAlerts: [], window: null, refittedAirbases: [],
    combatTargets: [], combatAttackers: [], arrival: { placed: [], mobilized: [], sovietVp: 0 }, victory: null } }
}

const submit = (record, side, action, option = board) => submitScorpionSession(record, side,
  { id: `refit-${record.revision}-${action.unitIds?.join('_') ?? ''}`, expectedRevision: record.revision, action }, assets, option).record

const data = { assets, board }

// ── 验收盘面 1：同一基地两架合法飞机，一次提交只扣 1T，标记同步激活 ───────────────────────────
test('board 1: one submit activates two aircraft at the same base and debits exactly 1T', () => {
  const record = refitState({ pieces: [plane('a', 's10.02', false, { index: 0 }), plane('b', 's10.02', false, { index: 1 }),
    plane('c', 's10.02', true, { index: 2 })] })
  const dumpId = 'soviet:hex:s10.01'
  const before = record.state.dumps[dumpId].tokens
  const action = { type: 'refit-aircraft', base: { kind: 'hex', hex: 's10.02', dumpId }, unitIds: ['a', 'b'] }
  const after = submit(record, 'soviet', action)
  assert.equal(after.state.dumps[dumpId].tokens, before - 1, 'two aircraft in one batch still cost exactly 1T')
  assert.deepEqual(after.state.pieces.filter((piece) => piece.active).map((piece) => piece.id).sort(), ['a', 'b', 'c'])
  assert.deepEqual(after.state.refittedAirbases, ['s10.02'], 'the base is recorded as refitted for this phase')
  assert.equal(after.state.dumps[dumpId].tokens, 9)
})

// ── 验收盘面 2：同阶段再整备该基地受原规则限制 ─────────────────────────────────────────────
test('board 2: the same base cannot refit twice in one phase', () => {
  const record = refitState({ pieces: [plane('a', 's10.02', false, { index: 0 }), plane('b', 's10.02', false, { index: 1 })] })
  const base = { kind: 'hex', hex: 's10.02', dumpId: 'soviet:hex:s10.01' }
  const first = submit(record, 'soviet', { type: 'refit-aircraft', base, unitIds: ['a'] })
  assert.throws(() => submit(first, 'soviet', { type: 'refit-aircraft', base, unitIds: ['b'] }), /already refitted/)
  // Cleaning the marker (as complete-refit and a new phase do) makes the base usable again.
  const reopened = { ...first, state: { ...first.state, refittedAirbases: [] } }
  assert.equal(submit(reopened, 'soviet', { type: 'refit-aircraft', base, unitIds: ['b'] }).state.pieces[1].active, true)
})

// ── 验收盘面 3：解冻减半、容量不足、未抵消敌控制区、图外免费，各验一次 ────────────────────────
test('board 3a: thaw halves the refit rate so a level-1 base takes one aircraft, not two', () => {
  const pieces = [plane('a', 's10.02', false, { index: 0 }), plane('b', 's10.02', false, { index: 1 })]
  const base = { kind: 'hex', hex: 's10.02', dumpId: 'soviet:hex:s10.01' }
  const freeze = refitState({ pieces })
  assert.equal(submit(freeze, 'soviet', { type: 'refit-aircraft', base, unitIds: ['a', 'b'] }).state.pieces.filter((p) => p.active).length, 2,
    'in freeze weather a level-1 base refits its printed rate of 2')
  const thaw = refitState({ pieces, weather: 'thaw' })
  assert.throws(() => submit(thaw, 'soviet', { type: 'refit-aircraft', base, unitIds: ['a', 'b'] }), /capacity/)
  const one = submit(thaw, 'soviet', { type: 'refit-aircraft', base, unitIds: ['a'] })
  assert.equal(one.state.pieces[0].active, true)
  assert.equal(one.state.dumps['soviet:hex:s10.01'].tokens, 9)
})

test('board 3b: an active-stacking ceiling that allows only one more plane is enforced', () => {
  // Level 1 → active capacity 5. Three already active leaves room for two; four leaves room for one.
  const base = { kind: 'hex', hex: 's10.02', dumpId: 'soviet:hex:s10.01' }
  const room = refitState({ pieces: [plane('a', 's10.02', true, { index: 0 }), plane('b', 's10.02', true, { index: 1 }),
    plane('c', 's10.02', true, { index: 2 }), plane('d', 's10.02', false, { index: 3 }), plane('e', 's10.02', false, { index: 4 })] })
  assert.equal(submit(room, 'soviet', { type: 'refit-aircraft', base, unitIds: ['d', 'e'] })
    .state.pieces.filter((piece) => piece.active).length, 5, 'five active is exactly the level-1 ceiling')
  const full = refitState({ pieces: [plane('a', 's10.02', true, { index: 0 }), plane('b', 's10.02', true, { index: 1 }),
    plane('c', 's10.02', true, { index: 2 }), plane('d', 's10.02', true, { index: 3 }), plane('e', 's10.02', false, { index: 4 }),
    plane('f', 's10.02', false, { index: 5 })] })
  assert.throws(() => submit(full, 'soviet', { type: 'refit-aircraft', base, unitIds: ['e', 'f'] }), /capacity/,
    'four active + two selected exceeds the ceiling of five')
  assert.equal(submit(full, 'soviet', { type: 'refit-aircraft', base, unitIds: ['e'] }).state.pieces.filter((piece) => piece.active).length, 5)
})

test('board 3c: an air base in unnegated enemy ZOC cannot refit', () => {
  const record = refitState({ pieces: [plane('a', 's10.02', false, { index: 0 })],
    units: { enemy: enemy('s10.03') } })
  assert.throws(() => submit(record, 'soviet', { type: 'refit-aircraft',
    base: { kind: 'hex', hex: 's10.02', dumpId: 'soviet:hex:s10.01' }, unitIds: ['a'] }), /unnegated enemy ZOC/)
})

test('board 3d: the off-map air box refits for free and never touches a dump', () => {
  const record = refitState({ pieces: [plane('off', undefined, false, { index: 0 }), plane('field', 's10.02', false, { index: 1 })] })
  const after = submit(record, 'soviet', { type: 'refit-aircraft', base: { kind: 'off-map-air' }, unitIds: ['off'] })
  assert.equal(after.state.pieces[0].active, true)
  assert.equal(after.state.pieces[1].active, false, 'only the aircraft named in the batch changes')
  assert.equal(after.state.dumps['soviet:hex:s10.01'].tokens, 10, 'off-map refit charges nothing')
  assert.deepEqual(after.state.refittedAirbases, [], 'the off-map box is not a base and records no once-per-phase marker')
})

// ── 验收盘面 4：关闭窗口后重开，只有一次扣账（幂等） ─────────────────────────────────────────
test('board 4: replaying the same command after a reopen debits once (idempotent)', () => {
  const record = refitState({ pieces: [plane('a', 's10.02', false, { index: 0 }), plane('b', 's10.02', false, { index: 1 })] })
  const command = { id: 'reopen:refit:1', expectedRevision: record.revision, action: { type: 'refit-aircraft',
    base: { kind: 'hex', hex: 's10.02', dumpId: 'soviet:hex:s10.01' }, unitIds: ['a', 'b'] } }
  const first = submitScorpionSession(record, 'soviet', command, assets, board)
  assert.equal(first.record.state.dumps['soviet:hex:s10.01'].tokens, 9)
  // The window is closed and reopened onto the saved record; the client replays the identical command.
  const saved = JSON.parse(JSON.stringify(first.record))
  const replay = submitScorpionSession(saved, 'soviet', command, assets, board)
  assert.equal(replay.duplicate, true, 'the receipt dedupes the replayed command instead of re-applying it')
  assert.equal(replay.record.state.dumps['soviet:hex:s10.01'].tokens, 9, 'a reopen must not debit a second token')
  assert.equal(replay.record.state.pieces.filter((piece) => piece.active).length, 2)
})

// ── 桌面草稿层：面板只列该基地本方非激活飞机，一次确认带整批 unitIds ───────────────────────────
test('the refit draft narrows the panel to that base and hands the rule layer one batch command', () => {
  const record = refitState({ pieces: [plane('a', 's10.02', false, { index: 0 }), plane('b', 's10.02', false, { index: 1 }),
    plane('c', 's10.02', true, { index: 2 }), plane('far', 's10.01', false, { index: 3 }),
    plane('off', undefined, false, { index: 4 }), plane('axis', 's10.02', false, { index: 5, side: 'axis' })] })
  const base = refitBaseAt(record.state, 'soviet', { hex: 's10.02' })
  assert.deepEqual(base, { kind: 'hex', hex: 's10.02' })
  const roster = localRoster(record.state, 'soviet', data, base)
  assert.deepEqual(roster.map(({ id }) => id).sort(), ['a', 'b'],
    'the base-scoped panel lists that base alone, own side, inactive only')

  const draft = refitDraft(record.state, 'soviet', base, ['a', 'b'], data)
  assert.equal(draft.total, '1T')
  assert.equal(draft.limit, 2)
  assert.deepEqual(draft.selected, ['a', 'b'])
  assert.deepEqual(draft.payments.map(({ dumpId }) => dumpId), ['soviet:hex:s10.01'])
  assert.equal(draft.ready, true)
  const labels = refitChoiceLabels(draft)
  assert.equal(labels.length, 1, 'one confirm per payable source')
  assert.match(labels[0].label, /整备 2 架/)
  assert.match(labels[0].label, /支付 1T/)
  assert.deepEqual(labels[0].unitIds, ['a', 'b'], 'the confirm carries the whole batch, not one plane')
  assert.deepEqual(labels[0].base, { kind: 'hex', hex: 's10.02', dumpId: 'soviet:hex:s10.01' })

  const choices = localChoices(record.state, 'soviet', { refitBase: base, unitIds: ['a', 'b'] }, data)
  const refits = choices.filter(({ actions }) => actions[0].type === 'refit-aircraft')
  assert.equal(refits.length, 1)
  assert.deepEqual(refits[0].actions[0].unitIds, ['a', 'b'])
})

test('the draft mirrors the once-per-base guard so the player cannot confirm a refitted base', () => {
  const record = refitState({ pieces: [plane('a', 's10.02', false, { index: 0 })] })
  const base = { kind: 'hex', hex: 's10.02' }
  record.state.refittedAirbases = ['s10.02']
  const draft = refitDraft(record.state, 'soviet', base, ['a'], data)
  assert.equal(draft.fenced, true)
  assert.equal(draft.ready, false)
  assert.deepEqual(refitChoiceLabels(draft), [])
  assert.ok(draft.notes.some((note) => note.includes('只能整备一次')))
})

test('the draft shows the thaw halving and the capacity ceiling as notes before a submit', () => {
  const pieces = [plane('a', 's10.02', false, { index: 0 }), plane('b', 's10.02', false, { index: 1 })]
  const thaw = refitState({ pieces, weather: 'thaw' })
  const draft = refitDraft(thaw.state, 'soviet', { kind: 'hex', hex: 's10.02' }, ['a', 'b'], data)
  assert.equal(draft.limit, 1, 'level-1 base rate 2 is halved to 1 in thaw')
  assert.equal(draft.ready, false)
  assert.ok(draft.notes.some((note) => note.includes('解冻')))
  assert.deepEqual(refitChoiceLabels(draft), [], 'the window offers no confirm the rule layer would reject')

  const crowded = refitState({ pieces: [plane('a', 's10.02', true, { index: 0 }), plane('b', 's10.02', true, { index: 1 }),
    plane('c', 's10.02', true, { index: 2 }), plane('d', 's10.02', true, { index: 3 }),
    plane('e', 's10.02', false, { index: 4 }), plane('f', 's10.02', false, { index: 5 })] })
  const ceiling = refitDraft(crowded.state, 'soviet', { kind: 'hex', hex: 's10.02' }, ['e', 'f'], data)
  assert.equal(ceiling.limit, 1, 'four active of a level-1 ceiling of five leaves room for one')
  assert.equal(ceiling.ready, false)
  assert.ok(ceiling.notes.some((note) => note.includes('激活容量 5')))
})

test('the draft marks an unnegated enemy ZOC and offers no confirm', () => {
  const record = refitState({ pieces: [plane('a', 's10.02', false, { index: 0 })],
    units: { enemy: enemy('s10.03') } })
  const draft = refitDraft(record.state, 'soviet', { kind: 'hex', hex: 's10.02' }, ['a'], data)
  assert.equal(draft.fenced, true)
  assert.equal(draft.ready, false)
  assert.deepEqual(refitChoiceLabels(draft), [])
  assert.ok(draft.notes.some((note) => note.includes('敌控制区')))
})

test('the off-map air box draft is free, charges 0T and needs no payment source', () => {
  const record = refitState({ pieces: [plane('off', undefined, false, { index: 0 }), plane('off2', undefined, false, { index: 1 })] })
  const base = refitBaseAt(record.state, 'soviet', { box: true })
  assert.deepEqual(base, { kind: 'off-map-air' })
  const draft = refitDraft(record.state, 'soviet', base, ['off', 'off2'], data)
  assert.equal(draft.total, '0T')
  assert.deepEqual(draft.payments, [], 'no dump is needed off-map')
  assert.equal(draft.ready, true)
  const labels = refitChoiceLabels(draft)
  assert.equal(labels.length, 1)
  assert.match(labels[0].label, /免费整备 2 架（合计 0T）/)
  assert.deepEqual(labels[0].unitIds, ['off', 'off2'])
})

test('right-clicking the airfield itself offers the batch draft before any aircraft is picked', () => {
  const record = refitState({ pieces: [plane('a', 's10.02', false, { index: 0 }), plane('b', 's10.02', false, { index: 1 })] })
  const hit = { hex: 's10.02', ownIds: ['a', 'b'], labels: {} }
  const menu = localMenu(record.state, 'soviet', { unitIds: ['a', 'b'] }, hit, data,
    (selection) => localChoices(record.state, 'soviet', selection, data))
  const refits = menu.filter(({ actions }) => actions[0].type === 'refit-aircraft')
  assert.equal(refits.length, 1)
  assert.deepEqual(refits[0].actions[0].unitIds, ['a', 'b'])
  assert.equal(refits[0].group, '飞机整备')
})

test('checkbox clicks toggle one plane while a plain click replaces the batch', () => {
  const record = refitState({ pieces: [plane('a', 's10.02', false, { index: 0 }), plane('b', 's10.02', false, { index: 1 }),
    plane('far', 's10.01', false, { index: 2 })] })
  const base = { kind: 'hex', hex: 's10.02' }
  assert.deepEqual(toggleRefitSelection(record.state, 'soviet', base, [], 'a', true), ['a'], 'a checkbox adds one plane')
  assert.deepEqual(toggleRefitSelection(record.state, 'soviet', base, ['a'], 'b', true), ['a', 'b'])
  assert.deepEqual(toggleRefitSelection(record.state, 'soviet', base, ['a', 'b'], 'a', true), ['b'], 'a second checkbox removes it')
  assert.deepEqual(toggleRefitSelection(record.state, 'soviet', base, ['a', 'b'], 'b', false), ['b'], 'a plain map click replaces the batch')
  assert.throws(() => toggleRefitSelection(record.state, 'soviet', base, [], 'far', true), /该基地本方非激活飞机/,
    'a plane parked at another base cannot be drafted into this batch')
})

test('without an opened base the legacy single-aircraft refit still works', () => {
  const record = refitState({ pieces: [plane('a', 's10.02', false, { index: 0 })] })
  const choices = localChoices(record.state, 'soviet', { unitId: 'a' }, data)
  const refits = choices.filter(({ actions }) => actions[0].type === 'refit-aircraft')
  assert.equal(refits.length, 1)
  assert.deepEqual(refits[0].actions[0].unitIds, ['a'], 'the old one-plane path is kept for callers that never open a base')
  assert.match(refits[0].label, /整备选中飞机/)
})
