import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import {
  buyCampaignFuel, campaignHasBulkFuel, campaignUnitFuelReady, clearCampaignCleanupFuel, clearCampaignPhaseFuel,
  fuelCampaignUnit,
} from '../src/match/campaign-fuel.ts'

// 通规 §12.5：战役燃料绑定——单单位法/编队法/HQ 法、fuelReady、换段与清理清除。
const map = { resolveHex: (h) => h, neighbors: () => [] }
const land = (id, hex, side = 'soviet') => ({ definition: id, kind: 'land', side, location: { kind: 'map', hex } })
function start({ counters = {}, dumps = { soviet: { 'A3.1': 8 }, axis: {} }, phasing = 'soviet', phase = 'movement' } = {}) {
  const opened = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 10, counters, supplyDumps: dumps }, 5)
  const record = { ...opened, state: { ...opened.state, cursor: { phase, phasing, first: 'axis' }, movementSegment: 'movement' } }
  const context = { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] },
    groundMovement: { map }, organicFormation: (_s, id) => (id === 'u1' || id === 'u2') ? 'F1' : undefined }
  return { record, context }
}
const submit = (record, context, action, side = 'soviet') =>
  submitCampaignMatch(record, side, { id: `fuel:${record.revision}`, expectedRevision: record.revision, action }, context).record

test('single-unit fuel pays 1 T, marks fueled and feeds fuelReady (§12.5c-C)', () => {
  const { record, context } = start({ counters: { u1: land('u1', 'A3.1') } })
  const fueled = submit(record, context, { type: 'fuel-campaign-unit', unitId: 'u1', sourceKey: 'dump:A3.1' })
  assert.equal(fueled.state.counters.u1.fueled, true)
  assert.equal(fueled.state.supplyDumps.soviet['A3.1'], 7)
  assert.equal(campaignUnitFuelReady(fueled.state, 'u1'), true)
  assert.throws(() => submit(fueled, context, { type: 'fuel-campaign-unit', unitId: 'u1', sourceKey: 'dump:A3.1' }), /does not require/)
  const axis = start({ counters: { u1: land('u1', 'A3.1') }, phasing: 'axis' })
  assert.throws(() => submit(axis.record, axis.context, { type: 'fuel-campaign-unit', unitId: 'u1', sourceKey: 'dump:A3.1' }, 'axis'), /friendly on-map/)
})

test('formation and HQ bulk fuel pay 1 SP and set markers (§12.5c-A/B)', () => {
  const { record, context } = start({ counters: { u1: land('u1', 'A3.1'), u2: land('u2', 'A3.1'), hq: { definition: 'hq', kind: 'hq', side: 'soviet', location: { kind: 'map', hex: 'A3.1' } } } })
  const form = submit(record, context, { type: 'fuel-campaign-formation', formation: 'F1', payments: [{ key: 'dump:A3.1', tokens: 4 }] })
  assert.deepEqual(form.state.formationFuel[0].recipients.sort(), ['u1', 'u2'])
  assert.equal(campaignHasBulkFuel(form.state, 'u1'), true)
  assert.equal(campaignUnitFuelReady(form.state, 'u2'), true)
  assert.equal(form.state.supplyDumps.soviet['A3.1'], 4)
  assert.throws(() => submit(form, context, { type: 'fuel-campaign-formation', formation: 'F1', payments: [{ key: 'dump:A3.1', tokens: 4 }] }), /active formation fuel marker/)
  assert.throws(() => submit(record, context, { type: 'fuel-campaign-formation', formation: 'F1', payments: [{ key: 'dump:A3.1', tokens: 1 }] }), /1 SP/)
  const hq = submit(record, context, { type: 'fuel-campaign-headquarters', headquartersId: 'hq', payments: [{ key: 'dump:A3.1', tokens: 4 }] })
  assert.equal(hq.state.headquartersFuel[0].id, 'hq')
  assert.throws(() => submit(hq, context, { type: 'fuel-campaign-headquarters', headquartersId: 'hq', payments: [{ key: 'dump:A3.1', tokens: 4 }] }), /unfueled friendly HQ/)
})

test('phase change clears single-unit fuel; cleanup clears bulk markers (§12.5c-C/d)', () => {
  const { record, context } = start({ counters: { u1: land('u1', 'A3.1'), u2: land('u2', 'A3.1') } })
  const single = submit(record, context, { type: 'fuel-campaign-unit', unitId: 'u1', sourceKey: 'dump:A3.1' })
  const bulk = submit(single, context, { type: 'fuel-campaign-formation', formation: 'F1', payments: [{ key: 'dump:A3.1', tokens: 4 }] })
  const phaseChanged = clearCampaignPhaseFuel(bulk.state)
  assert.equal(phaseChanged.counters.u1.fueled, false)
  assert.equal(campaignHasBulkFuel(phaseChanged, 'u2'), true) // 编队标记保留到清理阶段
  const cleaned = clearCampaignCleanupFuel(phaseChanged, 'soviet')
  assert.equal(cleaned.formationFuel.length, 0)
  assert.equal(campaignUnitFuelReady(cleaned, 'u2'), false)
})