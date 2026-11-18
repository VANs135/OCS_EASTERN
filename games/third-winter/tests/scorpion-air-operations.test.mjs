import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createRngState, roll2d6 } from '@ocs-eastern/series/rng'
import { flakLossCandidates, rollAirCombat } from '@ocs-eastern/series/tables/air'
import { scorpionRegularBarrageTargets } from '../src/match/scorpion-barrage-timing.ts'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'
import { scorpionMapStacks } from '../src/view/scorpion-map-counters.ts'

const hex = (hex) => ({ kind: 'hex', hex })
const box = { kind: 'off-map-air' }
const sovietBase = hex('s12.04')
const axisBase = hex('s16.04')
const airBase = (side, base) => ({ side, hex: base.hex, level: 1 })
function plane(id, side, location, { battle = 3, range = 12, fighter = true, airGroup = '独立', active = true,
  reduced = false, name = id, fullBombing = 2, reducedBombing = fullBombing } = {}) {
  const face = (asset, airCombat, bombing) => ({ asset, stats: { range, airCombat, bombing, defensiveOnly: !fighter } })
  const source = { name, side, org: { airGroup }, abilities: fighter ? ['interception'] : ['barrage'],
    faces: { combat: face('full.png', battle, fullBombing), move: face('reduced.png', battle - 1, reducedBombing) } }
  return { piece: { id, side, kind: 'aircraft', definition: id, location, active, reduced }, source }
}
function match(planes, { flight = 'limited', phase = 'movement', seed = 1, phasing = 'soviet', extraBases = [],
  units = {}, board, map } = {}) {
  const assets = { map, catalog: { definitions: new Map(planes.map(({ piece, source }) => [piece.id, { kind: 'aircraft', source }])),
    aliases: new Map() } }
  const record = { revision: 0, receipts: [], state: { kind: 'playing', rng: createRngState(seed), units, dumps: {},
    arrival: { sovietVp: 0 }, availableAlerts: [],
    turn: { number: 1, weather: { ground: 'freeze', flight }, step: { kind: 'player-turn' } },
    cursor: { turn: 1, first: phasing, phasing, phase }, combat: null, combatTargets: [],
    airBases: [airBase('soviet', sovietBase), airBase('axis', axisBase), ...extraBases], pieces: planes.map(({ piece }) => piece) } }
  const command = (at, action) => ({ id: `flight-${at.revision}`, expectedRevision: at.revision, action })
  const submit = (at, side, action) => submitScorpionSession(at, side, command(at, action), assets, board).record
  return { record, assets, command, submit }
}
const launch = (mission, target, ...unitIds) => ({ type: 'launch-air-mission', mission, target, unitIds })
const abort = (...unitIds) => ({ type: 'choose-air-aborts', unitIds })
const choose = (unitId) => ({ type: 'choose-air-combat-unit', unitId })
const flyHome = (unitId, base) => ({ type: 'return-aircraft', unitId, base })
const intercept = (unitId) => ({ type: 'respond-interception', unitId })
const getPlane = (record, id) => record.state.pieces.find((piece) => piece.id === id)
const seedWhere = (check) => Array.from({ length: 100 }, (_, i) => i).find((seed) => check(createRngState(seed)))

test('transfer applies off-map normal range, aircraft type and weather, and locks each aircraft to one mission per phase', () => {
  const planes = [plane('fighter', 'soviet', box), plane('bomber', 'soviet', box, { fighter: false }),
    plane('off-map patrol', 'axis', box)]
  const action = launch('base-transfer', sovietBase, 'fighter', 'bomber')
  const { record, submit } = match(planes)
  const moved = submit(record, 'soviet', action)
  assert.equal(moved.state.airMission, null)
  assert.equal(moved.state.rng.drawCount, 0)
  assert.deepEqual(getPlane(moved, 'fighter').location, sovietBase)
  assert.equal(getPlane(moved, 'fighter').active, true)
  assert.equal(getPlane(moved, 'bomber').active, false)
  assert.throws(() => submit(moved, 'soviet', launch('base-transfer', box, 'fighter')), /unused active/)
  const limited = match(planes, { phase: 'reaction', phasing: 'axis' })
  assert.throws(() => limited.submit(limited.record, 'soviet', action), /Flight conditions/)
  const noFlight = match(planes, { flight: 'none' })
  assert.throws(() => noFlight.submit(noFlight.record, 'soviet', action), /Flight conditions/)
  const normal = match(planes, { phase: 'reaction', phasing: 'axis', flight: 'normal' })
  assert.equal(getPlane(normal.submit(normal.record, 'soviet', action), 'fighter').active, true)
})

