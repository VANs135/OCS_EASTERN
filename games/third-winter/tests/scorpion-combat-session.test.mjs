import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createRngState } from '@ocs-eastern/series/rng'
import { rollRegularCombat } from '@ocs-eastern/series/tables/ground-combat'
import { barrageColumn, barrageDensity, rollGroundBarrage } from '@ocs-eastern/series/tables/barrage'
import { scorpionMap } from '../src/import/scorpion-map.ts'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'
import { scorpionPendingCombatDecision } from '../src/match/scorpion-combat-actions.ts'
import { localDecisionSide } from '../desktop/local/actions.mjs'
import { scorpionBarrageFrontAt } from '../src/ttw/scorpion/barrage-markers.ts'
import { scorpionBarrageMarkerFrame } from '../src/view/scorpion-barrage-markers.ts'
import { scorpionSessionBoxFrame } from '../src/view/scorpion-boxes.ts'
import { scorpionMapStacks } from '../src/view/scorpion-map-counters.ts'

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
  moved: [], pieces: [], availableAlerts: [], railControl: {}, rerollHolder: null, airBases: [], combat: null,
  arrivalsOnMap: [], placedAlerts: [], window: null,
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

test('TTW 1.1b ties paid construction, combat protection and capture to the hedgehog counter', () => {
  const hex = 's10.02'
  const owner = (side, level) => ({ side, level })
  const workers = { builder: unit('soviet', hex), escort: unit('soviet', hex) }
  const record = fixture('movement', workers)
  const dumpId = 'soviet:hex:s10.01'
  record.state.dumps[dumpId].tokens = 16
  const build = { type: 'work-hedgehog', operation: 'build', hex, unitIds: ['builder'], payments: [{ dumpId, tokens: 8 }] }
  const moved = { type: 'ground-move', unitId: 'builder', path: ['s10.03'] }
  assert.throws(() => submit(record, 'soviet', { ...build, payments: [] }), /8T/)
  const first = submit(record, 'soviet', build)
  assert.deepEqual(first.state.hedgehogs[hex], owner('soviet', 1))
  assert.equal(first.state.dumps[dumpId].tokens, 8)
  assert.throws(() => submit(first, 'soviet', moved), /unavailable/)
  assert.throws(() => submit(first, 'soviet', { ...build, unitIds: ['escort'] }), /once per turn/)
  const restored = JSON.parse(JSON.stringify(first))
  restored.state.cursor.turn++
  restored.state.moved = []
  const second = submit(restored, 'soviet', build)
  assert.deepEqual(second.state.hedgehogs[hex], owner('soviet', 2))
  const later = { ...second, state: { ...second.state, cursor: { ...second.state.cursor, turn: 3 }, moved: [] } }
  assert.throws(() => submit(later, 'soviet', build), /legal hex/)
  const reduced = submit(later, 'soviet', { ...build, operation: 'reduce', payments: [] })
  assert.deepEqual(reduced.state.hedgehogs[hex], owner('soviet', 1))

  const battle = fixture('combat', { infantry: unit('soviet', 's10.01'), defense: unit('axis', hex) })
  battle.state.hedgehogs = { [hex]: owner('axis', 2) }
  const order = { type: 'declare-combat', target: hex, attackers: ['infantry'], payments: [{ unitId: 'infantry', dumpId, tokens: 1 }] }
  assert.equal(submit(battle, 'soviet', order).state.combat.hedgehog, 2)

  const approach = fixture('movement', { infantry: unit('soviet', 's10.01'), hq: unit('soviet', 's10.01', { attackCapable: false }) })
  approach.state.hedgehogs = { [hex]: owner('axis', 2) }
  const advance = { type: 'ground-move', unitId: 'infantry', path: [hex, 's10.03'] }
  assert.throws(() => submit(approach, 'soviet', { ...advance, unitId: 'hq' }), /attack-capable/)
  const captured = submit(approach, 'soviet', advance)
  assert.deepEqual(captured.state.hedgehogs[hex], owner('soviet', 1))
  assert.equal(captured.state.rng.drawCount, approach.state.rng.drawCount)
  assert.deepEqual(captured.state.captureHistory.at(-1).hedgehog, { before: owner('axis', 2), after: owner('soviet', 1) })
  const catalog = { definitions: new Map([['soviet-counter', { source: { name: 'Infantry', faces: { combat: { asset: 'infantry.png' } } } }]]),
    aliases: new Map([['Hedgehog 1', [{ source: { faces: { combat: { asset: 'hog-1.png' } } } }]]]) }
  const stack = scorpionMapStacks({ ...captured.state, dumps: {} }, catalog, []).find((entry) => entry.hex === hex)
  assert.equal(stack.pages[0][0].asset, 'hog-1.png')
  const counterattack = JSON.parse(JSON.stringify(captured))
  counterattack.state.cursor.phasing = 'axis'
  counterattack.state.units = { infantry: unit('axis', 's10.03') }
  counterattack.state.moved = []
  const removed = submit(counterattack, 'axis', { ...advance, path: [hex] })
  assert.equal(removed.state.hedgehogs[hex], null)
  assert.equal(removed.state.captureHistory.at(-1).hedgehog.after, null)
})

