import assert from 'node:assert/strict'
import { test } from 'node:test'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { createCampaignOrdinaryMovementBoard } from '../src/match/campaign-movement-board.ts'
import { newCampaignReinforcementWindow } from '../src/match/campaign-reinforcement-flow.ts'
import { campaignMapInPlayArea } from '../src/ttw/campaign/play-area.ts'
import { projectCampaignGroundDestinations, projectCampaignGroundRoute, projectCampaignMarchResume, projectCampaignMatch } from '../src/view/campaign-match-view.ts'

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

function sovietMovement(counters, config) {
  const opening = atBreakout(counters)
  const record = { ...opening, state: { ...opening.state, cursor: { ...opening.state.cursor, phasing: 'soviet' } } }
  return submit(record, { type: 'complete-campaign-breakout' }, config, 'soviet')
}

const bridgeDecision = (blow = []) => ({ type: 'resolve-campaign-bridge-demolition', blow })

const closeGround = { type: 'complete-campaign-ground-movement' }
const closeMovement = { type: 'complete-campaign-movement-phase' }
function engineering(config = volga('blown')) {
  const board = config.groundMovement
  return { ...config, reinforcementBlockers: () => [], movementBarrageBlockers: () => [], groundMovement: {
    ...board, endBlockers: () => [], profileOf(state, id) {
      return { ...board.profileOf(state, id), pontoon: state.counters[id].definition === 'pontoon' }
    },
  } }
}
function beginEngineering(record, config, side = 'axis', turn = record.state.turn) {
  const closed = { ...record, state: { ...record.state, turn, cursor: { first: 'axis', phasing: side, phase: 'reinforcement' },
    reinforcement: { stage: 'closing', window: newCampaignReinforcementWindow() } } }
  return submit(closed, { type: 'complete-campaign-reinforcement' }, config, side)
}
const afterBreakout = (record, config, side = 'axis') => submit(record, { type: 'complete-campaign-breakout' }, config, side)
const pontoon = (hex, extra = {}) => unit(hex, 'axis', { definition: 'pontoon', currentRe: 1, ...extra })
const repairOrder = (pontoonId = 'pontoon') => ({ type: 'repair-campaign-volga-bridge', pontoonId, bridgeId: 'A2.1|A3.1' })

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

test('first Soviet combat entry stops at the bridge end and only Axis sees and answers the options', () => {
  const config = volga('intact')
  const record = sovietMovement({ march: unit('A1.01', 'soviet', { currentRe: 1 }), later: unit('B2.01', 'soviet', { currentRe: 1 }) }, config)
  const route = move(['A2.01', 'C3.34', 'A4.01'])
  const reachable = projectCampaignGroundDestinations(record, 'soviet', { id: 'march' }, config)
  assert.deepEqual(reachable.destinations.map(({ hex, pause }) => [hex, pause]), [['A2.1', 'volga-bridge-demolition']])
  const preview = projectCampaignGroundRoute(record, 'soviet', route, config)
  assert.deepEqual(preview.pause, { kind: 'volga-bridge-demolition', hex: 'A2.1' })
  assert.deepEqual(preview.placements, [{ id: 'march', hex: 'A2.1', spent: 1, stop: null }])
  assert.equal(record.state.counters.march.location.hex, 'A1.01')
  const waiting = submit(record, route, config, 'soviet')
  assert.equal(waiting.state.counters.march.location.hex, 'A2.1')
  assert.equal(waiting.state.groundMovement.moved.length, 0)
  const axis = projectCampaignMatch(waiting, 'axis', config)
  assert.deepEqual(axis.marchResponse.bridges, [{ id: 'A2.1|A3.1', hexside: ['A2.1', 'A3.1'] }])
  assert.equal(axis.actor, 'axis')
  assert.equal(axis.phasing, 'soviet')
  assert.equal(axis.aircraftConsolidation, undefined)
  assert.deepEqual(projectCampaignMatch(waiting, 'soviet', config).marchResponse, { kind: 'volga-bridge-demolition', hex: 'A2.1' })
  assert.throws(() => submit(waiting, { type: 'complete-campaign-ground-movement' }, config, 'soviet'), /awaits a response/)
  assert.throws(() => submit(waiting, bridgeDecision(), config, 'soviet'), /Only Axis/)
  assert.throws(() => submit(waiting, bridgeDecision(['not-offered']), config), /offered Volga bridges/)

  const answer = command(waiting, bridgeDecision())
  const resumed = submitCampaignMatch(waiting, 'axis', answer, config).record
  assert.equal(resumed.state.counters.march.location.hex, 'A4.1')
  assert.deepEqual(resumed.state.volgaBridgeDecisions, { 'A2.1|A3.1': 'kept' })
  assert.deepEqual(resumed.state.groundMovement.crossedReByHexside, { 'A2.1|A3.1': 1 })
  assert.equal(resumed.state.rng.drawCount, record.state.rng.drawCount)
  assert.equal(submitCampaignMatch(resumed, 'axis', answer, config).duplicate, true)
  assert.throws(() => submit(resumed, bridgeDecision(['A2.1|A3.1']), config), /response is unavailable/)
  const later = submit(resumed, move(['A2.01', 'A3.01'], [{ id: 'later' }]), config, 'soviet')
  assert.equal(later.state.groundMovement.interruption, undefined)
  assert.equal(later.state.counters.later.location.hex, 'A3.1')
})

