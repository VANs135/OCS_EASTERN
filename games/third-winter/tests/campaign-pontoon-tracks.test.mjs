import assert from 'node:assert/strict'
import { test } from 'node:test'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { createCampaignOrdinaryMovementBoard } from '../src/match/campaign-movement-board.ts'
import { campaignMapInPlayArea } from '../src/ttw/campaign/play-area.ts'
import { projectCampaignGroundDestinations, projectCampaignGroundRoute, projectCampaignMatch } from '../src/view/campaign-match-view.ts'

const edges = [['A1.01', 'A2.01'], ['A2.01', 'A3.01'], ['A3.01', 'A4.01'],
  ['A2.01', 'B2.01'], ['A2.01', 'B3.01'], ['A2.01', 'B4.01']]
const map = campaignMapInPlayArea(indexTtwCampaignMap({ items: [...new Set(edges.flat())].map((hex_id) => ({ hex_id })) },
  { items: edges.map(([hex_a, hex_b], i) => ({ edge_key: `${i}`, hex_a, hex_b })) }), { kind: 'all-map' })

function context(overrides = {}) {
  return { groundMovement: createCampaignOrdinaryMovementBoard({ map,
    profileOf: (state, id) => ({ combat: true, attackCapable: true, inCombatMode: state.counters[id].mode === 'combat',
      pontoon: state.counters[id].definition === 'pontoon', outOfSupply: false, moveMa: 7, moveMobility: 'truck', drawMobility: 'truck',
      singleTransportPoint: false }),
    moveProfile: () => ({ ma: 7, mobility: 'truck', fuelReady: true }),
    terrainAt: () => ['Open'],
    crossingAt: (_, _id, from, to) => {
      switch ([from, to].sort().join('|')) {
        case 'A1.1|A2.1': return { barrier: 'minor', routes: [] }
        case 'A2.1|A3.1': return { barrier: 'major', routes: [] }
        case 'A2.1|B2.1': return { barrier: 'major', routes: ['road'] }
        case 'A2.1|B3.1': return { barrier: 'volga', bridge: 'none', routes: [] }
        case 'A2.1|B4.1': return { barrier: 'blocked', routes: [] }
        default: return { barrier: 'none', routes: [] }
      }
    },
    entryRequiresResolution: () => false, inTrace: () => true, ...overrides }),
  reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] } }
}

const unit = (hex, extra = {}) => ({ side: 'axis', definition: 'ground', kind: 'land', mode: 'combat',
  currentRe: 1, location: { kind: 'map', hex }, ...extra })
const pontoon = (hex, extra = {}) => unit(hex, { definition: 'pontoon', ...extra })
function movement(counters, ground = 'dry') {
  const opening = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 1, counters }, 3)
  return { ...opening, state: { ...opening.state, cursor: { phase: 'movement', first: 'axis', phasing: 'axis' },
    movementSegment: 'movement', weather: { ground, flight: 'none' } } }
}
const move = (path, movers = [{ id: 'lead' }]) => ({ type: 'move-campaign-ground', path, movers })
const submit = (record, action, rules) => submitCampaignMatch(record, 'axis', { id: `move-${record.revision}`,
  expectedRevision: record.revision, action }, rules).record
const markers = (record, rules) => projectCampaignMatch(record, 'axis', rules).pontoonTrackBridges.map(({ id }) => id).sort()

