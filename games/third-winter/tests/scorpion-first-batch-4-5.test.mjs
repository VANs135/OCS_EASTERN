import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createRngState } from '@ocs-eastern/series/rng'
import { scorpionMap } from '../src/import/scorpion-map.ts'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'
import { remainingSteps } from '../src/match/scorpion-losses.ts'
import { retreatScorpionCombat } from '../src/match/scorpion-retreat.ts'
import { retreatStacks, stackKey } from '../desktop/local/combat-review.mjs'
import { airBaseOf, baseGroup, groupedAircraft, sameAirBase } from '../desktop/local/air-group.mjs'
import { localScorpionEnvelope, restoreLocalScorpion } from '../desktop/local/store.mjs'

// Acceptance boards for 第一批第 4、5 项 of 2026-11-19 后续开发方案.
// 第 4 项：撤退自选组 / 编内卡车随撤 —— 每枚幸存参战单位正确归组，卡车只按适用规则随撤；
//          分路线、敌控制区追加步损、撤退中自动夺取、路线余程。
// 第 5 项：空军按基地编组与混装 —— 多机任务、地图外与地图内转场、单位与补给混装、
//          受损后按剩余运力选货、关闭窗口再打开恢复待答步骤。

const pairs = [['s10.01', 's10.02'], ['s10.02', 's10.03'], ['s10.03', 's10.04'], ['s15.08', 's15.09'], ['s15.09', 's15.10']]
const map = scorpionMap([...new Set(pairs.flat())].map((hexId) => ({ hex_id: hexId, on_map: true, terrains_present: ['Open'] })),
  pairs.map(([hexA, hexB]) => ({ hex_a: hexA, hex_b: hexB, edge_terrain: 'none', road_present: false, rail_present: false, bridge: false })))
// s9.02 sits in the ZOC of an enemy at s9.03 and is a legal retreat step off s10.02.
const zocMap = scorpionMap([...new Set([...pairs.flat(), 's9.02', 's9.03', 's11.02'])].map((hexId) => ({ hex_id: hexId, on_map: true,
  terrains_present: ['Open'] })), [...pairs, ['s10.02', 's9.02'], ['s9.03', 's9.02'], ['s10.02', 's11.02']]
  .map(([hexA, hexB]) => ({ hex_a: hexA, hex_b: hexB, edge_terrain: 'none', road_present: false, rail_present: false, bridge: false })))

const face = { stats: { range: 4, airCombat: 4, bombing: 4, transport: 1 } }
// The air boards fly transport-2 airframes, so a two-aircraft group pools 4 capacity for mixed cargo.
const airFace = { stats: { range: 6, airCombat: 4, bombing: 2, transport: 2 } }
const cargoFace = { maColor: 'white', stats: { move: 4, attack: 2, artRange: 0 } }
const definitions = new Map(Array.from({ length: 8 }, (_, index) => [`counter-${index}`,
  { source: { name: `算子 ${index}`, faces: { combat: face, move: face } } }]))
definitions.set('air-0', { kind: 'aircraft', source: { name: '运输机 0', side: 'soviet', org: { airGroup: '5th Air Army' },
  abilities: ['barrage'], faces: { combat: airFace, move: airFace } } })
definitions.set('air-1', { kind: 'aircraft', source: { name: '运输机 1', side: 'soviet', org: { airGroup: '5th Air Army' },
  abilities: ['barrage'], faces: { combat: airFace, move: airFace } } })
definitions.set('cargo-0', { kind: 'land', source: { name: '货部队 0', side: 'soviet',
  faces: { combat: cargoFace, move: cargoFace } } })
const assets = { map, catalog: { definitions, aliases: new Map() } }
const zocAssets = { map: zocMap, catalog: { definitions, aliases: new Map() } }
const columns = ['1:5', '1:4', '1:3', '1:2', '1:1', '2:1', '3:1', '4:1', '5:1', '7:1', '9:1', '11:1', '13:1']
const combatTable = () => ({ diceRows: ['1 or less', '2-14', '15 or more'], terrainColumns: { Open: columns, Close: columns },
  matrix: Array.from({ length: 3 }, () => [...columns, ...columns].map(() => 'Ae4 DL1o1')) })
