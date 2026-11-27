import assert from 'node:assert/strict'
import { test } from 'node:test'
import { unitCatalog } from '../src/import/unit-catalog.ts'
import { applyCampaignCombatLosses } from '../src/match/campaign-combat-losses.ts'
import { campaignControlRecorder } from '../src/match/campaign-control.ts'
import { completeCampaignCleanup } from '../src/match/campaign-cleanup-phase.ts'
import { kirovogradScenarioVictory } from '../src/match/kirovograd-scenario-victory.ts'
import { kirovogradScenario } from '../src/ttw/campaign/kirovograd.ts'

function catalog() {
  const formation = (name, category, formationCode, side, nation) => ({ name, side, nation, category,
    org: { parentFmt: formationCode, airGroup: null } })
  const land = (id, name, side, formationCode, category, nation) => ({ id, name, side, nation, category,
    org: { parentFmt: formationCode, airGroup: null } })
  const hq = (id, name, hqKind) => ({ id, name, side: 'axis', hqKind, org: null })
  return unitCatalog([
    { kind: 'formation', file: 'synthetic-formations', rows: [
      formation('Ge Pz Div', 'armor', 'PzDiv', 'axis', 'Ge'),
      formation('Sov Tank Corps', 'armor', 'TankCorps', 'soviet', 'Sov'),
    ] },
    { kind: 'land', file: 'synthetic-land', rows: [
      land('a1', 'Ge Pz 1', 'axis', 'PzDiv', 'armor', 'Ge'),
      land('a2', 'Ge Pz 2', 'axis', 'PzDiv', 'armor', 'Ge'),
      land('s1', 'Sov Tank 1', 'soviet', 'TankCorps', 'armor', 'Sov'),
      land('s2', 'Sov Tank 2', 'soviet', 'TankCorps', 'armor', 'Sov'),
      land('s3', 'Sov Tank 3', 'soviet', 'TankCorps', 'armor', 'Sov'),
      land('inf', 'Ge Infantry', 'axis', 'InfDiv', 'infantry', 'Ge'),
    ] },
    { kind: 'hq', file: 'synthetic-hq', rows: [
      hq('h1', 'Ge HQ 8 Army', 'army'),
      hq('h2', 'Ge HQ 11 Corps', 'corps'),
      hq('h3', 'Ge HQ 42 Corps', 'corps'),
      hq('h4', 'Ge HQ 52 Corps', 'corps'),
      hq('ag', 'Ge HQ Army Group South', 'ags'),
    ] },
  ])
}

const destroyed = (definition, side, kind = 'land') => ({ id: definition, definition, side, kind, turn: 4 })

test('Scenario 09 victory reads destruction events and control history, not the current Dead Pile', () => {
  const definitions = catalog().definitions
  const victory = kirovogradScenarioVictory({ map: { resolveHex: (hex) => hex }, definitions, kirovogradHex: 'K' })
  const state = {
    when: { scenarioId: kirovogradScenario, date: '1944-01-19' },
    turn: 5,
    controlEvents: [
      { hex: 'K', side: 'axis', turn: 1 },
      { hex: 'K', side: 'soviet', turn: 2 },
      { hex: 'K', side: 'axis', turn: 3 },
      { hex: 'K', side: 'soviet', turn: 4 },
    ],
    hexControl: { K: 'soviet' },
    destroyedUnits: [
      destroyed('land:id:a1', 'axis'), destroyed('land:id:a2', 'axis'),
      destroyed('land:id:s1', 'soviet'), destroyed('land:id:s2', 'soviet'), destroyed('land:id:s3', 'soviet'),
      destroyed('hq:id:h1', 'axis', 'hq'), destroyed('hq:id:h2', 'axis', 'hq'),
      destroyed('hq:id:h3', 'axis', 'hq'), destroyed('hq:id:h4', 'axis', 'hq'),
      destroyed('hq:id:ag', 'axis', 'hq'), destroyed('land:id:inf', 'axis'),
    ],
  }
  // Soviet: liberation 1 + end control 1 + two Axis armor units 2 + 5 Axis HQs floor(5/2)=2
  // + Army HQ 1 + Army Group HQ 2 = 9. Axis: three Soviet armor units floor(3/2)=1.
  assert.deepEqual(victory(state), { scenarioId: kirovogradScenario, outcome: 'soviet', level: 'major', net: 8, soviet: 9, axis: 1 })
})

test('control recorder keeps a history of changes so liberation survives a later Axis reoccupation', () => {
  const record = (state, side) => campaignControlRecorder(new Set(['5']))(state, side,
    { path: ['5'], movers: [{ id: 'mover', combat: true, stepsLeft: 1 }], reached: { mover: 1 } })
  const state = { turn: 3, counters: {} }
  const first = record(state, 'soviet')
  assert.deepEqual(first.controlEvents, [{ hex: '5', side: 'soviet', turn: 3 }])
  const same = record(first, 'soviet')
  assert.deepEqual(same.controlEvents, first.controlEvents)
  const retaken = record(same, 'axis')
  assert.deepEqual(retaken.controlEvents, [{ hex: '5', side: 'soviet', turn: 3 }, { hex: '5', side: 'axis', turn: 3 }])
  assert.equal(retaken.hexControl['5'], 'axis')
})

test('combat losses append a destruction event separately from the Dead Pile snapshot', () => {
  const state = { turn: 2, counters: { u: { kind: 'land', side: 'axis', definition: 'land:id:u',
    location: { kind: 'map', hex: '1' }, currentRe: 4 } }, destroyedUnits: [] }
  const result = applyCampaignCombatLosses(state, new Map([['u', 4]]), { stepsOf: () => 4, reAfterLoss: () => 0 })
  assert.equal(result.counters.u.location.kind, 'dead-pile')
  assert.deepEqual(result.destroyedUnits, [{ id: 'u', definition: 'land:id:u', side: 'axis', kind: 'land', turn: 2 }])
})

test('cleanup writes the scenario victory when the round ends', () => {
  const expected = { scenarioId: kirovogradScenario, outcome: 'axis', level: 'major', net: 0, soviet: 0, axis: 0 }
  const state = { turn: 5, when: { scenarioId: kirovogradScenario, date: '1944-01-19' },
    cursor: { first: 'axis', phasing: 'soviet', phase: 'cleanup' }, counters: {} }
  const cleaned = completeCampaignCleanup(state, 'soviet', { cleanupEndBlockers: () => [],
    roundEnd: () => ({ kind: 'ended' }), scenarioVictory: () => expected })
  assert.deepEqual(cleaned.scenarioVictory, expected)
  assert.deepEqual(cleaned.cursor, { phase: 'ended', reason: 'scenario-end' })
})
