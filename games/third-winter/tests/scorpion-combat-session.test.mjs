import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createRngState } from '@ocs-eastern/series/rng'
import { rollRegularCombat } from '@ocs-eastern/series/tables/ground-combat'
import { barrageColumn, barrageDensity, rollGroundBarrage } from '@ocs-eastern/series/tables/barrage'
import { scorpionMap } from '../src/import/scorpion-map.ts'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'
import { scorpionBarrageFrontAt } from '../src/ttw/scorpion/barrage-markers.ts'
import { scorpionBarrageMarkerFrame } from '../src/view/scorpion-barrage-markers.ts'

const pairs = [['s10.01', 's10.02'], ['s10.02', 's10.03'], ['s15.08', 's15.09'], ['s15.09', 's15.10']]
const map = scorpionMap([...new Set(pairs.flat())].map((hex_id) => ({ hex_id, on_map: true, terrains_present: ['Open'] })),
  pairs.map(([hex_a, hex_b]) => ({ hex_a, hex_b, edge_terrain: 'none', road_present: false, rail_present: false, bridge: false })))
const assets = { map, catalog: { definitions: new Map() } }
const columns = ['1:5', '1:4', '1:3', '1:2', '1:1', '2:1', '3:1', '4:1', '5:1', '7:1', '9:1', '11:1', '13:1']
const table = (code) => ({ diceRows: ['1 or less', '2-14', '15 or more'], terrainColumns: { Open: columns },
  matrix: Array.from({ length: 3 }, () => columns.map(() => code)) })
const board = (code = 'Ae4 DL1o1') => ({ supplyRail: { railGauge: () => 'axis' }, combat: { table: table(code) } })
const unit = (side, hex, extra = {}) => ({ side, hex, printedRe: 1, stepsLost: 0, actionRating: 4, strength: 4,
  combatClass: 'other', antiTank: 0, attackCapable: true, fueled: false, combat: true, mobility: 'leg', allowance: 3,
  definition: `${side}-counter`, ...extra })
const fixture = (phase, units) => ({ revision: 0, receipts: [], state: { kind: 'playing', units,
  cursor: { turn: 1, first: 'soviet', phasing: 'soviet', phase, retention: 'soviet' },
  turn: { number: 1, weather: { ground: 'freeze', flight: 'limited' }, vp: 0, thawSeen: false,
    step: { kind: 'player-turn', first: 'soviet', retention: 'soviet' } },
  rng: createRngState(1), dumps: { 'soviet:hex:s10.01': { side: 'soviet', location: 'on-map', tokens: 10 } },
  moved: [], pieces: [], availableAlerts: [], railControl: {}, rerollHolder: 'soviet', airBases: [], combat: null,
  combatTargets: [], combatAttackers: [], arrival: { placed: [], mobilized: [], sovietVp: 0 }, victory: null,
} })
const command = (record, action) => ({ id: `battle-${record.revision}`, expectedRevision: record.revision, action })
const submit = (record, side, action, option) => submitScorpionSession(record, side, command(record, action), assets, option ?? board()).record

const artilleryTable = (code) => ({
  columns: ['1 or less', '2', '3-4', '5-7', '8-11', '12-16', '17-24', '25+'],
  costs: [1, 1, 2, 2, 2, 3, 3, 4],
  matrix: Array.from({ length: 11 }, () => Array(8).fill(code)),
})
const airfieldTable = (code) => ({
  columns: ['1 or less', '2', '3-4', '5-10', '11-20', '21-40', '41-80', '81+'],
  costs: [1, 1, 1, 1, 2, 4, 6, 8],
  matrix: Array.from({ length: 6 }, () => Array(8).fill(code)),
})

test('regular combat discloses each decision in order, updates the dead pile and permits advancement', () => {
  let record = fixture('combat', { infantry: unit('soviet', 's10.01'), defense: unit('axis', 's10.02') })
  record = submit(record, 'soviet', { type: 'declare-combat', target: 's10.02', attackers: ['infantry'],
    payments: [{ unitId: 'infantry', dumpId: 'soviet:hex:s10.01', tokens: 1 }] })
  assert.equal(record.state.dumps['soviet:hex:s10.01'].tokens, 9)
  assert.throws(() => submit(record, 'soviet', { type: 'complete-combat' }), /pending combat/)
  assert.throws(() => submit(record, 'soviet', { type: 'select-combat-rating', unitId: 'infantry' }), /correct order/)
  record = submit(record, 'axis', { type: 'defend-combat', payments: [] })
  record = submit(record, 'soviet', { type: 'select-combat-rating', unitId: 'infantry' })
  record = submit(record, 'axis', { type: 'select-combat-rating', unitId: 'defense' })
  const terrain = { type: 'choose-combat-terrain', terrain: 'Open', attackingTerrain: { 's10.01': 'Open' } }
  const id = command(record, terrain)
  record = submit(record, 'axis', terrain)
  assert.equal(record.state.combat.roll.code, 'Ae4 DL1o1')
  const restored = JSON.parse(JSON.stringify(record))
  assert.equal(submitScorpionSession(restored, 'axis', id, assets, board()).duplicate, true)
  record = submit(restored, 'soviet', { type: 'resolve-combat', lossOrder: [], optionLosses: 0, retreats: [] })
  assert.equal(record.state.units.infantry.exploit, true)
  record = submit(record, 'axis', { type: 'resolve-combat', lossOrder: ['defense'], optionLosses: 0, retreats: [] })
  assert.equal(record.state.arrival.sovietVp, 1)
  assert.equal(record.state.pieces[0].id, 'defense')
  record = submit(record, 'soviet', { type: 'advance-after-combat', unitIds: ['infantry'] })
  assert.equal(record.state.units.infantry.hex, 's10.02')
  assert.equal(record.state.railControl['s10.02'], 'soviet')
})