const board = { supplyRail: { railGauge: () => 'axis' }, combat: { table: combatTable() } }
// The same board with no defender step loss, so the only thing left to resolve is the retreat option.
const combatTableOption = () => ({ diceRows: ['1 or less', '2-14', '15 or more'], terrainColumns: { Open: columns, Close: columns },
  matrix: Array.from({ length: 3 }, () => [...columns, ...columns].map(() => 'Ae4 Do1')) })
const optionBoard = { supplyRail: { railGauge: () => 'axis' }, combat: { table: combatTableOption() } }
const data = { assets, board }

const unit = (side, hex, extra = {}) => ({ side, hex, printedRe: 1, stepsLost: 0, actionRating: 4, strength: 4,
  combatClass: 'other', antiTank: 0, attackCapable: true, fueled: false, combat: true, mobility: 'leg', allowance: 3,
  definition: `counter-${extra.index ?? 0}`, ...extra })

function playing(units, extra = {}) {
  return { revision: 0, receipts: [], state: { kind: 'playing', units,
    cursor: { turn: 1, first: 'soviet', phasing: 'soviet', phase: 'combat', retention: 'soviet' },
    turn: { number: 1, weather: { ground: 'freeze', flight: 'normal' }, vp: 0, thawSeen: false,
      step: { kind: 'player-turn', first: 'soviet', retention: 'soviet' } },
    rng: createRngState(1), dumps: { 'soviet:hex:s10.01': { side: 'soviet', location: 'on-map', tokens: 10 } },
    moved: [], pieces: [], availableAlerts: [], railControl: {}, rerollHolder: null, airBases: [],
    combat: null, arrivalsOnMap: [], placedAlerts: [], window: null, combatTargets: [], combatAttackers: [],
    arrival: { placed: [], mobilized: [], sovietVp: 0 }, victory: null, ...extra } }
}

const submit = (record, side, action, option = board, local = assets) => submitScorpionSession(record, side,
  { id: `board-${record.revision}-${action.type}`, expectedRevision: record.revision, action }, local, option).record

// A combat already rolled to the attacker's result, so the defender's resolve-combat is the next command.
function defenderResult(units, option = board) {
  let record = playing(units)
  record = submit(record, 'soviet', { type: 'declare-combat', target: 's10.02', attackers: ['a'],
    payments: [{ unitId: 'a', dumpId: 'soviet:hex:s10.01', tokens: 1 }] }, option)
  record = submit(record, 'axis', { type: 'defend-combat', payments: [] }, option)
  record = submit(record, 'soviet', { type: 'select-combat-rating', unitId: 'a' }, option)
  record = submit(record, 'axis', { type: 'select-combat-rating', unitId: 'd' }, option)
  record = submit(record, 'axis', { type: 'choose-combat-terrain', terrain: 'Open', attackingTerrain: { 's10.01': 'Open' } }, option)
  return submit(record, 'soviet', { type: 'resolve-combat', lossOrder: [], optionLosses: 0, retreats: [] }, option)
}

// ── 第 4 项 · 验收盘面 1：同一出发格拆成两组，各走各的路线 ────────────────────────────────
test('board 4-1: two stacks leaving one origin retreat on separate routes', () => {
  const record = playing({ a: unit('soviet', 's10.02', { index: 1 }), b: unit('soviet', 's10.02', { index: 2 }),
    enemy: unit('axis', 's10.01', { index: 3 }) })
  const stacks = retreatStacks(record.state, 'soviet', ['a', 'b'], undefined)
  assert.equal(stacks.length, 1, 'an un-split origin is one stack')
  assert.equal(stacks[0].key, 's10.02', 'the only stack keeps the plain hex key')
  const split = retreatStacks(record.state, 'soviet', ['a', 'b'], { splits: { 's10.02': [['a'], ['b']] } })
  assert.deepEqual(split.map(({ key }) => key), ['s10.02', 's10.02#1'], 'the second stack gets its own key')
  assert.deepEqual(split.map(({ combat }) => combat), [['a'], ['b']], 'every survivor lands in exactly one group')
  assert.deepEqual(split.flatMap(({ combat }) => combat).sort(), ['a', 'b'], 'no survivor is dropped or duplicated')
})

