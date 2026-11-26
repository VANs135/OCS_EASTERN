import assert from 'node:assert/strict'
import test from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { campaignAxisHqOptions } from '../src/match/campaign-axis-hq.ts'

const linearMap = {
  resolveHex: (h) => (Number.isInteger(+h) && +h >= 0 && +h <= 30 ? String(h) : undefined),
  neighbors: (h) => [Number(h) - 1, Number(h) + 1].filter((n) => n >= 0 && n <= 30).map(String),
}
const facts = (overrides = {}) => (_s, id) => id === 'ag'
  ? { isArmyGroupHq: true, combatMode: true, spStackedAtMovementStart: true, hqHex: '10', throwRadius: 5, ...overrides }
  : undefined
function game(dumps = { '10': 8 }) {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 1,
    counters: { ag: { id: 'ag', side: 'axis', location: { kind: 'map', hex: '10' }, stepsLost: 0, mode: 'combat', kind: 'hq', definition: 'ag-hq' } },
    supplyDumps: { axis: dumps } }, 300)
  record.state.cursor = { phase: 'movement', phasing: 'axis', first: 'axis' }
  record.state.movementSegment = 'movement'
  return record
}
const ctx = (f = facts()) => ({ reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: (h) => h, arrivalSites: () => [] }, groundMovement: { map: linearMap }, axisHqFacts: f })
let seq = 0
const place = (record, targetHex, f) => submitCampaignMatch(record, 'axis', { id: `ag-sp-${seq++}`, expectedRevision: record.revision,
  action: { type: 'army-group-place-sp', hqId: 'ag', targetHex } }, ctx(f)).record

test('Army Group HQ places 1 SP (4 tokens) within throw once per turn, Combat Mode (§2.3c D)', () => {
  const placed = place(game(), '12')
  assert.equal(placed.state.supplyDumps.axis['10'], 4)
  assert.equal(placed.state.supplyDumps.axis['12'], 4)
  assert.equal(placed.state.armyGroupSpPlaced.ag, 1)
  assert.throws(() => place(placed, '11'), /already placed SP/)
  // out of throw radius
  assert.throws(() => place(game(), '20'), /within throw/)
  // not Combat Mode
  assert.throws(() => place(game(), '12', facts({ combatMode: false })), /Combat Mode/)
  // no SP stacked at movement start
  assert.throws(() => place(game(), '12', facts({ spStackedAtMovementStart: false })), /Combat Mode/)
})

test('Army Group SP placement rejects an empty HQ hex and exposes UI options', () => {
  assert.throws(() => place(game({ '10': 0 }), '12'), /no SP to place/)
  const options = campaignAxisHqOptions(game().state, 'axis', facts())
  assert.deepEqual(options.groups.map((g) => g.hex), ['10'])
  assert.equal(options.groups[0].placedThisTurn, false)
  assert.equal(campaignAxisHqOptions(game().state, 'soviet', facts()), null)
})