test('the defending player can retreat the unresolved option along a legal hex path', () => {
  const option = board('Ae4 Do1')
  let record = fixture('combat', { a: unit('soviet', 's10.01'), d: unit('axis', 's10.02') })
  record = submit(record, 'soviet', { type: 'declare-combat', target: 's10.02', attackers: ['a'],
    payments: [{ unitId: 'a', dumpId: 'soviet:hex:s10.01', tokens: 1 }] }, option)
  record = submit(record, 'axis', { type: 'defend-combat', payments: [] }, option)
  record = submit(record, 'soviet', { type: 'select-combat-rating', unitId: 'a' }, option)
  record = submit(record, 'axis', { type: 'select-combat-rating', unitId: 'd' }, option)
  record = submit(record, 'axis', { type: 'choose-combat-terrain', terrain: 'Open', attackingTerrain: { 's10.01': 'Open' } }, option)
  record = submit(record, 'soviet', { type: 'resolve-combat', lossOrder: [], optionLosses: 0, retreats: [] }, option)
  const plan = (hex) => ({ type: 'resolve-combat', lossOrder: [], optionLosses: 0, retreats: [{ units: ['d'], path: [hex] }] })
  assert.throws(() => submit(record, 'axis', plan('s10.01'), option), /enemy at combat start/)
  record = submit(record, 'axis', plan('s10.03'), option)
  assert.equal(record.state.units.d.hex, 's10.03')
  assert.equal(record.state.combat.step, 'advance')
})

test('only an unfulfilled option or a retreat allows the defender to ignore an option', () => {
  for (const [code, canIgnore] of [['AL2 Do1', false], ['AL1o1 Do1', true]]) {
    const record = fixture('combat', { a: unit('soviet', 's10.01'), d: unit('axis', 's10.02') })
    record.state.combat = { step: 'attacker-result', target: 's10.02', attacker: 'soviet', attackers: ['a'], defenders: ['d'],
      attackerLeader: 'a', defenderLeader: 'd', roll: rollRegularCombat(table(code), 'Open', 1, 1, 0, 0, () => 4) }
    const settled = submit(record, 'soviet', { type: 'resolve-combat', lossOrder: ['a'], optionLosses: 0, retreats: [] })
    assert.equal(settled.state.combat.defenderMayIgnore, canIgnore)
  }
})

test('the non-phasing side releases reserves and the second cleanup opens the next turn', () => {
  let record = fixture('reaction', { reserves: unit('axis', 's15.08', { reserve: 'reserves' }) })
  assert.throws(() => submit(record, 'soviet', { type: 'complete-reaction' }), /cannot complete/)
  record = submit(record, 'axis', { type: 'release-reserve', unitId: 'reserves' })
  assert.throws(() => submit(record, 'axis', { type: 'ground-move', unitId: 'reserves', path: ['s15.09', 's15.10'] }), /allowance/)
  record = submit(record, 'axis', { type: 'ground-move', unitId: 'reserves', path: ['s15.09'] })
  record = submit(record, 'axis', { type: 'complete-reaction' })
  record = submit(record, 'soviet', { type: 'complete-combat' })
  record = submit(record, 'soviet', { type: 'complete-exploitation' })
  record = submit(record, 'soviet', { type: 'complete-cleanup' })
  assert.equal(record.state.turn.number, 1)
  assert.equal(record.state.cursor.phasing, 'axis')
  record = { ...record, state: { ...record.state, cursor: { ...record.state.cursor, phase: 'cleanup' } } }
  record = submit(record, 'axis', { type: 'complete-cleanup' })
  assert.equal(record.state.turn.number, 2)
  assert.equal(record.state.turn.step.kind, 'retention')
  record = submit(record, 'soviet', { type: 'retain-initiative', dumpId: 'soviet:hex:s10.01' })
  record = submit(record, 'soviet', { type: 'choose-first', first: 'axis' })
  assert.equal(record.state.cursor.phase, 'aircraft-refit')
  assert.equal(record.state.cursor.turn, 2)
  assert.equal(record.state.dumps['soviet:hex:s10.01'].tokens, 6)
})

