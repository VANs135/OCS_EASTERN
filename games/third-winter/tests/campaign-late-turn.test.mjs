import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { createCampaignOrdinaryMovementBoard } from '../src/match/campaign-movement-board.ts'
import { projectCampaignMatch } from '../src/view/campaign-match-view.ts'

const hexes = Array.from({ length: 12 }, (_, index) => `A${index + 1}.1`)
const map = {
  resolveHex: (hex) => hexes.includes(hex) ? hex : undefined,
  neighbors(hex) { const index = hexes.indexOf(hex); return index < 0 ? [] : [hexes[index - 1], hexes[index + 1]].filter(Boolean) },
}
const counter = (side, hex, props = {}) => ({ kind: 'land', side, definition: 'infantry', location: { kind: 'map', hex }, currentRe: 1,
  mode: 'move', ...props })
const makeRules = (sources = ['A1.1', 'A12.1'], traceCost = () => null) => ({
  reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] },
  groundMovement: createCampaignOrdinaryMovementBoard({ map, railNetwork: { edge: () => undefined },
    profileOf: (state, id) => ({ combat: state.counters[id].kind === 'land', attackCapable: true, inCombatMode: false,
      outOfSupply: false, moveMa: 4, moveMobility: 'leg', drawMobility: 'leg', singleTransportPoint: false }),
    moveProfile: () => ({ ma: 4, mobility: 'leg', fuelReady: true }), terrainAt: () => ['Open'],
    crossingAt: () => ({ barrier: 'none', routes: [] }), entryRequiresResolution: () => false,
    supply: { traceCost, facts: () => ({ sources: new Set(sources), controlled: new Set(), headquarters: [], detrainable: () => false }) },
    endBlockers: () => [],
  }),
  supplyPhase: { profile: (state, id) => ({ steps: state.counters[id].currentRe, multiStep: state.counters[id].definition === 'large',
    rating: 0, ...(id.startsWith('wing') ? { formation: 'wing' } : {}) }),
    reAfterLoss: (state, id, losses) => state.counters[id].currentRe - losses },
  railCleanup: { sovietNetworkStarts: () => [], axisSuppliedByKessel: () => false, distance: () => 21 },
  lateSegmentEndBlockers: () => [], exploitationEndBlockers: () => [], cleanupEndBlockers: () => [], movementBarrageBlockers: () => [],
  roundEnd: () => ({ kind: 'continue', date: '1943-10-08' }), stePlacement: () => true,
})

function start(counters, side = 'axis', segment = 'barrage', extra = {}) {
  const opened = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 2, counters, ...extra }, 623)
  return { ...opened, state: { ...opened.state, weather: { ground: 'dry', flight: 'none' },
    cursor: { phase: 'movement', phasing: side, first: 'axis' }, movementSegment: segment } }
}

const command = (record, input) => ({ id: `step-${record.revision}`, expectedRevision: record.revision,
  action: typeof input === 'string' ? { type: input } : input })
const submit = (record, input, rules, side = record.state.cursor.phasing) => submitCampaignMatch(record, side, command(record, input), rules).record
const skip = (segment) => ({ type: 'complete-campaign-late-segment', segment })
const source = (hex) => ({ kind: 'dump', hex })

