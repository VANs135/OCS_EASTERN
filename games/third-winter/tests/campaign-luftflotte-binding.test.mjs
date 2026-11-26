import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { campaignLuftflotteOptions } from '../src/match/campaign-luftflotte.ts'

// TTW §2.2b Luftflotte 一次性空运：60 格内友军格放 SP（机场 2/非机场 1），每局一次。
const map = { resolveHex: (h) => h, neighbors: (h) => {
  const n = Number(h)
  return [n - 1, n + 1].filter((x) => x >= 0 && x <= 70).map(String)
} }
function start({ phasing = 'axis' } = {}) {
  const opened = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 10, counters: {}, supplyDumps: {} }, 5)
  const record = { ...opened, state: { ...opened.state, cursor: { phase: 'movement', phasing, first: 'axis' } } }
  const context = { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] },
    groundMovement: { map }, luftflotteFacts: (_s, hex) => ({ hqHex: '0', friendlyHex: hex !== 'enemy', airBase: hex === '50' }) }
  return { record, context }
}
const submit = (record, context, action, side = 'axis') =>
  submitCampaignMatch(record, side, { id: `lf:${record.revision}`, expectedRevision: record.revision, action }, context).record
const airlift = (targetHex) => ({ type: 'airlift-campaign-luftflotte', targetHex })

test('airlift places 2 SP at an airbase / 1 SP elsewhere within 60, once per game (§2.2b)', () => {
  const { record, context } = start()
  const base = submit(record, context, airlift('50'))
  assert.equal(base.state.supplyDumps.axis['50'], 2)
  assert.equal(base.state.luftflotteAirliftUsed, true)
  assert.equal(campaignLuftflotteOptions(base.state, 'axis').available, false)
  assert.throws(() => submit(base, context, airlift('55')), /already used/)
  const other = start()
  assert.equal(submit(other.record, other.context, airlift('55')).state.supplyDumps.axis['55'], 1)
})

test('airlift rejects out-of-range, non-friendly and wrong side targets (§2.2b)', () => {
  const { record, context } = start()
  assert.throws(() => submit(record, context, airlift('65')), /within 60 hexes/)
  assert.throws(() => submit(record, context, airlift('enemy')), /within 60 hexes/)
  const soviet = start({ phasing: 'soviet' })
  assert.throws(() => submit(soviet.record, soviet.context, airlift('50'), 'soviet'), /Axis action/)
  assert.equal(campaignLuftflotteOptions(record.state, 'soviet'), null)
})