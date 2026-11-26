import assert from 'node:assert/strict'
import { test } from 'node:test'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { unitCatalog } from '../src/import/unit-catalog.ts'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { campaignGroundDestinations, campaignGroundMovementOptions } from '../src/match/campaign-ground-movement.ts'
import { createCampaignOrdinaryMovementBoard } from '../src/match/campaign-movement-board.ts'
import { kirovogradReleaseRule } from '../src/match/kirovograd-release.ts'
import { campaignHexesWithin } from '../src/ttw/campaign/hex-range.ts'
import { kirovogradTankCorpsHold, kirovogradTankCorpsReleased } from '../src/ttw/campaign/kirovograd.ts'
import { campaignMapInPlayArea } from '../src/ttw/campaign/play-area.ts'

// A nine-hex chain with a three-hex side branch. The corps sits at the west end, the city at the end of the branch.
const chain = Array.from({ length: 9 }, (_, i) => `A${i + 1}.01`)
const branch = ['A1.02', 'A2.02', 'A3.02']
const hexes = [...chain, ...branch]
const edges = [[chain[0], branch[0]], ...chain.slice(1).map((hex_b, i) => [chain[i], hex_b]),
  ...branch.slice(1).map((hex_b, i) => [branch[i], hex_b])]
const map = campaignMapInPlayArea(indexTtwCampaignMap({ items: hexes.map((hex_id) => ({ hex_id })) },
  { items: edges.map(([hex_a, hex_b]) => ({ edge_key: `${hex_a}|${hex_b}`, hex_a, hex_b, seam_dup_group: null })) }),
{ kind: 'hex-list', hexes })
const catalog = unitCatalog([{ kind: 'land', file: 'synthetic', rows: [
  { id: '1', name: 'Sov 29.Tk 25 Tk Bde', side: 'soviet', nation: 'Sov', org: { parentFmt: '29.Tk', airGroup: null } },
  { id: '2', name: 'Sov 29.Tk 31 Tk Bde', side: 'soviet', nation: 'Sov', org: { parentFmt: '29.Tk', airGroup: null } },
  { id: '3', name: 'Ge 3.Pz II-6 Pz Bn', side: 'axis', nation: 'Ge', org: { parentFmt: '3.Pz', airGroup: null } },
  { id: '4', name: 'Hun 1.Armored Div', side: 'axis', nation: 'Hun' },
  { id: '5', name: 'Sov 78 Rifle Div', side: 'soviet', nation: 'Sov' },
  { id: '6', name: 'Sov Truck', side: 'soviet', nation: 'Sov' },
  { id: '7', name: 'Ge unlabeled', side: 'axis' },
] }])
const counter = (definition, side, hex) => ({ definition: `land:id:${definition}`, kind: definition === '6' ? 'transport' : 'land',
  side, mode: 'combat', location: { kind: 'map', hex } })
const corps = (hex = 'A1.01') => ({
  tk25: { ...counter('1', 'soviet', hex), held: kirovogradTankCorpsHold },
  tk31: { ...counter('2', 'soviet', hex), held: kirovogradTankCorpsHold },
})
const city = 'A3.02'
const release = kirovogradReleaseRule({ map, definitions: catalog.definitions, kirovogradHex: city })
const config = () => ({
  reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] },
  groundMovement: createCampaignOrdinaryMovementBoard({ map, releases: release,
    profileOf: (state, id) => ({ combat: state.counters[id].kind !== 'transport', attackCapable: true, inCombatMode: true,
      outOfSupply: false, moveMa: 4, moveMobility: 'leg', drawMobility: 'leg', singleTransportPoint: false }),
    moveProfile: () => ({ ma: 4, mobility: 'leg', fuelReady: true }),
    terrainAt: () => ['Open'], crossingAt: () => ({ barrier: 'none', routes: [] }), entryRequiresResolution: () => false }),
})
function movement(counters, phasing) {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 3, counters }, 23)
  return { ...record, state: { ...record.state, cursor: { phase: 'movement', first: phasing, phasing },
    movementSegment: 'movement', weather: { ground: 'freeze', flight: 'limited' } } }
}
const submit = (record, action, context) => submitCampaignMatch(record, record.state.cursor.phasing,
  { id: `move-${record.revision}`, expectedRevision: record.revision, action }, context).record
const march = (id, path) => ({ type: 'move-campaign-ground', movers: [{ id }], path })
const heldIds = (state) => Object.keys(state.counters).filter((id) => state.counters[id].held === kirovogradTankCorpsHold)

test('hex ranges follow the map neighbors and the release rule accepts either trigger', () => {
  assert.deepEqual(new Set(campaignHexesWithin(map, 'A3.01', 2)), new Set(['A3.1', 'A2.1', 'A4.1', 'A1.1', 'A5.1']))
  assert.deepEqual(new Set(campaignHexesWithin(map, 'A3.01', 3)), new Set(['A3.1', 'A2.1', 'A4.1', 'A1.1', 'A5.1', 'A6.1', 'A1.2']))
  assert.deepEqual(campaignHexesWithin(map, 'A9.01', 3), ['A9.1', 'A8.1', 'A7.1', 'A6.1'])
  assert.deepEqual(campaignHexesWithin(map, 'A1.02', 0), ['A1.2'])
  assert.throws(() => campaignHexesWithin(map, 'A1.01', -1), /Invalid hex radius/)
  assert.deepEqual(kirovogradTankCorpsReleased({ kirovogradLiberated: false, germanWithin: false }), false)
  assert.equal(kirovogradTankCorpsReleased({ kirovogradLiberated: true, germanWithin: false }), true)
  assert.equal(kirovogradTankCorpsReleased({ kirovogradLiberated: false, germanWithin: true }), true)
})