test('a blown bridge commits the answer and lets Soviet replan using only remaining MP', () => {
  const config = volga('intact')
  const record = sovietMovement({ march: unit('A1.01', 'soviet', { definition: 'truck', currentRe: 2 }) }, config)
  const waiting = submit(record, move(['A2.01', 'A3.01', 'A4.01']), config, 'soviet')
  const blocked = submit(waiting, bridgeDecision(['A2.1|A3.1']), config)
  assert.equal(blocked.state.counters.march.location.hex, 'A2.1')
  assert.deepEqual(blocked.state.groundMovement.crossedReByHexside, {})
  assert.deepEqual(blocked.state.volgaBridgeDecisions, { 'A2.1|A3.1': 'blown' })
  const own = projectCampaignMatch(blocked, 'soviet', config)
  assert.equal(own.actor, 'soviet')
  assert.deepEqual(own.marchResponse.movers, [{ id: 'march', remainingMp: 4, stop: null }])
  assert.deepEqual(own.marchResponse.refusal, { reason: 'impassable', hex: 'A3.1' })
  assert.deepEqual(projectCampaignMatch(blocked, 'axis', config).marchResponse, { kind: 'resume-march', hex: 'A2.1' })
  assert.deepEqual(own.blownBridges, [{ id: 'A2.1|A3.1', hexside: ['A2.1', 'A3.1'] }])
  const reroute = { type: 'resume-campaign-ground-march', path: ['B2.01'] }
  assert.throws(() => submit(blocked, reroute, config), /Only Soviet/)
  assert.throws(() => submit(blocked, { ...reroute, path: ['A3.01'] }, config, 'soviet'), /impassable/)
  assert.throws(() => submit(blocked, move(['B2.01']), config, 'soviet'), /awaits a response/)
  assert.equal(projectCampaignMarchResume(blocked, 'axis', reroute, config).ok, false)
  assert.deepEqual(projectCampaignMarchResume(blocked, 'soviet', reroute, config).placements,
    [{ id: 'march', hex: 'B2.1', spent: 2, stop: null }])
  const finished = submit(blocked, reroute, config, 'soviet')
  assert.equal(finished.state.counters.march.location.hex, 'B2.1')
  assert.deepEqual(finished.state.groundMovement.moved, ['march'])
  assert.equal(finished.state.rng.drawCount, record.state.rng.drawCount)
})

test('crossing before first contact stays paid and both bridges incident to one entry can be answered together', () => {
  const config = volga('intact', true)
  const record = sovietMovement({ march: unit('A2.01', 'soviet', { currentRe: 2 }) }, config)
  const waiting = submit(record, move(['C3.34', 'B3.01']), config, 'soviet')
  assert.deepEqual(waiting.state.groundMovement.crossedReByHexside, { 'A2.1|A3.1': 2 })
  assert.deepEqual(projectCampaignMatch(waiting, 'axis', config).marchResponse.bridges.map(({ id }) => id), ['A2.1|A3.1', 'A3.1|B3.1'])
  const answered = submit(waiting, bridgeDecision(['A2.1|A3.1']), config)
  assert.equal(answered.state.counters.march.location.hex, 'B3.1')
  assert.deepEqual(answered.state.groundMovement.crossedReByHexside, { 'A2.1|A3.1': 2, 'A3.1|B3.1': 2 })
  assert.deepEqual(answered.state.volgaBridgeDecisions, { 'A2.1|A3.1': 'blown', 'A3.1|B3.1': 'kept' })
})