// ── 第 4 项 · 验收盘面 2：编内卡车只随同编成制的战斗单位撤退 ────────────────────────────────
test('board 4-2: an organic truck may only ride with a counter of its own formation', () => {
  const record = playing({ a: unit('soviet', 's10.02', { index: 1, formation: 'one' }),
    b: unit('soviet', 's10.02', { index: 2, formation: 'two' }),
    truck: unit('soviet', 's10.02', { index: 3, combat: false, organicTruck: 'full', formation: 'one' }) })
  const stacks = retreatStacks(record.state, 'soviet', ['a', 'b'], { splits: { 's10.02': [['a'], ['b']] },
    trucks: { 's10.02': ['truck'] } })
  assert.deepEqual(stacks[0].trucks, ['truck'], 'the truck rides with the stack holding its own formation')
  assert.deepEqual(stacks[1].trucks, [], 'the other formation carries no truck')
})
test('board 4-2: the rule layer refuses a truck whose escort is a different formation', () => {
  const units = { a: unit('soviet', 's10.01'), d: unit('axis', 's10.02', { index: 1, formation: 'one' }),
    truck: unit('axis', 's10.02', { index: 2, combat: false, organicTruck: 'full', formation: 'two' }) }
  const settled = defenderResult(units, optionBoard)
  const retreat = (ids) => ({ type: 'resolve-combat', lossOrder: [], optionLosses: 0, retreats: [{ group: 'g1', units: ids, path: ['s9.02'] }] })
  assert.throws(() => submit(settled, 'axis', retreat(['d', 'truck']), optionBoard, zocAssets),
    /编内卡车|only retreat with a combat unit of its own formation/, 'a mismatched escort is refused')
  units.truck.formation = 'one'
  const rode = submit(settled, 'axis', retreat(['d', 'truck']), optionBoard, zocAssets)
  assert.equal(rode.state.units.truck.hex, 's9.02', 'the same-formation truck rides along')
  assert.equal(rode.state.units.d.hex, 's9.02', 'the escort and its truck land together')
})

// ── 第 4 项 · 验收盘面 3：路线草稿与堆叠键 ────────────────────────────────────────────────
test('board 4-3: the drafted path and stack keys stay per group', () => {
  const state = playing({ a: unit('soviet', 's10.02', { index: 1 }), b: unit('soviet', 's10.02', { index: 2 }) }).state
  const single = retreatStacks(state, 'soviet', ['a'], { paths: { 's10.02': ['s10.01'] } })[0]
  assert.equal(single.path.at(-1), 's10.01', 'the draft keeps the path chosen so far')
  const split = retreatStacks(state, 'soviet', ['a', 'b'], { splits: { 's10.02': [['a'], ['b']] },
    paths: { 's10.02': ['s10.01'], 's10.02#1': ['s10.03'] } })
  const second = split.find((entry) => entry.key === 's10.02#1')
  assert.equal(second.path.at(-1), 's10.03', 'the second stack reads its own keyed path, not the origin hex')
  assert.equal(split[0].path.at(-1), 's10.01', 'the first stack keeps the plain hex key and its own path')
  assert.notEqual(stackKey('s10.02', 0), stackKey('s10.02', 1), 'stack keys are distinct per group')
})

