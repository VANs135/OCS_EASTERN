import assert from 'node:assert/strict'
import { test } from 'node:test'
import { campaignFrontPostureOptions, campaignMustLeaveOffensiveFronts, openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'

// 批次 10 姿态指定动作（§3.3c/d/e）：窗口、最多 2 进攻、3/9 回合计时与强制离开义务。
const map = { resolveHex: (h) => h, neighbors: () => [] }
function start(frontPostures, { phase = 'reinforcement', phasing = 'soviet', turn = 10 } = {}) {
  const opened = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn, counters: {}, supplyDumps: {} }, 7)
  const record = { ...opened, state: { ...opened.state, cursor: { phase, phasing, first: 'axis' }, frontPostures } }
  const context = { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] } }
  return { record, context }
}
const set = (front, mode, window) => ({ type: 'set-campaign-front-posture', front, mode, window })
const submit = (record, context, action, side = 'soviet') =>
  submitCampaignMatch(record, side, { id: `fp:${record.revision}`, expectedRevision: record.revision, action }, context).record
const off = (sinceTurn) => ({ mode: 'offensive', sinceTurn })
const reg = (sinceTurn) => ({ mode: 'regrouping', sinceTurn })

test('posture designation respects the reinforcement-phase windows (§3.3c/d)', () => {
  const { record, context } = start({ f: reg(1) })
  const r = submit(record, context, set('f', 'offensive', 'start'))
  assert.equal(r.state.frontPostures.f.mode, 'offensive')
  assert.equal(r.state.frontPostures.f.sinceTurn, 10)
  assert.throws(() => submit(record, context, set('f', 'offensive', 'end')), /start of the reinforcement phase/)
  const o = start({ f: off(1) })
  const r2 = submit(o.record, o.context, set('f', 'regrouping', 'end'))
  assert.equal(r2.state.frontPostures.f.mode, 'regrouping')
  assert.throws(() => submit(o.record, o.context, set('f', 'regrouping', 'start')), /end of the reinforcement phase/)
})

test('at most two fronts offensive and only during the Soviet reinforcement phase (§3.3c)', () => {
  const { record, context } = start({ a: off(1), b: off(1), c: reg(1) })
  assert.throws(() => submit(record, context, set('c', 'offensive', 'start')), /two-front limit/)
  const axis = start({ c: reg(1) }, { phasing: 'axis' })
  assert.throws(() => submit(axis.record, axis.context, set('c', 'offensive', 'start'), 'axis'), /Soviet reinforcement phase/)
  const wrongPhase = start({ c: reg(1) }, { phase: 'movement' })
  assert.throws(() => submit(wrongPhase.record, wrongPhase.context, set('c', 'offensive', 'start')), /Soviet reinforcement phase/)
})

test('3/9 turn change limits and the must-leave-offensive obligation (§3.3e)', () => {
  const young = start({ f: off(8) }) // turn 10, 2 turns < 3
  assert.throws(() => submit(young.record, young.context, set('f', 'regrouping', 'end')), /cannot yet switch to regrouping/)
  const ready = start({ f: off(7) }) // 3 turns
  assert.equal(submit(ready.record, ready.context, set('f', 'regrouping', 'end')).state.frontPostures.f.mode, 'regrouping')
  const stale = start({ f: off(1), g: off(8) }) // f 9 turns must leave; g 2 turns not
  assert.deepEqual(campaignMustLeaveOffensiveFronts(stale.record.state), ['f'])
  const regroupYoung = start({ f: reg(8) })
  assert.throws(() => submit(regroupYoung.record, regroupYoung.context, set('f', 'offensive', 'start')), /cannot be designated offensive/)
})

test('posture options projection exposes per-front status for the UI (§3.3)', () => {
  const { record } = start({ a: off(1), b: reg(1) }) // turn 10：a 进攻 9 回合须离开；b regrouping 9 回合可转进攻
  const options = campaignFrontPostureOptions(record.state)
  const a = options.find((o) => o.front === 'a')
  const b = options.find((o) => o.front === 'b')
  assert.equal(a.turnsInPosture, 9)
  assert.equal(a.mustLeaveOffensive, true)
  assert.equal(a.mayGoRegrouping, true)
  assert.equal(a.mayUseBarrageMarker, true)
  assert.equal(a.barrageMarkerReady, true)
  assert.equal(b.mayGoOffensive, true)
  assert.equal(b.mustLeaveOffensive, false)
  assert.equal(b.mayUseBarrageMarker, false)
})