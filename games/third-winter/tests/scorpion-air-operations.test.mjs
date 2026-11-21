import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createRngState, roll2d6, rollDie } from '@ocs-eastern/series/rng'
import { flakLossCandidates, rollAirCombat } from '@ocs-eastern/series/tables/air'
import { railCapacityCost } from '@ocs-eastern/series/trainbusting'
import { scorpionMap } from '../src/import/scorpion-map.ts'
import { scorpionRegularBarrageTargets } from '../src/match/scorpion-barrage-timing.ts'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'
import { hasTrace } from '../src/match/scorpion-supply-phase.ts'
import { scorpionMapStacks } from '../src/view/scorpion-map-counters.ts'
import { localChoices, localDecisionSide } from '../desktop/local/actions.mjs'
import { scorpionPendingAirDecision } from '../src/match/scorpion-air-actions.ts'

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
    turn: { number: 1, weather: { ground: 'freeze', flight }, step: { kind: 'player-turn', first: phasing } },
    cursor: { turn: 1, first: phasing, phasing, phase, retention: 'soviet' }, combat: null, combatTargets: [], moved: [],
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
  flying.state.rerollHolder = 'soviet'
  const finalRound = command(flying, choose('defender'))
  flying = submit(flying, 'axis', choose('defender'))
  const keep = { type: 'resolve-reroll', decision: 'keep' }
  assert.equal(flying.state.reroll.current.site.kind, 'air-combat')
  assert.equal(flying.state.reroll.current.draw.value.count, 2)
  flying = submit(flying, 'soviet', keep)
  assert.equal(flying.state.reroll.current.site.kind, 'air-combat-loss')
  assert.equal(flying.state.reroll.current.draw.value.count, 1)
  flying = submit(flying, 'soviet', keep)
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