test('automatic resume stops again at a second newly reached bridge', () => {
  const config = volga('intact', true)
  const record = sovietMovement({ march: unit('A1.01', 'soviet', { currentRe: 1 }) }, config)
  const waiting = submit(record, move(['A2.01', 'C3.34', 'B3.01']), config, 'soviet')
  const next = submit(waiting, bridgeDecision(), config)
  assert.equal(next.state.counters.march.location.hex, 'A3.1')
  assert.deepEqual(projectCampaignMatch(next, 'axis', config).marchResponse.bridges.map(({ id }) => id), ['A3.1|B3.1'])
  const finished = submit(next, bridgeDecision(), config)
  assert.equal(finished.state.counters.march.location.hex, 'B3.1')
  assert.equal(finished.state.groundMovement.interruption, undefined)
  assert.deepEqual(finished.state.groundMovement.crossedReByHexside, { 'A2.1|A3.1': 1, 'A3.1|B3.1': 1 })
})

test('bridge demolition is resolved before checking a strategic endpoint for trace supply', () => {
  const bridge = volga('intact')
  const config = { ...bridge, groundMovement: { ...bridge.groundMovement,
    inTrace: (state, _id, hex) => hex === 'B2.1' || hex === 'A2.1' && state.volgaBridgeDecisions?.['A2.1|A3.1'] !== 'blown' } }
  const record = sovietMovement({ march: unit('A1.01', 'soviet', { currentRe: 1 }) }, config)
  const waiting = submit(record, move(['A2.01'], [{ id: 'march', mode: 'strat' }]), config, 'soviet')
  const blown = submit(waiting, bridgeDecision(['A2.1|A3.1']), config)
  assert.equal(projectCampaignMatch(blown, 'soviet', config).marchResponse.refusal.reason, 'strategic-end-needs-trace')
  assert.throws(() => submit(blown, { type: 'resume-campaign-ground-march', path: [] }, config, 'soviet'), /strategic-end-needs-trace/)
  const resolved = submit(blown, { type: 'resume-campaign-ground-march', path: ['B2.01'] }, config, 'soviet')
  assert.equal(resolved.state.counters.march.location.hex, 'B2.1')
  assert.equal(resolved.state.counters.march.mode, 'strat')
})

test('transport entry leaves the bridge undecided and a repaired bridge offers no demolition', () => {
  const intact = volga('intact')
  const counters = { truck: unit('A1.01', 'soviet', { kind: 'transport', mode: 'move', definition: 'truck', currentRe: 1 }),
    march: unit('A1.01', 'soviet', { disorganized: true, currentRe: 1 }) }
  const record = sovietMovement(counters, intact)
  const truck = submit(record, move(['A2.01'], [{ id: 'truck' }]), intact, 'soviet')
  assert.equal(truck.state.volgaBridgeDecisions, undefined)
  assert.equal(truck.state.groundMovement.interruption, undefined)
  const combat = submit(truck, move(['A2.01']), intact, 'soviet')
  assert.equal(combat.state.groundMovement.interruption.kind, 'volga-bridge-demolition')
  const repaired = volga('repaired')
  assert.equal(submit(sovietMovement(counters, repaired), move(['A2.01']), repaired, 'soviet').state.groundMovement.interruption, undefined)
})

