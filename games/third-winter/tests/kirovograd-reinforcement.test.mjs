import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { unitCatalog } from '../src/import/unit-catalog.ts'
import { kirovogradReinforcementSupply } from '../src/match/kirovograd-reinforcement-supply.ts'
import { openCampaignReinforcementSession, submitCampaignSession } from '../src/match/campaign-session.ts'
import { projectCampaignReinforcements } from '../src/view/campaign-reinforcement-view.ts'
import { kirovogradDates, kirovogradScenario } from '../src/ttw/campaign/kirovograd.ts'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { newCampaignReinforcementWindow } from '../src/match/campaign-reinforcement-flow.ts'
import { projectCampaignMatch } from '../src/view/campaign-match-view.ts'

const names = [['army', 'Ge HQ 8 Army', 'axis'], ['corps1', 'Ge HQ 47 Pz Corps', 'axis'],
  ['corps2', 'Ge HQ 3 Pz Corps', 'axis'], ['corps3', 'Ge HQ 52 Corps', 'axis'],
  ['sov1', 'Sov HQ 5th Gd Army', 'soviet'], ['sov2', 'Sov HQ 2nd Ukr Front', 'soviet']]
const catalog = unitCatalog([{ kind: 'hq', file: 'synthetic', rows: names.map(([id, name, side]) => ({ id, name, side })) }])
const hexes = new Set(names.map(([id]) => `hex-${id}`))
const map = { resolveHex: (hex) => hexes.has(hex) ? hex : undefined }
const context = { schedule: new Map(), bindings: new Map(), arrivalSites: () => [], resolveHex: map.resolveHex,
  ...kirovogradReinforcementSupply({ catalog, map }) }
const counters = Object.fromEntries(names.map(([id, _, side]) => [id,
  { kind: 'hq', side, definition: `hq:id:${id}`, location: { kind: 'map', hex: `hex-${id}` } }]))
const start = (turn, side, pieces = counters) => openCampaignReinforcementSession(turn, side, pieces, {
  when: { scenarioId: kirovogradScenario, date: kirovogradDates[turn - 1] }, supplyDumps: { axis: { 'hex-army': 1 }, soviet: {} },
})
const request = (record, action) => ({ id: `test-${record.revision}`, expectedRevision: record.revision, action })
const send = (record, action, rules = context, side = record.state.cursor.phasing) =>
  submitCampaignSession(record, side, request(record, action), rules).record
const scheduledDone = (record) => send(record, { type: 'complete-scheduled-reinforcements' })
const issued = (record) => send(record, { type: 'issue-fixed-campaign-supply' })

test('both sides receive exact per-turn fixed awards and reach rebuild without any table dice', () => {
  for (let turn = 1; turn <= 5; turn++) for (const side of ['axis', 'soviet']) {
    const initial = start(turn, side)
    assert.throws(() => issued(initial), /not available/)
    const supply = scheduledDone(initial)
    assert.equal(projectCampaignReinforcements(supply, side, context).active.step, 'issue-fixed-supply')
    assert.equal(projectCampaignReinforcements(supply, side === 'axis' ? 'soviet' : 'axis', context).active, null)
    assert.throws(() => send(supply, { type: 'roll-campaign-supply' }), /not available/)
    const award = issued(supply)
    const expected = side === 'axis' ? 16 : [8, 8, 4, 4, 3][turn - 1]
    assert.equal(award.state.supplyAward.grossTokens, expected)
    assert.equal(award.state.supplyAward.dice, null)
    assert.equal(award.state.rng.drawCount, 0)
    assert.deepEqual(award.state.rolls, [])
    const projected = projectCampaignReinforcements(award, side, context).active.supply
    assert.equal(projected.dice, null)
    assert.ok(projected.placementPlan)
    const placements = side === 'axis' ? names.filter((n) => n[2] === side).map(([id]) => ({ pool: 'axis-hq', hex: `hex-${id}`, tokens: 4 }))
      : [{ pool: 'soviet-supply', hex: 'hex-sov1', tokens: expected }]
    const placed = send(award, { type: 'place-campaign-supply', placements })
    assert.equal(placed.state.segment, 'rebuild-consolidate')
    assert.equal(placed.state.rng.drawCount, 0)
    if (side === 'axis') assert.deepEqual(placed.state.supplyDumps.axis, { 'hex-army': 5, 'hex-corps1': 4, 'hex-corps2': 4, 'hex-corps3': 4 })
    else assert.equal(placed.state.supplyDumps.soviet['hex-sov1'], expected)
    assert.throws(() => send(placed, { type: 'roll-campaign-replacements' }), /not available/)
    assert.throws(() => send(placed, { type: 'roll-campaign-special-replacement' }), /not available/)
  }
})