test('a DG pontoon on its combat face bridges only friendly ordinary river movement and uses the TTW Track rate', () => {
  const rules = context()
  const dry = movement({ lead: unit('A1.01'), bridge: pontoon('A2.01', { disorganized: true }) })
  assert.deepEqual(markers(dry, rules), ['axis:pontoon-track:A1.1|A2.1', 'axis:pontoon-track:A2.1|A3.1'])
  assert.deepEqual(projectCampaignMatch(dry, 'soviet', rules).pontoonTrackBridges, [])
  const route = move(['A2.01', 'A3.01'])
  assert.equal(projectCampaignGroundRoute(dry, 'axis', route, rules).placements[0].spent, 2)
  assert.equal(submit(dry, route, rules).state.counters.lead.location.hex, 'A3.1')
  assert.equal(projectCampaignGroundRoute(dry, 'axis', move(['A2.01', 'B2.01']), rules).placements[0].spent, 1.5)
  assert.throws(() => submit(dry, move(['A2.01', 'B3.01']), rules), /impassable/)
  assert.throws(() => submit(dry, move(['A2.01', 'B4.01']), rules), /impassable/)
  const wet = movement(dry.state.counters, 'mud')
  assert.equal(projectCampaignGroundRoute(wet, 'axis', move(['A2.01']), rules).placements[0].spent, 4)
  const ice = movement(dry.state.counters, 'freeze')
  assert.equal(projectCampaignGroundRoute(ice, 'axis', route, rules).placements[0].spent, 2)
  const enemy = movement({ lead: unit('A3.01', { side: 'soviet' }), bridge: dry.state.counters.bridge })
  assert.equal(rules.groundMovement.cost(enemy.state, 'lead', 'A3.1', 'A2.1', 'truck'), null)
  for (const unavailable of [pontoon('A2.01', { mode: 'move' }), { ...pontoon('A2.01'), location: { kind: 'dead-pile' } }]) {
    const without = movement({ lead: unit('A1.01'), bridge: unavailable })
    assert.deepEqual(markers(without, rules), [])
    assert.throws(() => submit(without, route, rules), /impassable/)
  }
})

test('the moving pontoon relocates its automatic bridge in reachable-hex previews and in the committed board', () => {
  const rules = context()
  const record = movement({ lead: pontoon('A1.01'), escort: unit('A1.01') })
  assert.deepEqual(markers(record, rules), ['axis:pontoon-track:A1.1|A2.1'])
  const reachable = projectCampaignGroundDestinations(record, 'axis', { id: 'lead' }, rules)
  const beyond = reachable.destinations.find(({ hex }) => hex === 'A3.1')
  assert.deepEqual(beyond.path, ['A2.1', 'A3.1'])
  assert.equal(beyond.spent, 2)
  const moved = submit(record, move(beyond.path), rules)
  assert.deepEqual(markers(moved, rules), ['axis:pontoon-track:A2.1|A3.1'])
  assert.equal(projectCampaignGroundRoute(moved, 'axis', move(['A2.01'], [{ id: 'escort' }]), rules).placements[0].spent, 6)
})

test('only a newly flipped pontoon can use its former bridge for the departure step', () => {
  const rules = context()
  const record = movement({ lead: pontoon('A2.01'), escort: unit('A2.01') })
  const mover = { id: 'lead', mode: 'move' }
  const destinations = projectCampaignGroundDestinations(record, 'axis', mover, rules)
  assert.equal(destinations.destinations.find(({ hex }) => hex === 'A3.1').spent, 1)
  const both = move(['A3.01'], [mover, { id: 'escort' }])
  assert.throws(() => submit(record, both, rules), /impassable/)
  assert.throws(() => submit(record, move(['A3.01', 'A2.01'], [mover]), rules), /impassable/)
  assert.equal(record.state.counters.lead.mode, 'combat')
  const switched = submit(record, move(['A3.01'], [mover]), rules)
  assert.equal(switched.state.counters.lead.mode, 'move')
  assert.deepEqual(markers(switched, rules), [])
})

test('switching a pontoon to its combat face opens the track for its stack before the first step', () => {
  const rules = context()
  const record = movement({ lead: pontoon('A2.01', { mode: 'move' }), escort: unit('A2.01') })
  const movers = [{ id: 'lead', mode: 'combat' }, { id: 'escort' }]
  assert.deepEqual(markers(record, rules), [])
  assert.deepEqual(projectCampaignGroundRoute(record, 'axis', move(['A3.01'], movers), rules).placements.map(({ spent }) => spent), [1, 1])
  const crossed = submit(record, move(['A3.01'], movers), rules)
  assert.equal(crossed.state.counters.escort.location.hex, 'A3.1')
  assert.deepEqual(markers(crossed, rules), ['axis:pontoon-track:A2.1|A3.1'])
})

test('a temporary cross-river track does not grant a wheeled exit from swamp across another edge', () => {
  const rules = context({ terrainAt: (hex) => hex === 'A3.1' ? ['Swamp'] : ['Open'] })
  const record = movement({ lead: unit('A2.01'), bridge: pontoon('A2.01') })
  assert.throws(() => submit(record, move(['A3.01', 'A4.01']), rules), /impassable/)
  assert.equal(submit(record, move(['A3.01']), rules).state.counters.lead.location.hex, 'A3.1')
})