test('Scorpion uses six Reserve hexes, sharing a marker and releasing units individually', () => {
  const reserves = Object.fromEntries(['s10.01', 's10.02', 's10.03', 's15.08', 's15.09', 's15.10']
    .map((hex) => [hex, unit('soviet', hex, { reserve: hex })]))
  let record = fixture('movement', { ...reserves, infantry: unit('soviet', 's10.01'),
    truck: unit('soviet', 's10.01', { combat: false, organicTruck: 'full' }),
    transport: unit('soviet', 's10.01', { combat: false }),
    extra: unit('soviet', 's10.04') })
  const mark = (id) => ({ type: 'mark-reserve', unitId: id })
  assert.throws(() => submit(record, 'soviet', mark('extra')), /No free Reserve marker/)
  assert.throws(() => submit(record, 'soviet', mark('transport')), /eligible/)
  record = submit(record, 'soviet', mark('infantry'))
  record = submit(record, 'soviet', mark('truck'))
  record.state.cursor.phase = 'exploitation'
  record = submit(record, 'soviet', { type: 'release-reserve', unitId: 'infantry' })
  assert.equal(record.state.units.infantry.reserve, undefined)
  assert.equal(record.state.units.infantry.released, true)
  assert.equal(record.state.units.truck.reserve, 'truck')
  assert.equal(record.state.units['s10.01'].reserve, 's10.01')
})

test('a Reserve move selects the face and validates the quarter allowance and final marker count atomically', () => {
  const reserves = Object.fromEntries(['s10.01', 's10.02', 's10.03', 's15.08', 's15.09', 's16.01']
    .map((hex) => [hex, unit('soviet', hex, { reserve: hex })]))
  const record = fixture('movement', { ...reserves, infantry: unit('soviet', 's15.08'),
    stay: unit('soviet', 's15.09', { reserve: 'stay' }) })
  const definition = { kind: 'land', source: { side: 'soviet',
    faces: { move: { maColor: 'white', stats: { move: 7, attack: 2, artRange: 3 } } } } }
  const localAssets = { ...assets, catalog: { definitions: new Map([['soviet-counter', definition]]) } }
  const move = (path, reserveFace, unitId = 'infantry') => ({ type: 'ground-move', unitId, path, reserveFace })
  const play = (from, action) => submitScorpionSession(from, 'soviet', command(from, action), localAssets, board()).record
  assert.throws(() => play(record, move(['s15.09', 's15.10'], 'move')), /allowance/)
  assert.throws(() => play(record, move(['s15.10'], undefined, 's15.09')), /No free Reserve marker/)
  const stack = play(record, { type: 'reserve-stack-move', path: ['s15.10'],
    counters: [{ unitId: 's15.09' }, { unitId: 'stay' }] })
  assert.equal(stack.state.units['s15.09'].hex, 's15.10')
  assert.equal(stack.state.units.stay.hex, 's15.10')
  assert.equal(record.state.units.infantry.moveMode, undefined)
  const moved = play(record, move(['s15.09'], 'move'))
  assert.equal(moved.state.units.infantry.moveMode, true)
  assert.equal(moved.state.units.infantry.allowance, 7)
  assert.equal(moved.state.units.infantry.strength, 2)
  assert.equal(moved.state.units.infantry.actionRating, 3)
  assert.equal(moved.state.units.infantry.reserve, 'infantry')
  assert.throws(() => play(moved, { type: 'mark-reserve', unitId: 'infantry', face: 'combat' }), /before it moves/)
})

test('Reserve entry checks the origin ZOC and the hedgehog restriction is checked at movement end', () => {
  const record = fixture('movement', { infantry: unit('soviet', 's15.08'), enemy: unit('axis', 's15.10') })
  const option = { ...board(), combat: { ...board().combat, hedgehogAt: (hex) => hex === 's15.09' ? 1 : 0 } }
  const move = { type: 'ground-move', unitId: 'infantry', path: ['s15.09'], reserveFace: 'current' }
  assert.throws(() => submit(record, 'soviet', move, option), /hedgehog/)
  const moved = submit(record, 'soviet', move)
  assert.equal(moved.state.units.infantry.reserve, 'infantry')
  record.state.units.infantry.hex = 's15.09'
  assert.throws(() => submit(record, 'soviet', { type: 'mark-reserve', unitId: 'infantry' }), /enemy ZOC/)
  record.state.units.infantry.reserve = 'infantry'
  assert.throws(() => submit(record, 'soviet', { type: 'complete-movement' }, option), /hedgehog/)
  const left = submit(record, 'soviet', { type: 'leave-reserve', unitId: 'infantry' }, option)
  assert.equal(left.state.units.infantry.released, undefined)
  assert.equal(submit(left, 'soviet', { type: 'complete-movement' }, option).state.cursor.phase, 'supply')
})