test('supply prioritizes stocks, settles split sources and feeding, then uses fresh dice for each attrition stack', () => {
  const rules = makeRules()
  const opening = start({ stocks: counter('axis', 'A1.1', { internalStocks: 'exhausted', outOfSupply: true }),
    wingWest: counter('axis', 'A2.1'), wingEast: counter('axis', 'A11.1'),
    fedOne: counter('axis', 'A5.1'), fedTwo: counter('axis', 'A5.1'),
    hungry: counter('axis', 'A7.1', { currentRe: 3, definition: 'large', disorganized: true }), enemy: counter('soviet', 'A9.1') },
  'axis', 'barrage', { supplyDumps: { axis: { 'A1.1': 3, 'A5.1': 1 }, soviet: { 'A9.1': 4 } } })
  const supplied = submit(opening, 'complete-campaign-movement-phase', rules)
  assert.equal(projectCampaignMatch(supplied, 'axis', rules).supply.step, 'recover-stocks')
  assert.equal(projectCampaignMatch(supplied, 'soviet', rules).supply, null)
  assert.throws(() => submit(supplied, 'check-campaign-attrition', rules, 'soviet'), /not open for this side/)
  assert.throws(() => submit(supplied, 'complete-campaign-stock-recovery', rules), /Recover affordable/)
  const recovered = submit(supplied, { type: 'recover-campaign-stocks', unitId: 'stocks', payments: [{ source: source('A1.1'), tokens: 2 }] }, rules)
  assert.equal(recovered.state.counters.stocks.internalStocks, 'low')
  const traced = submit(recovered, 'complete-campaign-stock-recovery', rules)
  assert.equal(traced.state.supplyDumps.axis['A1.1'], undefined)
  assert.equal(projectCampaignMatch(traced, 'axis', rules).supply.step, 'choose-formation-trace')
  assert.throws(() => submit(traced, 'check-campaign-attrition', rules), /Select the formation/)
  let record = submit(traced, { type: 'choose-campaign-formation-trace', formation: 'wing', anchor: 'direct:A1.1' }, rules)
  for (const unitId of ['fedOne', 'fedTwo']) {
    record = submit(record, { type: 'feed-campaign-units', payments: [{ source: source('A5.1'), portions: [{ unitId, re: 1 }] }] }, rules)
    if (unitId === 'fedOne') assert.deepEqual(projectCampaignMatch(record, 'axis', rules).supply.sources,
      [{ source: source('A5.1'), tokens: 0, coveredRe: 1, unitIds: ['fedTwo'] }])
  }
  assert.deepEqual(record.state.supplyDumps, { axis: {}, soviet: { 'A9.1': 4 } })
  const check = command(record, 'check-campaign-attrition')
  record = submitCampaignMatch(record, 'axis', check, rules).record
  const stacks = record.state.supplyPhase.attrition
  assert.deepEqual(stacks.map(({ hex, before, after }) => [hex, before, after]), [['A11.1', 0, 2], ['A7.1', 2, 4]])
  assert.equal(record.state.counters.enemy.outOfSupply, undefined)
  assert.equal(record.state.counters.wingEast.outOfSupply, true)
  assert.equal(record.state.counters.stocks.outOfSupply, false)
  assert.equal(record.state.counters.fedTwo.outOfSupply, false)
  assert.equal(submitCampaignMatch(record, 'axis', check, rules).duplicate, true)
  for (const stack of stacks.filter(({ losses }) => losses)) {
    assert.throws(() => submit(record, 'complete-campaign-supply', rules), /Resolve all/)
    record = submit(record, { type: 'assign-campaign-attrition', hex: stack.hex, allocation: [{ unitId: stack.units[0], steps: stack.losses }] }, rules)
    assert.equal(record.state.counters[stack.units[0]].stepsLost, stack.losses)
  }
  const reacting = submit(record, 'complete-campaign-supply', rules)
  assert.equal(reacting.state.cursor.phase, 'reaction')
  assert.equal(projectCampaignMatch(reacting, 'axis', rules).actor, 'soviet')
  assert.equal(reacting.state.rng.drawCount, 4)
})

test('phase completion follows the acting side, then cleanup clears the correct markers and advances the calendar', () => {
  const rules = makeRules()
  let record = start({ axis: counter('axis', 'A1.1', { mode: 'combat', disorganized: true, exploiting: true, fueled: true }),
    soviet: counter('soviet', 'A12.1', { disorganized: true }) }, 'axis', 'barrage', {
    trainbusting: [{ side: 'axis', hex: 'A4.1' }, { side: 'soviet', hex: 'A5.1' }],
  })
  record = submit(record, 'complete-campaign-movement-phase', rules)
  for (const action of ['complete-campaign-stock-recovery', 'check-campaign-attrition', 'complete-campaign-supply']) record = submit(record, action, rules)
  assert.throws(() => submit(record, skip('movement'), rules, 'axis'), /not open for this actor/)
  assert.throws(() => submit(record, skip('shooting'), rules, 'soviet'), /not open for this actor/)
  assert.throws(() => submit(record, skip('movement'), { ...rules, lateSegmentEndBlockers: () => ['answer'] }, 'soviet'), /obligations/)
  for (const segment of ['movement', 'shooting']) record = submit(record, skip(segment), rules, 'soviet')
  assert.equal(record.state.cursor.phase, 'combat')
  for (const segment of ['shooting', 'ground-combat']) record = submit(record, skip(segment), rules)
  assert.throws(() => submit(record, 'complete-campaign-exploitation', rules), /Complete exploitation movement/)
  for (const segment of ['movement', 'shooting']) record = submit(record, skip(segment), rules)
  record = submit(record, 'complete-campaign-exploitation', rules)
  const cleaned = submit(record, 'complete-campaign-cleanup', rules)
  assert.deepEqual(cleaned.state.cursor, { first: 'axis', phasing: 'soviet', phase: 'aircraft-refit' })
  assert.equal(cleaned.state.counters.axis.mode, 'combat')
  assert.equal(cleaned.state.counters.axis.disorganized, false)
  assert.equal(cleaned.state.counters.axis.exploiting, false)
  assert.equal(cleaned.state.counters.axis.fueled, false)
  assert.equal(cleaned.state.counters.soviet.disorganized, true)
  assert.deepEqual(cleaned.state.trainbusting, [{ side: 'axis', hex: 'A4.1' }])
  const last = { ...cleaned, state: { ...cleaned.state, cursor: { ...cleaned.state.cursor, phase: 'cleanup' } } }
  const next = submit(last, 'complete-campaign-cleanup', rules)
  assert.deepEqual(next.state.cursor, { phase: 'pre-turn', segment: 'weather' })
  assert.equal(next.state.turn, 3)
  assert.equal(next.state.when.date, '1943-10-08')
  assert.deepEqual(next.state.trainbusting, [])
  assert.equal(submit(last, 'complete-campaign-cleanup', { ...rules, roundEnd: () => ({ kind: 'ended' }) }).state.cursor.reason, 'scenario-end')
})