test('airfield bombing offers attacker return before the defender capacity decision', () => {
  const seed = seedWhere((rng) => roll2d6(rng).value.total < 9)
  const residents = Array.from({ length: 6 }, (_, i) => plane(`resident ${i}`, 'axis', axisBase, { fighter: false }))
  const board = { facilityBarrage: table('1 (6)', true) }
  const { record, assets, submit } = match([plane('bomber', 'soviet', box, { fighter: false }), ...residents],
    { seed, map, board })
  record.state.airBases[1].level = 2
  const launched = submit(record, 'soviet', { ...launch('barrage', axisBase, 'bomber'), targetKind: 'air-base' })
  assert.equal(launched.state.airfieldCapacityChoice.excess, 1)
  assert.deepEqual(scorpionPendingAirDecision(launched.state), { kind: 'air-mission', step: 'return', actor: 'soviet' })
  assert.throws(() => submit(launched, 'axis', { type: 'settle-airfield-capacity', unitIds: ['resident 0'] }), /pending air mission/)
  const issueOffered = (rec, side, type) => {
    assert.equal(localDecisionSide(rec.state), side)
    const actions = localChoices(rec.state, side, {}, { assets, board }).flatMap(({ actions }) => actions)
    assert.ok(actions.length > 0)
    assert.ok(actions.every((action) => action.type === type))
    return submit(rec, side, actions[0])
  }
  const returned = issueOffered(launched, 'soviet', 'return-aircraft')
  assert.equal(returned.state.airMission, null)
  assert.deepEqual(scorpionPendingAirDecision(returned.state), { kind: 'airfield-capacity', actor: 'axis' })
  const settled = issueOffered(returned, 'axis', 'settle-airfield-capacity')
  assert.equal(scorpionPendingAirDecision(settled.state), null)
  assert.equal(settled.state.pieces.filter((piece) => piece.side === 'axis' && piece.active).length, 5)
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

test('trainbusting hits an empty hex, adds patrol Flak, and retains only one marker per hex until enemy cleanup', () => {
  const seed = seedWhere((rng) => roll2d6(rng).value.total < 8)
  const options = { seed, flight: 'normal', map, board: { facilityBarrage: table('1 S (5)', true) } }
  const { record, submit, assets } = match([plane('first', 'soviet', box, { fighter: false }),
    plane('second', 'soviet', box, { fighter: false }), plane('patrol', 'axis', axisBase)], options)
  const action = launch('trainbusting', target, 'first')
  let result = submit(record, 'soviet', action)
  assert.deepEqual(result.state.airMission.step.candidates, ['patrol'])
  result = submit(result, 'axis', intercept(null))
  assert.equal(result.state.airMission.flak.modifier, 3)
  assert.deepEqual(result.state.trainbusting, [{ side: 'soviet', hex: target.hex }])
  assert.equal(result.state.barrageHistory.at(-1).trainbustingRoll.placed, true)
  result = submit(result, 'soviet', flyHome('first', box))
  assert.equal(getPlane(result, 'first').active, false)
  assert.throws(() => submit(result, 'soviet', launch('trainbusting', target, 'second')), /eligible for this air barrage/)
  assert.throws(() => submit(result, 'soviet', launch('base-transfer', sovietBase, 'second')), /current segment/)

  result.state.cursor.phase = 'exploitation'
  result.state.rng = createRngState(seed)
  result = submit(result, 'soviet', launch('trainbusting', target, 'second'))
  result = submit(result, 'axis', intercept(null))
  assert.equal(result.state.barrageHistory.at(-1).trainbustingRoll.placed, false)
  assert.equal(result.state.trainbusting.length, 1)
  result = submit(result, 'soviet', flyHome('second', box))
  result = JSON.parse(JSON.stringify(result))

  assets.catalog.aliases.set('Trainbusting - Allied', [{ source: { faces: { combat: { asset: 'trainbusting.png' } } } }])
  assets.catalog.aliases.set('Trainbusting - Axis', [{ source: { faces: { combat: { asset: 'axis-trainbusting.png' } } } }])
  const visible = (rec) => scorpionMapStacks(rec.state, assets.catalog, [])
    .flatMap(({ pages }) => pages.flat()).filter(({ id }) => id.startsWith('trainbusting:')).map(({ hex }) => hex)
  result.state.trainbusting.push({ side: 'axis', hex: adjacent.hex })
  assert.deepEqual(visible(result), [target.hex, adjacent.hex])
  const cleanup = { type: 'complete-cleanup' }
  result.state.cursor.phase = 'cleanup'
  result = submit(result, 'soviet', cleanup)
  assert.deepEqual(visible(result), [target.hex])
  assert.equal(result.state.cursor.phasing, 'axis')
  result.state.cursor.phase = 'cleanup'
  result = submit(result, 'axis', cleanup)
  assert.deepEqual(visible(result), [])
})

test('trainbusting with no S result still returns the aircraft and does not damage an air base in the hex', () => {
  const seed = seedWhere((rng) => roll2d6(rng).value.total < 10)
  const { record, submit } = match([plane('bomber', 'soviet', box, { fighter: false }),
    plane('parked', 'axis', axisBase, { active: false })], {
    seed, map, board: { facilityBarrage: table('1 (6)', true) },
  })
  record.state.airBases[1].level = 2
  let result = submit(record, 'soviet', launch('trainbusting', axisBase, 'bomber'))
  assert.equal(result.state.airMission.step.kind, 'return')
  assert.equal(result.state.airBases[1].level, 2)
  assert.equal(getPlane(result, 'parked').reduced, false)
  assert.deepEqual(result.state.trainbusting, [])
  assert.equal(result.state.barrageHistory.at(-1).trainbustingRoll.placed, false)
  result = submit(result, 'soviet', flyHome('bomber', box))
  assert.equal(getPlane(result, 'bomber').active, false)
})

const rows = ['s12.02', 's12.03', 's12.04', 's12.05']
const line = (terrain = 'Open') => scorpionMap(rows.map((hex_id, index) =>
  ({ hex_id, on_map: true, terrains_present: [index === 2 ? terrain : 'Open'] })),
rows.slice(1).map((hex_b, index) =>
  ({ hex_a: rows[index], hex_b, edge_terrain: 'none', road_present: false, rail_present: true, rail_class: 'single', bridge: false })))

test('trainbusting adds at most one MP per affected hex and doubles rail cost once across the route', () => {
  const route = line()
  const units = { moving: ground('axis', hex(rows[0]), { mobility: 'track', fueled: true, allowance: 3 }) }
  const { record, submit } = match([], { units, phasing: 'axis', map: route, board: { supplyRail: { railGauge: () => 'axis' } } })
  record.state.airBases = []
  const action = { type: 'ground-move', unitId: 'moving', path: rows.slice(1, 3) }
  const trainbusting = rows.slice(2).map((hex) => ({ side: 'soviet', hex }))
  record.state.trainbusting = trainbusting
  assert.throws(() => submit(record, 'axis', action), /allowance exceeded/)
  record.state.units.moving.allowance = 4
  assert.equal(submit(record, 'axis', action).state.units.moving.hex, rows[2])
  record.state.units.moving = { ...units.moving, mobility: 'leg', allowance: 3 }
  assert.equal(submit(record, 'axis', action).state.units.moving.hex, rows[2])
  record.state.units.moving = { ...units.moving, mobility: 'leg', allowance: 2 }
  assert.throws(() => submit(record, 'axis', action), /allowance exceeded/)
  assert.equal(railCapacityCost(2, rows, false, trainbusting, 'axis', route.neighbors), 4)
  assert.equal(railCapacityCost(2, rows, true, trainbusting, 'axis', route.neighbors), 2)
  assert.equal(railCapacityCost(2, rows, true, trainbusting, 'soviet', route.neighbors), 1)
})

test('trainbusting can raise an otherwise legal overrun entry above the 3 MP threshold', () => {
  const map = line('Forest')
  const units = { attacker: ground('axis', hex(rows[1]), { mobility: 'track', fueled: true, allowance: 5, attackCapable: true }),
    defender: ground('soviet', hex(rows[2])) }
  const { record, submit } = match([], { units, phasing: 'axis', map,
    board: { combat: {}, supplyRail: { railGauge: () => 'axis' } } })
  const dumpId = `axis:hex:${rows[1]}`
  record.state.dumps[dumpId] = { side: 'axis', location: 'on-map', tokens: 1 }
  const action = { type: 'declare-overrun', target: rows[2], attackers: ['attacker'],
    payments: [{ unitId: 'attacker', dumpId, tokens: 1 }] }
  record.state.trainbusting = [{ side: 'soviet', hex: rows[3] }]
  assert.throws(() => submit(record, 'axis', action), /3 MP.*Trainbusting/)
  record.state.trainbusting = []
  assert.equal(submit(record, 'axis', action).state.combat.kind, 'overrun')
})

const sourceBox = 'soviet:air-box'
const destination = `soviet:hex:${sovietBase.hex}`
const airlift = (id, supplyTokens) => ({ ...launch('transport', sovietBase, id), supplyTokens })
const li2 = (id, extra = {}) => plane(id, 'soviet', box, { fighter: false, name: 'Sov Li.2', fullBombing: 0, ...extra })

test('off-map supply airlift debits the box, doubles printed capacity, and limits returning unloads each segment', () => {
  const { record, submit } = match([li2('first'), li2('second')])
  record.state.dumps[sourceBox] = { side: 'soviet', location: 'off-map', tokens: 5 }
  assert.throws(() => submit(record, 'soviet', airlift('first', 3)), /transport capacity/)
  let result = submit(record, 'soviet', airlift('first', 2))
  assert.equal(result.state.dumps[sourceBox].tokens, 3)
  assert.equal(result.state.dumps[destination].tokens, 2)
  assert.equal(result.state.airMission.step.kind, 'return')
  result = submit(result, 'soviet', flyHome('first', box))
  assert.deepEqual(result.state.airHistory[0].airlift.unloading, { delivered: 2, lost: 0, capacityUsed: 2 })
  assert.deepEqual(getPlane(result, 'first').location, box)
  result = submit(result, 'soviet', airlift('second', 2))
  assert.equal(result.state.dumps[destination].tokens, 2)
  assert.equal(result.state.airMission.step.kind, 'airlift-landing')
  const stay = (...unitIds) => ({ type: 'choose-airlift-landing', unitIds })
  assert.throws(() => submit(result, 'soviet', stay()), /Leave enough cargo aircraft/)
  result = submit(JSON.parse(JSON.stringify(result)), 'soviet', stay('second'))
  assert.equal(result.state.airMission, null)
  assert.equal(result.state.dumps[destination].tokens, 4)
  assert.equal(result.state.dumps[sourceBox].tokens, 1)
  assert.deepEqual(result.state.airHistory[1].airlift.unloading, { delivered: 2, lost: 0, capacityUsed: 0 })
  assert.deepEqual(getPlane(result, 'second').location, sovietBase)
  assert.equal(getPlane(result, 'second').active, false)
})

test('an intercepted transport unloads surviving supply at the destination using its post-combat counter face', () => {
  for (const damaged of [false, true]) {
    const seed = seedWhere((rng) => {
      const result = rollAirCombat(rng, 10, 0)
      return result.defenderAborts && result.stepLoss === damaged
    })
    const { record, submit } = match([li2('transport', { battle: 0 }), plane('patrol', 'axis', axisBase, { battle: 10 })], { seed })
    record.state.dumps[sourceBox] = { side: 'soviet', location: 'off-map', tokens: 2 }
    let result = submit(record, 'soviet', airlift('transport', 2))
    assert.equal(result.state.dumps[sourceBox].tokens, 0)
    assert.equal(result.state.dumps[destination], undefined)
    result = submit(result, 'axis', intercept('patrol'))
    result = submit(result, 'axis', abort())
    result = submit(result, 'soviet', abort())
    result = submit(result, 'axis', choose('patrol'))
    result = submit(result, 'soviet', choose('transport'))
    result = submit(result, 'axis', abort())
    const delivered = damaged ? 1 : 2
    assert.deepEqual(getPlane(result, 'transport').location, sovietBase)
    assert.equal(getPlane(result, 'transport').active, false)
    assert.equal(getPlane(result, 'transport').reduced, damaged)
    assert.equal(result.state.dumps[destination].tokens, delivered)
    assert.deepEqual(result.state.airHistory[0].airlift.unloading, { delivered, lost: 2 - delivered, capacityUsed: 0 })
  }
})

test('Flak can destroy a reduced transport and its supply while the off-map box debit remains spent', () => {
  const seed = seedWhere((rng) => roll2d6(rng).value.total >= 8)
  const { record, submit } = match([li2('transport', { reduced: true }), plane('patrol', 'axis', axisBase)], { seed })
  record.state.dumps[sourceBox] = { side: 'soviet', location: 'off-map', tokens: 1 }
  let result = submit(record, 'soviet', airlift('transport', 1))
  result = submit(result, 'axis', intercept(null))
  assert.equal(getPlane(result, 'transport').location.kind, 'dead-pile')
  assert.equal(result.state.dumps[sourceBox].tokens, 0)
  assert.equal(result.state.dumps[destination], undefined)
  assert.deepEqual(result.state.airHistory[0].airlift.unloading, { delivered: 0, lost: 1, capacityUsed: 0 })
})

const mapAirlift = (source, target, unitIds, supplyTokens, flightModes = []) =>
  ({ ...launch('transport', target, ...unitIds), supplySource: source, supplyTokens, flightModes })

test('on-map airlift checks the selected outbound and return range and leaves extended flights inactive at the target', () => {
  const source = hex('s8.04')
  const other = hex('s18.04')
  const key = `soviet:hex:${source.hex}`
  const { record, submit } = match([plane('normal', 'soviet', source, { name: 'Sov Li.2', range: 8, fighter: false }),
    plane('long', 'soviet', source, { name: 'Sov Li.2', range: 2, fighter: false })],
  { extraBases: [airBase('soviet', source), airBase('soviet', other)] })
  record.state.dumps[key] = { side: 'soviet', location: 'on-map', tokens: 3 }
  assert.throws(() => submit(record, 'soviet', mapAirlift(source, sovietBase, ['normal'], 2)), /transport capacity/)
  assert.throws(() => submit(record, 'soviet', mapAirlift(source, sovietBase, ['long'], 1)), /selected range/)
  assert.throws(() => submit(record, 'soviet', mapAirlift(source, sovietBase, ['long'], 1,
    [{ id: 'normal', mode: 'extended' }])), /one valid transport range/)

  let flying = submit(record, 'soviet', mapAirlift(source, sovietBase, ['normal'], 1))
  flying = submit(flying, 'soviet', flyHome('normal', other))
  assert.deepEqual(getPlane(flying, 'normal').location, other)
  assert.equal(flying.state.airHistory[0].airlift.unloading.capacityUsed, 1)

  let doubled = submit(record, 'soviet', mapAirlift(source, sovietBase, ['normal'], 2, [{ id: 'normal', mode: 'double-capacity' }]))
  assert.throws(() => submit(doubled, 'soviet', flyHome('normal', other)), /return range/)
  doubled = submit(doubled, 'soviet', flyHome('normal', source))
  assert.equal(doubled.state.dumps[destination].tokens, 2)
  assert.equal(doubled.state.dumps[key].tokens, 1)

  const extended = submit(record, 'soviet', mapAirlift(source, sovietBase, ['long'], 1, [{ id: 'long', mode: 'extended' }]))
  assert.equal(extended.state.airMission, null)
  assert.deepEqual(getPlane(extended, 'long').location, sovietBase)
  assert.equal(getPlane(extended, 'long').active, false)
  assert.deepEqual(extended.state.airHistory[0].airlift.unloading, { delivered: 1, lost: 0, capacityUsed: 0 })
})

test('two half-capacity aircraft can pool capacity from the same airport', () => {
  const source = hex('s16.04')
  const field = hex('s14.04')
  const key = `axis:hex:${source.hex}`
  const { record, submit } = match([plane('one', 'axis', source, { name: 'Ge He.111H', fighter: false }),
    plane('two', 'axis', source, { name: 'Ge He.111H', fighter: false }),
    plane('away', 'axis', box, { name: 'Ge He.111H', fighter: false })],
  { phasing: 'axis', extraBases: [airBase('axis', field)] })
  record.state.dumps[key] = { side: 'axis', location: 'on-map', tokens: 1 }
  assert.throws(() => submit(record, 'axis', mapAirlift(source, field, ['one', 'away'], 1)), /transport capacity/)
  let result = submit(record, 'axis', mapAirlift(source, field, ['one', 'two'], 1))
  result = submit(result, 'axis', flyHome('one', source))
  result = submit(result, 'axis', flyHome('two', source))
  assert.equal(result.state.dumps[`axis:hex:${field.hex}`].tokens, 1)
})

test('an on-map shipment rounds fractional post-Flak capacity in favor of delivered cargo', () => {
  const source = axisBase
  const field = hex('s14.04')
  const key = `axis:hex:${source.hex}`
  const seed = seedWhere((rng) => roll2d6(rng).value.total >= 8)
  const { record, submit } = match([plane('one', 'axis', source, { name: 'Ge He.111H', fighter: false }),
    plane('two', 'axis', source, { name: 'Ge He.111H', fighter: false }), plane('patrol', 'soviet', sovietBase)],
  { seed, phasing: 'axis', extraBases: [airBase('axis', field)] })
  record.state.dumps[key] = { side: 'axis', location: 'on-map', tokens: 1 }
  let result = submit(record, 'axis', mapAirlift(source, field, ['one', 'two'], 1))
  result = submit(result, 'soviet', intercept(null))
  assert.equal(result.state.pieces.filter(({ reduced }) => reduced).length, 1)
  result = submit(result, 'axis', flyHome('one', source))
  result = submit(result, 'axis', flyHome('two', source))
  assert.deepEqual(result.state.airHistory[0].airlift.unloading, { delivered: 1, lost: 0, capacityUsed: 1 })
})

test('unloaded supply can fuel a ground move and cannot be flown again until another phase', () => {
  const origin = hex(rows[0])
  const options = { flight: 'normal', extraBases: [airBase('soviet', origin)], map: line(),
    board: { supplyRail: { railGauge: () => 'soviet' } },
    units: { armor: ground('soviet', sovietBase, { mobility: 'track', allowance: 4, attackCapable: true }) } }
  const { record, submit } = match([li2('delivery'),
    plane('relay', 'soviet', sovietBase, { name: 'Sov Li.2', fighter: false }),
    plane('later', 'soviet', sovietBase, { name: 'Sov Li.2', fighter: false })], options)
  record.state.dumps[sourceBox] = { side: 'soviet', location: 'off-map', tokens: 2 }
  record.state.dumps[destination] = { side: 'soviet', location: 'on-map', tokens: 1 }
  let result = submit(record, 'soviet', airlift('delivery', 2))
  result = submit(result, 'soviet', flyHome('delivery', box))
  const relay = (id, tokens) => mapAirlift(sovietBase, origin, [id], tokens, [{ id, mode: 'double-capacity' }])
  assert.throws(() => submit(result, 'soviet', relay('relay', 2)), /cannot be transported again/)

  // An existing save may have a logged shipment and no provenance field on the dump.
  result = JSON.parse(JSON.stringify(result))
  delete result.state.dumps[destination].unloaded
  delete result.state.airHistory[0].airlift.source
  delete result.state.airHistory[0].airlift.flightModes
  assert.throws(() => submit(result, 'soviet', relay('relay', 2)), /cannot be transported again/)
  result = submit(result, 'soviet', { type: 'ground-move', unitId: 'armor', path: [rows[3]], fuelDumpId: destination })
  assert.equal(result.state.dumps[destination].unloaded.tokens, 1)
  assert.throws(() => submit(result, 'soviet', relay('relay', 2)), /cannot be transported again/)
  result = submit(result, 'soviet', relay('relay', 1))
  result = submit(result, 'soviet', flyHome('relay', sovietBase))
  assert.equal(result.state.dumps[destination].tokens, 1)
  assert.throws(() => submit(result, 'soviet', relay('later', 1)), /cannot be transported again/)
  const nextPhase = { ...result, state: { ...result.state, cursor: { ...result.state.cursor, phase: 'exploitation' } } }
  result = submit(nextPhase, 'soviet', relay('later', 1))
  assert.equal(result.state.dumps[destination].tokens, 0)
  assert.equal(result.state.dumps[`soviet:hex:${origin.hex}`].tokens, 2)
})

function groundLift(source, target, aircraft, cargo, supplyTokens = 0) {
  return { ...mapAirlift(source, target, aircraft, supplyTokens,
    [{ id: aircraft[0], mode: 'double-capacity' }]), cargoUnitIds: cargo }
}

test('ground airlift uses Move Mode, charges transport equivalents and shares half MP before and after the flight', () => {
  const source = hex(rows[1])
  const target = hex(rows[2])
  const unit = ground('soviet', hex(rows[0]), { moveMode: false, mobility: 'leg', allowance: 2, definition: 'guard' })
  const { record, submit, assets } = match([plane('lift', 'soviet', source, { name: 'Sov Li.2', fighter: false })],
    { map: line(), extraBases: [airBase('soviet', source)], units: { guard: unit },
      board: { supplyRail: { railGauge: () => 'soviet' } } })
  const definition = { kind: 'land', source: { side: 'soviet', name: 'Rifle battalion',
    faces: { move: { maColor: 'white', stats: { move: 4, attack: 1, artRange: 3 } } } } }
  assets.catalog.definitions.set('guard', definition)
  const air = groundLift(source, target, ['lift'], ['guard'])
  assert.throws(() => submit(record, 'soviet', air), /departure air base/)
  const approached = submit(record, 'soviet', { type: 'ground-move', unitId: 'guard', face: 'move', path: [source.hex] })
  assert.equal(approached.state.units.guard.moveMode, true)
  const standard = { ...air, flightModes: [] }
  assert.throws(() => submit(approached, 'soviet', standard), /transport capacity/)
  const arrived = submit(JSON.parse(JSON.stringify(approached)), 'soviet', air)
  assert.deepEqual(arrived.state.airMission.airlift.ground, [{ id: 'guard', tokens: 2 }])
  assert.equal(arrived.state.units.guard.hex, target.hex)
  const returned = submit(arrived, 'soviet', flyHome('lift', source))
  assert.throws(() => submit(returned, 'soviet', { type: 'mark-reserve', unitId: 'guard' }), /before it moves/)
  const marched = submit(returned, 'soviet', { type: 'ground-move', unitId: 'guard', path: [rows[3]] })
  assert.equal(marched.state.groundActivity.spent.guard, 2)
  assert.equal(marched.state.units.guard.hex, rows[3])
  assert.throws(() => submit(marched, 'soviet', { type: 'ground-move', unitId: 'guard', path: [target.hex] }), /unavailable/)

  const spent = { ...approached, state: { ...approached.state, groundActivity: { ...approached.state.groundActivity, spent: { guard: 3 } } } }
  assert.throws(() => submit(spent, 'soviet', air), /already used more ground movement/)
  const noMp = { ...approached, state: { ...approached.state, units: { guard: { ...approached.state.units.guard, allowance: 2 } } } }
  const last = submit(submit(noMp, 'soviet', air), 'soviet', flyHome('lift', source))
  assert.throws(() => submit(last, 'soviet', { type: 'ground-move', unitId: 'guard', path: [rows[3]] }), /No ground movement remains/)
})

test('Reaction airlift divides MP twice for released Reserves and leaves other cargo immobile', () => {
  const source = hex(rows[1])
  const target = hex(rows[2])
  const path = [rows[3]]
  for (const released of [false, true]) {
    const { record, submit } = match([plane('lift', 'soviet', source, { name: 'Sov Li.2', fighter: false })],
      { map: line(), flight: 'normal', phase: 'reaction', phasing: 'axis',
        extraBases: [airBase('soviet', source)], board: { supplyRail: { railGauge: () => 'soviet' } },
        units: { guard: ground('soviet', source, { moveMode: true, mobility: 'leg', allowance: 4, released }) } })
    const result = submit(submit(record, 'soviet', groundLift(source, target, ['lift'], ['guard'])), 'soviet', flyHome('lift', source))
    const move = { type: 'ground-move', unitId: 'guard', path }
    if (!released) assert.throws(() => submit(result, 'soviet', move), /unavailable/)
    else assert.equal(submit(result, 'soviet', move).state.groundActivity.spent.guard, 1)
  }
})

test('an overstacked arrival can be dispersed before the Movement Segment closes', () => {
  const source = hex(rows[1])
  const target = hex(rows[2])
  const { record, submit } = match([plane('lift', 'soviet', source, { name: 'Sov Li.2', fighter: false })],
    { map: line(), extraBases: [airBase('soviet', source)], board: { supplyRail: { railGauge: () => 'soviet' } },
      units: { guard: ground('soviet', source, { moveMode: true, mobility: 'leg', allowance: 4 }),
        stack: ground('soviet', target, { printedRe: 10 }) } })
  const arrived = submit(record, 'soviet', groundLift(source, target, ['lift'], ['guard']))
  const returned = submit(arrived, 'soviet', flyHome('lift', source))
  assert.throws(() => submit(returned, 'soviet', { type: 'complete-movement' }), /stacking limit/)
  const marched = submit(returned, 'soviet', { type: 'ground-move', unitId: 'guard', path: [rows[3]] })
  assert.equal(marched.state.units.guard.hex, rows[3])
})

test('the owner chooses between ground cargo and supply when reduced transport capacity cannot fit both', () => {
  const source = hex('s8.04')
  const key = `soviet:hex:${source.hex}`
  const seed = seedWhere((rng) => {
    const flak = roll2d6(rng)
    return flak.value.total >= 8 && rollDie(flak.rng).value <= 3
  })
  const { record, submit } = match([plane('heavy', 'soviet', source, { name: 'Sov Li.2', fighter: false }),
    plane('light', 'soviet', source, { name: 'Sov Li.2', fighter: false }), plane('patrol', 'axis', axisBase)],
  { seed, map: line(), extraBases: [airBase('soviet', source)],
    units: { guard: ground('soviet', source, { moveMode: true, mobility: 'leg', allowance: 5, definition: 'guard' }) } })
  record.state.dumps[key] = { side: 'soviet', location: 'on-map', tokens: 1 }
  record.state.rerollHolder = 'axis'
  const flying = submit(record, 'soviet', groundLift(source, sovietBase, ['heavy', 'light'], ['guard'], 1))
  const flak = submit(flying, 'axis', intercept(null))
  assert.equal(flak.state.reroll.current.site.kind, 'flak')
  assert.equal(flak.state.reroll.current.draw.value.count, 2)
  const keepFlak = { type: 'resolve-reroll', decision: 'keep' }
  const designation = submit(flak, 'axis', keepFlak)
  assert.equal(designation.state.reroll.current.site.kind, 'flak-loss')
  assert.equal(designation.state.reroll.current.draw.value.count, 1)
  const pending = submit(designation, 'axis', keepFlak)
  assert.equal(pending.state.airMission.step.kind, 'airlift-cargo')
  assert.equal(pending.state.airMission.step.capacity, 2)
  const keep = (tokens, ...unitIds) => ({ type: 'choose-airlift-cargo', cargo: { tokens, unitIds } })
  assert.throws(() => submit(pending, 'axis', keep(0, 'guard')), /No air decision/)
  assert.throws(() => submit(pending, 'soviet', keep(1, 'guard')), /surviving transport capacity/)
  assert.throws(() => submit(pending, 'soviet', keep(0)), /Keep all cargo/)
  const survived = submit(pending, 'soviet', keep(0, 'guard'))
  assert.equal(survived.state.units.guard.hex, sovietBase.hex)
  assert.equal(survived.state.airMission.airlift.unloading.lost, 1)
  const supplied = submit(pending, 'soviet', keep(1))
  assert.equal(supplied.state.units.guard, undefined)
  assert.equal(supplied.state.pieces.find(({ id }) => id === 'guard').location.kind, 'dead-pile')
  assert.equal(supplied.state.dumps[destination].tokens, 1)
})

const supplyDrop = (target, tokens, id = 'lift') => ({ ...launch('air-drop', target, id), supplyTokens: tokens })

test('supply drop uses phase-start occupancy, rolls each token and puts the surviving SP counter in the hex', () => {
  const source = hex(rows[1])
  const destination = hex(rows[0])
  const seed = seedWhere((rng) => {
    const first = roll2d6(rng)
    return first.value.total === 6 && roll2d6(first.rng).value.total < 6
  })
  const { record, submit, assets } = match([li2('lift')], { map: line(), seed,
    units: { guard: ground('soviet', destination, { definition: 'guard', moveMode: true, mobility: 'leg', allowance: 4 }) },
    board: { supplyRail: { railGauge: () => 'soviet' } } })
  assets.catalog.definitions.set('guard', { kind: 'land', source: { side: 'soviet', name: 'Guard', faces: { move: { asset: 'guard.png' } } } })
  assets.catalog.aliases.set('Supply Ton 1T', [{ source: { faces: { combat: { asset: 'supply.png' } } } }])
  record.state.dumps[sourceBox] = { side: 'soviet', location: 'off-map', tokens: 2 }
  const advanced = submit(record, 'soviet', { type: 'ground-move', unitId: 'guard', path: [source.hex] })
  const inFlight = submit(advanced, 'soviet', supplyDrop(destination, 2))
  const { drop } = inFlight.state.airMission
  assert.equal(drop.friendly, true)
  assert.equal(drop.clear, true)
  assert.deepEqual(drop.result.rolls.map(({ threshold, modifier, landed }) => [threshold, modifier, landed]),
    [[5, -1, true], [5, -1, false]])
  assert.equal(inFlight.state.dumps[`soviet:hex:${destination.hex}`].tokens, 1)
  assert.equal(inFlight.state.dumps[sourceBox].tokens, 0)
  const returned = submit(inFlight, 'soviet', flyHome('lift', box))
  assert.equal(returned.state.airHistory.at(-1).drop.result.lostTokens, 1)
  const stack = scorpionMapStacks(returned.state, assets.catalog, []).find(({ hex }) => hex === destination.hex)
  assert.ok(stack.pages.flat().some(({ id }) => id === `soviet:hex:${destination.hex}:1`))
})

test('Axis can drop supply in Reaction with normal flight, but no cargo survives dropping on an enemy combat unit', () => {
  const target = hex(rows[0])
  const groundMap = line()
  groundMap.hexes.get(target.hex).terrains = ['Woods']
  const seed = seedWhere((rng) => roll2d6(rng).value.total >= 8)
  const { record, submit } = match([plane('lift', 'axis', box, { name: 'Ge Ju.52', fighter: false })], {
    map: groundMap, seed, phase: 'reaction', phasing: 'soviet', flight: 'normal', units: { guard: ground('soviet', target) },
  })
  record.state.dumps['axis:air-box'] = { side: 'axis', location: 'off-map', tokens: 1 }
  const action = supplyDrop(target, 1)
  const limited = { ...record, state: { ...record.state, turn: { ...record.state.turn, weather: { flight: 'limited' } } } }
  assert.throws(() => submit(limited, 'axis', action), /Flight conditions/)
  assert.throws(() => submit(record, 'axis', supplyDrop(hex('s22.07'), 1)), /legal on-map/)
  const thrown = submit(record, 'axis', action)
  const drop = thrown.state.airMission.drop
  assert.equal(drop.clear, false)
  assert.equal(drop.result.rolls[0].threshold, 7)
  assert.equal(drop.result.rolls[0].success, true)
  assert.equal(drop.result.rolls[0].landed, false)
  assert.equal(drop.result.lostTokens, 1)
  assert.equal(thrown.state.dumps[`axis:hex:${target.hex}`], undefined)
})

test('an aborted drop outside friendly bases returns only the cargo that fits, with no landing dice', () => {
  for (const damaged of [false, true]) {
    const seed = seedWhere((rng) => {
      const result = rollAirCombat(rng, 10, 0)
      return result.defenderAborts && result.stepLoss === damaged
    })
    const target = hex(rows[0])
    const { record, submit } = match([li2('lift', { battle: 0 }), plane('patrol', 'axis', axisBase, { battle: 10 })],
      { seed, map: line() })
    record.state.dumps[sourceBox] = { side: 'soviet', location: 'off-map', tokens: 2 }
    let pending = submit(record, 'soviet', supplyDrop(target, 2))
    pending = submit(pending, 'axis', intercept('patrol'))
    pending = submit(pending, 'axis', abort())
    pending = submit(pending, 'soviet', abort())
    pending = submit(pending, 'axis', choose('patrol'))
    pending = submit(pending, 'soviet', choose('lift'))
    pending = submit(pending, 'axis', abort())
    const result = submit(JSON.parse(JSON.stringify(pending)), 'soviet', flyHome('lift', box))
    assert.deepEqual(result.state.airHistory.at(-1).drop.result,
      { rolls: [], landedTokens: 0, abortedTokens: damaged ? 1 : 2, lostTokens: damaged ? 1 : 0 })
    assert.equal(result.state.dumps[sourceBox].tokens, damaged ? 1 : 2)
    assert.equal(result.state.dumps[`soviet:hex:${target.hex}`], undefined)
    assert.equal(getPlane(result, 'lift').reduced, damaged)
  }
})

test('only the TTW brigade can plan in setup and Refit; a scheduled landing ends movement and waives trace that turn', () => {
  const source = sovietBase
  const target = hex(rows[0])
  const seed = seedWhere((rng) => roll2d6(rng).value.total >= 8)
  const brigade = ground('soviet', source, { definition: 'brigade', moveMode: true, mobility: 'leg', allowance: 5, attackCapable: true,
    outOfSupply: true })
  const { record, submit, assets } = match([plane('lift', 'soviet', source, { name: 'Sov Li.2', fighter: false })],
    { seed, map: line(), units: { brigade, namesake: { ...brigade, definition: 'namesake' } },
      board: { supplyRail: { railGauge: () => 'soviet' } } })
  for (const [key, sourceId] of [['brigade', '4301'], ['namesake', '3109']]) {
    assets.catalog.definitions.set(key, { kind: 'land', sourceId, source: { side: 'soviet', name: 'Airborne brigade',
      faces: { move: { maColor: 'white', stats: { move: 5, attack: 2, artRange: 4 } } } } })
  }
  const setup = { ...record, state: { kind: 'setup', opening: { seat: 'soviet', units: record.state.units } } }
  const plan = (turn, unitId = 'brigade') => ({ type: 'plan-air-drop', unitId, target: target.hex, turn })
  assert.throws(() => submit(setup, 'axis', plan(1)), /Soviet player/)
  assert.throws(() => submit(setup, 'soviet', plan(1, 'namesake')), /1st Guards/)
  const opened = submit(setup, 'soviet', plan(1))
  const dropPlan = opened.state.opening.dropPlan
  assert.equal(dropPlan.turn, 1)
  const refit = { ...record, state: { ...record.state, cursor: { ...record.state.cursor, phase: 'aircraft-refit' } } }
  assert.throws(() => submit(refit, 'soviet', plan(2)), /two turns ahead/)
  const planned = submit(refit, 'soviet', plan(3))
  assert.throws(() => submit(planned, 'soviet', plan(4)), /existing drop plan/)
  const delayed = submit(planned, 'soviet', { type: 'delay-air-drop' })
  assert.deepEqual(delayed.state.dropPlan, { ...dropPlan, turn: 4 })
  assert.equal(submit(delayed, 'soviet', { type: 'cancel-air-drop' }).state.dropPlan, null)
  const action = { ...groundLift(source, target, ['lift'], ['brigade']), mission: 'air-drop' }
  assert.throws(() => submit(record, 'soviet', action), /planned hex and turn/)
  const scheduled = { ...record, state: { ...record.state, dropPlan } }
  assert.throws(() => submit(scheduled, 'soviet', { ...action, target: hex(rows[1]) }), /planned hex and turn/)
  const returned = submit(submit(scheduled, 'soviet', action), 'soviet', flyHome('lift', source))
  assert.equal(returned.state.dropPlan, null)
  assert.equal(returned.state.units.brigade.hex, target.hex)
  assert.equal(returned.state.units.brigade.outOfSupply, false)
  assert.throws(() => submit(returned, 'soviet', { type: 'ground-move', unitId: 'brigade', path: [rows[1]] }), /unavailable/)
  const supply = submit(returned, 'soviet', { type: 'complete-movement' })
  assert.equal(hasTrace(supply.state.supply, 'brigade'), true)
  assert.equal(hasTrace(supply.state.supply, 'namesake'), false)

  const garrison = plane('parked', 'axis', target, { active: false })
  assets.catalog.definitions.set('parked', { kind: 'aircraft', source: garrison.source })
  const opposed = { ...scheduled, state: { ...scheduled.state, pieces: [...scheduled.state.pieces, garrison.piece],
    airBases: [...scheduled.state.airBases, airBase('axis', target)] } }
  const captured = submit(opposed, 'soviet', action)
  assert.equal(captured.state.airBases.find(({ hex }) => hex === target.hex).side, 'soviet')
  assert.equal(captured.state.capture, null)
  assert.equal(captured.state.captureHistory.at(-1).displacedAircraft[0].id, 'parked')
  const finished = submit(captured, 'soviet', flyHome('lift', source))
  assert.equal(finished.state.airHistory.at(-1).drop.result.unit.outcome, 'landed')
  assert.deepEqual(getPlane(finished, 'parked').location, box)
})
