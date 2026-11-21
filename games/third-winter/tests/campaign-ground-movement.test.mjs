import assert from 'node:assert/strict'
import { test } from 'node:test'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { createCampaignOrdinaryMovementBoard } from '../src/match/campaign-movement-board.ts'
import { campaignMapInPlayArea } from '../src/ttw/campaign/play-area.ts'
import { projectCampaignGroundDestinations, projectCampaignGroundRoute, projectCampaignMatch } from '../src/view/campaign-match-view.ts'

const hexes = ['A1.01', 'A2.01', 'A3.01', 'C3.34', 'A4.01', 'A5.01', 'B2.01', 'B3.01']
const index = indexTtwCampaignMap({ items: hexes.map((hex_id) => ({ hex_id,
  seam_twin: hex_id === 'A3.01' ? 'C3.34' : hex_id === 'C3.34' ? 'A3.01' : null,
  seam_primary: hex_id === 'A3.01' ? true : hex_id === 'C3.34' ? false : null,
})) }, { items: [['A1.01', 'A2.01'], ['A2.01', 'C3.34'], ['A3.01', 'A4.01'], ['A4.01', 'A5.01'],
  ['A2.01', 'B2.01'], ['A3.01', 'B3.01']].map(([hex_a, hex_b]) =>
  ({ edge_key: `${hex_a}|${hex_b}`, hex_a, hex_b, seam_dup_group: null })) })
const map = campaignMapInPlayArea(index, { kind: 'hex-list', hexes: hexes.filter((hex) => hex !== 'A5.01') })
const unit = (hex, side = 'axis', extra = {}) => ({ kind: 'land', mode: 'combat', side, definition: 'foot', location: { kind: 'map', hex }, ...extra })
const reinforcement = { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] }
const groundProfile = { combat: true, attackCapable: true, inCombatMode: true, outOfSupply: false,
  moveMa: 4, moveMobility: 'leg', drawMobility: 'leg', singleTransportPoint: false }
const context = (inputs = {}) => ({ reinforcement, groundMovement: createCampaignOrdinaryMovementBoard({
  map, profileOf: (state, id) => ({ ...groundProfile, combat: state.counters[id].kind !== 'transport' }),
  moveProfile: (state, id) => ({ ma: state.counters[id].definition === 'truck' ? 5 : 3,
    mobility: state.counters[id].definition === 'truck' ? 'truck' : 'leg', fuelReady: true }),
  terrainAt: () => ['Open'], crossingAt: () => ({ barrier: 'none', routes: [] }),
  entryRequiresResolution: () => false,
  inTrace: (state, id, hex) => state.counters[id].location.hex === hex && hex === 'A4.1',
  ...inputs,
}) })
function atBreakout(counters, ground = 'dry') {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 3, counters }, 19)
  return { ...record, state: { ...record.state, cursor: { phase: 'movement', first: 'axis', phasing: 'axis' }, movementSegment: 'breakout',
    weather: { ground, flight: 'none' } } }
}
const command = (record, action) => ({ id: `move-${record.revision}`, expectedRevision: record.revision, action })
const submit = (record, action, config, side = 'axis') => submitCampaignMatch(record, side, command(record, action), config).record
const move = (path, movers = [{ id: 'march' }]) => ({ type: 'move-campaign-ground', movers, path })
const normal = (counters, config, ground) => submit(atBreakout(counters, ground), { type: 'complete-campaign-breakout' }, config)

test('single-unit previews replay through the normal command at the same cost across a canonical seam', () => {
  const config = context({ crossingAt: (_, id, from, to) => ({ barrier: 'none',
    routes: [from, to].includes('A3.1') ? ['road'] : [] }) })
  const breakout = atBreakout({ march: unit('A1.01') })
  const action = move(['A2.01', 'C3.34', 'A4.01'])
  assert.throws(() => submit(breakout, action, config), /window-closed/)
  const record = submit(breakout, { type: 'complete-campaign-breakout' }, config)
  assert.equal(projectCampaignMatch(record, 'soviet', config).movement, null)
  assert.deepEqual(projectCampaignGroundRoute(record, 'soviet', action, config), { revision: record.revision, ok: false, reason: 'window-closed' })
  const choices = projectCampaignGroundDestinations(record, 'axis', { id: 'march' }, config)
  assert.equal(choices.revision, record.revision)
  for (const { hex, spent, path } of choices.destinations) {
    const preview = projectCampaignGroundRoute(record, 'axis', move(path), config)
    assert.equal(preview.placements[0].spent, spent)
    assert.equal(submit(record, move(path), config).state.counters.march.location.hex, hex)
  }
  assert.equal(projectCampaignGroundRoute(record, 'axis', action, config).placements[0].spent, 2)
  const settled = submit(record, action, config)
  assert.equal(settled.state.counters.march.location.hex, 'A4.1')
  assert.equal(settled.state.rng.drawCount, record.state.rng.drawCount)
  assert.equal(submitCampaignMatch(settled, 'axis', command(record, action), config).duplicate, true)
  assert.throws(() => submitCampaignMatch(settled, 'axis', { ...command(record, action), id: 'stale-preview' }, config), /Stale match revision/)
  assert.throws(() => submit(settled, move(['A3.01']), config), /counter-cannot-spend-mp/)
  assert.throws(() => submit(record, move([...action.path, 'A5.01']), config), /outside-play-area/)
})