test('on-map transfer respects double range and forces excess active aircraft to be stood down', () => {
  const another = hex('s2.04')
  const fighters = Array.from({ length: 5 }, (_, i) => plane(`garrison ${i}`, 'soviet', another))
  const { record, submit } = match([...fighters, plane('long', 'soviet', sovietBase, { range: 5 }),
    plane('short', 'soviet', sovietBase, { range: 4 }), plane('box', 'soviet', box)],
  { extraBases: [airBase('soviet', another)] })
  assert.throws(() => submit(record, 'soviet', launch('base-transfer', another, 'short')), /out of range/)
  const long = submit(record, 'soviet', launch('base-transfer', another, 'long'))
  assert.equal(getPlane(long, 'long').active, false)
  assert.equal(long.state.airfieldCapacityChoice, null)
  const excess = submit(long, 'soviet', launch('base-transfer', another, 'box'))
  assert.equal(excess.state.airfieldCapacityChoice.excess, 1)
  const settled = submit(excess, 'soviet', { type: 'settle-airfield-capacity', unitIds: ['garrison 0'] })
  assert.equal(getPlane(settled, 'garrison 0').active, false)
  assert.equal(getPlane(settled, 'box').active, true)
})

test('fighter sweep checks Air Army sectors and moves the aircraft from mission hex to the chosen base', () => {
  const seed = seedWhere((rng) => rollAirCombat(rng, 3, 2).defenderAborts)
  const parked = Array.from({ length: 4 }, (_, i) => plane(`parked ${i}`, 'axis', axisBase, { active: false }))
  const { record, assets, submit, command } = match([...parked, plane('west', 'soviet', box, { airGroup: '2nd Air Army' }),
    plane('independent', 'soviet', box), plane('defender', 'axis', axisBase, { battle: 2, fighter: false })], { seed })
  assert.throws(() => submit(record, 'soviet', launch('fighter-sweep', axisBase, 'west')), /sector/)
  let flying = submit(record, 'soviet', launch('fighter-sweep', axisBase, 'independent'))
  assert.throws(() => submit(flying, 'soviet', { type: 'complete-movement' }), /pending air mission/)
  const counters = (rec) => scorpionMapStacks(rec.state, assets.catalog, []).flatMap(({ pages }) => pages.flat())
  const targetStack = scorpionMapStacks(flying.state, assets.catalog, []).find(({ hex }) => hex === axisBase.hex)
  assert.ok(targetStack.pages[0].some(({ id }) => id === 'independent'))
  assert.deepEqual(counters(flying).find(({ id }) => id === 'independent').badges.map(({ text }) => text), ['飞'])
  assert.throws(() => submit(flying, 'soviet', abort('independent')), /leave at least one/)
  flying = submit(flying, 'soviet', abort())
  flying = submit(flying, 'axis', abort())
  flying = submit(flying, 'soviet', choose('independent'))
  const finalRound = command(flying, choose('defender'))
  flying = submit(flying, 'axis', choose('defender'))
  flying = JSON.parse(JSON.stringify(flying))
  assert.equal(submitScorpionSession(flying, 'axis', finalRound, assets).duplicate, true)
  assert.equal(flying.state.airMission.step.kind, 'return')
  assert.equal(flying.state.rng.drawCount, 3)
  assert.deepEqual(getPlane(flying, 'defender').location, axisBase)
  assert.equal(getPlane(flying, 'defender').active, false)
  assert.equal(counters(flying).find(({ id }) => id === 'independent').badges[0].text, '返')
  assert.throws(() => submit(flying, 'soviet', flyHome('independent', axisBase)), /friendly base/)
  const landed = submit(flying, 'soviet', flyHome('independent', box))
  assert.equal(counters(landed).some(({ id }) => id === 'independent'), false)
  assert.equal(landed.state.airHistory[0].rounds.length, 1)
  assert.equal(landed.state.airHistory[0].flak, undefined)
  assert.equal(getPlane(landed, 'independent').active, false)
  const axis = match([plane('fighter', 'axis', box), plane('defender', 'soviet', sovietBase)], { phasing: 'axis' })
  assert.equal(axis.submit(axis.record, 'axis', launch('fighter-sweep', sovietBase, 'fighter')).state.airMission.kind, 'fighter-sweep')
})