test('aircraft refit charges a reachable dump once per base and respects the active capacity in no-flight weather', () => {
  const record = fixture('aircraft-refit', {})
  record.state.turn.weather = { ground: 'freeze', flight: 'none' }
  record.state.airBases = [{ side: 'soviet', hex: 's10.02', level: 1 }]
  record.state.pieces = Array.from({ length: 6 }, (_, index) => ({
    id: `plane-${index}`, side: 'soviet', kind: 'aircraft', location: { kind: 'hex', hex: 's10.02' },
    active: index < 3, reduced: index === 3,
  }))
  const dumpId = 'soviet:hex:s10.01'
  const action = { type: 'refit-aircraft', base: { kind: 'hex', hex: 's10.02', dumpId }, unitIds: ['plane-3', 'plane-4'] }
  assert.throws(() => submit(record, 'axis', action), /phasing side/)
  assert.throws(() => submit(record, 'soviet', { ...action, unitIds: [...action.unitIds, 'plane-5'] }), /capacity/)
  const thaw = { ...record, state: { ...record.state, turn: { ...record.state.turn, weather: { ground: 'thaw', flight: 'none' } } } }
  assert.throws(() => submit(thaw, 'soviet', action), /capacity/)
  assert.equal(submit(thaw, 'soviet', { ...action, unitIds: ['plane-3'] }).state.pieces[3].active, true)
  const refitted = submit(record, 'soviet', action)
  assert.equal(refitted.state.dumps[dumpId].tokens, 9)
  assert.equal(refitted.state.pieces.filter((plane) => plane.active).length, 5)
  assert.equal(refitted.state.pieces[3].reduced, true)
  assert.throws(() => submit(refitted, 'soviet', { ...action, unitIds: ['plane-5'] }), /already refitted/)
  assert.equal(submitScorpionSession(JSON.parse(JSON.stringify(refitted)), 'soviet', command(record, action), assets, board()).duplicate, true)
  const reinforcement = submit(refitted, 'soviet', { type: 'complete-refit' }, { ...board(), reinforcements: () => ({}) })
  assert.equal(reinforcement.state.cursor.phase, 'reinforcement')
  assert.deepEqual(reinforcement.state.refittedAirbases, [])
})

