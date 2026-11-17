import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'

const units = {
  'setup:axis': { side: 'axis', hex: 's1.09', printedRe: 4, stepsLost: 0 },
  'setup:soviet-a': { side: 'soviet', hex: 's1.11', printedRe: 3, stepsLost: 0 },
  'setup:soviet-b': { side: 'soviet', hex: 's1.11', printedRe: 3, stepsLost: 0 },
}
const definition = { key: 'alert', kind: 'land', source: { name: 'Alert', side: 'axis', re: 1,
  faces: { combat: { stats: { move: 3, artRange: 2 }, maColor: 'white' }, move: null } } }
const assets = { map: { hexes: new Map([['s1.09', {}], ['s1.11', {}]]) },
  catalog: { definitions: new Map([['alert', definition]]) } }
const fixture = (pieces) => ({ revision: 0, receipts: [], state: { kind: 'setup', opening: { seat: 'axis', pieces,
  units, drawnAlerts: [{ id: 'drawn', definition: 'alert' }], availableAlerts: [], dumps: {},
  lossChoices: [{ candidates: ['setup:soviet-a', 'setup:soviet-b'], stepsLost: 1 }],
  rng: { seed: 1, state: 1, drawCount: 0 } } } })
const aircraft = (id, side) => ({ id, side, kind: 'aircraft', location: { kind: 'air-setup' }, active: true })
const command = (record, action) => ({ id: `cmd-${record.revision}`, expectedRevision: record.revision, action })
const submit = (record, seat, action) => submitScorpionSession(record, seat, command(record, action), assets).record

test('Axis confirms before Soviet deployment and a restored confirmation is acknowledged only once', () => {
  const axisPlane = aircraft('axis', 'axis')
  const sovietPlane = aircraft('soviet', 'soviet')
  const initial = fixture([axisPlane, sovietPlane])
  const confirm = { type: 'confirm-setup' }
  assert.throws(() => submit(initial, 'soviet', confirm), /has not been invited/)
  assert.throws(() => submit(initial, 'axis', confirm), /Complete all required/)
  assert.throws(() => submit(initial, 'axis', { type: 'place-setup-alert', id: 'drawn', hex: 's1.11' }), /German ground/)
  let record = submit(initial, 'axis', { type: 'place-setup-alert', id: 'drawn', hex: 's1.09' })
  record = submit(record, 'axis', { type: 'base-aircraft', id: axisPlane.id, base: { kind: 'off-map-air' } })
  record = submit(record, 'axis', confirm)
  assert.equal(record.state.opening.seat, 'soviet')
  assert.throws(() => submit(record, 'axis', { type: 'base-aircraft', id: axisPlane.id, base: { kind: 'hex', hex: 's13.11' } }), /has not been invited/)
  record = submit(record, 'soviet', { type: 'base-aircraft', id: sovietPlane.id, base: { kind: 'hex', hex: 's18.07' } })
  assert.throws(() => submit(record, 'soviet', confirm), /Complete all required/)
  record = submit(record, 'soviet', { type: 'choose-setup-loss', id: 'setup:soviet-a' })
  record = submit(record, 'soviet', { type: 'choose-setup-loss', id: 'setup:soviet-b' })
  const finalCommand = command(record, confirm)
  const opened = submitScorpionSession(record, 'soviet', finalCommand, assets).record
  assert.equal(opened.state.kind, 'playing')
  assert.equal(opened.state.cursor.phasing, 'soviet')
  assert.equal(opened.state.cursor.phase, 'aircraft-refit')
  assert.equal(opened.state.units['setup:soviet-a'].stepsLost, 0)
  assert.equal(opened.state.units['setup:soviet-b'].stepsLost, 1)
  const restored = JSON.parse(JSON.stringify(opened))
  assert.equal(submitScorpionSession(restored, 'soviet', finalCommand, assets).duplicate, true)
  assert.throws(() => submit(restored, 'soviet', confirm), /deployment is closed/)
})

test('the level-2 airbase admits six active aircraft and the off-map box stays available', () => {
  let record = fixture(Array.from({ length: 7 }, (_, id) => aircraft(String(id), 'axis')))
  const base = { kind: 'hex', hex: 'S13.11' }
  for (let i = 0; i < 6; i++) record = submit(record, 'axis', { type: 'base-aircraft', id: String(i), base })
  assert.throws(() => submit(record, 'axis', { type: 'base-aircraft', id: '6', base }), /overstack/)
  assert.throws(() => submit(record, 'axis', { type: 'base-aircraft', id: '6', base: { kind: 'hex', hex: 's18.07' } }), /friendly air base/)
  record = submit(record, 'axis', { type: 'base-aircraft', id: '6', base: { kind: 'off-map-air' } })
  assert.equal(record.state.opening.pieces.at(-1).location.kind, 'off-map-air')
})