// ── 第 4 项 · 验收盘面 4：敌控制区追加步损按组取出，余程逐格结算 ──────────────────────────
test('board 4-4: an enemy-ZOC step is charged to the stack that entered it and settles the remaining steps', () => {
  const units = { a: unit('soviet', 's10.02', { printedRe: 2, stepsLost: 1, disorganized: true }),
    b: unit('soviet', 's10.02', { index: 1 }), lurker: unit('axis', 's9.03', { index: 5 }) }
  const record = playing(units)
  const combat = { target: 's10.02', attacker: 'axis', attackers: ['lurker'], defenders: ['a', 'b'],
    heldAtStart: { soviet: ['s10.01'], axis: ['s9.03'] }, hedgehog: 0, step: 'defender-result' }
  assert.equal(remainingSteps(units.a), 1, 'a 2 RE counter that lost one step has one step left')
  // No loss named on the ZOC step: the rule layer surfaces the choice with the stack's own group id.
  assert.throws(() => retreatScorpionCombat(record.state, 'soviet', ['a', 'b'], 1,
    [{ group: 'g1', units: ['a'], path: ['s9.02'] }, { group: 'g2', units: ['b'], path: ['s11.02'] }],
  combat, zocAssets, {}), (error) => error.group === 'g1' && error.step === 0 && error.hex === 's9.02' &&
    error.candidates.join() === 'a' && error.constructor.name === 'ScorpionRetreatLossChoice')
  // The same route with the loss named settles it: the last step of the stack is eliminated to the dead pile.
  const settled = retreatScorpionCombat(record.state, 'soviet', ['a', 'b'], 1,
    [{ group: 'g1', units: ['a'], path: ['s9.02'], zocLosses: { 0: 'a' } },
      { group: 'g2', units: ['b'], path: ['s11.02'] }], combat, zocAssets, {})
  assert.equal(settled.pending, null, 'a ZOC loss does not leave the retreat pending')
  assert.equal(settled.state.units.a, undefined, 'the counter with no step left is removed')
  assert.deepEqual(settled.state.pieces.map(({ id, location }) => [id, location.kind]), [['a', 'dead-pile']],
    'the eliminated counter goes to the dead pile')
  assert.equal(settled.state.units.b.hex, 's11.02', 'the other stack still finishes its own route')
})

test('board 4-4: a stack with steps to spare pays the ZOC loss as one step and keeps moving', () => {
  const units = { a: unit('soviet', 's10.02', { printedRe: 3, disorganized: true }), b: unit('soviet', 's10.02', { index: 1 }),
    lurker: unit('axis', 's9.03', { index: 5 }) }
  const record = playing(units)
  const combat = { target: 's10.02', attacker: 'axis', attackers: ['lurker'], defenders: ['a', 'b'],
    heldAtStart: { soviet: ['s10.01'], axis: ['s9.03'] }, hedgehog: 0, step: 'defender-result' }
  const settled = retreatScorpionCombat(record.state, 'soviet', ['a', 'b'], 1,
    [{ group: 'g1', units: ['a'], path: ['s9.02'], zocLosses: { 0: 'a' } },
      { group: 'g2', units: ['b'], path: ['s11.02'] }], combat, zocAssets, {})
  assert.equal(settled.state.units.a.stepsLost, 1, 'one step is charged')
  assert.equal(remainingSteps(settled.state.units.a), 2, 'two steps remain after the ZOC loss')
  assert.equal(settled.state.units.a.hex, 's9.02', 'the counter still ends on its route hex')
})

test('board 4-4: every stack must carry its own group id', () => {
  const units = { a: unit('soviet', 's10.02'), b: unit('soviet', 's10.02', { index: 1 }), lurker: unit('axis', 's9.03', { index: 5 }) }
  const record = playing(units)
  const combat = { target: 's10.02', attacker: 'axis', attackers: ['lurker'], defenders: ['a', 'b'],
    heldAtStart: { soviet: ['s10.01'], axis: ['s9.03'] }, hedgehog: 0, step: 'defender-result' }
  assert.throws(() => retreatScorpionCombat(record.state, 'soviet', ['a', 'b'], 1,
    [{ group: 'g1', units: ['a'], path: ['s9.02'] }, { group: 'g1', units: ['b'], path: ['s11.02'] }],
  combat, zocAssets, {}), /own group id/, 'two stacks sharing a group id are refused')
  // Plans that name no group stay valid: the index becomes the group id.
  const legacy = retreatScorpionCombat(record.state, 'soviet', ['a', 'b'], 1,
    [{ units: ['a'], path: ['s9.02'] }, { units: ['b'], path: ['s11.02'] }], combat, zocAssets, {})
  assert.equal(legacy.state.units.a.hex, 's9.02', 'a plan without a group still retreats')
  assert.equal(legacy.state.units.b.hex, 's11.02', 'both stacks of a plan without groups retreat')
})

