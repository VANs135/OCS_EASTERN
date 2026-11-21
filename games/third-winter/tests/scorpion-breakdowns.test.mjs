import assert from 'node:assert/strict'
import { mkdtemp, rmdir, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRngState } from '@ocs-eastern/series/rng'
import { localChoices, localDecisionSide } from '../desktop/local/actions.mjs'
import { localCombatReview } from '../desktop/local/combat-review.mjs'
import { openLocalScorpion, projectLocalScorpion } from '../desktop/local/controller.mjs'
import { localMenu, sidebarChoice } from '../desktop/local/interaction.mjs'
import { localScorpionEnvelope, readLocalJson, replaceLocalJson } from '../desktop/local/store.mjs'
import { readScorpionBreakdowns } from '../src/import/scorpion-breakdown-config.ts'
import { deployScorpionGroundCounter } from '../src/import/scorpion-deployment.ts'
import { scorpionMap } from '../src/import/scorpion-map.ts'
import { scorpionBreakdownStock } from '../src/match/scorpion-breakdowns.ts'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'
import { scorpionBreakdownCardViews } from '../src/view/scorpion-breakdown-boxes.ts'
import { scorpionHexLayout } from '../src/view/scorpion-grid-layout.ts'

const origin = 's10.01'
const destination = 's10.02'
const map = scorpionMap([origin, destination].map((hex_id) => ({ hex_id, on_map: true, terrains_present: ['Open'] })),
  [{ hex_a: origin, hex_b: destination, edge_terrain: 'none', road_present: false, rail_present: false, bridge: false }])
const unit = (key, rating, re, side = 'soviet') => ({ key, kind: 'land', source: { name: key, side, re,
  faces: { combat: { maColor: 'white', stats: { attack: 3, artRange: rating, move: 3 } },
    move: { maColor: 'white', stats: { attack: 2, artRange: rating, move: 4 } } } } })
const parent = unit('parent', 3, 3)
const assets = { map, catalog: { definitions: new Map([
  parent, unit('split', 2, 1), unit('high-ar', 4, 1), unit('other-pool', 2, 1), unit('enemy', 2, 1, 'axis'),
].map((definition) => [definition.key, definition])) }, breakdowns: {
  parentPools: new Map([['parent', 'first']]),
  counters: new Map([
    ['split', { pool: 'first', copies: 2 }], ['high-ar', { pool: 'first', copies: 1 }],
    ['enemy', { pool: 'first', copies: 1 }], ['other-pool', { pool: 'other', copies: 1 }],
  ]),
} }

function fixture(fields = {}, patch = {}) {
  return { revision: 0, receipts: [], state: { kind: 'playing',
    cursor: { turn: 1, first: 'soviet', phasing: 'soviet', phase: 'movement', retention: 'soviet' },
    turn: { number: 1, weather: { ground: 'freeze', flight: 'limited' }, vp: 0, thawSeen: false,
      step: { kind: 'player-turn', first: 'soviet', retention: 'soviet' } },
    units: { parent: { ...deployScorpionGroundCounter(parent, origin, 0), ...patch } }, rng: createRngState(1),
    moved: [], pieces: [], availableAlerts: [], railControl: {}, rerollHolder: null, airBases: [], combat: null,
    arrivalsOnMap: [], placedAlerts: [], dumps: {}, window: null, combatTargets: [], combatAttackers: [],
    arrival: { placed: [], mobilized: [], sovietVp: 0 }, victory: null, ...fields,
  } }
}

const action = (fields = {}) => ({ type: 'ground-move', unitId: 'parent', path: [destination],
  breakdownDefinitions: ['split'], ...fields })
const board = { supplyRail: { railGauge: () => 'soviet' }, combat: { table: {} } }
const submit = (record, move, side = 'soviet', local = assets) => submitScorpionSession(record, side,
  { id: `test-${record.revision}`, expectedRevision: record.revision, action: move }, local, board).record