test('TTW STE maintains its physical identity, extends trace only on map, and returns to Ready in Soviet cleanup', () => {
  const rules = makeRules(['A1.1'], (_, _a, _b, mobility) => mobility === 'truck' ? 1 : null)
  const boxed = (box) => counter('soviet', 'A1.1', { kind: 'transport', specialTruckExtender: { range: 5 }, location: { kind: 'box', box } })
  const startMove = start({ supplyTruck: boxed('ste-ready'), second: boxed('ste-moving'),
    guard: counter('soviet', 'A7.1'), enemy: counter('axis', 'A8.1') }, 'soviet', 'movement')
  const deploy = { type: 'deploy-campaign-ste', counterId: 'supplyTruck', hex: 'A6.1' }
  assert.equal(projectCampaignMatch(startMove, 'axis', rules).ste, null)
  assert.throws(() => submit(startMove, { ...deploy, hex: 'A8.1' }, rules), /without enemy counters/)
  assert.throws(() => submit(startMove, { ...deploy, counterId: 'second' }, rules), /Ready box/)
  const deployed = submit(startMove, deploy, rules)
  assert.equal(rules.groundMovement.inTrace(deployed.state, 'guard', 'A7.1'), true)
  assert.deepEqual(projectCampaignMatch(deployed, 'soviet', rules).ste.deployed, [{ id: 'supplyTruck', hex: 'A6.1' }])
  const withdrawn = submit(deployed, { type: 'withdraw-campaign-ste', counterId: 'supplyTruck' }, rules)
  assert.equal(rules.groundMovement.inTrace(withdrawn.state, 'guard', 'A7.1'), false)
  assert.throws(() => submit(withdrawn, deploy, rules), /Ready box/)
  const axisMove = { ...deployed, state: { ...deployed.state, counters: { ...deployed.state.counters, enemy: counter('axis', 'A5.1') },
    cursor: { ...deployed.state.cursor, phasing: 'axis' } } }
  const entered = submit(axisMove, { type: 'move-campaign-ground', movers: [{ id: 'enemy' }], path: ['A6.1'] }, rules)
  assert.deepEqual(entered.state.counters.supplyTruck.location, { kind: 'box', box: 'ste-moving' })
  assert.equal(entered.state.counters.enemy.location.hex, 'A6.1')
  const cleanup = { ...entered, state: { ...entered.state, cursor: { ...entered.state.cursor, phase: 'cleanup', phasing: 'soviet' } } }
  const ready = submit(cleanup, 'complete-campaign-cleanup', rules)
  for (const id of ['supplyTruck', 'second']) assert.deepEqual(ready.state.counters[id].location, { kind: 'box', box: 'ste-ready' })
})

test('air refit observes ZOC, per-base limits and payment, with free Axis refit in the Romania box', () => {
  const rules = { ...makeRules(), aircraftRefit: { bases: (_, side) => side === 'axis' ? [{ hex: 'A2.1', level: 1 }] : [],
    romaniaBox: () => 'romania-box' } }
  const aircraft = (active, location = { kind: 'map', hex: 'A2.1' }) => ({ kind: 'aircraft', side: 'axis', definition: 'air', location, active })
  const opening = start({ first: aircraft(false), second: aircraft(false), romania: aircraft(false, { kind: 'box', box: 'romania-box' }),
    ...Object.fromEntries(['a', 'b', 'c', 'd'].map((id) => [id, aircraft(true)])), enemy: counter('soviet', 'A3.1', { mode: 'combat' }) },
  'axis', 'barrage', { supplyDumps: { axis: { 'A1.1': 1 }, soviet: {} } })
  const record = { ...opening, state: { ...opening.state, cursor: { ...opening.state.cursor, phase: 'aircraft-refit' } } }
  const atBase = { type: 'refit-campaign-aircraft', base: { kind: 'map', hex: 'A2.1' }, unitIds: ['first'], source: source('A1.1') }
  assert.equal(projectCampaignMatch(record, 'soviet', rules).refit, null)
  assert.throws(() => submit(record, atBase, rules), /eligible inactive/)
  const negated = { ...record, state: { ...record.state, counters: { ...record.state.counters, guard: counter('axis', 'A2.1') } } }
  assert.throws(() => submit(negated, { ...atBase, unitIds: ['first', 'second'] }, rules), /refit capacity/)
  const refitted = submit(negated, atBase, rules)
  assert.equal(refitted.state.counters.first.active, true)
  assert.equal(refitted.state.supplyDumps.axis['A1.1'], undefined)
  assert.throws(() => submit(refitted, { ...atBase, unitIds: ['second'] }, rules), /eligible inactive/)
  const free = submit(refitted, { type: 'refit-campaign-aircraft', base: { kind: 'romania', box: 'romania-box' }, unitIds: ['romania'] }, rules)
  assert.equal(free.state.counters.romania.active, true)
  assert.equal(submit(free, 'complete-campaign-refit', rules).state.refittedBases, undefined)
})