test('a wheel unit stops in ZOC and can go farther after a friendly combat unit commits its MP', () => {
  const config = context()
  const record = normal({ march: unit('A1.01', 'axis', { definition: 'truck' }), foot: unit('A1.01'),
    guard: unit('A2.01', 'axis', { mode: 'move' }), enemy: unit('B2.01', 'soviet') }, config)
  const route = ['A2.01', 'C3.34']
  assert.throws(() => submit(record, move(route), config), /must-stop/)
  assert.throws(() => submit(record, move(['A2.01', 'B2.01']), config), /must-stop/)
  const stack = move(route, [{ id: 'march', stopAfter: 1 }, { id: 'foot' }])
  const spread = submit(record, stack, config)
  assert.equal(spread.state.counters.march.location.hex, 'A2.1')
  assert.equal(spread.state.counters.foot.location.hex, 'A3.1')
  assert.throws(() => submit(spread, move(['A3.01']), config), /counter-cannot-spend-mp/)
  assert.deepEqual(projectCampaignMatch(record, 'axis', config).movement.zocHoldIds, ['guard'])
  const held = submit(record, { type: 'hold-campaign-ground-zoc', counterId: 'guard' }, config)
  assert.throws(() => submit(held, move(['A3.01'], [{ id: 'guard' }]), config), /counter-cannot-spend-mp/)
  assert.throws(() => submit(held, move(['A2.01', 'B2.01']), config), /enemy-combat/)
  assert.equal(submit(held, move(route), config).state.counters.march.location.hex, 'A3.1')
  assert.equal(record.state.counters.march.location.hex, 'A1.01')
})

test('strategic movement uses the move face, permits unsupplied transit and must finish in trace', () => {
  const config = context({ moveProfile: (state, id) => ({ ma: state.counters[id].mode === 'strat' ? 2 : 1,
    mobility: 'leg', fuelReady: true }) })
  const record = normal({ march: unit('A1.01') }, config)
  const mover = { id: 'march', mode: 'strat' }
  const choices = projectCampaignGroundDestinations(record, 'axis', mover, config)
  assert.deepEqual(choices.destinations.map(({ hex, spent }) => [hex, spent]), [['A4.1', 3]])
  assert.throws(() => submit(record, move(['A2.01'], [mover]), config), /strategic-end-needs-trace/)
  const settled = submit(record, move(choices.destinations[0].path, [mover]), config)
  assert.equal(settled.state.counters.march.mode, 'strat')
  const covered = normal({ march: unit('A1.01'), guard: unit('A2.01'), enemy: unit('B2.01', 'soviet') }, config)
  const held = submit(covered, { type: 'hold-campaign-ground-zoc', counterId: 'guard' }, config)
  assert.throws(() => submit(held, move(['A2.01'], [mover]), config), /strategic-zoc/)
  assert.throws(() => submit(covered, move(['A1.01'], [{ id: 'guard', mode: 'strat' }]), config), /strategic-mode-unavailable/)
})