test('the move detaches one step at the starting hex, preserving mode and markers', () => {
  const before = fixture({}, { disorganized: true, outOfSupply: true, internalStocks: 'low' })
  const move = action({ face: 'move' })
  const after = submit(before, move)
  const detached = after.state.units['breakdown:split:1']
  assert.equal(after.state.units.parent.hex, destination)
  assert.equal(after.state.units.parent.stepsLost, 1)
  assert.equal(detached.hex, origin)
  assert.equal(detached.printedRe, 1)
  assert.equal(detached.moveMode, true)
  assert.equal(detached.disorganized, true)
  assert.equal(detached.outOfSupply, true)
  assert.equal(detached.internalStocks, 'low')
  assert.equal(detached.formation, undefined)
  assert.deepEqual(after.state.moved, ['parent'])
  assert.equal(before.state.units.parent.stepsLost, 0)
  assert.ok(submitScorpionSession(after, 'soviet', { id: 'test-0', expectedRevision: 0, action: move }, assets, board).duplicate)
  const next = submit(after, { type: 'ground-move', unitId: 'breakdown:split:1', path: [destination] })
  assert.equal(next.state.units['breakdown:split:1'].hex, destination)
})

test('pool, eligible parent, rating, remaining steps and pre-move window are enforced', () => {
  assert.throws(() => submit(fixture(), action(), 'soviet', { ...assets, breakdowns: undefined }), /No breakdown pools/)
  for (const definition of ['other-pool', 'enemy']) {
    assert.throws(() => submit(fixture(), action({ breakdownDefinitions: [definition] })), /parent unit’s pool/)
  }
  assert.throws(() => submit(fixture(), action({ breakdownDefinitions: ['high-ar'] })), /action rating/)
  for (const before of [fixture({}, { stepsLost: 2 }), fixture({}, { combatClass: 'mech' }), fixture({ moved: ['parent'] })]) {
    assert.throws(() => submit(before, action()), /before it starts moving/)
  }
  assert.throws(() => submit(fixture(), action(), 'axis'), /before it starts moving/)
})

test('physical limits count boxed copies, and a rejected path or stock request leaves the board unchanged', () => {
  const before = fixture({ pieces: [{ id: 'breakdown:split:1', kind: 'ground', side: 'soviet', definition: 'split',
    location: { kind: 'dead-pile' } }] })
  assert.throws(() => submit(before, action({ breakdownDefinitions: ['split', 'split'] })), /No copy/)
  assert.throws(() => submit(before, action({ path: ['s10.05'] })), /route|hex|adjacent/i)
  assert.deepEqual(Object.keys(before.state.units), ['parent'])
  assert.equal(before.state.units.parent.stepsLost, 0)
  const after = submit(before, action())
  assert.equal(after.state.units['breakdown:split:2'].hex, origin)
  assert.equal(after.state.pieces[0].id, 'breakdown:split:1')
})

const order = { parentId: 'parent', definitions: ['split'] }
const atCombat = (combat, patch) => {
  const record = fixture({ combat }, patch)
  return { ...record, state: { ...record.state, cursor: { ...record.state.cursor, phase: 'combat' } } }
}

async function syntheticDesktop(t, record) {
  const folder = await mkdtemp(join(tmpdir(), 'ocs-breakdowns-'))
  const file = join(folder, 'match.json')
  const definitions = new Map([...assets.catalog.definitions].map(([id, definition]) => [id, { ...definition,
    source: { ...definition.source, faces: Object.fromEntries(Object.entries(definition.source.faces)
      .map(([mode, face]) => [mode, { ...face, asset: 'synthetic.png' }])) } }]))
  const aliases = new Map(['Turn', 'Ground', 'Flight', 'Soviet VPs Tracker', '1st Ukr Arty Ready', '2nd Ukr Arty Ready']
    .map((name) => [name, [{ kind: 'marker', source: { name,
      faces: { combat: { asset: 'synthetic.png' }, move: { asset: 'synthetic.png' } } } }]]))
  const local = { ...assets, catalog: { definitions, aliases } }
  const fingerprint = 'synthetic-breakdowns'
  let client
  t.after(async () => {
    await client?.close()
    await unlink(file).catch((error) => { if (error.code !== 'ENOENT') throw error })
    await rmdir(folder)
  })
  await replaceLocalJson(file, localScorpionEnvelope(record, fingerprint))
  client = await openLocalScorpion({ assets: local, board, fingerprint,
    breakdownBoxes: new Map([['split', { x: 12, y: 18, w: 48, h: 40 }]]) }, file)
  const dispatch = (request) => client.dispatch({ revision: client.view().revision, ...request })
  const choose = (predicate, rows = client.view().actions) => {
    const choice = rows.find(predicate)
    assert.ok(choice, 'expected a desktop action')
    return dispatch({ kind: 'apply', key: choice.key })
  }
  return { view: client.view, dispatch, choose, saved: async () => (await readLocalJson(file)).record }
}

