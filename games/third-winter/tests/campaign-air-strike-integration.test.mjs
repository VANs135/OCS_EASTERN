import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'

const hexes = ['A1.1', 'A2.1', 'A3.1', 'A4.1']
const map = {
  resolveHex: (hex) => hexes.includes(hex) ? hex : undefined,
  neighbors(hex) { const i = hexes.indexOf(hex); return i < 0 ? [] : [hexes[i - 1], hexes[i + 1]].filter(Boolean) },
}
const table = { columns: ['1-2', '3-6', '7-8'], costs: [1, 1, 1], matrix: Array.from({ length: 11 }, () => ['1', '-', '-']) }
const board = {
  map, table, distance: (a, b) => Math.abs(hexes.indexOf(a) - hexes.indexOf(b)),
  profileOf: (state, id) => ({ combat: state.counters[id]?.kind === 'land', attackCapable: true,
    inCombatMode: true, outOfSupply: false, moveMa: 4, moveMobility: 'leg', drawMobility: 'leg', singleTransportPoint: false }),
  barrageProfile: () => undefined,
  stepsOf: (state, id) => state.counters[id]?.currentRe,
  printedReOf: (state, id) => state.counters[id]?.currentRe ?? 1,
  terrainAt: () => ['Open'], hedgehogAt: () => 0, canUseSupply: () => true,
  losses: { stepsOf: (state, id) => state.counters[id]?.currentRe, reAfterLoss: (state, id, losses) => state.counters[id].currentRe - losses,
    hqKindOf: () => undefined },
  airProfileOf: (state, id) => state.counters[id]?.kind === 'aircraft' ? {
    rangeHexes: 99, printedSteps: 2, airCombat: 1, bombing: 2, fighter: false, hipShoot: false, tankBuster: false,
  } : undefined,
  rangeHexes: () => 99, flakValueAt: () => 10, workRefusal: () => null,
}

const command = (record, action) => ({ id: `air:${record.revision}`, expectedRevision: record.revision, action })
const submit = (record, context, action, side = 'axis') => submitCampaignMatch(record, side, command(record, action), context)

function setup() {
  const opened = openCampaignMatch({ when: { scenarioId: '09', date: '1944-01-05' }, turn: 1,
    counters: {
      a: { kind: 'aircraft', side: 'axis', definition: 'Ju.87D', location: { kind: 'box', box: '09:axis:air' }, active: true },
      victim: { kind: 'land', side: 'soviet', definition: 'inf', location: { kind: 'map', hex: 'A3.1' }, currentRe: 1, mode: 'combat' },
    } }, 623)
  return { ...opened, state: { ...opened.state, weather: { ground: 'frozen', flight: 'normal' },
    cursor: { phase: 'movement', phasing: 'axis', first: 'axis' }, movementSegment: 'barrage' } }
}

test('campaign dispatch carries an air strike through Flak, terrain, loss and return', () => {
  const record = setup()
  const context = { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] },
    airMission: board, barrage: board }
  const launched = submit(record, context, { type: 'launch-campaign-air-strike', kind: 'barrage', targetHex: 'A3.1', aircraftIds: ['a'] })
  assert.equal(launched.record.state.airMission.step.kind, 'flak')
  const flak = submit(launched.record, context, { type: 'resolve-campaign-air-flak' })
  assert.equal(flak.record.state.airMission.step.kind, 'barrage')
  assert.equal(flak.record.state.barrage.air.missionId, flak.record.state.airMission.id)
  assert.equal(flak.record.state.counters.a.stepsLost, 1)
  const rolled = submit(flak.record, context, { type: 'choose-campaign-barrage-terrain', terrain: 'Open' }, 'soviet')
  const settled = rolled.record.state.barrage?.lossesDue
    ? submit(rolled.record, context, { type: 'assign-campaign-barrage-loss', allocation: [{ unitId: 'victim', steps: 1 }] }, 'soviet').record
    : rolled.record
  assert.equal(settled.state.airMission, null)
  assert.equal(settled.state.barrage, null)
  assert.deepEqual(settled.state.counters.a.location, { kind: 'box', box: '09:axis:air' })
  assert.equal(settled.state.counters.a.active, false)
  assert.equal(settled.state.airHistory.length, 1)
})