// ── 第 5 项 · 验收盘面 5：同一基地的飞机按基地编成一组，行内写明航程/分区/装载/货物 ────────
test('board 5-1: aircraft are grouped by departure base with range, sector, capacity and cargo', () => {
  const pieces = [
    { id: 'a1', side: 'soviet', kind: 'aircraft', definition: 'air-0', location: { kind: 'hex', hex: 's10.02' }, active: true, reduced: false },
    { id: 'a2', side: 'soviet', kind: 'aircraft', definition: 'air-1', location: { kind: 'hex', hex: 's10.02' }, active: true, reduced: false },
    { id: 'b1', side: 'soviet', kind: 'aircraft', definition: 'air-0', location: { kind: 'off-map-air' }, active: true, reduced: false }]
  const state = playing({}, { pieces, airBases: [{ side: 'soviet', hex: 's10.02', level: 2 }],
    dumps: { 'soviet:hex:s10.02': { side: 'soviet', location: 'on-map', tokens: 6 } } }).state
  assert.deepEqual(groupedAircraft(state, 'soviet', { kind: 'hex', hex: 's10.02' }), ['a1', 'a2'],
    'the map airfield groups only its own two aircraft')
  assert.deepEqual(groupedAircraft(state, 'soviet', { kind: 'off-map-air' }), ['b1'], 'the air box is its own group')
  const group = baseGroup(state, 'soviet', { kind: 'hex', hex: 's10.02' }, { kind: 'hex', hex: 's10.03' }, data)
  assert.match(group.label, /航程 6/, 'the row states the flight range')
  assert.equal(group.capacity, 4, 'two transport-2 aircraft pool 4 capacity')
  assert.equal(group.supply, 6, 'the base reports the supply loaded there')
  assert.ok(sameAirBase(airBaseOf(pieces[0]), { kind: 'hex', hex: 's10.02' }), 'base shapes match the refit draft')
})

// ── 第 5 项 · 验收盘面 6：地图外与地图内转场读同一个基地键 ────────────────────────────────
test('board 5-2: the off-map box and a map airfield are two groups of one base key space', () => {
  assert.ok(sameAirBase({ kind: 'off-map-air' }, { kind: 'off-map-air' }))
  assert.ok(!sameAirBase({ kind: 'off-map-air' }, { kind: 'hex', hex: 's10.02' }), 'the box is not a hex base')
  assert.ok(!sameAirBase({ kind: 'hex', hex: 's10.02' }, { kind: 'hex', hex: 's10.03' }))
})