test('desktop movement adds and removes several breakdown counters before a single confirmed move', async (t) => {
  const client = await syntheticDesktop(t, fixture())
  const point = scorpionHexLayout(destination)
  const stock = () => client.view().breakdownStock.find(({ definition }) => definition === 'split').availableIds
  const add = (row) => row.label.startsWith('加一枚')
  await client.dispatch({ kind: 'select-unit', unitId: 'parent' })
  await client.dispatch({ kind: 'board-left', ...point })
  const context = await client.dispatch({ kind: 'board-menu', ...point })
  await client.choose(({ group }) => group === '拆分', context.menu)
  const opened = client.view()
  assert.match(opened.breakdownPrompt, /已选 0/)
  await client.choose(add)
  await client.choose(add)
  assert.match(client.view().breakdownPrompt, /已选 2/)
  assert.equal(client.view().actions.some(add), false)
  assert.equal(stock().length, 2)
  await client.dispatch({ kind: 'board-left', ...point, confirm: true })
  assert.equal((await client.saved()).revision, 0)
  await client.choose(({ label }) => label.startsWith('减一枚'))
  assert.match(client.view().breakdownPrompt, /已选 1/)
  await client.choose(({ label }) => label === '取消拆分选择')
  assert.equal(client.view().breakdownPrompt, undefined)
  assert.deepEqual(client.view().route, [destination])
  assert.equal((await client.saved()).revision, 0)

  const again = await client.dispatch({ kind: 'board-menu', ...point })
  await client.choose(({ group }) => group === '拆分', again.menu)
  await client.choose(add)
  await client.choose(add)
  const pending = projectLocalScorpion(client.view()).actions
  assert.ok(pending.some(({ actionTypes }) => actionTypes.includes('ground-move')))
  await client.choose(({ label }) => label.startsWith('确认 2 枚拆分'))
  const after = await client.saved()
  assert.equal(after.revision, 1)
  assert.deepEqual(after.receipts[0].action.breakdownDefinitions, ['split', 'split'])
  assert.equal(after.state.units.parent.stepsLost, 2)
  assert.equal(after.state.units.parent.hex, destination)
  assert.equal(after.state.units['breakdown:split:1'].hex, origin)
  assert.equal(after.state.units['breakdown:split:2'].hex, origin)
  assert.deepEqual(stock(), [])
})

test('desktop advance can allocate one shared pool to several advancing parents in the same command', async (t) => {
  const original = atCombat({ kind: 'regular', attacker: 'soviet', attackers: ['parent', 'second'], step: 'advance', target: destination })
  const record = { ...original, state: { ...original.state, units: { ...original.state.units, second: original.state.units.parent } } }
  const client = await syntheticDesktop(t, record)
  await client.choose(({ breakdownDraft }) => breakdownDraft?.action.unitIds.length === 2)
  await client.choose(({ label }) => label.startsWith('加一枚 · parent #1'))
  await client.choose(({ label }) => label.startsWith('加一枚 · parent #2'))
  assert.equal(client.view().actions.some(({ label }) => label.startsWith('加一枚')), false)
  assert.equal((await client.saved()).revision, 0)
  await client.choose(({ label }) => label.startsWith('确认 2 枚拆分'))
  const after = await client.saved()
  assert.equal(after.revision, 1)
  assert.deepEqual(after.receipts[0].action.breakdowns, [order, { parentId: 'second', definitions: ['split'] }])
  assert.ok(Object.values(after.state.units).every(({ hex }) => hex === destination))
  assert.equal(after.state.units.parent.stepsLost, 1)
  assert.equal(after.state.units.second.stepsLost, 1)
})

test('selected surviving attackers can split at the start of a regular combat advance', () => {
  const record = atCombat({ attacker: 'soviet', attackers: ['parent'], step: 'advance', target: destination })
  const advance = { type: 'advance-after-combat', unitIds: ['parent'], breakdowns: [order] }
  assert.throws(() => submit(record, advance, 'axis'), /responding side/)
  assert.throws(() => submit(record, { ...advance, unitIds: [] }), /distinct eligible/)
  const { state } = submit(record, advance)
  assert.equal(state.units.parent.stepsLost, 1)
  assert.equal(state.units.parent.hex, destination)
  assert.equal(state.units['breakdown:split:1'].hex, destination)
  assert.equal(state.combat, null)
})