test('enemy ZOC blocks on-map aircraft refit and the off-map box refits freely', () => {
  const record = fixture('aircraft-refit', { enemy: unit('axis', 's10.03') })
  record.state.airBases = [{ side: 'soviet', hex: 's10.02', level: 1 }]
  record.state.pieces = [
    { id: 'field', side: 'soviet', kind: 'aircraft', location: { kind: 'hex', hex: 's10.02' }, active: false },
    { id: 'off-map', side: 'soviet', kind: 'aircraft', location: { kind: 'off-map-air' }, active: false },
  ]
  const field = { type: 'refit-aircraft', base: { kind: 'hex', hex: 's10.02', dumpId: 'soviet:hex:s10.01' }, unitIds: ['field'] }
  assert.throws(() => submit(record, 'soviet', field), /unnegated enemy ZOC/)
  const offMap = { type: 'refit-aircraft', base: { kind: 'off-map-air' }, unitIds: ['off-map'] }
  assert.throws(() => submit(record, 'soviet', { ...offMap, unitIds: ['field'] }), /inactive friendly aircraft at this base/)
  const refitted = submit(record, 'soviet', offMap)
  assert.equal(refitted.state.pieces[1].active, true)
  assert.equal(refitted.state.pieces[0].active, false)
  assert.equal(refitted.state.dumps['soviet:hex:s10.01'].tokens, 10)
  record.state.units.cover = unit('soviet', 's10.02', { moveMode: true })
  const covered = submit(record, 'soviet', field)
  assert.equal(covered.state.pieces[0].active, true)
  assert.equal(covered.state.dumps['soviet:hex:s10.01'].tokens, 9)
})

test('regular combat discloses each decision in order, updates the dead pile and permits advancement', () => {
  let record = fixture('combat', { infantry: unit('soviet', 's10.01'), defense: unit('axis', 's10.02') })
  const expectWindow = (step, actor, actionType) => {
    assert.deepEqual(scorpionPendingCombatDecision(record.state), { kind: 'regular', target: 's10.02', step, actor, actionType })
    assert.equal(localDecisionSide(record.state), actor)
  }
  record = submit(record, 'soviet', { type: 'declare-combat', target: 's10.02', attackers: ['infantry'],
    payments: [{ unitId: 'infantry', dumpId: 'soviet:hex:s10.01', tokens: 1 }] })
  expectWindow('defender-supply', 'axis', 'defend-combat')
  assert.equal(record.state.dumps['soviet:hex:s10.01'].tokens, 9)
  assert.throws(() => submit(record, 'soviet', { type: 'complete-combat' }), /pending combat/)
  assert.throws(() => submit(record, 'soviet', { type: 'select-combat-rating', unitId: 'infantry' }), /correct order/)
  record = submit(record, 'axis', { type: 'defend-combat', payments: [] })
  expectWindow('attacker-rating', 'soviet', 'select-combat-rating')
  assert.throws(() => submit(record, 'axis', { type: 'select-combat-rating', unitId: 'defense' }), /responding side/)
  record = submit(record, 'soviet', { type: 'select-combat-rating', unitId: 'infantry' })
  expectWindow('defender-rating', 'axis', 'select-combat-rating')
  assert.throws(() => submit(record, 'axis', { type: 'choose-combat-terrain', terrain: 'Open' }), /correct order/)
  record = submit(record, 'axis', { type: 'select-combat-rating', unitId: 'defense' })
  expectWindow('defender-terrain', 'axis', 'choose-combat-terrain')
  assert.equal(record.state.rng.drawCount, 0)
  const terrain = { type: 'choose-combat-terrain', terrain: 'Open', attackingTerrain: { 's10.01': 'Open' } }
  const id = command(record, terrain)
  record = submit(record, 'axis', terrain)
  expectWindow('attacker-result', 'soviet', 'resolve-combat')
  assert.equal(record.state.combat.roll.code, 'Ae4 DL1o1')
  assert.throws(() => submit(record, 'axis', { type: 'resolve-combat', lossOrder: ['defense'], optionLosses: 0, retreats: [] }),
    /responding side/)
  const restored = JSON.parse(JSON.stringify(record))
  assert.equal(submitScorpionSession(restored, 'axis', id, assets, board()).duplicate, true)
  record = submit(restored, 'soviet', { type: 'resolve-combat', lossOrder: [], optionLosses: 0, retreats: [] })
  expectWindow('defender-result', 'axis', 'resolve-combat')
  assert.equal(record.state.units.infantry.exploit, true)
  record = submit(record, 'axis', { type: 'resolve-combat', lossOrder: ['defense'], optionLosses: 0, retreats: [] })
  expectWindow('advance', 'soviet', 'advance-after-combat')
  assert.equal(record.state.arrival.sovietVp, 1)
  assert.equal(record.state.pieces[0].id, 'defense')
  record = submit(record, 'soviet', { type: 'advance-after-combat', unitIds: ['infantry'] })
  assert.equal(record.state.units.infantry.hex, 's10.02')
  assert.equal(record.state.railControl['s10.02'], undefined)
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
  assert.equal(record.state.railControl['s10.03'], undefined)
  assert.equal(record.state.combat.step, 'advance')
})

