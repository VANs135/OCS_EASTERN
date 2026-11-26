import assert from 'node:assert/strict'
import { test } from 'node:test'
import { campaignBarrageMarkerReady, openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'

// TTW §3.4a–b：弹幕标记仅进攻姿态＋Ready 可花费，用后入轨 9 回合。
const map = { resolveHex: (h) => h, neighbors: () => [] }
function start({ frontPostures = { f: { mode: 'offensive', sinceTurn: 1 } }, turn = 10, segment = 'barrage', phasing = 'soviet', markers } = {}) {
  const opened = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn, counters: {}, supplyDumps: {} }, 5)
  const record = { ...opened, state: { ...opened.state, cursor: { phase: 'movement', phasing, first: 'axis' },
    movementSegment: segment, frontPostures, frontBarrageMarkers: markers } }
  const context = { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] } }
  return { record, context }
}
const spend = (front = 'f', targetHex = 'A3.1') => ({ type: 'spend-campaign-barrage-marker', front, targetHex })
const submit = (record, context, action, side = 'soviet') =>
  submitCampaignMatch(record, side, { id: `bm:${record.revision}`, expectedRevision: record.revision, action }, context).record

test('a ready offensive front spends its marker and recovers nine turns later (§3.4)', () => {
  const { record, context } = start()
  assert.equal(campaignBarrageMarkerReady(record.state, 'f'), true)
  const spent = submit(record, context, spend())
  assert.equal(spent.state.frontBarrageMarkers.f.readyTurn, 19)
  assert.equal(campaignBarrageMarkerReady(spent.state, 'f'), false)
  assert.throws(() => submit(spent, context, spend()), /not ready/)
  const later = { ...spent, state: { ...spent.state, turn: 19 } }
  assert.equal(campaignBarrageMarkerReady(later.state, 'f'), true)
})

test('marker spend is gated by posture, segment and side (§3.4a)', () => {
  const regrouping = start({ frontPostures: { f: { mode: 'regrouping', sinceTurn: 1 } } })
  assert.throws(() => submit(regrouping.record, regrouping.context, spend()), /offensive posture/)
  const wrongSegment = start({ segment: 'movement' })
  assert.throws(() => submit(wrongSegment.record, wrongSegment.context, spend()), /air\/naval barrage segment/)
  const axis = start({ phasing: 'axis' })
  assert.throws(() => submit(axis.record, axis.context, spend(), 'axis'), /air\/naval barrage segment/)
})

test('the target geometry predicate is enforced when injected (§3.4a)', () => {
  const { record, context } = start()
  const guarded = { ...context, barrageMarkerTarget: (_s, _f, hex) => hex === 'A3.1' }
  assert.equal(submit(record, guarded, spend('f', 'A3.1')).state.frontBarrageMarkers.f.readyTurn, 19)
  assert.throws(() => submit(record, guarded, spend('f', 'A9.9')), /adjacent to a Soviet combat unit/)
})