test('the selected route keeps its ordinary move, with breakdowns offered in the right-click menu', () => {
  const record = fixture()
  const data = { assets, board }
  const picked = { unitId: 'parent', unitIds: ['parent'], hex: destination, route: [destination] }
  const choices = localChoices(record.state, 'soviet', picked, data)
  const ordinary = choices.find((row) => row.actions[0].type === 'ground-move')
  assert.ok(sidebarChoice(ordinary))
  assert.equal(ordinary.actions[0].breakdownDefinitions, undefined)
  const rows = localMenu(record.state, 'soviet', picked, { hex: destination, ownIds: [], labels: {} }, data,
    (next) => localChoices(record.state, 'soviet', next, data))
  const split = rows.find(({ group }) => group === '拆分')
  assert.deepEqual(split.actions, [])
  assert.deepEqual(split.probeActions, [action()])
  assert.equal(sidebarChoice(split), false)
})

test('regular advance and a completed retreat draft offer breakdown commands through their existing windows', () => {
  const advance = atCombat({ attacker: 'soviet', attackers: ['parent'], step: 'advance', target: destination })
  const rows = localChoices(advance.state, 'soviet', {}, { assets })
  assert.ok(rows.some(({ actions }) => actions[0]?.type === 'advance-after-combat' && !actions[0].unitIds.length))
  const advanceSplit = rows.find(({ breakdownDraft }) => breakdownDraft).probeActions[0]
  assert.deepEqual(advanceSplit.breakdowns, [order])
  assert.equal(submit(advance, advanceSplit).state.units.parent.hex, destination)

  const retreat = atCombat({ attacker: 'axis', attackers: [], defenders: ['parent'], defenderLeader: 'parent', target: origin,
    step: 'defender-result', heldAtStart: { axis: [], soviet: [] }, roll: { defender: { loss: 1, option: 1 } } })
  const review = (draft) => localCombatReview(retreat.state, 'soviet', draft, assets, (command) => submit(retreat, command))
  const draft = { mode: { optionLosses: 0, ignoreDefenderOption: false }, lossOrder: ['parent'], paths: { [origin]: [destination] } }
  const option = review(draft).choices.find(({ label }) => label.includes('撤退前拆出'))
  const revised = review(option.reviewDraft)
  assert.equal(revised.choices.filter(({ label }) => label.includes('撤退前拆出')).length, 0) // Only one step remains above the last step.
  assert.ok(revised.choices.some(({ label }) => label.includes('撤销 parent 的拆分')))
  const command = revised.choices.find(({ label }) => label === '确认战果').actions[0]
  assert.deepEqual(command.retreats[0].breakdowns, [order])
  assert.equal(submit(retreat, command).state.units['breakdown:split:1'].hex, destination)
})