test('an accepted interceptor fights alongside non-mission aircraft and returns active if it wins', () => {
  const seed = seedWhere((rng) => rollAirCombat(rng, 9, 1).total >= 8)
  const { record, submit } = match([plane('transfer', 'soviet', box, { battle: 1, fighter: false }),
    plane('resident', 'soviet', sovietBase, { battle: 1, fighter: false }),
    plane('interceptor', 'axis', axisBase, { battle: 9 })], { seed })
  let flying = submit(record, 'soviet', launch('base-transfer', sovietBase, 'transfer'))
  assert.deepEqual(flying.state.airMission.step.candidates, ['interceptor'])
  flying = submit(flying, 'axis', intercept('interceptor'))
  flying = submit(flying, 'axis', abort())
  flying = submit(flying, 'soviet', abort())
  flying = submit(flying, 'axis', choose('interceptor'))
  flying = submit(flying, 'soviet', choose('resident'))
  assert.equal(getPlane(flying, 'resident').active, false)
  flying = submit(flying, 'axis', choose('interceptor'))
  flying = submit(flying, 'soviet', choose('transfer'))
  flying = submit(flying, 'axis', abort())
  assert.deepEqual(getPlane(flying, 'interceptor').location, axisBase)
  assert.equal(getPlane(flying, 'interceptor').active, true)
  assert.equal(getPlane(flying, 'transfer').active, false)
  assert.equal(flying.state.airHistory[0].flak, undefined)
})

test('passing interception still rolls Flak and puts a reduced mission aircraft in the dead pile', () => {
  const seed = seedWhere((rng) => roll2d6(rng).value.total >= 8)
  const { record, submit } = match([plane('transfer', 'soviet', box, { fighter: false, reduced: true }),
    plane('interceptor', 'axis', axisBase)], { seed })
  const flying = submit(record, 'soviet', launch('base-transfer', sovietBase, 'transfer'))
  assert.throws(() => submit(flying, 'soviet', intercept(null)), /No air decision/)
  const resolved = submit(flying, 'axis', intercept(null))
  assert.equal(resolved.state.airHistory[0].flak.lossId, 'transfer')
  assert.deepEqual(getPlane(resolved, 'transfer').location, { kind: 'dead-pile' })
  assert.equal(getPlane(resolved, 'interceptor').active, true)
  assert.deepEqual(flakLossCandidates([2, 1, 1, 4], 5), [1, 2])
})

const target = hex('s14.04')
const adjacent = hex('s14.05')
const map = { hexes: new Map([target, axisBase, sovietBase, adjacent].map(({ hex }) => [hex, { terrains: ['Open'] }])),
  neighbors: (id) => id === target.hex ? [adjacent.hex] : id === adjacent.hex ? [target.hex] : [] }
const ground = (side, location, extra = {}) => ({ side, hex: location.hex, combat: true, strength: 2,
  combatClass: 'other', printedRe: 1, stepsLost: 0, ...extra })
const table = (code, facility = false) => ({ columns: ['1 or less', '2-4', '5-8', '9+'], costs: [1, 1, 1, 2],
  matrix: Array.from({ length: facility ? 6 : 11 }, () => Array(4).fill(code)) })
const terrain = { type: 'choose-barrage-terrain', terrain: 'Open' }
const loss = (unitId) => ({ type: 'assign-barrage-loss', allocation: [{ unitId, steps: 1 }] })

