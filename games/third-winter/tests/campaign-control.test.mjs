import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { createCampaignOrdinaryMovementBoard } from '../src/match/campaign-movement-board.ts'
import { campaignCityControl, campaignControlOptions, campaignControlRecorder } from '../src/match/campaign-control.ts'

// TTW §5.0a：最后穿越 VP/城市格的战斗单位一方控制该格；城市整体控制＝全部格同属一方。
const map = { resolveHex: (h) => h, neighbors: (h) => [`${Number(h) - 1}`, `${Number(h) + 1}`] }
const sites = new Set(['4', '5', '6'])
const unit = (hex, extra = {}) => ({ kind: 'land', mode: 'combat', side: 'axis', definition: 'foot', location: { kind: 'map', hex }, ...extra })
const reinforcement = { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] }
const groundProfile = { combat: true, attackCapable: true, inCombatMode: true, outOfSupply: false,
  moveMa: 4, moveMobility: 'leg', drawMobility: 'leg', singleTransportPoint: false }
function context() {
  return { reinforcement, groundMovement: createCampaignOrdinaryMovementBoard({
    map, profileOf: (state, id) => ({ ...groundProfile, combat: state.counters[id].definition !== 'supply' }),
    moveProfile: () => ({ ma: 3, mobility: 'leg', fuelReady: true }), terrainAt: () => ['Open'],
    crossingAt: () => ({ barrier: 'none', routes: [] }), entryRequiresResolution: () => false,
    inTrace: () => true, afterMove: campaignControlRecorder(sites),
  }) }
}
function game(counters) {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 3, counters }, 21)
  return { ...record, state: { ...record.state, cursor: { phase: 'movement', first: 'axis', phasing: 'axis' }, movementSegment: 'movement',
    weather: { ground: 'dry', flight: 'none' } } }
}
let seq = 0
const submit = (record, action) => submitCampaignMatch(record, 'axis',
  { id: `ctl-${seq++}`, expectedRevision: record.revision, action }, context()).record

test('a combat unit moving through a control site claims it, a supply unit does not (§5.0a)', () => {
  const moved = submit(game({ march: unit('4') }), { type: 'move-campaign-ground', movers: [{ id: 'march' }], path: ['5', '6'] })
  assert.equal(moved.state.hexControl['5'], 'axis')
  assert.equal(moved.state.hexControl['6'], 'axis')
  // a non-combat mover leaves control untouched
  const nonCombat = submit(game({ wagon: unit('4', { definition: 'supply', kind: 'transport' }) }),
    { type: 'move-campaign-ground', movers: [{ id: 'wagon' }], path: ['5', '6'] })
  assert.equal(nonCombat.state.hexControl, undefined)
})

test('the last side through a site takes it, and a city needs every hex on one side (§5.0a)', () => {
  const record = campaignControlRecorder(sites)(game({}).state, 'soviet', { path: ['5', '6'], movers: [{ id: 'x', combat: true, stepsLeft: 2 }] })
  assert.equal(record.hexControl['5'], 'soviet')
  const state = { ...record, hexControl: { ...record.hexControl, '4': 'axis' } }
  assert.equal(campaignCityControl(state, ['5', '4']), null)
  assert.equal(campaignCityControl({ ...state, hexControl: { '4': 'soviet', '5': 'soviet' } }, ['4', '5']), 'soviet')
  assert.deepEqual(campaignControlOptions({ ...state, hexControl: { '4': 'axis' } }, ['4', '7']),
    [{ hex: '4', side: 'axis' }, { hex: '7', side: null }])
})