test('configured auxiliary stock shows the same physical identity before deployment and after absorption', () => {
  const split = unit('split', 3, 1)
  split.source.faces.combat.asset = 'synthetic.png'
  const catalog = { definitions: new Map([...assets.catalog.definitions, ['split', split]]) }
  const input = { parents: [{ definition: 'parent', pool: 'first' }],
    counters: [{ definition: 'split', pool: 'first', copies: 1, box: { x: 12, y: 18, w: 48, h: 40 } }] }
  const parsed = readScorpionBreakdowns(input, catalog.definitions)
  const local = { ...assets, catalog, breakdowns: parsed.rules }
  const stock = (state) => scorpionBreakdownStock(state, local)
  const card = (state) => scorpionBreakdownCardViews(stock(state), catalog, parsed.boxes)['soviet-breakdowns']
  const start = fixture()
  const id = 'breakdown:split:1'
  assert.deepEqual(card(start.state).counters.map(({ id, x, y }) => ({ id, x, y })), [{ id, x: 36, y: 38 }])
  const detached = submit(start, action(), 'soviet', local)
  assert.equal(detached.state.units[id].hex, origin)
  assert.equal(stock(detached.state)[0].inUse, 1)
  assert.deepEqual(card(detached.state).counters, [])
  assert.equal(card(detached.state).captions[0].text, '0/1')
  const invited = submit(detached, { type: 'ground-move', unitId: id, path: [destination] }, 'soviet', local)
  const combat = { ...invited, state: { ...invited.state, cursor: { ...invited.state.cursor, phase: 'combat' } } }
  const pending = submit(combat, { type: 'complete-combat' }, 'soviet', local)
  const absorbed = submit(pending, { type: 'absorb-breakdown', parentId: 'parent', breakdownId: id }, 'soviet', local)
  assert.equal(absorbed.state.units[id], undefined)
  assert.equal(card(absorbed.state).counters[0].id, id)

  const original = atCombat(null, { stepsLost: 1 })
  const setupId = 'setup:split:existing'
  const preplaced = { ...original, state: { ...original.state,
    units: { ...original.state.units, [setupId]: deployScorpionGroundCounter(split, origin, 0) } } }
  assert.deepEqual(card(preplaced.state).counters, [])
  const ready = submit(preplaced, { type: 'complete-combat' }, 'soviet', local)
  const returned = submit(ready, { type: 'absorb-breakdown', parentId: 'parent', breakdownId: setupId }, 'soviet', local)
  assert.equal(card(returned.state).counters[0].id, setupId)
  const nextMove = { ...returned, state: { ...returned.state, cursor: { ...returned.state.cursor, phase: 'movement' } } }
  assert.equal(submit(nextMove, action(), 'soviet', local).state.units[setupId].hex, origin)
  assert.throws(() => readScorpionBreakdowns({ ...input, counters: [...input.counters, ...input.counters] }, catalog.definitions), /counter 2/)
  assert.throws(() => readScorpionBreakdowns({ ...input, parents: [{ definition: 'parent', pool: 'other' }] }, catalog.definitions), /parent 1/)
})

function overrunBeforeDefenderResult(defenderSteps = 1) {
  const defense = deployScorpionGroundCounter(unit('defense', 2, defenderSteps, 'axis'), destination, 0)
  const escort = deployScorpionGroundCounter(assets.catalog.definitions.get('split'), origin, 0)
  const record = fixture({ combat: { kind: 'overrun', attacker: 'soviet', attackers: ['parent', 'escort'], defenders: ['defense'],
    defenderLeader: 'defense', target: destination, step: 'defender-result', roll: { defender: { loss: 1, option: 0 } } },
  overrunMarch: { remaining: { parent: 2, escort: 1 }, enteredHex: false }, moved: ['parent', 'escort'] })
  return { ...record, state: { ...record.state, units: { ...record.state.units, escort, defense } } }
}

const defendOverrunLoss = { type: 'resolve-combat', lossOrder: ['defense'], optionLosses: 0, retreats: [] }

test('a cleared overrun hex opens the attacker’s breakdown choice while all survivors must enter', () => {
  const pending = submit(overrunBeforeDefenderResult(), defendOverrunLoss, 'axis')
  assert.equal(pending.state.combat.step, 'advance')
  assert.equal(localDecisionSide(pending.state), 'soviet')
  assert.equal(pending.state.units.parent.hex, origin)
  assert.equal(pending.state.overrunMarch.enteredHex, false)
  const complete = { type: 'advance-after-combat', unitIds: ['parent', 'escort'] }
  const split = { ...complete, breakdowns: [order] }
  const [automatic, draft] = localChoices(pending.state, 'soviet', {}, { assets })
  assert.deepEqual(automatic.actions, [complete])
  assert.deepEqual(draft.probeActions, [split])
  assert.throws(() => submit(pending, { ...complete, unitIds: ['parent'] }), /must advance/)
  assert.throws(() => submit(pending, split, 'axis'), /responding side/)
  assert.throws(() => submit(pending, { ...split, breakdowns: [{ ...order, definitions: ['high-ar'] }] }), /action rating/)

  const { state } = submit(pending, split)
  assert.equal(state.units.parent.stepsLost, 1)
  assert.equal(state.units.parent.hex, destination)
  assert.equal(state.units.escort.hex, destination)
  assert.equal(state.units['breakdown:split:1'].hex, origin)
  assert.deepEqual(state.moved, ['parent', 'escort'])
  assert.deepEqual(state.overrunMarch, { remaining: { parent: 2, escort: 1 }, enteredHex: true })
  assert.equal(state.combat, null)
  assert.deepEqual(submit(pending, complete).state.overrunMarch, state.overrunMarch)
})