test('ordinary air barrage finishes air defense, applies DG without an air [1/2] loss, and returns without spending SP', () => {
  const seed = seedWhere((rng) => roll2d6(rng).value.total < 11)
  const { record, submit } = match([plane('box bomber', 'soviet', box), plane('nearby', 'soviet', sovietBase)],
    { seed, units: { target: ground('axis', target, { reserve: 'group' }), spotter: ground('soviet', adjacent) },
      map, board: { barrage: table('[1/2]') } })
  const action = launch('barrage', target, 'box bomber')
  let result = submit(record, 'soviet', action)
  assert.equal(result.state.airMission.step.kind, 'barrage')
  assert.equal(result.state.airMission.flak.modifier, 0)
  assert.throws(() => submit(result, 'soviet', terrain), /targeted player/)
  result = submit(result, 'axis', terrain)
  assert.equal(result.state.barrageHistory[0].air.shortRange, false)
  assert.equal(result.state.barrageHistory[0].cost, 0)
  assert.equal(result.state.barrageHistory[0].roll.halfDie, null)
  assert.equal(result.state.units.target.disorganized, true)
  assert.equal(result.state.units.target.reserve, undefined)
  result = submit(result, 'soviet', flyHome('box bomber', box))
  assert.deepEqual(result.state.dumps, record.state.dumps)
  assert.equal(getPlane(result, 'box bomber').active, false)
  assert.deepEqual([...scorpionRegularBarrageTargets(result.state)], [target.hex])
  assert.throws(() => submit(result, 'soviet', launch('barrage', target, 'nearby')), /eligible for this air barrage/)

  const nearby = submit(record, 'soviet', launch('barrage', target, 'nearby'))
  const spotted = submit(nearby, 'axis', terrain)
  assert.equal(spotted.state.barrageHistory[0].roll.shifts.shortRange, 1)
})

test('airfield barrage resolves aircraft stationed on the target before offering another airfield’s interceptors', () => {
  const seed = seedWhere((rng) => rollAirCombat(rng, 8, 1).defenderAborts)
  const { record, submit } = match([plane('bomber', 'soviet', box, { battle: 8 }), plane('resident', 'axis', axisBase, { battle: 1 }),
    plane('nearby', 'axis', target, { battle: 3 })],
  { seed, extraBases: [airBase('axis', target)], map, board: { facilityBarrage: table('1 (6)', true) } })
  record.state.airBases[1].level = 2
  const action = { ...launch('barrage', axisBase, 'bomber'), targetKind: 'air-base' }
  let result = submit(record, 'soviet', action)
  assert.equal(result.state.airMission.step.kind, 'combat-aborts')
  assert.throws(() => submit(result, 'axis', intercept('nearby')), /No air decision/)
  result = submit(result, 'soviet', abort())
  result = submit(result, 'axis', abort())
  result = submit(result, 'soviet', choose('bomber'))
  result = submit(result, 'axis', choose('resident'))
  result = submit(result, 'soviet', abort())
  assert.deepEqual(result.state.airMission.step.candidates, ['nearby'])
  assert.equal(getPlane(result, 'resident').active, false)
  result = submit(result, 'axis', intercept(null))
  assert.equal(result.state.airMission.step.kind, 'return')
  assert.equal(result.state.barrageHistory[0].facilityRoll.damage, 1)
  assert.equal(result.state.airBases.find(({ hex }) => hex === axisBase.hex).level, 1)
  result = submit(result, 'soviet', flyHome('bomber', box))
  assert.equal(result.state.airHistory[0].rounds.length, 1)
})

test('Hip Shoots require normal flight and a spotter and can repeat without using the ordinary barrage slot', () => {
  const planes = ['first', 'second', 'third'].map((id) => plane(id, 'axis', box, { name: 'Ge Ju.87D', fighter: false }))
  const units = { target: ground('soviet', target), spotter: ground('axis', adjacent) }
  const options = { phasing: 'axis', units, map, board: { barrage: table('DG') } }
  const action = launch('hip-shoot', target, 'first')
  const limited = match(planes, options)
  assert.throws(() => limited.submit(limited.record, 'axis', action), /Flight conditions/)
  const blind = match(planes, { ...options, flight: 'normal', units: { target: units.target } })
  assert.throws(() => blind.submit(blind.record, 'axis', action), /spotter/)
  const soviet = match([plane('first', 'soviet', box, { name: 'Sov Ju.87D', airGroup: '独立' })],
    { ...options, phasing: 'soviet', flight: 'normal', units: { target: ground('axis', target), spotter: ground('soviet', adjacent) } })
  assert.throws(() => soviet.submit(soviet.record, 'soviet', action), /single Axis/)
  const { record, submit } = match(planes, { ...options, flight: 'normal' })
  let result = record
  for (const id of ['first', 'second']) {
    result = submit(result, 'axis', launch('hip-shoot', target, id))
    result = submit(result, 'soviet', terrain)
    result = submit(result, 'axis', flyHome(id, box))
    assert.equal(scorpionRegularBarrageTargets(result.state).size, 0)
  }
  assert.equal(result.state.barrageHistory.every((event) => event.air.hipShoot), true)
  result = submit(result, 'axis', launch('barrage', target, 'third'))
  assert.equal(result.state.airMission.kind, 'barrage')
})