test('9.12f settles captures during retreat and preserves the previous pause for legacy saves', () => {
  const origin = 's10.02'
  const target = 's10.03'
  const destination = 's10.04'
  const alternate = 's11.04'
  const edges = [['s10.01', origin], [origin, target], [target, destination], [target, alternate]]
  const map = scorpionMap([...new Set(edges.flat())].map((hex_id) => ({ hex_id, on_map: true, terrains_present: ['Open'] })),
    edges.map(([hex_a, hex_b]) => ({ hex_a, hex_b, edge_terrain: 'none', road_present: false, rail_present: false, bridge: false })))
  const source = { name: 'Fighter', side: 'soviet', faces: { combat: { stats: { range: 10 } }, move: { stats: { range: 5 } } } }
  const truck = (side, name) => ({ key: name, kind: 'transport', source: { side, name,
    faces: { combat: { stats: { transport: 1, move: 45 }, maColor: 'black' } } } })
  const sovietTruck = truck('soviet', 'Sov Truck')
  const axisTruck = truck('axis', 'Ge Truck')
  const local = { ...assets, map, catalog: { definitions: new Map([['fighter', { kind: 'aircraft', source }],
    ['Sov Truck', sovietTruck], ['Ge Truck', axisTruck]]), aliases: new Map([['Ge Truck', [axisTruck]]]) } }
  const options = board('Ae4 Do2')
  const issue = (at, side, action, legacy = {}) => submitScorpionSession(at, side, command(at, action), local, { ...options, ...legacy }).record
  let record = fixture('combat', { a: unit('soviet', 's10.01'), d: unit('axis', origin) })
  const dumpId = `soviet:hex:${target}`
  record.state.dumps[dumpId] = { side: 'soviet', tokens: 4, location: 'on-map' }
  record.state.airBases = [{ hex: target, side: 'soviet', level: 1 }]
  record.state.pieces = [{ id: 'fighter', kind: 'aircraft', side: 'soviet', definition: 'fighter', active: true,
    location: { kind: 'hex', hex: target } }]
  record = issue(record, 'soviet', { type: 'declare-combat', target: origin, attackers: ['a'],
    payments: [{ unitId: 'a', dumpId: 'soviet:hex:s10.01', tokens: 1 }] })
  record = issue(record, 'axis', { type: 'defend-combat', payments: [] })
  record = issue(record, 'soviet', { type: 'select-combat-rating', unitId: 'a' })
  record = issue(record, 'axis', { type: 'select-combat-rating', unitId: 'd' })
  record = issue(record, 'axis', { type: 'choose-combat-terrain', terrain: 'Open', attackingTerrain: { 's10.01': 'Open' } })
  const noLoss = { type: 'resolve-combat', lossOrder: [], optionLosses: 0, retreats: [] }
  record = issue(record, 'soviet', noLoss)
  const retreat = { ...noLoss, retreats: [{ units: ['d'], path: [target, destination] }] }
  const dumpOnly = { ...record, state: { ...record.state, airBases: [], pieces: [] } }
  const uninterrupted = issue(dumpOnly, 'axis', retreat)
  assert.equal(uninterrupted.state.units.d.hex, destination)
  assert.equal(uninterrupted.state.combat.step, 'advance')
  assert.equal(uninterrupted.state.captureHistory[0].dump.destroyed + uninterrupted.state.captureHistory[0].dump.taken, 4)

  const nonCaptor = { ...record, state: { ...record.state, units: { ...record.state.units, d: { ...record.state.units.d, attackCapable: false } } } }
  assert.throws(() => issue(nonCaptor, 'axis', retreat), /attack-capable/)
  const automatically = issue(record, 'axis', retreat)
  assert.equal(automatically.state.units.d.hex, destination)
  assert.equal(automatically.state.capture, null)
  assert.equal(automatically.state.pieces[0].location.kind, 'off-map-air')
  assert.equal(automatically.state.combat.step, 'advance')
  const legacy = { captureResolution: 'manual' }
  const paused = issue(record, 'axis', retreat, legacy)
  assert.equal(paused.state.units.d.hex, target)
  assert.equal(paused.state.railControl[target], undefined)
  assert.equal(paused.state.capture.owner, 'soviet')
  assert.equal(paused.state.combat.retreat.nextStep, 1)
  assert.equal(paused.state.dumps[dumpId], undefined)
  assert.equal(paused.state.airBases[0].side, 'axis')
  assert.equal(paused.state.rng.drawCount - record.state.rng.drawCount, 2)
  const move = { type: 'continue-combat-retreat' }
  assert.throws(() => issue(paused, 'axis', move), /pending special capture/)
  const displace = { type: 'settle-capture', aircraft: [{ id: 'fighter', destination: { kind: 'off-map-air' } }] }
  assert.throws(() => issue(paused, 'axis', displace), /original owner/)
  const response = command(paused, displace)
  const settled = issue(JSON.parse(JSON.stringify(paused)), 'soviet', displace)
  assert.equal(submitScorpionSession(settled, 'soviet', response, local, options).duplicate, true)
  assert.equal(settled.state.pieces[0].location.kind, 'off-map-air')
  assert.throws(() => issue(settled, 'soviet', move), /retreating side/)
  assert.throws(() => issue(settled, 'axis', retreat), /pending combat retreat/)
  assert.throws(() => issue(settled, 'axis', { ...move, routes: [{ path: [] }] }), /full option distance/)
  const resumed = issue(settled, 'axis', move)
  assert.equal(resumed.state.units.d.hex, destination)
  assert.equal(resumed.state.units.d.disorganized, true)
  assert.equal(resumed.state.combat.step, 'advance')
  assert.equal(resumed.state.combat.retreat, undefined)
  assert.equal(resumed.state.captureHistory.length, 1)
  assert.equal(resumed.state.rng.drawCount, paused.state.rng.drawCount)
  const rerouted = issue(settled, 'axis', { ...move, routes: [{ path: [alternate] }] })
  assert.equal(rerouted.state.units.d.hex, alternate)
  assert.equal(rerouted.state.railControl[alternate], undefined)

  const twoCaptures = { ...record, state: { ...record.state, units: { ...record.state.units,
    truck: unit('soviet', destination, { combat: false, allowance: 45, definition: 'Sov Truck' }) } } }
  const autoTwo = issue(twoCaptures, 'axis', retreat)
  assert.deepEqual(autoTwo.state.captureHistory.map(({ hex }) => hex), [target, destination])
  assert.ok(Object.entries(autoTwo.state.units).filter(([id, unit]) => id.startsWith('captured:') && unit.side === 'axis')
    .every(([id]) => autoTwo.state.moved.includes(id)))
  const passedAirBase = issue(issue(twoCaptures, 'axis', retreat, legacy), 'soviet', displace)
  const stoppedAgain = issue(passedAirBase, 'axis', move, legacy)
  assert.equal(stoppedAgain.state.units.d.hex, destination)
  assert.equal(stoppedAgain.state.capture.hex, destination)
  const [group] = stoppedAgain.state.capture.transports
  const transportReply = issue(stoppedAgain, 'soviet', { type: 'settle-capture', aircraft: [], transports: [
    { id: 'truck', takenPoints: group.points, takenTokens: 0, displacedTo: alternate },
  ] })
  const completed = issue(transportReply, 'axis', move)
  assert.equal(completed.state.combat.step, 'advance')
  assert.deepEqual(completed.state.captureHistory.map(({ hex }) => hex), [target, destination])
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
  record.state.dumps['axis:hex:s10.02'] = { side: 'axis', tokens: 7, location: 'on-map' }
  const attack = { type: 'declare-overrun', target: 's10.02', attackers: [unitId],
    payments: [{ unitId, dumpId, tokens: 1 }] }
  for (const remaining of [4, 1]) {
    record = submit(record, 'soviet', attack, option)
    assert.equal(record.state.overrunMarch.remaining[unitId], remaining)
    assert.equal(record.state.units.attack.hex, 's10.01')
    assert.throws(() => submit(record, 'soviet', { type: 'complete-movement' }, option), /pending combat/)
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
  assert.equal(record.state.dumps['axis:hex:s10.02'], undefined)
  const [{ dump }] = record.state.captureHistory
  assert.equal(dump.taken + dump.destroyed, 7)
  assert.deepEqual(record.state.combatTargets, [])
  record = submit(record, 'soviet', { type: 'continue-overrun-move', path: ['s10.03'] }, option)
  assert.equal(record.state.units.attack.hex, 's10.03')
  assert.equal(record.state.overrunMarch, null)
})

test('capturing an air base displaces survivors automatically and movement continues through the hex', () => {
  const from = 's10.01'
  const target = 's10.02'
  const next = 's10.03'
  const record = fixture('movement', { attacker: unit('soviet', from) })
  record.state.dumps['axis:hex:s10.02'] = { side: 'axis', tokens: 8, location: 'on-map' }
  record.state.airBases = [{ side: 'axis', hex: target, level: 2 }]
  const plane = { side: 'axis', kind: 'aircraft', definition: 'fighter', location: { kind: 'hex', hex: target } }
  record.state.pieces = [{ ...plane, id: 'fighter', active: true }, { ...plane, id: 'reduced', reduced: true, active: false }]
  const definition = { kind: 'aircraft', source: { name: 'Fighter', side: 'axis',
    faces: { combat: { asset: 'fighter-full.png', stats: { range: 20 } },
      move: { asset: 'fighter-reduced.png', stats: { range: 20 } } } } }
  const aliases = new Map(['Turn', 'Ground', 'Flight', 'Soviet VPs Tracker'].map((name) =>
    [name, [{ kind: 'marker', source: { faces: { combat: { asset: `${name}.png` } } } }]]))
  const local = { ...assets, catalog: { definitions: new Map([['fighter', definition]]), aliases } }
  const play = (at, side, action) => submitScorpionSession(at, side, command(at, action), local, board()).record
  const move = { type: 'ground-move', unitId: 'attacker', path: [target, next] }
  assert.equal(record.state.rng.drawCount, 0)
  const settled = play(record, 'soviet', move)
  assert.equal(settled.state.units.attacker.hex, next)
  assert.equal(settled.state.capture, null)
  assert.deepEqual(settled.state.airBases, [{ side: 'soviet', hex: target, level: 2 }])
  assert.equal(settled.state.dumps['soviet:hex:s10.02'].tokens, 2)
  assert.equal(settled.state.pieces[0].reduced, true)
  assert.equal(settled.state.pieces[1].location.kind, 'dead-pile')
  assert.equal(settled.state.pieces[0].location.kind, 'off-map-air')
  assert.equal(settled.state.pieces[0].active, false)
  assert.equal(settled.state.rng.drawCount, 3)
  const boxes = scorpionSessionBoxFrame(settled.state, local.catalog, 'axis').inventories
  assert.equal(boxes.find(({ cell }) => cell === 20).counters[0].asset, 'fighter-reduced.png')
  assert.equal(boxes.find(({ cell }) => cell === 19).counters[0].id, 'reduced')
  assert.deepEqual(play(record, 'soviet', move), settled)
})

test('transport capture uses the group percentage and preserves the independently rounded points and cargo', () => {
  const target = 's10.02'
  const ground = (side, name, transport) => ({ key: name, kind: 'transport', source: { side, name,
    faces: { combat: { stats: { transport, move: 45 }, maColor: 'black' } } } })
  const rows = [ground('axis', 'two', 2), ground('axis', 'organic', 1), ground('soviet', 'Sov Truck', 1)]
  const local = { ...assets, catalog: { definitions: new Map(rows.map((row) => [row.key, row])),
    aliases: new Map(rows.map((row) => [row.key, [row]])) } }
  const record = fixture('movement', { attacker: unit('soviet', 's10.01'),
    transport: unit('axis', target, { combat: false, allowance: 45, definition: 'two' }),
    organic: unit('axis', target, { combat: false, allowance: 45, definition: 'organic', organicTruck: 'full' }) })
  record.state.rng = createRngState(12)
  const play = (at, side, action) => submitScorpionSession(at, side, command(at, action), local, board()).record
  const settled = play(record, 'soviet', { type: 'ground-move', unitId: 'attacker', path: [target, 's10.03'] })
  const report = settled.state.captureHistory.at(-1)
  const [group] = report.transports
  assert.deepEqual([group.die, group.points, group.tokens], [3, 1, 1])
  assert.equal(settled.state.capture, null)
  assert.equal(settled.state.captureHistory.length, 1)
  assert.equal(settled.state.units.attacker.hex, 's10.03')
  const displacedTo = 's10.01'
  assert.deepEqual(report.transportAllocation, [{ id: 'organic', takenPoints: 1, takenTokens: 1, displacedTo },
    { id: 'transport', takenPoints: 0, takenTokens: 0, displacedTo }])
  const [captured] = Object.values(settled.state.units).filter((item) => item.side === 'soviet' && !item.combat)
  assert.equal(captured.definition, 'Sov Truck')
  assert.equal(captured.transportCargoTokens, 1)
  assert.equal(settled.state.moved.some((id) => id.startsWith('captured:')), false)
  assert.equal(settled.state.units.transport.hex, displacedTo)
  assert.equal(settled.state.dumps[`axis:hex:${displacedTo}`].tokens, 3)
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

function openDefense(defenders, tokens = 0) {
  const record = fixture('combat', { attacker: unit('soviet', 's10.01', { strength: 14 }), ...defenders })
  if (tokens) record.state.dumps['axis:hex:s10.02'] = { side: 'axis', location: 'on-map', tokens }
  return submit(record, 'soviet', { type: 'declare-combat', target: 's10.02', attackers: ['attacker'],
    payments: [{ unitId: 'attacker', dumpId: 'soviet:hex:s10.01', tokens: 1 }] })
}

test('two 1 RE defenders cannot partly pay a 2T stack cost, and neither wastes the insufficient 1T', () => {
  const target = 's10.02'
  const start = openDefense({ first: unit('axis', target), second: unit('axis', target, { outOfSupply: true }) }, 1)
  const dumpId = `axis:hex:${target}`
  const action = { type: 'defend-combat', payments: [{ dumpId, tokens: 1 }] }
  assert.throws(() => submit(start, 'axis', action), /full defending stack cost/)
  assert.throws(() => submit(start, 'axis', { ...action, internalUnitIds: ['second'] }), /full defending stack cost/)
  assert.equal(start.state.dumps[dumpId].tokens, 1)
  const both = submit(start, 'axis', { type: 'defend-combat', payments: [], internalUnitIds: ['first', 'second'] })
  assert.equal(both.state.units.first.internalStocks, 'low')
  assert.equal(both.state.units.second.internalStocks, 'low')
  assert.equal(both.state.dumps[dumpId].tokens, 1)
  const onlyFirst = submit(start, 'axis', { type: 'defend-combat', payments: [], internalUnitIds: ['first'] })
  let partial = JSON.parse(JSON.stringify(onlyFirst))
  partial = submit(partial, 'soviet', { type: 'select-combat-rating', unitId: 'attacker' })
  partial = submit(partial, 'axis', { type: 'select-combat-rating', unitId: 'first' })
  const resolved = submit(partial, 'axis', { type: 'choose-combat-terrain', terrain: 'Open', attackingTerrain: { 's10.01': 'Open' } })
  // 14 attack vs. 4 + 1 defense (the second defender withheld combat supply and is out of trace supply).
  assert.equal(resolved.state.combat.roll.initialColumn, columns.indexOf('3:1'))
})

test('defensive internal supply wastes the insufficient regular draw of a multi-step unit but can leave organic cargo', () => {
  const target = 's10.02'
  const dumpId = `axis:hex:${target}`
  const division = unit('axis', target, { printedRe: 2, internalStocks: 'low', formation: 'panzer' })
  const truck = unit('axis', target, { combat: false, organicTruck: 'full', formation: 'panzer' })
  const limited = openDefense({ division, truck }, 1)
  const stocks = { type: 'defend-combat', payments: [], internalUnitIds: ['division'] }
  const paid = submit(limited, 'axis', stocks)
  assert.equal(paid.state.units.division.internalStocks, 'exhausted')
  assert.equal(paid.state.dumps[dumpId].tokens, 0)
  assert.equal(paid.state.units.truck.transportCargoTokens, undefined)
  limited.state.dumps[dumpId].tokens = 2
  assert.throws(() => submit(limited, 'axis', stocks), /required on-map/)
  const withheld = submit(limited, 'axis', { ...stocks, internalUnitIds: [] })
  assert.equal(withheld.state.dumps[dumpId].tokens, 2)
  assert.equal(withheld.state.units.division.internalStocks, 'low')
})

test('two organic trucks can supply different defenders in the same combat without supplying other formations', () => {
  const target = 's10.02'
  const defender = (formation) => unit('axis', target, { formation })
  const truck = (formation) => unit('axis', target, { combat: false, organicTruck: 'full', formation })
  const record = openDefense({ p1: defender('one'), p2: defender('two'), truck1: truck('one'), truck2: truck('two') })
  const action = { type: 'defend-combat', payments: [{ dumpId: 'truck1', tokens: 1 }, { dumpId: 'truck2', tokens: 1 }] }
  assert.throws(() => submit(record, 'axis', { ...action, payments: [{ dumpId: 'truck1', tokens: 2 }] }), /Each defender/)
  const supplied = submit(record, 'axis', action)
  assert.equal(supplied.state.combat.defenseSupplied, true)
  assert.equal(supplied.state.units.truck1.transportCargoTokens, 3)
  assert.equal(supplied.state.units.truck2.transportCargoTokens, 3)
  assert.deepEqual(supplied.state.combat.defenseInternalUnits, [])
  const dumpId = `axis:hex:${target}`
  record.state.dumps[dumpId] = { side: 'axis', location: 'on-map', tokens: 1 }
  const mixed = submit(record, 'axis', { ...action, payments: [{ dumpId, tokens: 1 }, { dumpId: 'truck1', tokens: 1 }] })
  assert.equal(mixed.state.combat.defenseSupplied, true)
  assert.equal(mixed.state.dumps[dumpId].tokens, 0)
  assert.equal(mixed.state.units.truck1.transportCargoTokens, 3)
  assert.equal(mixed.state.units.truck2.transportCargoTokens, undefined)
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
  record.state.rerollHolder = 'axis'
  const damage = submit(record, 'soviet', attack, option)
  const keep = { type: 'resolve-reroll', decision: 'keep' }
  assert.equal(damage.state.reroll.current.site.kind, 'airfield-barrage')
  assert.equal(damage.state.reroll.current.draw.value.count, 1)
  const firstLoss = submit(damage, 'axis', keep, option)
  assert.deepEqual(firstLoss.state.reroll.current.site, { kind: 'airfield-loss', hex: 's10.02', unitId: 'full' })
  assert.equal(firstLoss.state.airBases[0].level, 2)
  assert.equal(firstLoss.state.dumps['soviet:hex:s10.01'].tokens, 10)
  const secondLoss = submit(firstLoss, 'axis', keep, option)
  assert.equal(secondLoss.state.reroll.current.site.unitId, 'reduced')
  const hit = submit(secondLoss, 'axis', keep, option)
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