test('Dry, Freeze and Mud use the TTW cost table and respect route, reciprocity and entry availability', () => {
  const counters = { march: unit('A1.01', 'axis', { definition: 'truck' }) }
  const mud = context()
  const expensive = normal(counters, mud, 'mud')
  const first = projectCampaignGroundRoute(expensive, 'axis', move(['A2.01']), mud)
  assert.deepEqual(first.placements, [{ id: 'march', hex: 'A2.1', spent: 5, stop: 'minimum-move' }])
  assert.throws(() => submit(expensive, move(['A2.01', 'A3.01']), mud), /must-stop/)
  const road = context({ terrainAt: () => ['Mountain'], crossingAt: () => ({ barrier: 'major', routes: ['road', 'rail'] }) })
  assert.equal(projectCampaignGroundRoute(expensive, 'axis', move(['A2.01', 'A3.01']), road).placements[0].spent, 4)
  const woods = context({ terrainAt: (hex) => hex === 'A2.1' ? ['Open', 'Woods'] : ['Open'] })
  assert.equal(projectCampaignGroundRoute(expensive, 'axis', move(['A2.01']), woods).placements[0].stop, 'all-mp')
  const frozen = normal(counters, mud, 'freeze')
  const ford = context({ terrainAt: (hex) => hex === 'A1.1' ? ['Swamp'] : ['Open'],
    crossingAt: () => ({ barrier: 'minor', routes: [] }) })
  assert.throws(() => submit(normal(counters, ford), move(['A2.01']), ford), /impassable/)
  assert.equal(projectCampaignGroundRoute(frozen, 'axis', move(['A2.01']), ford).placements[0].spent, 4)
  const needsEntry = context({ entryRequiresResolution: (_, side, hex) => side === 'axis' && hex === 'A2.1' })
  assert.throws(() => submit(frozen, move(['A2.01']), needsEntry), /entry-unresolved/)
  const noFuel = context({ moveProfile: () => ({ ma: 4, mobility: 'truck', fuelReady: false }) })
  assert.throws(() => submit(frozen, move(['A2.01']), noFuel), /needs-fuel/)
})

test('closing the movement segment checks its obligations and enters the barrage segment of the same phase', () => {
  const config = context({ endBlockers: (state) => state.counters.march.location.hex === 'A2.1' ? [] : ['overstack'] })
  const record = normal({ march: unit('A1.01') }, config)
  const complete = { type: 'complete-campaign-ground-movement' }
  assert.throws(() => submit(record, complete, context()), /end-rules-unavailable/)
  assert.deepEqual(projectCampaignMatch(record, 'axis', config).movement.endBlockers, ['overstack'])
  assert.throws(() => submit(record, complete, config), /overstack/)
  assert.throws(() => submit(record, complete, config, 'soviet'), /window-closed/)
  const moved = submit(record, move(['A2.01']), config)
  const ended = submit(moved, complete, config)
  assert.equal(ended.state.cursor.phase, 'movement')
  assert.equal(ended.state.movementSegment, 'barrage')
  assert.throws(() => submit(ended, move(['A3.01']), config), /window-closed/)
})

function volga(bridge, additionalBank = false) {
  return context({ crossingAt: (_, _id, from, to) => {
    if ([from, to].includes('A3.1') && ([from, to].includes('A2.1') || additionalBank && [from, to].includes('B3.1'))) {
      return { barrier: 'volga', bridge, routes: bridge === 'none' ? [] : ['road'] }
    }
    return { barrier: 'none', routes: [] }
  } })
}

test('Volga bridge capacity uses reduced RE, canonical sides of the seam and both directions', () => {
  const config = volga('intact')
  const record = normal({ march: unit('A2.01', 'axis', { currentRe: 2 }), fractional: unit('A2.01', 'axis', { currentRe: 1.5 }),
    reverse: unit('C3.34', 'axis', { currentRe: 1 }), excess: unit('A3.01', 'axis', { currentRe: 0.5 }),
    enemy: unit('A4.01', 'soviet'), unknown: unit('A2.01') }, config)
  const across = move(['C3.34'])
  const overloaded = move(['C3.34'], [{ id: 'march' }, { id: 'fractional' }])
  assert.throws(() => submit(record, overloaded, config), /crossing-capacity/)
  assert.throws(() => submit(record, move(['C3.34', 'A2.01']), config), /crossing-capacity/)
  assert.throws(() => submit(record, move(['C3.34'], [{ id: 'unknown' }]), config), /crossing-strength-unavailable/)
  assert.equal(record.state.counters.march.location.hex, 'A2.01')
  assert.equal(record.state.groundMovement.crossedReByHexside, undefined)
  assert.equal(projectCampaignGroundRoute(record, 'axis', across, config).placements[0].spent, 0.5)

  const crossed = submit(record, across, config)
  const held = submit(crossed, { type: 'hold-campaign-ground-zoc', counterId: 'excess' }, config)
  assert.deepEqual(held.state.groundMovement.crossedReByHexside, { 'A2.1|A3.1': 2 })
  const full = submit(held, move(['A2.01'], [{ id: 'reverse' }]), config)
  assert.deepEqual(full.state.groundMovement.crossedReByHexside, { 'A2.1|A3.1': 3 })
  assert.deepEqual(projectCampaignMatch(full, 'axis', config).movement.crossedReByHexside, { 'A2.1|A3.1': 3 })
  assert.equal(full.state.counters.reverse.location.hex, 'A2.1')
  assert.equal(projectCampaignGroundDestinations(full, 'axis', { id: 'fractional' }, config).destinations.some(({ hex }) => hex === 'A3.1'), false)
  assert.throws(() => submit(full, move(['A3.01'], [{ id: 'fractional' }]), config), /crossing-capacity/)
  const complete = { ...config, groundMovement: { ...config.groundMovement, endBlockers: () => [] } }
  const barrage = submit(full, { type: 'complete-campaign-ground-movement' }, complete)
  assert.deepEqual(barrage.state.groundMovement.crossedReByHexside, { 'A2.1|A3.1': 3 })
  const next = { ...barrage, state: { ...barrage.state, cursor: { ...barrage.state.cursor, phasing: 'soviet' }, movementSegment: 'breakout' } }
  assert.equal(submit(next, { type: 'complete-campaign-breakout' }, config, 'soviet').state.groundMovement.crossedReByHexside, undefined)
})