test('combat clears Reserve on units receiving a result and clears an organic truck on DG', () => {
  for (const [code, defenderReserve, truckReserve] of [['AL1', true, true], ['A Do1', false, true], ['A DDG', false, false]]) {
    const option = board(code)
    let record = fixture('combat', { a: unit('soviet', 's10.01'), d: unit('axis', 's10.02', { reserve: 'd' }),
      truck: unit('axis', 's10.02', { combat: false, attackCapable: false, organicTruck: 'full', reserve: 'truck' }) })
    record = submit(record, 'soviet', { type: 'declare-combat', target: 's10.02', attackers: ['a'],
      payments: [{ unitId: 'a', dumpId: 'soviet:hex:s10.01', tokens: 1 }] }, option)
    record = submit(record, 'axis', { type: 'defend-combat', payments: [] }, option)
    record = submit(record, 'soviet', { type: 'select-combat-rating', unitId: 'a' }, option)
    record = submit(record, 'axis', { type: 'select-combat-rating', unitId: 'd' }, option)
    record = submit(record, 'axis', { type: 'choose-combat-terrain', terrain: 'Open', attackingTerrain: { 's10.01': 'Open' } }, option)
    assert.equal(Boolean(record.state.units.d.reserve), defenderReserve)
    assert.equal(Boolean(record.state.units.truck.reserve), truckReserve)
    assert.equal(record.state.units.truck.disorganized, undefined)
  }
})

test('regular odds floor to the printed column and then shift for surprise', () => {
  const dice = [6, 4, 1, 3, 3]
  const result = rollRegularCombat(table('AL1o1 Do1'), 'Open', 12, 1, 0, 0, () => dice.shift())
  assert.equal(result.initialColumn, 11)
  assert.equal(result.column, 12)
  assert.deepEqual(result.attacker, { loss: 1, option: 1 })
})

test('overrun uses the 9 and 6 surprise thresholds and never grants exploitation', () => {
  for (const [dice, shift] of [[[4, 5], 4], [[3, 3], -4]]) {
    const makeRoll = () => [...dice, 4, 3, 3]
    const regularDice = makeRoll()
    const overrunDice = makeRoll()
    assert.equal(rollRegularCombat(table('Ae4 DL1'), 'Open', 4, 4, 0, 0, () => regularDice.shift()).shift, 0)
    assert.equal(rollRegularCombat(table('Ae4 DL1'), 'Open', 4, 4, 0, 0, () => overrunDice.shift(), true).shift, shift)
  }
})

test('an overrun stack can repeat its attack and automatically enters a cleared hex before continuing on remaining MP', () => {
  const option = board('Ae4 DL1')
  const unitId = 'attack'
  const dumpId = 'soviet:hex:s10.01'
  let record = fixture('movement', { [unitId]: unit('soviet', 's10.01', { allowance: 7 }),
    bystander: unit('soviet', 's10.01'), defense: unit('axis', 's10.02', { printedRe: 2 }) })
  const attack = { type: 'declare-overrun', target: 's10.02', attackers: [unitId],
    payments: [{ unitId, dumpId, tokens: 1 }] }
  for (const remaining of [4, 1]) {
    record = submit(record, 'soviet', attack, option)
    assert.equal(record.state.overrunMarch.remaining[unitId], remaining)
    assert.equal(record.state.units.attack.hex, 's10.01')
    assert.throws(() => submit(record, 'soviet', { type: 'complete-movement' }, option), /supply is unavailable/)
    record = submit(record, 'axis', { type: 'defend-combat', payments: [] }, option)
    record = submit(record, 'soviet', { type: 'select-combat-rating', unitId }, option)
    record = submit(record, 'axis', { type: 'select-combat-rating', unitId: 'defense' }, option)
    record = submit(record, 'axis', { type: 'choose-combat-terrain', terrain: 'Open', attackingTerrain: { 's10.01': 'Open' } }, option)
    record = submit(record, 'soviet', { type: 'resolve-combat', lossOrder: [], optionLosses: 0, retreats: [] }, option)
    record = submit(record, 'axis', { type: 'resolve-combat', lossOrder: ['defense'], optionLosses: 0, retreats: [] }, option)
    assert.equal(record.state.combat, null)
    assert.equal(record.state.units.attack.exploit, undefined)
  }
  assert.equal(record.state.units.attack.hex, 's10.02')
  assert.equal(record.state.units.bystander.hex, 's10.01')
  assert.equal(record.state.dumps[dumpId].tokens, 8)
  assert.deepEqual(record.state.combatTargets, [])
  record = submit(record, 'soviet', { type: 'continue-overrun-move', path: ['s10.03'] }, option)
  assert.equal(record.state.units.attack.hex, 's10.03')
  assert.equal(record.state.overrunMarch, null)
})

