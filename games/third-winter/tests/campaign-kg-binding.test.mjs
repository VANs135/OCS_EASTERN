import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { campaignKgOptions, removeEmptyCampaignKg } from '../src/match/campaign-kg.ts'

// TTW §2.4e KG 绑定：创建/解散、成员按同堆合格单位派生、空标记回池、UI 投影。
const map = { resolveHex: (h) => h, neighbors: () => [] }
const axis = (id, hex) => ({ definition: id, kind: 'land', side: 'axis', location: { kind: 'map', hex } })
const eligible = (_s, id) => id === 'g1' || id === 'g2'
function start({ counters = {}, phase = 'movement', phasing = 'axis' } = {}) {
  const opened = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 10, counters, supplyDumps: {} }, 5)
  const record = { ...opened, state: { ...opened.state, cursor: { phase, phasing, first: 'axis' }, movementSegment: 'movement' } }
  const context = { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] },
    groundMovement: { map }, kgEligible: eligible }
  return { record, context }
}
const submit = (record, context, action, side = 'axis') =>
  submitCampaignMatch(record, side, { id: `kg:${record.revision}`, expectedRevision: record.revision, action }, context).record

test('create a KG on an eligible stacked unit; members derive from stacking (§2.4e)', () => {
  const { record, context } = start({ counters: { g1: axis('g1', 'A3.1'), g2: axis('g2', 'A3.1'), g3: axis('g3', 'A9.9') } })
  const created = submit(record, context, { type: 'create-campaign-kg', unitId: 'g1', hex: 'A3.1' })
  assert.deepEqual(created.state.kampfgruppen, [{ id: 'g1', hex: 'A3.1' }])
  const options = campaignKgOptions(created.state, 'axis', map, eligible)
  assert.deepEqual(options[0].members.sort(), ['g1', 'g2'])
  assert.throws(() => submit(record, context, { type: 'create-campaign-kg', unitId: 'g3', hex: 'A9.9' }), /German with Truck or Track/)
  assert.throws(() => submit(created, context, { type: 'create-campaign-kg', unitId: 'g1', hex: 'A3.1' }), /already leads/)
  const soviet = start({ counters: { g1: axis('g1', 'A3.1') }, phasing: 'soviet' })
  assert.throws(() => submit(soviet.record, soviet.context, { type: 'create-campaign-kg', unitId: 'g1', hex: 'A3.1' }, 'soviet'), /Axis movement phase/)
})

test('dissolve voluntarily and remove the marker when the last eligible unit leaves (§2.4e)', () => {
  const { record, context } = start({ counters: { g1: axis('g1', 'A3.1'), g2: axis('g2', 'A3.1') } })
  const created = submit(record, context, { type: 'create-campaign-kg', unitId: 'g1', hex: 'A3.1' })
  const dissolved = submit(created, context, { type: 'dissolve-campaign-kg', id: 'g1' })
  assert.deepEqual(dissolved.state.kampfgruppen, [])
  assert.throws(() => submit(created, context, { type: 'dissolve-campaign-kg', id: 'nope' }), /existing Kampfgruppe/)
  // 合格单位全部离堆 → 标记回池。
  const moved = { ...created.state, counters: { ...created.state.counters,
    g1: { ...created.state.counters.g1, location: { kind: 'map', hex: 'B5.5' } },
    g2: { ...created.state.counters.g2, location: { kind: 'map', hex: 'B5.5' } } } }
  assert.deepEqual(removeEmptyCampaignKg(moved, map, eligible).kampfgruppen, [])
  assert.equal(campaignKgOptions(created.state, 'soviet', map, eligible), null)
})