test('Axis HQ quotas aggregate at the same hex and follow current map presence', () => {
  const relocated = { ...counters, corps1: { ...counters.corps1, location: { kind: 'map', hex: 'hex-army' } },
    corps2: { ...counters.corps2, location: { kind: 'dead-pile' } },
    corps3: { ...counters.corps3, location: { kind: 'box', box: 'elsewhere' } } }
  const award = issued(scheduledDone(start(1, 'axis', relocated)))
  assert.equal(award.state.supplyAward.grossTokens, 8)
  const plan = context.supplyPlacementPlan(award.state)
  assert.deepEqual(plan[1].sites, [{ hex: 'hex-army', side: 'axis', minTokens: 8, maxTokens: 8 }])
  const placed = send(award, { type: 'place-campaign-supply', placements: [{ pool: 'axis-hq', hex: 'hex-army', tokens: 8 }] })
  assert.equal(placed.state.supplyDumps.axis['hex-army'], 9)
  const ordinary = issued(scheduledDone(start(1, 'axis')))
  assert.throws(() => send(ordinary, { type: 'place-campaign-supply', placements: [
    { pool: 'axis-hq', hex: 'hex-army', tokens: 8 }, { pool: 'axis-hq', hex: 'hex-corps1', tokens: 4 },
    { pool: 'axis-hq', hex: 'hex-corps2', tokens: 4 },
  ] }), /quota/)
})

test('fixed awards reject wrong seats and illegal placements while receipt retries never duplicate supply', () => {
  const supply = scheduledDone(start(5, 'soviet'))
  const claim = request(supply, { type: 'issue-fixed-campaign-supply' })
  assert.throws(() => submitCampaignSession(supply, 'axis', claim, context), /active side/)
  const award = submitCampaignSession(supply, 'soviet', claim, context).record
  assert.equal(submitCampaignSession(award, 'soviet', claim, context).duplicate, true)
  assert.throws(() => send(award, { type: 'issue-fixed-campaign-supply' }), /not available/)
  assert.throws(() => send(award, { type: 'place-campaign-supply', placements: [{ pool: 'soviet-supply', hex: 'hex-army', tokens: 3 }] }), /Illegal/)
  assert.throws(() => send(award, { type: 'place-campaign-supply', placements: [{ pool: 'soviet-supply', hex: 'hex-sov1', tokens: 12 }] }), /quota/)
  const placement = request(award, { type: 'place-campaign-supply', placements: [
    { pool: 'soviet-supply', hex: 'hex-sov1', tokens: 1 }, { pool: 'soviet-supply', hex: 'hex-sov2', tokens: 2 },
  ] })
  const placed = submitCampaignSession(award, 'soviet', placement, context).record
  assert.equal(submitCampaignSession(placed, 'soviet', placement, context).duplicate, true)
  assert.deepEqual(placed.state.supplyDumps.soviet, { 'hex-sov1': 1, 'hex-sov2': 2 })
  assert.deepEqual(award.state.supplyDumps.soviet, {})
  assert.equal(placed.state.rng.drawCount, 0)
})

test('missing fixed rules and inconsistent dates stay unresolved without falling back to a roll', () => {
  const current = scheduledDone(start(1, 'axis'))
  const wrongDate = { ...current, state: { ...current.state, when: { scenarioId: kirovogradScenario, date: '1944-01-06' } } }
  assert.throws(() => issued(wrongDate), /not configured/)
  assert.throws(() => send(current, { type: 'issue-fixed-campaign-supply' }, { ...context, fixedSupply: () => undefined }), /not configured/)
  assert.equal(current.state.rng.drawCount, 0)
  assert.equal(current.state.supplyAward, undefined)
})

test('the ordinary campaign command entry uses the same fixed award and segment transition', () => {
  const opening = openCampaignMatch({ turn: 1, when: { scenarioId: kirovogradScenario, date: kirovogradDates[0] }, counters }, 17)
  let record = { ...opening, state: { ...opening.state, cursor: { phase: 'reinforcement', phasing: 'soviet', first: 'soviet' },
    reinforcement: { stage: 'ordinary', window: newCampaignReinforcementWindow() } } }
  const rules = { reinforcement: context }
  const act = (action) => { record = submitCampaignMatch(record, 'soviet', request(record, action), rules).record }
  act({ type: 'complete-scheduled-reinforcements' })
  assert.equal(projectCampaignMatch(record, 'soviet', rules).active.step, 'issue-fixed-supply')
  assert.equal(projectCampaignMatch(record, 'axis', rules).active, null)
  act({ type: 'issue-fixed-campaign-supply' })
  act({ type: 'place-campaign-supply', placements: [{ pool: 'soviet-supply', hex: 'hex-sov1', tokens: 8 }] })
  assert.equal(record.state.reinforcement.window.segment, 'rebuild-consolidate')
  assert.equal(record.state.supplyDumps.soviet['hex-sov1'], 8)
  assert.equal(record.state.rng.drawCount, 0)
})

test('a fixed Soviet award with no surviving HQ stays pending for a legal landing site', () => {
  const noHq = Object.fromEntries(Object.entries(counters).map(([id, unit]) => [id,
    unit.side === 'soviet' ? { ...unit, location: { kind: 'dead-pile' } } : unit]))
  const award = issued(scheduledDone(start(5, 'soviet', noHq)))
  assert.equal(award.state.supplyAward.grossTokens, 3)
  assert.deepEqual(context.supplyPlacementPlan(award.state)[0].sites, [])
  assert.throws(() => send(award, { type: 'place-campaign-supply', placements: [] }), /entire authorized/)
  assert.equal(award.state.segment, 'supply')
})