test('deploy a ferry immediately, record its use and reserve the pontoon through the withdrawal phase', () => {
  const config = engineering(volga('none'))
  const starting = atBreakout({ pontoon: pontoon('A2.01', { disorganized: true }),
    march: unit('A2.01', 'axis', { currentRe: 1 }), later: unit('A2.01', 'axis', { currentRe: 1 }) })
  const opened = beginEngineering(starting, config)
  const deploy = { type: 'deploy-campaign-ferry', pontoonId: 'pontoon' }
  const remove = { type: 'remove-campaign-ferry', pontoonId: 'pontoon' }
  assert.throws(() => submit(opened, deploy, config), /engineering is unavailable/)
  const play = afterBreakout(opened, config)
  assert.equal(projectCampaignMatch(play, 'soviet', config).pontoon, null)
  assert.equal(projectCampaignMatch(play, 'axis', config).pontoon[0].deploy, true)
  const ice = { ...play, state: { ...play.state, weatherHistory: { ...play.state.weatherHistory, ice: true } } }
  assert.throws(() => submit(ice, deploy, config), /Cannot deploy/)
  assert.throws(() => submit(play, deploy, config, 'soviet'), /engineering is unavailable/)
  const laid = submit(play, deploy, config)
  assert.deepEqual(projectCampaignMatch(laid, 'soviet', config).ferries, [{ id: 'ferry:pontoon', side: 'axis', hex: 'A2.1' }])
  assert.deepEqual(laid.state.supplyDumps, play.state.supplyDumps)
  assert.throws(() => submit(laid, remove, config), /Cannot remove/)
  const crossed = submit(laid, move(['A3.01']), config)
  assert.deepEqual(crossed.state.groundMovement.usedFerryIds, ['ferry:pontoon'])
  const night = submit(submit(crossed, closeGround, config), closeMovement, config)
  const tomorrow = afterBreakout(beginEngineering(night, config, 'axis', 4), config)
  const usedAgain = submit(tomorrow, move(['A3.01'], [{ id: 'later' }]), config)
  assert.throws(() => submit(usedAgain, remove, config), /used this Movement Phase/)
  const takenUp = submit(tomorrow, remove, config)
  assert.deepEqual(projectCampaignMatch(takenUp, 'axis', config).ferries, [])
  assert.throws(() => submit(takenUp, move(['A3.01'], [{ id: 'later' }]), config), /impassable/)
  assert.throws(() => submit(takenUp, move(['A1.01'], [{ id: 'pontoon' }]), config), /committed-to-engineering/)
  const finished = submit(submit(takenUp, closeGround, config), closeMovement, config)
  const free = afterBreakout(beginEngineering(finished, config, 'axis', 5), config)
  assert.equal(submit(free, move(['A1.01'], [{ id: 'pontoon' }]), config).state.counters.pontoon.location.hex, 'A1.1')
})

test('a bridge crossing leaves a nearby ferry unused when the blown bridge already admits leg movement', () => {
  const config = engineering()
  const opening = atBreakout({ pontoon: pontoon('A2.01'), march: unit('A2.01', 'axis', { currentRe: 1 }) })
  const withFerry = { ...opening, state: { ...opening.state, ferries: [{ id: 'existing', side: 'axis', hex: 'A2.01', pontoonId: 'pontoon' }] } }
  const play = afterBreakout(beginEngineering(withFerry, config), config)
  const moved = submit(play, move(['A3.01']), config)
  assert.deepEqual(moved.state.groundMovement.usedFerryIds, [])
  assert.deepEqual(submit(moved, { type: 'remove-campaign-ferry', pontoonId: 'pontoon' }, config).state.ferries, [])
})

test('repair counts once per fully closed friendly movement phase and opens at the next phase start', () => {
  const config = engineering(volga('intact'))
  const opening = atBreakout({ pontoon: pontoon('A2.01'), spare: pontoon('A2.01'),
    march: unit('A2.01', 'axis', { definition: 'truck', currentRe: 1 }) })
  let record = { ...opening, state: { ...opening.state, volgaBridgeDecisions: { 'A2.1|A3.1': 'blown' } } }
  for (let phase = 0; phase < 4; phase++) {
    if (phase === 2) record = { ...record, state: { ...record.state, weatherHistory: { ...record.state.weatherHistory, ice: true } } }
    const start = afterBreakout(beginEngineering(record, config, 'axis', 3 + phase), config)
    const worked = phase === 0 ? submit(submit(start, repairOrder(), config), repairOrder('spare'), config) : start
    assert.equal(projectCampaignMatch(worked, 'axis', config).pontoon[0].repair, 'A2.1|A3.1')
    assert.equal(projectCampaignMatch(worked, 'soviet', config).repairingBridges[0].phases, phase)
    assert.equal(projectCampaignMatch(worked, 'soviet', config).repairingBridges[0].pontoonIds, undefined)
    assert.throws(() => submit(worked, closeMovement, config), /before the phasing side resolves barrage/)
    const barrage = submit(worked, closeGround, config)
    assert.deepEqual(projectCampaignMatch(barrage, 'axis', config).barrageEndBlockers, [])
    assert.equal(projectCampaignMatch(barrage, 'soviet', config).barrageEndBlockers, null)
    assert.equal(barrage.state.volgaBridgeRepairs['A2.1|A3.1'].phases, phase)
    assert.throws(() => submit(barrage, closeMovement, { ...config, movementBarrageBlockers: () => ['pending'] }), /obligations/)
    record = submit(barrage, closeMovement, config)
    assert.equal(record.state.cursor.phase, 'supply')
    assert.equal(record.state.volgaBridgeRepairs['A2.1|A3.1'].phases, phase + 1)
    assert.equal(record.state.volgaBridgeDecisions['A2.1|A3.1'], 'blown')
  }
  assert.equal(beginEngineering(record, config, 'soviet', 7).state.volgaBridgeDecisions['A2.1|A3.1'], 'blown')
  const fixed = beginEngineering(record, config, 'axis', 7)
  assert.equal(fixed.state.movementSegment, 'breakout')
  assert.deepEqual(projectCampaignMatch(fixed, 'axis', config).repairedBridges, [{ id: 'A2.1|A3.1', hexside: ['A2.1', 'A3.1'] }])
  assert.deepEqual(projectCampaignMatch(fixed, 'axis', config).blownBridges, [])
  assert.deepEqual(projectCampaignMatch(fixed, 'axis', config).repairingBridges, [])
  assert.equal(submit(afterBreakout(fixed, config), move(['A3.01']), config).state.counters.march.location.hex, 'A3.1')
})