test('overrun approach and fuel are atomic, and a road cannot legalize the overrun entry', () => {
  const options = board('AL1')
  const from = 's10.01'
  const through = 's10.02'
  const target = 's10.03'
  const dumpId = `soviet:hex:${from}`
  const approach = scorpionMap([from, through, target].map((hex_id) => ({ hex_id, on_map: true,
    terrains_present: [hex_id === target ? 'Rough' : 'Open'] })),
  [[from, through], [through, target]].map(([hex_a, hex_b]) => ({ hex_a, hex_b, edge_terrain: 'none',
    road_present: true, road_subclass: 'Secondary Road', rail_present: false, bridge: false })))
  const record = fixture('movement', { trucks: unit('soviet', from, { allowance: 8, mobility: 'truck' }),
    defense: unit('axis', target) })
  const attack = { type: 'declare-overrun', target, attackers: ['trucks'], path: [through],
    fuel: [{ unitId: 'trucks', dumpId }], payments: [{ unitId: 'trucks', dumpId, tokens: 1 }] }
  const play = () => submitScorpionSession(record, 'soviet', command(record, attack), { ...assets, map: approach }, options)
  assert.throws(play, /before roads/)
  assert.equal(record.state.units.trucks.hex, from)
  assert.equal(record.state.dumps[dumpId].tokens, 10)
  const started = submit(record, 'soviet', attack, options)
  assert.equal(started.state.units.trucks.hex, through)
  assert.equal(started.state.overrunMarch.remaining.trucks, 4)
  assert.equal(started.state.dumps[dumpId].tokens, 8)
})

test('a released reaction stack that retreats from an overrun cannot resume movement', () => {
  const option = board('Ao1 Do1')
  let record = fixture('reaction', { attacker: unit('axis', 's10.02', { allowance: 8, reserve: 'attacker' }),
    bystander: unit('axis', 's10.02'), defense: unit('soviet', 's10.03') })
  const dumpId = 'axis:hex:s10.02'
  record.state.dumps = { [dumpId]: { side: 'axis', location: 'on-map', tokens: 3 } }
  const attack = { type: 'declare-overrun', target: 's10.03', attackers: ['attacker'],
    payments: [{ unitId: 'attacker', dumpId, tokens: 1 }] }
  assert.throws(() => submit(record, 'axis', attack, option), /eligible attackers/)
  record = submit(record, 'axis', { type: 'release-reserve', unitId: 'attacker' }, option)
  record = submit(record, 'axis', attack, option)
  assert.equal(record.state.overrunMarch.remaining.attacker, 1)
  record = submit(record, 'soviet', { type: 'defend-combat', payments: [] }, option)
  record = submit(record, 'axis', { type: 'select-combat-rating', unitId: 'attacker' }, option)
  record = submit(record, 'soviet', { type: 'select-combat-rating', unitId: 'defense' }, option)
  record = submit(record, 'soviet', { type: 'choose-combat-terrain', terrain: 'Open', attackingTerrain: { 's10.02': 'Open' } }, option)
  const retreat = (units) => ({ type: 'resolve-combat', lossOrder: [], optionLosses: 0, retreats: [{ units, path: ['s10.01'] }] })
  assert.throws(() => submit(record, 'axis', retreat(['attacker', 'bystander']), option), /Only overrun participants/)
  record = submit(record, 'axis', retreat(['attacker']), option)
  record = submit(record, 'soviet', { type: 'resolve-combat', lossOrder: [], optionLosses: 0,
    ignoreDefenderOption: true, retreats: [] }, option)
  assert.equal(record.state.units.attacker.hex, 's10.01')
  assert.equal(record.state.units.bystander.hex, 's10.02')
  assert.equal(record.state.overrunMarch, null)
  assert.throws(() => submit(record, 'axis', { type: 'continue-overrun-move', path: ['s10.02'] }, option), /current overrun stack/)
  assert.throws(() => submit(record, 'axis', { type: 'ground-move', unitId: 'attacker', path: ['s10.02'] }, option), /unavailable/)
})

test('attackers can mix map supply and internal stocks across counters, and partial supply is lost for a division', () => {
  const dumpId = 'soviet:hex:s10.01'
  const record = fixture('combat', { division: unit('soviet', 's10.01', { printedRe: 3 }),
    infantry: unit('soviet', 's10.01'), enemy: unit('axis', 's10.02') })
  record.state.dumps[dumpId].tokens = 1
  const attack = { type: 'declare-combat', target: 's10.02', attackers: ['division', 'infantry'] }
  assert.throws(() => submit(record, 'soviet', { ...attack, payments: [], internalUnitIds: ['division', 'infantry'] }),
    /required on-map/)
  assert.equal(record.state.dumps[dumpId].tokens, 1)
  const mixed = submit(record, 'soviet', { ...attack, payments: [{ unitId: 'infantry', dumpId, tokens: 1 }],
    internalUnitIds: ['division'] })
  assert.equal(mixed.state.units.division.internalStocks, 'low')
  assert.equal(mixed.state.units.infantry.internalStocks, undefined)
  const division = { ...attack, attackers: ['division'], payments: [], internalUnitIds: ['division'] }
  record.state.units.division.internalStocks = 'low'
  const result = submit(record, 'soviet', division)
  assert.equal(result.state.units.division.internalStocks, 'exhausted')
  assert.equal(result.state.dumps[dumpId].tokens, 0)
  record.state.units.division.internalStocks = 'exhausted'
  assert.throws(() => submit(record, 'soviet', division), /exhausted/)
  record.state.dumps[dumpId].tokens = 3
  const paid = submit(record, 'soviet', { ...division, internalUnitIds: [], payments: [{ unitId: 'division', dumpId, tokens: 3 }] })
  assert.equal(paid.state.units.division.internalStocks, 'exhausted')
})

