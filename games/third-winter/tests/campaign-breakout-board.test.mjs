import assert from 'node:assert/strict'
import { test } from 'node:test'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { createCampaignBreakoutBoard } from '../src/match/campaign-breakout-board.ts'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { campaignMapInPlayArea } from '../src/ttw/campaign/play-area.ts'
import { projectCampaignMatch } from '../src/view/campaign-match-view.ts'

const hexes = Array.from({ length: 9 }, (_, index) => ({ hex_id: `A${index + 1}.01` }))
hexes[2] = { hex_id: 'A3.01', seam_twin: 'C3.34', seam_primary: true }
hexes.push({ hex_id: 'C3.34', seam_twin: 'A3.01', seam_primary: false }, { hex_id: 'B3.01' }, { hex_id: 'B4.01' })
const link = (a, b) => ({ edge_key: `${a}|${b}`, hex_a: a, hex_b: b, seam_dup_group: null })
const map = campaignMapInPlayArea(indexTtwCampaignMap({ items: hexes }, { items: [
  ...hexes.slice(0, 8).map(({ hex_id }, index) => link(hex_id, hexes[index + 1].hex_id)),
  link('B3.01', 'A2.01'), link('A1.01', 'B4.01'), link('B4.01', 'C3.34'),
] }), { kind: 'hex-list', hexes: hexes.filter(({ hex_id }) => hex_id !== 'B4.01').map(({ hex_id }) => hex_id) })

const counter = (hex, side = 'axis') => ({ definition: 'infantry', kind: 'land', side, location: { kind: 'map', hex } })
const standard = { combat: true, attackCapable: true, inCombatMode: true, outOfSupply: false,
  moveMa: 5, moveMobility: 'truck', drawMobility: 'truck', singleTransportPoint: false }
function context(overrides = {}) {
  return { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] },
    breakoutBoard: createCampaignBreakoutBoard({ map, profileOf: () => standard,
      movementCost: () => 1, traceCost: () => 1, distance: (a, b) => Math.abs(Number(a.slice(1).split('.')[0]) - Number(b.slice(1).split('.')[0])),
      supply: () => ({ sources: new Set(['A9.01']), controlled: new Set(['A9.1']), headquarters: [],
        railCanTrace: () => false, detrainable: () => false, inTrace: (_, routes) => routes.length > 0, firstTurnWithoutTrace: () => false }),
      ...overrides,
    }) }
}
function movement(counters) {
  const start = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 3, counters }, 2)
  return { ...start, state: { ...start.state, cursor: { first: 'axis', phasing: 'axis', phase: 'movement' }, movementSegment: 'breakout' } }
}
const attempt = (record, configured) => submitCampaignMatch(record, 'axis', { id: 'breakout', expectedRevision: record.revision,
  action: { type: 'attempt-campaign-breakout', counterId: 'stranded' } }, configured).record

test('campaign breakout consumes the live canonical board and rechecks combat ZOC on every command', () => {
  const units = { stranded: counter('A1.01'), friend: counter('C3.34'), enemy: counter('B3.01', 'soviet') }
  const record = movement(units)
  const configured = context()
  assert.throws(() => attempt(record, configured), /no-passable-path/, 'outside-scenario B4 cannot bypass enemy ZOC')
  assert.equal(record.state.rng.drawCount, 0)
  const negated = movement({ ...units, covering: counter('A2.01') })
  assert.ok(projectCampaignMatch(negated, 'axis', configured).breakout.options.eligibleIds.includes('stranded'))
  assert.equal(attempt(negated, configured).state.counters.stranded.location.kind, 'breakout-return')
  assert.throws(() => attempt(negated, context({ movementCost: (_, from, to) => from === 'A1.1' && to === 'A2.1' ? null : 1 })), /no-passable-path/)
  const incomplete = context({ profileOf: (_, id) => id === 'enemy' ? undefined : standard })
  assert.equal(projectCampaignMatch(record, 'axis', incomplete).breakout.options.configured, false)
  assert.throws(() => attempt(record, incomplete), /board facts are not configured/)
})

test('a connected and controlled detraining site changes the live trace verdict', () => {
  const record = movement({ stranded: counter('A1.01'), friend: counter('C3.34') })
  const rail = (connected) => context({ supply: () => ({ sources: new Set(['A9.01']), controlled: new Set(['A6.01']), headquarters: [],
    railCanTrace: (a, b) => connected && /^A[6-9]\.1$/.test(a) && /^A[6-9]\.1$/.test(b), detrainable: (hex) => hex === 'A6.1',
    inTrace: (_, offered) => offered.length > 0, firstTurnWithoutTrace: () => false,
  }) })
  assert.throws(() => attempt(record, rail(true)), /has-trace-supply/)
  assert.equal(attempt(record, rail(false)).state.counters.stranded.location.kind, 'breakout-return')
})

test('HQ projection only prevents breakout when the work policy admits the ordinary trace', () => {
  const record = movement({ stranded: counter('A1.01'), friend: counter('C3.34'),
    headquarters: { ...counter('A6.01'), kind: 'hq' } })
  const configured = (allowHq) => context({ supply: () => ({ sources: new Set(['A9.01']), controlled: new Set(),
    headquarters: [{ id: 'headquarters', hex: 'A6.01', mobility: 'truck', throwRange: 4 }],
    railCanTrace: () => false, detrainable: () => false, firstTurnWithoutTrace: () => false,
    inTrace: (id, options) => options.some(({ kind }) => id !== 'stranded' || kind === 'direct' || allowHq),
  }) })
  assert.throws(() => attempt(record, configured(true)), /has-trace-supply/)
  assert.equal(attempt(record, configured(false)).state.counters.stranded.location.kind, 'breakout-return')
})