test('tank-buster step loss comes from the strongest eligible ground unit and Flak loss goes to the tank-buster', () => {
  const seed = seedWhere((rng) => roll2d6(rng).value.total >= 11)
  const { record, submit } = match([plane('tank-buster', 'axis', box, { name: 'Ge Hs.129', fighter: false,
    fullBombing: 10, reducedBombing: 4 }), plane('escort', 'axis', box, { fullBombing: 6 })],
  { seed, phasing: 'axis', map, board: { barrage: table('[1/2]') }, units: {
    spotter: ground('axis', adjacent), armor: ground('soviet', target, { combatClass: 'armor', strength: 5 }),
    mechanized: ground('soviet', target, { combatClass: 'mech', strength: 10 }), infantry: ground('soviet', target, { strength: 20 }),
  } })
  let result = submit(record, 'axis', launch('barrage', target, 'escort', 'tank-buster'))
  assert.equal(result.state.barrage.strength, 4)
  assert.equal(getPlane(result, 'tank-buster').reduced, true)
  assert.equal(getPlane(result, 'escort').reduced, false)
  result = submit(result, 'soviet', terrain)
  assert.equal(result.state.barrage.roll.dieModifier, 1)
  assert.equal(result.state.barrage.roll.code, '1')
  assert.equal(result.state.barrage.roll.halfDie, null)
  assert.throws(() => submit(result, 'soviet', loss('armor')), /highest Combat Mode/)
  result = submit(result, 'soviet', loss('mechanized'))
  assert.equal(result.state.units.mechanized, undefined)
  assert.ok(result.state.units.infantry.disorganized)
  assert.equal(result.state.pieces.find(({ id }) => id === 'mechanized').location.kind, 'dead-pile')
})

test('a normal barrage fully eliminated by Flak still uses up the target for the phase', () => {
  const seed = seedWhere((rng) => roll2d6(rng).value.total >= 11)
  const { record, submit } = match([plane('reduced', 'soviet', box, { reduced: true }), plane('backup', 'soviet', box)],
    { seed, map, units: { target: ground('axis', target) }, board: { barrage: table('DG') } })
  const result = submit(record, 'soviet', launch('barrage', target, 'reduced'))
  assert.equal(result.state.airMission, null)
  assert.equal(result.state.barrageHistory, undefined)
  assert.equal(getPlane(result, 'reduced').location.kind, 'dead-pile')
  assert.deepEqual([...scorpionRegularBarrageTargets(result.state)], [target.hex])
  assert.throws(() => submit(result, 'soviet', launch('barrage', target, 'backup')), /eligible for this air barrage/)
  assert.throws(() => submit(result, 'soviet', launch('base-transfer', sovietBase, 'backup')), /current segment/)
})

test('air and artillery barrages share the target limit during the non-phasing side’s Reaction', () => {
  const seed = seedWhere((rng) => roll2d6(rng).value.total < 11)
  const { record, submit } = match([plane('bomber', 'soviet', box)], {
    seed, phasing: 'axis', phase: 'reaction', flight: 'normal', map,
    units: { target: ground('axis', target), spotter: ground('soviet', adjacent) }, board: { barrage: table('DG') },
  })
  const action = launch('barrage', target, 'bomber')
  assert.throws(() => submit(record, 'axis', action), /current segment/)
  let result = submit(record, 'soviet', action)
  result = submit(result, 'axis', terrain)
  result = submit(result, 'soviet', flyHome('bomber', box))
  assert.throws(() => submit(result, 'soviet', { type: 'declare-artillery-barrage', target: target.hex,
    batteries: [], supply: { kind: 'direct', payments: [] } }), /once per phase/)
})
