import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createRngState } from '@ocs-eastern/series/rng'
import { rollRegularCombat } from '@ocs-eastern/series/tables/ground-combat'
import { scorpionMap } from '../src/import/scorpion-map.ts'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'

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

test('regular odds floor to the printed column and then shift for surprise', () => {
  const dice = [6, 4, 1, 3, 3]
  const result = rollRegularCombat(table('AL1o1 Do1'), 'Open', 12, 1, 0, 0, () => dice.shift())
  assert.equal(result.initialColumn, 11)
  assert.equal(result.column, 12)
  assert.deepEqual(result.attacker, { loss: 1, option: 1 })
})
