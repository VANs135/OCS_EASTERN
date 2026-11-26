import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { createCampaignOrdinaryMovementBoard } from '../src/match/campaign-movement-board.ts'

const hexes = ['A1.1', 'A2.1', 'A3.1']
const resolveHex = (hex) => hexes.includes(hex) ? hex : undefined
const parent = (more = {}) => ({ kind: 'land', side: 'axis', definition: 'parent', location: { kind: 'map', hex: 'A1.1' }, currentRe: 4, stepsLost: 0, mode: 'combat', ...more })

function start(counters, { phase = 'movement', segment = 'movement', copies = 2, moved = false } = {}) {
  const opened = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 2, counters, supplyDumps: { axis: {}, soviet: {} } }, 623)
  const record = { ...opened, state: { ...opened.state, weather: { ground: 'dry', flight: 'none' },
    cursor: { phase, phasing: 'axis', first: 'axis' }, movementSegment: segment } }
  const printed = { parent: 4, bd: 1, bd2: 1, bdHi: 1 }
  const ar = { parent: 3, bd: 3, bd2: 3, bdHi: 4 }
  const board = {
    resolveHex,
    factsOf: (state, id) => {
      const c = state.counters[id]
      if (!c || c.kind !== 'land') return undefined
      return { combat: true, combatClass: 'other', printedRe: printed[c.definition] ?? 1, stepsLost: c.stepsLost ?? 0,
        actionRating: ar[c.definition] ?? 2, moveMode: c.mode === 'move', reserve: c.mode === 'reserve' ? 'reserve' : undefined,
        disorganized: c.disorganized === true, exploit: c.exploiting === true, outOfSupply: c.outOfSupply === true, internalStocks: c.internalStocks }
    },
    definitionFacts: (def) => ['bd', 'bd2', 'bdHi'].includes(def) ? { side: 'axis', actionRating: ar[def] } : undefined,
    parentPools: new Map([['parent', 'p']]),
    counters: new Map([['bd', { pool: 'p', copies }], ['bd2', { pool: 'q', copies }], ['bdHi', { pool: 'p', copies }]]),
    stackingReAt: (state, hex) => Object.values(state.counters).reduce((sum, c) => sum + (c.location.kind === 'map' && c.location.hex === hex ? c.currentRe ?? 1 : 0), 0),
    hasMoved: () => moved,
  }
  const context = { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex, arrivalSites: () => [] }, breakdown: board }
  return { record, context }
}
const command = (record, action) => ({ id: `bd:${record.revision}`, expectedRevision: record.revision, action })
const submit = (record, context, action, side = 'axis') => submitCampaignMatch(record, side, command(record, action), context).record
const detach = (definitions = ['bd'], parentId = 'parent') => ({ type: 'detach-campaign-breakdown', parentId, definitions })
const absorb = (breakdownId, parentId = 'parent') => ({ type: 'absorb-campaign-breakdown', parentId, breakdownId })
const openWindow = (record) => ({ ...record, state: { ...record.state, breakdownAbsorb: { side: 'axis' } } })

test('detach creates a one-step breakdown in the parent hex and reduces the parent (OCS 20.0)', () => {
  const { record, context } = start({ parent: parent() })
  const next = submit(record, context, detach())
  const bd = next.state.counters['breakdown:bd:1']
  assert.deepEqual(bd.location, { kind: 'map', hex: 'A1.1' })
  assert.equal(bd.currentRe, 1)
  assert.equal(bd.stepsLost, 0)
  assert.equal(bd.mode, 'combat')
  assert.equal(next.state.counters.parent.stepsLost, 1)
  assert.equal(next.state.counters.parent.currentRe, 3)
})

test('pool copies limit, wrong pool, last step, AR ceiling and movement-start gate are enforced (OCS 20.0/TTW 1.6e)', () => {
  const limited = start({ parent: parent() }, { copies: 1 })
  const once = submit(limited.record, limited.context, detach())
  assert.throws(() => submit(once, limited.context, detach()), /No copy of this breakdown counter remains/)
  const wrongPool = start({ parent: parent() })
  assert.throws(() => submit(wrongPool.record, wrongPool.context, detach(['bd2'])), /parent unit’s pool/)
  const lastStep = start({ parent: parent({ stepsLost: 3, currentRe: 1 }) })
  assert.throws(() => submit(lastStep.record, lastStep.context, detach()), /last step intact/)
  const highAr = start({ parent: parent() })
  assert.throws(() => submit(highAr.record, highAr.context, detach(['bdHi'])), /exceeds the parent unit’s rating/)
  const moved = start({ parent: parent() }, { moved: true })
  assert.throws(() => submit(moved.record, moved.context, detach()), /move start/)
  const wrongPhase = start({ parent: parent() }, { phase: 'combat' })
  assert.throws(() => submit(wrongPhase.record, wrongPhase.context, detach()), /move start/)
})

