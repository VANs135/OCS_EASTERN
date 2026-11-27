import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { unitCatalog } from '../src/import/unit-catalog.ts'
import { prepareKirovogradOpening } from '../src/match/kirovograd-opening.ts'
import { openCampaignSession, submitCampaignSessionCommand } from '../src/match/campaign-opening-session.ts'
import { openCampaignReinforcementSession, submitCampaignSession } from '../src/match/campaign-session.ts'
import { projectCampaignSession } from '../src/view/campaign-opening-session-view.ts'
import { scheduledCampaignReinforcements } from '../src/match/campaign-reinforcement-actions.ts'
import { kirovogradTankCorpsHold } from '../src/ttw/campaign/kirovograd.ts'

function data() {
  const land = (id, side, re) => ({ id, name: id, side, re, faces: { combat: null, move: null } })
  const transport = (id, name, side, points) => ({ ...land(id, side, 0), name,
    faces: { combat: { maColor: 'black', stats: { transport: points, move: 45 } }, move: null } })
  const catalog = unitCatalog([
    { kind: 'land', file: 'synthetic', rows: [land('first', 'axis', 4), land('second', 'soviet', 2), land('alert', 'axis', 1),
      { ...land('corps', 'soviet', 3), org: { parentFmt: '29.Tk', airGroup: null } }] },
    { kind: 'aircraft', file: 'synthetic-air', rows: [land('air', 'soviet', 0)] },
    { kind: 'transport', file: 'synthetic-transport', rows: [transport('at', 'Axis Truck 2/45', 'axis', 2),
      transport('st2', 'Sov Truck 2/45', 'soviet', 2), transport('st1', 'Sov Truck', 'soviet', 1)] },
  ])
  const map = { resolveHex: (hex) => ['D10.30', 'D11.30', 'D5.23', 'D13.23', 'D12.30', 'D14.30'].includes(hex) ? hex : undefined }
  const arrivals = [1, 2].map((turn) => ({ id: `order-${turn}`, ref: 'first', row: turn, entry: 1, side: 'axis', turn,
    date: turn === 1 ? '1944-01-05' : '1944-01-08', sourceDate: null, sourceChannel: 'reinforce hex', note: null,
    definition: 'land:id:first', counterKind: 'land', status: 'classified',
    operation: { kind: 'arrival', channel: { kind: 'fixed-hex', hex: 'D13.23', printedHex: 'D13.23' } } }))
  return { map, catalog, kirovogradHex: 'D12.30', setupOrder: ['axis', 'soviet'], dates: ['1944-01-05'], opening: {
    weather: { ground: 'freeze', flight: 'limited' }, first: 'soviet' },
  setup: { counters: [
    { id: 'initial-axis', definition: 'land:id:first', side: 'axis', kind: 'land', hex: 'D10.30', face: null, stepsLost: 2 },
    { id: 'initial-soviet', definition: 'land:id:second', side: 'soviet', kind: 'land', hex: 'D14.30', face: null },
    { id: 'initial-corps', definition: 'land:id:corps', side: 'soviet', kind: 'land', hex: 'D12.30', face: null },
  ], drawOrders: [{ row: 1, side: 'axis', pool: 'alert', hex: 'D5.23', count: 1 },
    { row: 2, side: 'axis', pool: 'alert', hex: 'D5.23', count: 1 }],
  unresolvedSetup: [], unresolvedLosses: [], missingSetupHexes: [], outsideSetupArea: [], unresolvedDraws: [], pendingMarkerRows: [] },
  placements: [{ id: 'initial-axis', choices: ['D10.30', 'D11.30'] }],
  aircraft: [{ id: 'air-1', definition: 'aircraft:id:air', side: 'soviet', reduced: true, availableThrough: 3 }],
  alertPool: [{ ref: 'alert', definition: 'land:id:alert', count: 3 }],
  supplyDumps: { axis: { 'D5.23': 4 }, soviet: { 'D14.30': 8 } },
  otherMarkers: [{ ref: 'Truck Points', side: 'axis', count: 2, hex: 'D5.23' },
    { ref: 'Truck Points', side: 'soviet', count: 3, hex: 'D14.30' }, { ref: 'Railhead', side: 'soviet', count: 1, hex: 'D12.30' }],
  reinforcement: { entries: arrivals, schedule: new Map(arrivals.map((order) => [order.turn, { axis: [order], soviet: [] }])) },
  diagnostics: { missingTerrain: [] } }
}

const send = (record, actor, action, context) => submitCampaignSessionCommand(record, actor,
  { id: `test:${record.revision}`, expectedRevision: record.revision, action }, context).record