test('only the defender spending its own internal stocks defends at supplied strength', () => {
  let record = fixture('combat', { attacker: unit('soviet', 's10.01', { strength: 11 }),
    ready: unit('axis', 's10.02'), exhausted: unit('axis', 's10.02', { internalStocks: 'exhausted' }) })
  record = submit(record, 'soviet', { type: 'declare-combat', target: 's10.02', attackers: ['attacker'],
    payments: [{ unitId: 'attacker', dumpId: 'soviet:hex:s10.01', tokens: 1 }] })
  assert.throws(() => submit(record, 'axis', { type: 'defend-combat', payments: [], internalUnitIds: ['exhausted'] }),
    /exhausted/)
  record = submit(record, 'axis', { type: 'defend-combat', payments: [], internalUnitIds: ['ready'] })
  assert.equal(record.state.units.ready.internalStocks, 'low')
  record = submit(record, 'soviet', { type: 'select-combat-rating', unitId: 'attacker' })
  record = submit(record, 'axis', { type: 'select-combat-rating', unitId: 'ready' })
  record = submit(record, 'axis', { type: 'choose-combat-terrain', terrain: 'Open', attackingTerrain: { 's10.01': 'Open' } })
  assert.equal(record.state.combat.roll.initialColumn, columns.indexOf('2:1'))
})

test('artillery pays before the target chooses terrain and its losses reach the dead pile and VP', () => {
  const option = { ...board(), barrage: artilleryTable('1') }
  const dumpId = 'soviet:hex:s10.01'
  const attack = { type: 'declare-artillery-barrage', target: 's10.02', batteries: [{ unitId: 'battery' }],
    supply: { kind: 'direct', payments: [{ dumpId, tokens: 3 }] } }
  const record = fixture('combat', {
    battery: unit('soviet', 's10.01', { artillery: { strength: 14, range: 2 }, outOfSupply: true }),
    target: unit('axis', 's10.02', { reserve: 'target' }),
    truck: unit('axis', 's10.02', { combat: false, organicTruck: 'full', reserve: 'truck' }),
  })
  const pending = submit(record, 'soviet', attack, option)
  assert.equal(pending.state.dumps[dumpId].tokens, 7)
  assert.equal(pending.state.barrage.strength, 14)
  assert.throws(() => submit(pending, 'soviet', { type: 'complete-combat' }, option), /pending barrage/)
  const terrain = { type: 'choose-barrage-terrain', terrain: 'Open' }
  assert.throws(() => submit(pending, 'soviet', terrain, option), /targeted player/)
  const restored = JSON.parse(JSON.stringify(pending))
  const rolled = submit(restored, 'axis', terrain, option)
  assert.equal(rolled.state.units.target.disorganized, true)
  assert.equal(rolled.state.units.target.reserve, undefined)
  assert.equal(rolled.state.units.truck.reserve, undefined)
  assert.equal(rolled.state.barrage.lossesDue, 1)
  assert.equal(rolled.state.barrageHistory[0].roll.column, 4)
  const losses = { type: 'assign-barrage-loss', allocation: [{ unitId: 'target', steps: 1 }] }
  const settled = submit(rolled, 'axis', losses, option)
  assert.equal(settled.state.barrage, null)
  assert.equal(settled.state.arrival.sovietVp, 1)
  assert.equal(settled.state.pieces[0].location.kind, 'dead-pile')
  assert.equal(submitScorpionSession(settled, 'axis', command(rolled, losses), assets, option).duplicate, true)
})

test('reaction artillery requires released reserves and a Soviet division can split only its surviving RE', () => {
  const option = { ...board(), barrage: artilleryTable('-') }
  const dumpId = 'soviet:hex:s10.02'
  const record = fixture('reaction', {
    division: unit('soviet', 's10.02', { printedRe: 3, stepsLost: 1, reserve: 'division',
      artillery: { strength: 42, range: 2, independentRe: true } }),
    left: unit('axis', 's10.01'), right: unit('axis', 's10.03'),
  })
  record.state.cursor.phasing = 'axis'
  record.state.dumps[dumpId] = { location: 'on-map', side: 'soviet', tokens: 12 }
  const fire = (target, re = 1) => ({ type: 'declare-artillery-barrage', target, batteries: [{ unitId: 'division', re }],
    supply: { kind: 'direct', payments: [{ dumpId, tokens: 3 }] } })
  assert.throws(() => submit(record, 'soviet', fire('s10.01'), option), /eligible artillery/)
  const released = submit(record, 'soviet', { type: 'release-reserve', unitId: 'division' }, option)
  const terrain = { type: 'choose-barrage-terrain', terrain: 'Open' }
  const first = submit(submit(released, 'soviet', fire('s10.01'), option), 'axis', terrain, option)
  assert.throws(() => submit(first, 'soviet', fire('s10.01'), option), /once per phase/)
  assert.throws(() => submit(first, 'soviet', { type: 'ground-move', unitId: 'division', path: ['s10.03'] }, option),
    /Movement Segment has ended/)
  assert.throws(() => submit(first, 'soviet', fire('s10.03', 2), option), /unused artillery RE/)
  const second = submit(submit(first, 'soviet', fire('s10.03'), option), 'axis', terrain, option)
  assert.equal(second.state.barrageHistory.length, 2)
  assert.equal(second.state.dumps[dumpId].tokens, 6)
})

