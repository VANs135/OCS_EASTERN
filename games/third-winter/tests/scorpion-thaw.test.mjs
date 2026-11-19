import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRngState } from '@ocs-eastern/series/rng'
import { scorpionMap } from '../src/import/scorpion-map.ts'
import { startScorpionPlayerTurns } from '../src/match/scorpion-player-turn.ts'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'

test('a Thaw shares each logistical phase, allows mode changes and marks out-of-supply units without rolling', () => {
  const first = 'axis'
  const turn = { number: 5, weather: { ground: 'thaw', flight: 'none' }, thawSeen: true, vp: 0,
    step: { kind: 'player-turn', first, retention: 'closed' } }
  const map = scorpionMap(['s10.01', 's10.02'].map((hex_id) => ({ hex_id, on_map: true, terrains_present: ['Open'] })),
    [{ hex_a: 's10.01', hex_b: 's10.02', edge_terrain: 'none', road_present: false, rail_present: false, bridge: false }])
  const face = { maColor: 'white', stats: { attack: 1, move: 4, artRange: 2 } }
  const def = { kind: 'land', source: { side: 'axis', faces: { move: face } } }
  const assets = { map, catalog: { definitions: new Map([['unit', def]]) } }
  const board = { supplyRail: { railGauge: () => 'axis' }, reinforcements: () => ({ catalog: [], controlOf: () => null,
    supplySources: { axis: new Set(), soviet: new Set() } }) }
  const unit = { side: 'axis', hex: 's10.01', definition: 'unit', combat: true, attackCapable: false, mobility: 'leg',
    printedRe: 1, stepsLost: 0, actionRating: 2, allowance: 3 }
  let record = { revision: 0, receipts: [], state: { kind: 'playing', turn, cursor: startScorpionPlayerTurns(turn),
    rng: createRngState(7), rerollHolder: null, units: { unit }, pieces: [], airBases: [], moved: [], window: null, supply: null,
    dumps: {}, railControl: {}, availableAlerts: [], placedAlerts: [], arrivalsOnMap: [], pax: { soviet: 0, axis: 0 },
    arrival: { placed: [], mobilized: [], sovietVp: 0 } } }
  const issue = (side, action) => submitScorpionSession(record, side, { id: `thaw-${record.revision}`,
    expectedRevision: record.revision, action }, assets, board).record
  const command = (side, type) => { record = issue(side, { type }) }
  const stage = (side, name) => assert.deepEqual([record.state.cursor.phasing, record.state.cursor.phase], [side, name])

  command('axis', 'complete-refit')
  stage('soviet', 'aircraft-refit')
  assert.equal(record.state.window, null)
  command('soviet', 'complete-refit')
  stage('axis', 'reinforcement')
  for (const side of ['axis', 'soviet']) {
    command(side, 'finish-scheduled-arrivals')
    record = issue(side, { type: 'place-supply', target: { kind: 'air-box' }, tokens: record.state.window.variableTokens })
    command(side, 'complete-reinforcement')
    stage(side === 'axis' ? 'soviet' : 'axis', side === 'axis' ? 'reinforcement' : 'movement')
  }
  assert.throws(() => issue('axis', { type: 'work-hedgehog' }), /unavailable in a Thaw/)
  assert.throws(() => issue('axis', { type: 'declare-artillery-barrage' }), /unavailable in a Thaw/)
  assert.throws(() => issue('axis', { type: 'declare-combat' }), /unavailable in a Thaw/)
  assert.throws(() => issue('axis', { type: 'ground-move', unitId: 'unit', path: ['s10.02'] }), /unavailable/)
  record = issue('axis', { type: 'set-ground-mode', unitId: 'unit', face: 'move' })
  assert.equal(record.state.units.unit.moveMode, true)
  assert.equal(record.state.units.unit.hex, 's10.01')
  command('axis', 'complete-movement')
  stage('soviet', 'movement')
  record = JSON.parse(JSON.stringify(record))
  command('soviet', 'complete-movement')
  stage('axis', 'supply')
  assert.ok(record.state.thawSupply)
  const savedRng = record.state.rng
  command('axis', 'check-attrition')
  assert.equal(record.state.units.unit.outOfSupply, true)
  assert.deepEqual(record.state.supply.attrition, [])
  assert.deepEqual(record.state.rng, savedRng)
  command('axis', 'complete-supply')
  stage('soviet', 'supply')
  command('soviet', 'check-attrition')
  command('soviet', 'complete-supply')
  stage('axis', 'cleanup')
  command('axis', 'complete-cleanup')
  stage('soviet', 'cleanup')
  command('soviet', 'complete-cleanup')
  assert.equal(record.state.turn.number, 6)
  assert.equal(record.state.turn.weather.ground, 'freeze')
})