test('Volga crossing separates current ice from Freeze and distinguishes repaired and blown bridges', () => {
  const units = { march: unit('A2.01', 'axis', { currentRe: 1 }), wheels: unit('A2.01', 'axis', { definition: 'truck', currentRe: 1 }) }
  const closed = volga('none')
  const frozen = normal(units, closed, 'freeze')
  assert.throws(() => submit(frozen, move(['A3.01']), closed), /impassable/)
  const ice = { ...frozen, state: { ...frozen.state, weatherHistory: { ...frozen.state.weatherHistory, ice: true } } }
  assert.equal(projectCampaignGroundRoute(ice, 'axis', move(['C3.34']), closed).placements[0].stop, 'all-mp')
  assert.throws(() => submit(ice, move(['A3.01', 'B3.01']), closed), /must-stop/)
  assert.throws(() => submit(ice, move(['A3.01'], [{ id: 'wheels' }]), closed), /impassable/)
  const blown = volga('blown')
  assert.equal(projectCampaignGroundRoute(frozen, 'axis', move(['A3.01']), blown).placements[0].stop, 'all-mp')
  assert.throws(() => submit(frozen, move(['A3.01'], [{ id: 'wheels' }]), blown), /impassable/)
  const repaired = volga('repaired')
  const wet = { ...ice, state: { ...ice.state, weather: { ground: 'mud', flight: 'none' } } }
  assert.equal(projectCampaignGroundRoute(wet, 'axis', move(['A3.01'], [{ id: 'wheels' }]), repaired).placements[0].spent, 2)
})

test('one friendly ferry marker covers its adjacent river hexsides and fixes its pontoon in place', () => {
  const config = volga('none', true)
  const normalPhase = normal({ march: unit('A2.01', 'axis', { currentRe: 3 }), branch: unit('B3.01', 'axis', { currentRe: 3 }),
    pontoon: unit('A3.01', 'axis', { currentRe: 1 }), enemy: unit('A4.01', 'soviet') }, config)
  const ferry = { id: 'ferry', side: 'axis', hex: 'C3.34', pontoonId: 'pontoon' }
  const record = { ...normalPhase, state: { ...normalPhase.state, ferries: [ferry] } }
  assert.deepEqual(projectCampaignMatch(record, 'soviet', config).ferries, [{ id: 'ferry', side: 'axis', hex: 'A3.1' }])
  assert.equal(projectCampaignMatch(record, 'axis', config).movement.availableIds.includes('pontoon'), false)
  assert.throws(() => submit(record, move(['A2.01'], [{ id: 'pontoon' }]), config), /pontoon-has-active-ferry/)
  assert.equal(config.groundMovement.cost(record.state, 'enemy', 'A2.1', 'A3.1', 'leg'), null)
  const first = submit(record, move(['A3.01']), config)
  const second = submit(first, move(['A3.01'], [{ id: 'branch' }]), config)
  assert.deepEqual(second.state.groundMovement.crossedReByHexside, { 'A2.1|A3.1': 3, 'A3.1|B3.1': 3 })
  const inactive = { ...record, state: { ...record.state, counters: { ...record.state.counters, pontoon: unit('A1.01') } } }
  assert.throws(() => submit(inactive, move(['A3.01']), config), /impassable/)
  assert.deepEqual(projectCampaignMatch(inactive, 'soviet', config).ferries, [])
})