test('the Kherson rail ferry cannot be selected as a bridge repair', () => {
  const bank = campaignMapInPlayArea(indexTtwCampaignMap({ items: ['D14.03', 'D15.03'].map((hex_id) => ({ hex_id })) },
    { items: [{ edge_key: 'kherson', hex_a: 'D14.03', hex_b: 'D15.03' }] }), { kind: 'all-map' })
  const config = engineering(context({ map: bank, crossingAt: () => ({ barrier: 'volga', bridge: 'blown', routes: ['rail'] }) }))
  const play = afterBreakout(beginEngineering(atBreakout({ pontoon: pontoon('D14.03') }), config), config)
  assert.deepEqual(projectCampaignMatch(play, 'axis', config).pontoon[0].repairIds, [])
  assert.throws(() => submit(play, { ...repairOrder(), bridgeId: 'D14.3|D15.3' }, config), /eligible blown Volga bridge/)
})

test('interruption or adjacency pauses repair, and enemy attack-capable occupation erases it immediately', () => {
  const config = engineering()
  const opening = atBreakout({ pontoon: pontoon('A2.01'), enemy: unit('A4.01', 'soviet', { currentRe: 1 }) })
  const withProgress = { ...opening, state: { ...opening.state, volgaBridgeRepairs: { 'A2.1|A3.1': { side: 'axis', phases: 2 } } } }
  const own = afterBreakout(beginEngineering(withProgress, config), config)
  const repairing = submit(own, repairOrder(), config)
  const combined = submit(repairing, { type: 'deploy-campaign-ferry', pontoonId: 'pontoon' }, config)
  assert.equal(combined.state.pontoonPhase.orders.pontoon.repair, 'A2.1|A3.1')
  assert.equal(combined.state.pontoonPhase.orders.pontoon.ferry, 'deploy')
  const cancelled = submit(repairing, { type: 'cancel-campaign-volga-repair', pontoonId: 'pontoon' }, config)
  assert.equal(submit(submit(cancelled, closeGround, config), closeMovement, config).state.volgaBridgeRepairs['A2.1|A3.1'].phases, 2)
  const enemyNear = { ...withProgress, state: { ...withProgress.state, counters: { ...opening.state.counters, enemy: unit('B2.01', 'soviet') } } }
  const blocked = afterBreakout(beginEngineering(enemyNear, config), config)
  assert.throws(() => submit(blocked, repairOrder(), config), /eligible blown Volga bridge/)
  assert.equal(submit(submit(blocked, closeGround, config), closeMovement, config).state.volgaBridgeRepairs['A2.1|A3.1'].phases, 2)
  const opposition = afterBreakout(beginEngineering(withProgress, config, 'soviet'), config, 'soviet')
  const enteredAndLeft = submit(opposition, move(['A3.01', 'B3.01'], [{ id: 'enemy' }]), config, 'soviet')
  assert.equal(enteredAndLeft.state.counters.enemy.location.hex, 'B3.1')
  assert.equal(enteredAndLeft.state.volgaBridgeRepairs['A2.1|A3.1'], undefined)
})