test('an uncleared target and stock exhaustion do not open an overrun breakdown reply', () => {
  const held = submit(overrunBeforeDefenderResult(2), defendOverrunLoss, 'axis').state
  assert.equal(held.combat, null)
  assert.equal(held.units.parent.hex, origin)
  assert.equal(held.overrunMarch.enteredHex, false)

  const counters = new Map(assets.breakdowns.counters)
  counters.set('split', { pool: 'first', copies: 1 }) // The on-map escort uses the only copy.
  const exhausted = { ...assets, breakdowns: { ...assets.breakdowns, counters } }
  const automatic = submit(overrunBeforeDefenderResult(), defendOverrunLoss, 'axis', exhausted).state
  assert.equal(automatic.combat, null)
  assert.equal(automatic.units.parent.hex, destination)
  assert.equal(automatic.units.escort.hex, destination)
  assert.equal(automatic.units['breakdown:split:1'], undefined)
})

test('retreat splitting uses surviving steps and the detached counter follows the validated stack', () => {
  const record = atCombat({ attacker: 'axis', attackers: [], defenders: ['parent'], defenderLeader: 'parent', target: origin,
    step: 'defender-result', heldAtStart: { axis: [], soviet: [] }, roll: { defender: { loss: 1, option: 1 } } })
  const result = { type: 'resolve-combat', lossOrder: ['parent'], optionLosses: 0,
    retreats: [{ units: ['parent'], path: [destination], breakdowns: [order] }] }
  assert.throws(() => submit(record, { ...result, retreats: [{ ...result.retreats[0], path: ['s10.05'] }] }), /Retreat/)
  assert.equal(record.state.units.parent.stepsLost, 0)
  const { state } = submit(record, result)
  assert.equal(state.units.parent.stepsLost, 2)
  assert.equal(state.units.parent.hex, destination)
  assert.equal(state.units['breakdown:split:1'].hex, destination)
  assert.equal(state.combat, null)
})

test('resuming an interrupted retreat keeps its detached counter without spending another parent step', () => {
  const endpoint = 's10.03'
  const localMap = scorpionMap([origin, destination, endpoint].map((hex_id) => ({ hex_id, on_map: true, terrains_present: ['Open'] })),
    [[origin, destination], [destination, endpoint]].map(([hex_a, hex_b]) =>
      ({ hex_a, hex_b, edge_terrain: 'none', road_present: false, rail_present: false, bridge: false })))
  const fighter = { kind: 'aircraft', source: { side: 'axis', name: 'Fighter',
    faces: { combat: { stats: { range: 10 } }, move: { stats: { range: 5 } } } } }
  const local = { ...assets, map: localMap, catalog: { definitions: new Map([...assets.catalog.definitions, ['fighter', fighter]]) } }
  const original = atCombat({ attacker: 'axis', attackers: [], defenders: ['parent'], defenderLeader: 'parent', target: origin,
    step: 'defender-result', heldAtStart: { axis: [], soviet: [] }, roll: { defender: { loss: 0, option: 2 } } })
  const before = { ...original, state: { ...original.state, airBases: [{ side: 'axis', hex: destination, level: 1 }],
    pieces: [{ id: 'fig', kind: 'aircraft', definition: 'fighter', side: 'axis', active: true,
      location: { kind: 'hex', hex: destination } }] } }
  const issue = (record, side, action) => submitScorpionSession(record, side,
    { id: `retreat-${record.revision}`, expectedRevision: record.revision, action }, local, { ...board, captureResolution: 'manual' }).record
  const paused = issue(before, 'soviet', { type: 'resolve-combat', lossOrder: [], optionLosses: 0,
    retreats: [{ units: ['parent'], path: [destination, endpoint], breakdowns: [order] }] })
  assert.deepEqual(paused.state.combat.retreat.routes[0].units, ['parent', 'breakdown:split:1'])
  const displaced = issue(paused, 'axis', { type: 'settle-capture', aircraft: [{ id: 'fig', destination: { kind: 'off-map-air' } }] })
  const { state } = issue(displaced, 'soviet', { type: 'continue-combat-retreat' })
  assert.equal(state.units.parent.stepsLost, 1)
  assert.equal(state.units.parent.hex, endpoint)
  assert.equal(state.units['breakdown:split:1'].hex, endpoint)
  assert.equal(state.units['breakdown:split:2'], undefined)
})

