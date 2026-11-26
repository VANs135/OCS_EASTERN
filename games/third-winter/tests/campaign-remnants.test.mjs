import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { applyCampaignCombatLosses } from '../src/match/campaign-combat-losses.ts'
import { newCampaignReinforcementWindow } from '../src/match/campaign-reinforcement-flow.ts'
import { emptyCampaignReplacementHoldings } from '../src/match/campaign-reinforcement-state.ts'

const resolveHex = (hex) => hex
const div = (more = {}) => ({ kind: 'land', side: 'axis', definition: 'parent', location: { kind: 'map', hex: 'A3.1' }, currentRe: 1, stepsLost: 0, mode: 'combat', ...more })
const stepsOf = (state, id) => state.counters[id]?.location.kind === 'map' ? state.counters[id].currentRe ?? 1 : undefined
const lossBoard = (remnant) => ({ stepsOf, reAfterLoss: (state, id, losses) => state.counters[id].currentRe - losses, remnant })
const gen = (more = {}) => ({ isParentDivision: (_s, id) => id === 'div', destinations: () => ['A1.1'], nextId: () => 'remnant:1', definition: 'remnant', ...more })

function base(counters) {
  return openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 2, counters, supplyDumps: { axis: {}, soviet: {} } }, 623).state
}

test('destroying a 16-4-3 last step generates a remnant two hexes west inheriting mode (TTW 2.4d)', () => {
  const state = base({ div: div({ disorganized: true }) })
  const next = applyCampaignCombatLosses(state, new Map([['div', 1]]), lossBoard(gen()))
  assert.deepEqual(next.counters.div.location, { kind: 'dead-pile' })
  const remnant = next.counters['remnant:1']
  assert.deepEqual(remnant.location, { kind: 'map', hex: 'A1.1' })
  assert.equal(remnant.currentRe, 1)
  assert.equal(remnant.definition, 'remnant')
  assert.equal(remnant.disorganized, true)
  assert.equal(remnant.mode, 'combat')
})

test('no remnant when the pool is empty, no legal destination, not a parent, or not the last step', () => {
  const state = base({ div: div() })
  assert.equal(applyCampaignCombatLosses(state, new Map([['div', 1]]), lossBoard(gen({ nextId: () => undefined }))).counters['remnant:1'], undefined)
  assert.equal(applyCampaignCombatLosses(state, new Map([['div', 1]]), lossBoard(gen({ destinations: () => [] }))).counters['remnant:1'], undefined)
  assert.equal(applyCampaignCombatLosses(state, new Map([['div', 1]]), lossBoard(gen({ isParentDivision: () => false }))).counters['remnant:1'], undefined)
  const reduced = base({ div: div({ currentRe: 2 }) })
  const partial = applyCampaignCombatLosses(reduced, new Map([['div', 1]]), lossBoard(gen()))
  assert.equal(partial.counters['remnant:1'], undefined)
  assert.equal(partial.counters.div.stepsLost, 1)
})

function rebuildStart(counters, { pax = 1, segment = 'rebuild-consolidate', hqStacked = true } = {}) {
  const opened = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 3, counters, supplyDumps: { axis: {}, soviet: {} } }, 623)
  const holdings = emptyCampaignReplacementHoldings()
  const record = { ...opened, state: { ...opened.state, cursor: { phase: 'reinforcement', phasing: 'axis', first: 'axis' },
    reinforcement: { stage: 'ordinary', window: { ...newCampaignReinforcementWindow(), segment } },
    replacementHoldings: { ...holdings, axis: { ...holdings.axis, pax } } } }
  const context = { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex, arrivalSites: () => [] },
    remnantRebuild: { isRemnant: (_s, id) => id === 'remnant', isParentDivision: (_s, id) => id === 'div',
      hqStacked: () => hqStacked, printedStepsOf: () => 4 } }
  return { record, context }
}
const command = (record, action) => ({ id: `rem:${record.revision}`, expectedRevision: record.revision, action })
const submit = (record, context, action) => submitCampaignMatch(record, 'axis', command(record, action), context).record
const rebuild = { type: 'rebuild-campaign-from-remnant', remnantId: 'remnant', divisionId: 'div' }
const remnantCounter = { kind: 'land', side: 'axis', definition: 'remnant', location: { kind: 'map', hex: 'A1.1' }, currentRe: 1, mode: 'combat' }
const deadDiv = { kind: 'land', side: 'axis', definition: 'parent', location: { kind: 'dead-pile' }, currentRe: 0 }

test('a remnant stacked with an Army HQ rebuilds a one-step division for 1 Pax and returns to pool (TTW 2.4d)', () => {
  const { record, context } = rebuildStart({ remnant: remnantCounter, div: deadDiv, hq: { kind: 'hq', side: 'axis', definition: 'hq-army', location: { kind: 'map', hex: 'A1.1' }, currentRe: 1 } })
  const next = submit(record, context, rebuild)
  assert.deepEqual(next.state.counters.div.location, { kind: 'map', hex: 'A1.1' })
  assert.equal(next.state.counters.div.currentRe, 1)
  assert.equal(next.state.counters.div.stepsLost, 3)
  assert.equal(next.state.counters.div.mode, 'combat')
  assert.equal(next.state.counters.remnant, undefined)
  assert.equal(next.state.reinforcement.window.replacementSpent.pax, 1)
})

test('remnant rebuild enforces HQ stacking, Pax, window and dead-pile parent', () => {
  const counters = { remnant: remnantCounter, div: deadDiv }
  const noHq = rebuildStart(counters, { hqStacked: false })
  assert.throws(() => submit(noHq.record, noHq.context, rebuild), /stacked Corps\/Army HQ and one Pax/)
  const noPax = rebuildStart(counters, { pax: 0 })
  assert.throws(() => submit(noPax.record, noPax.context, rebuild), /stacked Corps\/Army HQ and one Pax/)
  const wrongWindow = rebuildStart(counters, { segment: 'supply' })
  assert.throws(() => submit(wrongWindow.record, wrongWindow.context, rebuild), /Axis rebuild and consolidation window/)
  const liveDiv = rebuildStart({ remnant: remnantCounter, div: { ...deadDiv, location: { kind: 'map', hex: 'A2.1' }, currentRe: 1 } })
  assert.throws(() => submit(liveDiv.record, liveDiv.context, rebuild), /dead-pile 16-4-3 division/)
})