test('the unreleased corps cannot march and is released for the rest of the game by a German unit within five hexes', () => {
  const context = config()
  const far = submit(movement({ ...corps(), ge: counter('3', 'axis', 'A8.01') }, 'axis'), march('ge', ['A7.01']), context)
  assert.deepEqual(heldIds(far.state), ['tk25', 'tk31'])
  const soviet = movement(far.state.counters, 'soviet')
  assert.throws(() => submit(soviet, march('tk25', ['A2.01']), context), /counter-held/)
  const options = campaignGroundMovementOptions(soviet.state, 'soviet', context.groundMovement)
  assert.deepEqual(options.heldIds, ['tk25', 'tk31'])
  assert.ok(!options.availableIds.includes('tk25') && !options.availableIds.includes('tk31'))
  const choice = campaignGroundDestinations(soviet.state, 'soviet', { id: 'tk31', mode: 'move' }, context.groundMovement)
  assert.equal(choice.ok, false)
  assert.equal(choice.reason, 'counter-held')
  const near = submit(movement(far.state.counters, 'axis'), march('ge', ['A6.01']), context)
  assert.deepEqual(heldIds(near.state), [])
  const left = submit(movement(near.state.counters, 'axis'), march('ge', ['A7.01', 'A8.01']), context)
  const free = submit(movement(left.state.counters, 'soviet'), march('tk25', ['A2.01']), context)
  assert.equal(free.state.counters.tk25.location.hex, 'A2.1')
  assert.equal('held' in free.state.counters.tk25, false)
})

test('only a German unit releases the corps by proximity', () => {
  const adjacent = movement({ ...corps(), hun: counter('4', 'axis', 'A2.01'), unlabeled: counter('7', 'axis', 'A1.02') }, 'soviet').state
  assert.deepEqual(release(adjacent, 'axis', { path: [], movers: [] }), [])
  assert.throws(() => submit(movement(adjacent.counters, 'soviet'), march('tk25', ['A2.02']), config()), /counter-held/)
  const german = { ...adjacent, counters: { ...adjacent.counters, ge: counter('3', 'axis', 'A1.02') } }
  assert.deepEqual(release(german, 'axis', { path: [], movers: [] }), ['tk25', 'tk31'])
})

test('liberating Kirovograd releases the corps at once, a march paused before the city does not', () => {
  const context = config()
  const truck = submit(movement({ ...corps(), truck: counter('6', 'soviet', 'A2.02') }, 'soviet'), march('truck', [city]), context)
  assert.deepEqual(heldIds(truck.state), ['tk25', 'tk31'])
  const rifle = submit(movement({ ...corps(), rifle: counter('5', 'soviet', 'A1.02') }, 'soviet'), march('rifle', ['A2.02', city]), context)
  assert.deepEqual(heldIds(rifle.state), [])
  const samePhase = submit(rifle, march('tk25', ['A2.01']), context)
  assert.equal(samePhase.state.counters.tk25.location.hex, 'A2.1')
  const paused = movement({ ...corps(), rifle: { ...counter('5', 'soviet', 'A2.02') } }, 'soviet').state
  const interrupted = { ...paused, groundMovement: { ...paused.groundMovement,
    interruption: { kind: 'resume-march', hex: 'A2.02', refusal: { reason: 'blocked' }, march: {} } } }
  assert.deepEqual(release(interrupted, 'soviet', { path: ['A2.02', city], movers: [{ id: 'rifle', combat: true, stepsLeft: 2 }] }), [])
  assert.deepEqual(release(paused, 'soviet', { path: ['A2.02', city], movers: [{ id: 'rifle', combat: true, stepsLeft: 2 }] }), ['tk25', 'tk31'])
})

test('a combat unit that stops short of the city does not liberate it, even if a stack-mate reaches it', () => {
  const context = config()
  const start = { ...corps(), rifle: counter('5', 'soviet', 'A1.02'), truck: counter('6', 'soviet', 'A1.02') }
  const order = (rifleStop) => ({ type: 'move-campaign-ground', path: ['A2.02', city],
    movers: [{ id: 'rifle', ...(rifleStop ? { stopAfter: 1 } : {}) }, { id: 'truck' }] })
  const short = submit(movement(start, 'soviet'), order(true), context)
  assert.equal(short.state.counters.rifle.location.hex, 'A2.2')
  assert.equal(short.state.counters.truck.location.hex, 'A3.2')
  assert.deepEqual(heldIds(short.state), ['tk25', 'tk31'])
  const both = submit(movement(start, 'soviet'), order(false), context)
  assert.deepEqual(heldIds(both.state), [])
})
