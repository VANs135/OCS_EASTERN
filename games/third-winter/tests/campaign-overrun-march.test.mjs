import assert from 'node:assert/strict'
import { test } from 'node:test'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { createCampaignOrdinaryMovementBoard } from '../src/match/campaign-movement-board.ts'
import { campaignMapInPlayArea } from '../src/ttw/campaign/play-area.ts'

// OCS 8.1 突袭返回移动：进格后以余量 MP 续走；阶段/回合边界清空战斗账本。
const hexes = ['A1.01', 'A2.01', 'A3.01', 'A4.01']
const index = indexTtwCampaignMap({ items: hexes.map((hex_id) => ({ hex_id, seam_twin: null, seam_primary: null })) },
  { items: [['A1.01', 'A2.01'], ['A2.01', 'A3.01'], ['A3.01', 'A4.01']].map(([hex_a, hex_b]) =>
    ({ edge_key: `${hex_a}|${hex_b}`, hex_a, hex_b, seam_dup_group: null })) })
const map = campaignMapInPlayArea(index, { kind: 'hex-list', hexes })
const unit = (hex, extra = {}) => ({ kind: 'land', mode: 'combat', side: 'axis', definition: 'foot', location: { kind: 'map', hex }, currentRe: 1, ...extra })
const reinforcement = { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] }
const config = { reinforcement, cleanupEndBlockers: () => [], roundEnd: () => ({ kind: 'continue', date: '1943-10-12' }), groundMovement: createCampaignOrdinaryMovementBoard({
  map, profileOf: () => ({ combat: true, attackCapable: true, inCombatMode: true, outOfSupply: false, moveMa: 4, moveMobility: 'leg', drawMobility: 'leg', singleTransportPoint: false }),
  moveProfile: () => ({ ma: 3, mobility: 'leg', fuelReady: true }),
  terrainAt: () => ['Open'], crossingAt: () => ({ barrier: 'none', routes: [] }),
  entryRequiresResolution: () => false, inTrace: () => true, endBlockers: () => [],
}) }
function atMovement(counters, over = {}) {
  const opened = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 3, counters }, 19)
  return { ...opened, state: { ...opened.state, cursor: { phase: 'movement', first: 'axis', phasing: 'axis' }, movementSegment: 'movement',
    weather: { ground: 'dry', flight: 'none' }, overrunMarch: { remaining: { atk: 2 }, enteredHex: true }, ...over } }
}
const command = (record, action) => ({ id: `march-${record.revision}`, expectedRevision: record.revision, action })
const submit = (record, action, side = 'axis') => submitCampaignMatch(record, side, command(record, action), config).record
const move = (path, movers = [{ id: 'atk' }]) => ({ type: 'move-campaign-ground', movers, path })

test('8.1 return movement spends the overrun remainder and marks the stack moved', () => {
  const record = atMovement({ atk: unit('A3.01'), other: unit('A1.01') })
  const settled = submit(record, move(['A4.01']))
  assert.deepEqual(settled.state.counters.atk.location, { kind: 'map', hex: 'A4.1' })
  assert.deepEqual(settled.state.overrunMarch, { remaining: { atk: 1 }, enteredHex: true })
  assert.ok(settled.state.groundMovement.moved.includes('atk'))
  // 余量 1 不足以走两格。
  assert.throws(() => submit(atMovement({ atk: unit('A2.01') }, { overrunMarch: { remaining: { atk: 1 }, enteredHex: true } }), move(['A3.01', 'A4.01'])), /movement/)
})

test('8.1 only overrun participants may move while the return march is pending', () => {
  const record = atMovement({ atk: unit('A3.01'), other: unit('A1.01') })
  assert.throws(() => submit(record, move(['A2.01'], [{ id: 'other' }])), /overrun-march-pending/)
})

test('movement segment end and player-turn boundary clear the combat ledgers', () => {
  const record = atMovement({ atk: unit('A3.01') })
  const ended = submit(record, { type: 'complete-campaign-ground-movement' })
  assert.equal(ended.state.overrunMarch, null)
  assert.equal(ended.state.movementSegment, 'barrage')
  const cleanup = { ...record, state: { ...record.state, cursor: { phase: 'cleanup', phasing: 'axis' },
    combatTargets: ['A3.01'], combatAttackers: ['atk'], volgaAdvance: { phase: 'combat', re: { east: 3 } } } }
  const settled = submit(cleanup, { type: 'complete-campaign-cleanup' })
  assert.deepEqual(settled.state.combatTargets, [])
  assert.deepEqual(settled.state.combatAttackers, [])
  assert.equal(settled.state.overrunMarch, null)
  assert.equal(settled.state.volgaAdvance, undefined)
})