test('phase completion requires the owning side to choose an eligible absorption before resuming', () => {
  const original = atCombat(null, { stepsLost: 1, internalStocks: 'low' })
  const placed = (id, extra = {}) => ({ ...deployScorpionGroundCounter(assets.catalog.definitions.get(id), origin, 0), ...extra })
  const before = { ...original, state: { ...original.state, units: { ...original.state.units,
    another: { ...original.state.units.parent },
    lowRating: placed('split', { internalStocks: 'low' }),
    wrongMode: placed('high-ar', { moveMode: true, internalStocks: 'low' }),
    wrongStock: placed('high-ar'),
    eligible: placed('high-ar', { internalStocks: 'low' }),
  } } }
  const finish = { type: 'complete-combat' }
  const choose = { type: 'absorb-breakdown', parentId: 'another', breakdownId: 'eligible' }
  assert.throws(() => submit(before, choose), /at the end of the phase/)
  assert.throws(() => submit(before, finish, 'axis'), /This side cannot complete/)
  const pending = submit(before, finish)
  assert.equal(pending.state.cursor.phase, 'combat')
  assert.equal(localDecisionSide(pending.state), 'soviet')
  assert.deepEqual(localChoices(pending.state, 'soviet', {}, { assets }).map(({ actions }) => actions[0]), [
    { ...choose, parentId: 'parent' }, choose,
  ])
  assert.throws(() => submit(pending, choose, 'axis'), /owning side/)
  assert.throws(() => submit(pending, { ...choose, breakdownId: 'lowRating' }), /eligible breakdown/)
  assert.throws(() => submit(pending, finish), /mandatory breakdown/)
  const { state } = submit(pending, choose)
  assert.equal(state.cursor.phase, 'exploitation')
  assert.equal(state.phaseClose, undefined)
  assert.equal(state.units.another.stepsLost, 0)
  assert.equal(state.units.parent.stepsLost, 1)
  assert.equal(state.units.eligible, undefined)
})

test('the non-phasing side can owe absorption during the phasing side’s phase completion', () => {
  const original = atCombat(null)
  const axisParent = unit('axis-parent', 2, 3, 'axis')
  const counters = { axisParent: deployScorpionGroundCounter(axisParent, destination, 1),
    axisBreakdown: deployScorpionGroundCounter(assets.catalog.definitions.get('enemy'), destination, 0) }
  const local = { ...assets, breakdowns: { ...assets.breakdowns,
    parentPools: new Map([...assets.breakdowns.parentPools, ['axis-parent', 'first']]) } }
  const pending = submit({ ...original, state: { ...original.state, units: { ...original.state.units, ...counters } } },
    { type: 'complete-combat' }, 'soviet', local)
  assert.equal(localDecisionSide(pending.state), 'axis')
  const { state } = submit(pending, { type: 'absorb-breakdown', parentId: 'axisParent', breakdownId: 'axisBreakdown' }, 'axis', local)
  assert.equal(state.units.axisParent.stepsLost, 0)
  assert.equal(state.cursor.phasing, 'soviet')
  assert.equal(state.cursor.phase, 'exploitation')
})

test('the first Simulcast handoff leaves the absorption decision for the shared phase’s end', () => {
  const original = fixture({}, { stepsLost: 1 })
  const before = { ...original, state: { ...original.state,
    cursor: { ...original.state.cursor, simulcast: true },
    turn: { ...original.state.turn, weather: { ground: 'thaw', flight: 'limited' } },
    units: { ...original.state.units, detached: deployScorpionGroundCounter(assets.catalog.definitions.get('high-ar'), origin, 0) },
  } }
  const finish = { type: 'complete-movement' }
  const handedOff = submit(before, finish)
  assert.equal(handedOff.state.cursor.phase, 'movement')
  assert.equal(handedOff.state.cursor.phasing, 'axis')
  assert.equal(handedOff.state.phaseClose, undefined)
  const pending = submit(handedOff, finish, 'axis')
  assert.equal(pending.state.cursor.phase, 'movement')
  assert.equal(pending.state.phaseClose.actor, 'soviet')
  const { state } = submit(pending, { type: 'absorb-breakdown', parentId: 'parent', breakdownId: 'detached' })
  assert.equal(state.cursor.phase, 'supply')
  assert.equal(state.units.parent.stepsLost, 0)
})