test('20.0a also allows detach at post-combat advance and post-retreat windows', () => {
  const combat = { target: 'A2.1', attacker: 'axis', attackers: ['parent'], defenders: [], hedgehog: 0,
    heldAtStart: { axis: [], soviet: [] } }
  const advance = start({ parent: parent() }, { phase: 'combat' })
  const atAdvance = { ...advance.record, state: { ...advance.record.state, combat: { ...combat, step: 'advance' } } }
  assert.equal(submit(atAdvance, advance.context, detach()).state.counters.parent.stepsLost, 1)
  const retreat = start({ parent: parent() }, { phase: 'combat' })
  const atRetreat = { ...retreat.record, state: { ...retreat.record.state, combat: { ...combat, step: 'defender-result', attackerRetreated: true } } }
  assert.equal(submit(atRetreat, retreat.context, detach()).state.counters.parent.stepsLost, 1)
})

test('absorb returns the counter to its pool and restores the parent step (OCS 20.0b-d)', () => {
  const { record, context } = start({ parent: parent() })
  const detached = submit(record, context, detach())
  assert.throws(() => submit(detached, context, absorb('breakdown:bd:1')), /segment end/)   // 段中不可吸收
  const absorbed = submit(openWindow(detached), context, absorb('breakdown:bd:1'))
  assert.equal(absorbed.state.counters['breakdown:bd:1'], undefined)
  assert.equal(absorbed.state.counters.parent.stepsLost, 0)
  assert.equal(absorbed.state.counters.parent.currentRe, 4)
  assert.deepEqual(absorbed.state.breakdownReturns.bd, ['breakdown:bd:1'])
})

test('absorb requires same hex, matching mode and a reduced parent; physical identity is reused', () => {
  const { record, context } = start({ parent: parent() })
  const detached = openWindow(submit(record, context, detach()))
  const mismatch = { ...detached, state: { ...detached.state, counters: { ...detached.state.counters,
    'breakdown:bd:1': { ...detached.state.counters['breakdown:bd:1'], mode: 'move' } } } }
  assert.throws(() => submit(mismatch, context, absorb('breakdown:bd:1')), /same hex and pool/)
  const otherHex = { ...detached, state: { ...detached.state, counters: { ...detached.state.counters,
    'breakdown:bd:1': { ...detached.state.counters['breakdown:bd:1'], location: { kind: 'map', hex: 'A2.1' } } } } }
  assert.throws(() => submit(otherHex, context, absorb('breakdown:bd:1')), /same hex and pool/)
  const fresh = start({ parent: parent() })
  assert.throws(() => submit(openWindow(fresh.record), fresh.context, absorb('breakdown:bd:1')), /same hex and pool/)
  const reused = submit(submit(detached, context, absorb('breakdown:bd:1')), context, detach())
  assert.ok(reused.state.counters['breakdown:bd:1'])
  assert.equal(reused.state.counters['breakdown:bd:2'], undefined)
})

test('20.0d segment end opens a mandatory absorb window that blocks completion until settled', () => {
  const { record, context } = start({ parent: parent() })
  const detached = submit(record, context, detach())
  const groundMovement = createCampaignOrdinaryMovementBoard({
    map: { resolveHex, neighbors: (hex) => hexes.filter((x) => Math.abs(hexes.indexOf(x) - hexes.indexOf(hex)) === 1) },
    profileOf: () => ({ combat: true, attackCapable: true, inCombatMode: true, outOfSupply: false, moveMa: 4, moveMobility: 'leg', drawMobility: 'leg', singleTransportPoint: false }),
    moveProfile: () => ({ ma: 3, mobility: 'leg', fuelReady: true }), terrainAt: () => ['Open'],
    crossingAt: () => ({ barrier: 'none', routes: [] }), entryRequiresResolution: () => false, inTrace: () => true, endBlockers: () => [],
  })
  const ctx = { ...context, groundMovement }
  const blocked = submit(detached, ctx, { type: 'complete-campaign-ground-movement' })
  assert.deepEqual(blocked.state.breakdownAbsorb, { side: 'axis' })
  assert.equal(blocked.state.movementSegment, 'movement')
  const absorbed = submit(blocked, ctx, absorb('breakdown:bd:1'))
  const done = submit(absorbed, ctx, { type: 'complete-campaign-ground-movement' })
  assert.equal(done.state.movementSegment, 'barrage')
  assert.equal(done.state.breakdownAbsorb, null)
})