import assert from 'node:assert/strict'
import test from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { campaignRvgkExitObligations } from '../src/match/campaign-rvgk.ts'

const map = { resolveHex: (h) => h, neighbors: (h) => [`${Number(h) - 1}`, `${Number(h) + 1}`] }
const isCombatUnit = (state, id) => state.counters[id]?.definition === 'COMBAT'

const soviets = () => ({
  S1: { definition: 'S', kind: 'land', side: 'soviet', location: { kind: 'box', box: 'rvgk-1' } },
  S2: { definition: 'S', kind: 'land', side: 'soviet', location: { kind: 'box', box: 'rvgk-1' } } })

function game(patch = {}) {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 6, counters: {
    ...soviets(),
    A: { definition: 'COMBAT', kind: 'land', side: 'axis', location: { kind: 'map', hex: '14' } } } }, 900)
  record.state.cursor = { phase: 'movement', phasing: 'soviet', first: 'axis' }
  record.state.movementSegment = 'movement'
  record.state.rvgkMarkers = { 'rvgk-1': '10' }
  Object.assign(record.state, patch)
  return record
}
let seq = 0
const force = (record, action, side = 'soviet', facts = isCombatUnit) => submitCampaignMatch(record, side,
  { id: `rvgk-exit-${seq++}`, expectedRevision: record.revision, action: { type: 'force-exit-campaign-rvgk', ...action } },
  { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: (h) => h, arrivalSites: () => [] },
    groundMovement: { map }, rvgkAxisCombatUnit: facts }).record

test('an Axis combat unit within five hexes of the marker creates a forced-exit obligation (TTW 3.5d A)', () => {
  assert.deepEqual(campaignRvgkExitObligations(game().state, map, isCombatUnit), [{ box: 'rvgk-1', axisCombatHex: '14' }])
  const withAxis = (axis) => { const state = game().state
    return { ...state, counters: { ...soviets(), A: axis } } }
  // a far Axis unit creates nothing
  assert.deepEqual(campaignRvgkExitObligations(withAxis({ definition: 'COMBAT', kind: 'land', side: 'axis',
    location: { kind: 'map', hex: '30' } }), map, isCombatUnit), [])
  // an empty box creates nothing
  assert.deepEqual(campaignRvgkExitObligations({ ...withAxis({ definition: 'COMBAT', kind: 'land', side: 'axis',
    location: { kind: 'map', hex: '14' } }), counters: { A: { definition: 'COMBAT', kind: 'land', side: 'axis',
    location: { kind: 'map', hex: '14' } } } }, map, isCombatUnit), [])
})

test('the Soviets place the whole box within three hexes of the marker (TTW 3.5d A)', () => {
  const placed = force(game(), { box: 'rvgk-1', axisCombatHex: '14', placements: { S1: '10', S2: '11' } })
  assert.deepEqual(placed.state.counters.S1.location, { kind: 'map', hex: '10' })
  assert.deepEqual(placed.state.counters.S2.location, { kind: 'map', hex: '11' })
  // every unit must land within three hexes of the marker
  assert.throws(() => force(game(), { box: 'rvgk-1', axisCombatHex: '14', placements: { S1: '10', S2: '25' } }),
    /within 3 hexes/)
  // a non-combat Axis counter cannot trigger the exit
  assert.throws(() => force(game(), { box: 'rvgk-1', axisCombatHex: '14', placements: { S1: '10', S2: '11' } },
    'soviet', () => false), /not within five hexes/)
  assert.throws(() => force(game(), { box: 'rvgk-1', axisCombatHex: '30', placements: { S1: '10' } }), /not within five hexes/)
  // only the Soviet player issues the placements
  assert.throws(() => force(game(), { box: 'rvgk-1', axisCombatHex: '14', placements: { S1: '10' } }, 'axis'), /Only the Soviet/)
})