test('scenario opening binds losses, ordinary truck capacity, pool identities and independent arrival instances', () => {
  const input = data()
  const { opening, context, markerSetup, aircraftAvailability, movement } = prepareKirovogradOpening(input)
  assert.deepEqual(opening.hexControl, { 'D12.30': 'axis' })
  assert.equal(typeof context.turn.scenarioVictory, 'function')
  assert.equal(typeof context.turn.roundEnd, 'function')
  assert.equal(opening.counters['initial-corps'].held, kirovogradTankCorpsHold)
  assert.equal(opening.counters['initial-soviet'].held, undefined)
  assert.equal(typeof movement.releases, 'function')
  assert.equal(opening.counters['initial-axis'].stepsLost, 2)
  assert.equal(opening.counters['initial-axis'].currentRe, 2)
  assert.equal(opening.counters['initial-axis'].mode, 'combat')
  assert.equal(opening.counters['initial-axis'].location.kind, 'available')
  assert.equal(opening.counters['air-1'].location.box, '09:soviet:air')
  assert.equal(opening.counters['air-1'].stepsLost, 1)
  assert.equal(opening.counters['air-1'].availableThrough, 3)
  assert.deepEqual(aircraftAvailability, [{ id: 'air-1', availableThrough: 3 }])
  assert.deepEqual(context.turn.aircraftRefit.offMapBoxes(undefined, 'soviet'), ['09:soviet:air'])
  assert.deepEqual(context.turn.aircraftRefit.offMapBoxes(undefined, 'axis'), [])
  assert.deepEqual(markerSetup, [input.otherMarkers[2]])
  const trucks = Object.values(opening.counters).filter(({ kind }) => kind === 'transport')
  assert.equal(trucks.length, 3)
  assert.equal(trucks.filter(({ side }) => side === 'soviet').reduce((sum, c) => sum + c.transportPoints, 0), 3)
  assert.equal(trucks.reduce((sum, c) => sum + c.transportCargoTokens, 0), 0)
  assert.deepEqual(opening.supplyDumps, input.supplyDumps)
  const first = context.turn.reinforcement.bindings.get('order-1')[0]
  const later = context.turn.reinforcement.bindings.get('order-2')[0]
  assert.notEqual(first, later)
  assert.notEqual(first, 'initial-axis')
  assert.equal(opening.counters[first].location.kind, 'available')
  const session = openCampaignReinforcementSession(1, 'axis', opening.counters)
  const [ready] = scheduledCampaignReinforcements(session.state, context.turn.reinforcement)
  assert.equal(ready.status, 'ready')
  const result = submitCampaignSession(session, 'axis', { id: 'arrive', expectedRevision: 0, action: {
    type: 'execute-scheduled-reinforcement', orderId: 'order-1', placements: [{ counterId: first, hex: 'D13.23' }],
  } }, context.turn.reinforcement).record
  assert.equal(result.state.counters[first].location.hex, 'D13.23')
  assert.equal(result.state.counters[later].location.kind, 'available')
  assert.equal(input.setup.counters[0].hex, 'D10.30')
})

test('scenario setup uses legal choices and distinct pool draws, then retains the sequence across prescribed weather', () => {
  const prepared = prepareKirovogradOpening(data())
  const { context } = prepared
  let record = openCampaignSession(prepared.opening, context, 21)
  const initial = projectCampaignSession(record, 'axis', context)
  assert.equal(initial.actor, 'axis')
  assert.deepEqual(initial.active.destinations, ['D10.30', 'D11.30'])
  assert.equal(projectCampaignSession(record, 'soviet', context).active, null)
  assert.throws(() => send(record, 'axis', { type: 'setup-place', stepId: initial.active.id, hex: 'D13.23' }, context), /offered/)
  while (record.state.kind === 'setup') {
    const step = context.setupPlan.steps[record.state.setup.stepIndex]
    const active = projectCampaignSession(record, step.side, context).active
    record = send(record, step.side, active.kind === 'place'
      ? { type: 'setup-place', stepId: step.id, hex: 'D11.30' }
      : { type: active.kind === 'draw' ? 'setup-draw' : 'setup-confirm', stepId: step.id }, context)
  }
  assert.equal(record.state.setupDraws.length, 2)
  assert.equal(new Set(record.state.setupDraws.map(({ counterId }) => counterId)).size, 2)
  assert.equal(record.state.turn.counters['initial-axis'].location.hex, 'D11.30')
  assert.deepEqual(projectCampaignSession(record, 'soviet', context).setupDraws, [])
  const count = record.state.turn.rng.drawCount
  record = send(record, 'soviet', { type: 'determine-campaign-weather' }, context)
  assert.equal(record.state.turn.rng.drawCount, count)
  assert.deepEqual(record.state.turn.weather, { ground: 'freeze', flight: 'limited' })
})

test('the adapter leaves unresolved source rows visible and rejects malformed or ambiguous bindings', () => {
  const input = data()
  assert.throws(() => prepareKirovogradOpening({ ...input, setup: { ...input.setup, unresolvedSetup: [{ ref: 'missing' }] } }), /diagnostics/)
  assert.throws(() => prepareKirovogradOpening({ ...input, placements: [...input.placements, ...input.placements] }), /Duplicate Kirovograd placement/)
  assert.throws(() => prepareKirovogradOpening({ ...input, otherMarkers: [{ ...input.otherMarkers[0], count: 4 }] }), /Truck Points/)
  const missing = { ...input, setup: { ...input.setup, drawOrders: [{ ...input.setup.drawOrders[0], count: undefined }] } }
  assert.throws(() => prepareKirovogradOpening(missing), /Unsupported Kirovograd setup draw/)
})

test('the opening reuses a supplied barrage table to assemble the 09 air-strike board', () => {
  const table = { columns: ['1-2'], costs: [1], matrix: Array.from({ length: 11 }, () => ['-']) }
  const prepared = prepareKirovogradOpening(data(), { barrage: { table } })
  assert.equal(prepared.context.turn.airMission?.table, table)
  assert.equal(prepared.context.turn.airMission?.rangeHexes?.({ counters: {} }, 'air-1'), Number.MAX_SAFE_INTEGER)
})
