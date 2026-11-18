import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createRngState, roll2d6 } from '@ocs-eastern/series/rng'
import { flakLossCandidates, rollAirCombat } from '@ocs-eastern/series/tables/air'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'
import { scorpionMapStacks } from '../src/view/scorpion-map-counters.ts'

const hex = (hex) => ({ kind: 'hex', hex })
const box = { kind: 'off-map-air' }
const sovietBase = hex('s12.04')
const axisBase = hex('s16.04')
const airBase = (side, base) => ({ side, hex: base.hex, level: 1 })
function plane(id, side, location, { battle = 3, range = 12, fighter = true, airGroup = '独立', active = true, reduced = false } = {}) {
  const face = (asset, airCombat) => ({ asset, stats: { range, airCombat, bombing: 2, defensiveOnly: !fighter } })
  const source = { name: id, side, org: { airGroup }, abilities: fighter ? ['interception'] : ['barrage'],
    faces: { combat: face('full.png', battle), move: face('reduced.png', battle - 1) } }
  return { piece: { id, side, kind: 'aircraft', definition: id, location, active, reduced }, source }
}
function match(planes, { flight = 'limited', phase = 'movement', seed = 1, phasing = 'soviet', extraBases = [] } = {}) {
  const assets = { catalog: { definitions: new Map(planes.map(({ piece, source }) => [piece.id, { kind: 'aircraft', source }])),
    aliases: new Map() } }
  const record = { revision: 0, receipts: [], state: { kind: 'playing', rng: createRngState(seed), units: {}, dumps: {},
    turn: { number: 1, weather: { ground: 'freeze', flight }, step: { kind: 'player-turn' } },
    cursor: { turn: 1, first: phasing, phasing, phase }, combat: null, combatTargets: [],
    airBases: [airBase('soviet', sovietBase), airBase('axis', axisBase), ...extraBases], pieces: planes.map(({ piece }) => piece) } }
  const command = (at, action) => ({ id: `flight-${at.revision}`, expectedRevision: at.revision, action })
  const submit = (at, side, action) => submitScorpionSession(at, side, command(at, action), assets).record
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