// ── 第 5 项 · 验收盘面 7：多机混装任务一次下发，落地按剩余运力交货 ──────────────────────────
test('board 5-1: one grouped mission flies two aircraft carrying units and supply together', () => {
  const pieces = [{ id: 'a1', side: 'soviet', kind: 'aircraft', definition: 'air-0', location: { kind: 'hex', hex: 's10.02' }, active: true, reduced: false },
    { id: 'a2', side: 'soviet', kind: 'aircraft', definition: 'air-1', location: { kind: 'hex', hex: 's10.02' }, active: true, reduced: false }]
  const record = playing({ cargo: unit('soviet', 's10.02', { definition: 'cargo-0', moveMode: true }) },
    { pieces, airBases: [{ side: 'soviet', hex: 's10.02', level: 2 }, { side: 'soviet', hex: 's11.02', level: 1 }],
      dumps: { 'soviet:hex:s10.02': { side: 'soviet', location: 'on-map', tokens: 3 } },
      cursor: { turn: 1, first: 'soviet', phasing: 'soviet', phase: 'movement', retention: 'soviet' } })
  const launch = { type: 'launch-air-mission', mission: 'transport', target: { kind: 'hex', hex: 's11.02' },
    unitIds: ['a1', 'a2'], cargoUnitIds: ['cargo'], supplySource: { kind: 'hex', hex: 's10.02' },
    supplyTokens: 2, flightModes: [{ id: 'a1', mode: 'normal' }, { id: 'a2', mode: 'normal' }] }
  const flying = submit(record, 'soviet', launch)
  assert.equal(flying.state.airMission.kind, 'transport', 'the whole group launches as one mission')
  assert.deepEqual(flying.state.airMission.flights.map(({ id }) => id), ['a1', 'a2'], 'both aircraft fly it')
  assert.deepEqual(flying.state.airMission.airlift.carriers, ['a1', 'a2'], 'both aircraft pool their capacity')
  assert.equal(flying.state.airMission.airlift.tokens, 2, 'the supply loaded is the supply debited')
  assert.equal(flying.state.airMission.airlift.ground[0].id, 'cargo', 'a ground unit rides the same mission')
  assert.equal(flying.state.dumps['soviet:hex:s10.02'].tokens, 1, 'only the loaded supply leaves the base')
  // The load is capacity-bound: 2 tokens of supply plus one 2-token leg unit is 4 of 4 capacity.
  const overload = { ...launch, supplyTokens: 3 }
  assert.throws(() => submit({ ...record, state: { ...record.state, dumps: { 'soviet:hex:s10.02':
    { side: 'soviet', location: 'on-map', tokens: 5 } } } }, 'soviet', overload),
  /capacity/, 'a load above the pooled capacity is refused')
  const landed = submit(flying, 'soviet', { type: 'choose-airlift-landing', unitIds: ['a1', 'a2'] })
  assert.equal(landed.state.airMission, null, 'landing closes the mission once nothing is left over')
  assert.equal(landed.state.airHistory.at(-1).kind, 'transport', 'the finished mission is kept in the history')
  assert.equal(landed.state.units.cargo.hex, 's11.02', 'the ground cargo is delivered to the target')
})

// ── 第 5 项 · 验收盘面 8：待答步骤在关闭窗口后仍可恢复 ────────────────────────────────────
test('board 5-3: a pending air mission survives closing and reopening the window', () => {
  const pieces = [{ id: 'a1', side: 'soviet', kind: 'aircraft', definition: 'air-0',
    location: { kind: 'hex', hex: 's10.02' }, active: true, reduced: false }]
  const record = playing({}, { pieces, airBases: [{ side: 'soviet', hex: 's10.02', level: 2 }],
    airMission: { kind: 'barrage', side: 'soviet', target: { kind: 'hex', hex: 's10.03' },
      flights: [{ id: 'a1', origin: { kind: 'hex', hex: 's10.02' }, normalRange: true }],
      patrol: false, returning: [], rounds: [], step: { kind: 'interception', actor: 'axis', candidates: [] } } })
  const envelope = localScorpionEnvelope(record, 'board')
  assert.equal(envelope.record.state.airMission.step.kind, 'interception', 'the pending step is serialised whole')
  const restored = restoreLocalScorpion(JSON.parse(JSON.stringify(envelope)), { fingerprint: 'board', assets })
  assert.equal(restored.state.airMission.step.kind, 'interception', 'reopening lands on the same pending step')
  assert.equal(restored.state.airMission.target.hex, 's10.03', 'the target hex is kept')
  // A save from a different board is refused rather than half-restored.
  assert.throws(() => restoreLocalScorpion(JSON.parse(JSON.stringify(envelope)), { fingerprint: 'other', assets }),
    /与当前对局不同/)
})