test('barrage density caps a formation and bracketed half losses depend on a spotter and hedgehogs', () => {
  const density = barrageDensity([{ re: 3, formation: 'one' }, { re: 2, formation: 'one' }, { re: 5 }])
  assert.equal(density, 6)
  const crt = artilleryTable('[1/2]')
  const { initialColumn, cost } = barrageColumn(crt, 16)
  const facts = { density, hedgehog: 1, terrain: 'Close', spotter: true }
  const result = rollGroundBarrage(crt, initialColumn, facts, () => 4)
  assert.equal(cost, 3)
  assert.equal(result.column, initialColumn + 1)
  assert.equal(result.loss, 1)
  assert.equal(rollGroundBarrage(crt, initialColumn, { ...facts, hedgehog: 3 }, () => 6).halfDie, null)
  assert.equal(rollGroundBarrage(crt, initialColumn, { ...facts, spotter: false }, () => 6).loss, 0)
})

test('two batteries may use multiple dumps only through a common HQ', () => {
  const option = { ...board(), barrage: artilleryTable('-') }
  const artillery = { strength: 8, range: 2 }
  const record = fixture('combat', { first: unit('soviet', 's10.01', { artillery }),
    second: unit('soviet', 's10.02', { artillery }),
    hq: unit('soviet', 's10.01', { headquarters: { throwRange: 2, mobility: 'truck', kessel: false } }),
    target: unit('axis', 's10.03') })
  const firstDump = 'soviet:hex:s10.01'
  const secondDump = 'soviet:hex:s10.02'
  record.state.dumps[secondDump] = { location: 'on-map', side: 'soviet', tokens: 2 }
  const payments = [{ dumpId: firstDump, tokens: 1 }, { dumpId: secondDump, tokens: 2 }]
  const attack = { type: 'declare-artillery-barrage', target: 's10.03', batteries: [{ unitId: 'first' }, { unitId: 'second' }] }
  assert.throws(() => submit(record, 'soviet', { ...attack, supply: { kind: 'direct', payments } }, option), /shared dump/)
  assert.throws(() => submit(record, 'soviet', { ...attack, supply: { kind: 'hq', hqId: 'first', payments } }, option),
    /reachable friendly dump/)
  const pending = submit(record, 'soviet', { ...attack, supply: { kind: 'hq', hqId: 'hq', payments } }, option)
  assert.equal(pending.state.dumps[firstDump].tokens, 9)
  assert.equal(pending.state.dumps[secondDump].tokens, 0)
})

test('an airfield barrage changes the level and aircraft faces without hitting defending ground troops', () => {
  const option = { ...board(), facilityBarrage: airfieldTable('2 S (3)') }
  const record = fixture('combat', { battery: unit('soviet', 's10.01', { artillery: { strength: 14, range: 2 } }),
    garrison: unit('axis', 's10.02') })
  record.state.airBases = [{ hex: 's10.02', side: 'axis', level: 2 }]
  record.state.pieces = [
    { id: 'full', kind: 'aircraft', side: 'axis', active: true, location: { kind: 'hex', hex: 's10.02' } },
    { id: 'reduced', kind: 'aircraft', side: 'axis', reduced: true, location: { kind: 'hex', hex: 's10.02' } },
    { id: 'outside', kind: 'aircraft', side: 'axis', location: { kind: 'off-map-air' } },
  ]
  const attack = { type: 'declare-artillery-barrage', target: 's10.02', targetKind: 'air-base',
    batteries: [{ unitId: 'battery' }], supply: { kind: 'direct', payments: [{ dumpId: 'soviet:hex:s10.01', tokens: 2 }] } }
  assert.throws(() => submit(record, 'soviet', attack), /appropriate OCS/)
  const hit = submit(record, 'soviet', attack, option)
  assert.equal(hit.state.dumps['soviet:hex:s10.01'].tokens, 8)
  assert.equal(hit.state.airBases[0].level, 1)
  assert.equal(hit.state.pieces[0].reduced, true)
  assert.equal(hit.state.pieces[1].location.kind, 'dead-pile')
  assert.equal(hit.state.pieces[2].reduced, undefined)
  assert.equal(hit.state.units.garrison.disorganized, undefined)
  assert.deepEqual(hit.state.barrageHistory[0].facilityRoll.aircraft.map(({ die }) => die), [4, 6])
  assert.throws(() => submit(hit, 'soviet', { ...attack, targetKind: 'units' }, { ...option, barrage: artilleryTable('-') }),
    /once per phase/)
})

