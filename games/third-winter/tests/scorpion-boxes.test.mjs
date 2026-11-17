import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { placeScorpionOffMapAircraft, scorpionSetupBoxPieces } from '../src/match/scorpion-box-pieces.ts'
import { completeScorpionCleanup } from '../src/match/scorpion-round.ts'
import { placeScorpionArrival } from '../src/ttw/scorpion/arrival.ts'
import { openScorpionTurn } from '../src/ttw/scorpion/pre-turn.ts'
import { scorpionWeather } from '../src/ttw/scorpion/weather.ts'
import { calibratedSurface } from '../src/view/calibrated-surface.ts'
import { scorpionBoxFrame, scorpionSurfaceBoxes } from '../src/view/scorpion-boxes.ts'

const definition = (name, kind, side, move = null) => ({ key: name, kind, source: { side, name,
  faces: { combat: { asset: `${name}.png` }, move: move && { asset: move } } } })
const counters = [
  ...['Turn', 'Ground', 'Flight', 'Soviet VPs Tracker'].map((name) => definition(name, 'marker', null)),
  definition('Axis fighter', 'aircraft', 'axis'), definition('Sov Pe.2', 'aircraft', 'soviet', 'reduced.png'),
  definition('Axis battalion', 'land', 'axis'),
]
const catalog = { definitions: new Map(counters.map((row) => [row.key, row])),
  aliases: new Map(counters.map((row) => [row.key, [row]])) }
const noDice = () => assert.fail('Weather dice are unavailable here')
const opening = () => openScorpionTurn(1, scorpionWeather(1, false, noDice), 0, 'soviet', 0, 'soviet')
const track = (turn, player) => scorpionBoxFrame(turn, [], catalog, player).trackers
const cells = (turn, player) => track(turn, player).map(({ cell }) => cell)

test('v3 and v4 calibrations use the saved pan and zoom to find the printed cells', () => {
  const viewport = { tx: 40, ty: 60, zoom: 2 }
  const background = { naturalWidth: 200, naturalHeight: 300, screenRect: { x: 42, y: 54, w: 100, h: 150 } }
  const boxes = [{ id: 1, x: 5, y: 7, w: 9, h: 11 }]
  for (const view of [{ version: 3, config: viewport }, { version: 4, global: viewport }]) {
    const surface = calibratedSurface({ ...view, background, boxes })
    assert.deepEqual(surface.boxes.get(1), { x: 16, y: 40, w: 36, h: 44 })
    assert.throws(() => scorpionSurfaceBoxes(surface), /Wrong calibration/)
  }
})

test('the turn advances once after both cleanups and weather moves both markers', () => {
  const turn = opening()
  assert.deepEqual(cells(turn), [11, 21, 24, 33])
  const player = { cursor: { turn: 1, first: 'soviet', phasing: 'soviet', retention: 'soviet', phase: 'cleanup' },
    arrival: { placed: [], mobilized: [], sovietVp: 0 }, victory: null }
  const afterFirst = completeScorpionCleanup(turn, player, 'soviet', 0, 'soviet', noDice)
  assert.equal(afterFirst.cursor.phasing, 'axis')
  assert.deepEqual(cells(afterFirst.turn), [11, 21, 24, 33])
  const afterSecond = completeScorpionCleanup(afterFirst.turn, { ...player, cursor: { ...afterFirst.cursor, phase: 'cleanup' } },
    'axis', 0, 'soviet', () => 6)
  assert.equal(afterSecond.cursor, null)
  assert.deepEqual(cells(afterSecond.turn), [12, 21, 25, 33])
  const thaw = openScorpionTurn(3, scorpionWeather(3, false, () => 6), -2, 'axis', 8, 'soviet')
  assert.deepEqual(cells(thaw), [13, 22, 23, 31])
})

test('the VP marker follows an optional arrival in the same turn and ordinary end scoring', () => {
  const turn = { ...opening(), number: 4, vp: 18, step: { kind: 'player-turn', first: 'axis', retention: 'closed' } }
  const cursor = { turn: 4, first: 'axis', phasing: 'axis', retention: 'closed', phase: 'reinforcement' }
  const before = { placed: [], mobilized: [], sovietVp: 18 }
  const optional = { turn: 4, side: 'axis', destinations: ['s15.01'], id: '24-panzer', optionalForce: 'axis-24-panzer' }
  const after = placeScorpionArrival(before, optional, 4, 'axis', 's15.01', optional.destinations)
  const updated = track(turn, { cursor, arrival: after, victory: { outcome: 'soviet', level: 'major' } })
  assert.equal(updated[0].cell, 14)
  assert.equal(updated[3].cell, 53)
  assert.match(updated[3].label, /23$/)
  const feb19 = openScorpionTurn(8, scorpionWeather(8, false, noDice), 10, 'closed', 0, 'soviet')
  assert.equal(feb19.step.kind, 'ended')
  assert.deepEqual(cells(feb19), [18, 22, 23, 44])
})

test('map boxes project side, actual piece location and the reduced aircraft face', () => {
  const setup = { air: [{ ref: 'Axis fighter' }, { ref: 'Sov Pe.2' }, { ref: 'Sov Pe.2' }],
    dead_pile: [{ ref: 'Axis battalion' }] }
  const initial = scorpionSetupBoxPieces(setup, catalog.aliases)
  const [axis, soviet] = initial.filter((piece) => piece.kind === 'aircraft')
  assert.throws(() => placeScorpionOffMapAircraft(initial, 'axis', soviet.id), /cannot be placed/)
  const deployed = placeScorpionOffMapAircraft(placeScorpionOffMapAircraft(initial, 'axis', axis.id), 'soviet', soviet.id)
  const inventory = (pieces, seat) => scorpionBoxFrame(opening(), pieces, catalog, undefined, seat).inventories
  assert.deepEqual(inventory(initial).map(({ counters }) => counters.length), [1, 0, 0, 0])
  assert.deepEqual(inventory(deployed).map(({ cell, counters }) => [cell, counters[0]?.asset]),
    [[19, 'Axis battalion.png'], [20, 'Axis fighter.png'], [27, undefined], [26, 'reduced.png']])
  assert.equal(inventory(deployed, 'axis').find(({ cell }) => cell === 26).hidden, true)
  const returnedOnMap = deployed.map((piece) => piece.id === soviet.id ?
    { ...piece, location: { kind: 'hex', hex: 's18.07' } } : piece)
  assert.equal(inventory(returnedOnMap).find(({ cell }) => cell === 26).counters.length, 0)
})