test('after airfield capacity falls only its owner may inactivate the required planes', () => {
  const option = { ...board(), facilityBarrage: airfieldTable('1 (6)') }
  const record = fixture('combat', { battery: unit('soviet', 's10.01', { artillery: { strength: 14, range: 2 } }) })
  record.state.airBases = [{ hex: 's10.02', side: 'axis', level: 2 }]
  record.state.pieces = Array.from({ length: 6 }, (_, index) => ({
    id: `air-${index}`, kind: 'aircraft', side: 'axis', active: true, location: { kind: 'hex', hex: 's10.02' },
  }))
  const pending = submit(record, 'soviet', { type: 'declare-artillery-barrage', target: 's10.02', targetKind: 'air-base',
    batteries: [{ unitId: 'battery' }], supply: { kind: 'direct', payments: [{ dumpId: 'soviet:hex:s10.01', tokens: 2 }] } }, option)
  assert.equal(pending.state.airfieldCapacityChoice.excess, 1)
  assert.throws(() => submit(pending, 'soviet', { type: 'complete-combat' }, option), /capacity first/)
  const choose = { type: 'settle-airfield-capacity', unitIds: ['air-3'] }
  assert.throws(() => submit(pending, 'soviet', choose, option), /excess active aircraft/)
  const settled = submit(pending, 'axis', choose, option)
  assert.equal(settled.state.pieces.filter((unit) => unit.active).length, 5)
  assert.equal(settled.state.airfieldCapacityChoice, null)
})

test('the Scorpion front marker moves from the printed card to its sector, flips, and advances at Soviet reinforcement', () => {
  const aidCatalog = { aliases: new Map(['1st Ukr Arty Ready', '2nd Ukr Arty Ready'].map((ref) =>
    [ref, [{ kind: 'marker', source: { faces: { combat: { asset: `${ref}.png` }, move: { asset: `${ref}-spent.png` } } } }]])) }
  const frame = (state) => scorpionBarrageMarkerFrame(state, aidCatalog)
  const option = { ...board(), barrage: artilleryTable('-') }
  const record = fixture('movement', {
    army: unit('soviet', 's10.01', { headquarters: { throwRange: 2, mobility: 'truck', kessel: false } }),
    artillery: unit('soviet', 's10.01', { printedRe: 2, artillery: { strength: 28, range: 2, independentRe: true } }),
    target: unit('axis', 's10.02'), adjacent: unit('axis', 's10.03'),
  })
  const front = 'first-ukrainian'
  const marker = `artillery:${front}`
  const attack = { type: 'declare-front-barrage', front, center: 's10.02', hqId: 'army',
    volleys: ['s10.02', 's10.03'].map((target) => ({ target, batteries: [{ unitId: 'artillery', re: 1 }] })) }
  assert.equal(scorpionBarrageFrontAt('s8.15'), 'second-ukrainian')
  assert.equal(scorpionBarrageFrontAt('s9.15'), 'first-ukrainian')
  assert.equal(frame(record.state).aidCounters.length, 2)
  assert.throws(() => submit(record, 'soviet', { ...attack, front: 'second-ukrainian' }, option), /Scorpion sector/)
  const active = submit(record, 'soviet', attack, option)
  assert.equal(frame(active.state).mapCounters[0].id, marker)
  assert.equal(frame(active.state).aidCounters.length, 1)
  assert.equal(active.state.dumps['soviet:hex:s10.01'].tokens, 10)

  const terrain = { type: 'choose-barrage-terrain', terrain: 'Open' }
  const first = submit(JSON.parse(JSON.stringify(active)), 'axis', terrain, option)
  assert.equal(first.state.barrage.target, 's10.03')
  assert.equal(frame(first.state).mapCounters[0].id, marker)
  const finished = submit(first, 'axis', terrain, option)
  assert.equal(frame(finished.state).mapCounters.length, 0)
  const spent = frame(finished.state).aidCounters.find(({ id }) => id === marker)
  assert.match(spent.asset, /-spent/)
  assert.equal(finished.state.barrageRecovery[front], 1)
  assert.throws(() => submit(finished, 'soviet', attack, option), /once per front/)
  assert.throws(() => submit(finished, 'soviet', { type: 'ground-move', unitId: 'army', path: ['s10.02'] }, option),
    /Movement Segment has ended/)

  const later = { ...finished, state: { ...finished.state, cursor: { ...finished.state.cursor, turn: 2, phase: 'reinforcement' },
    arrivalsOnMap: [], placedAlerts: [], window: { stage: 'variable', variableTokens: 0 } } }
  const reinforced = submit(later, 'soviet', { type: 'complete-reinforcement' }, { ...option, reinforcements: () => ({}) })
  assert.equal(reinforced.state.barrageRecovery[front], 2)
  assert.equal(frame(reinforced.state).aidCounters.find(({ id }) => id === marker).x - spent.x, 75)
  assert.throws(() => submit(reinforced, 'soviet', { ...attack, front: 'second-ukrainian' }, option), /turn-one/)
})
