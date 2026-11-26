import assert from 'node:assert/strict'
import test from 'node:test'
import { openCampaignMatch } from '../src/match/campaign-match.ts'
import { campaignPostureHooks } from '../src/match/campaign-posture-boards.ts'

const source = {
  frontOfHex: (hex) => (hex === '10' || hex === '11' ? 'front1' : hex === '20' ? 'front2' : undefined),
  benefitEligible: (s, hex) => hex === '10',
}
const hooks = campaignPostureHooks(source)
function game() {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 1, counters: {}, supplyDumps: {} }, 330)
  record.state.frontPostures = { front1: { mode: 'regrouping', sinceTurn: 1 }, front2: { mode: 'offensive', sinceTurn: 1 } }
  return record
}

test('posture benefit gates on Soviet side, regrouping front, boundary and eligibility (§3.3d B)', () => {
  const s = game().state
  assert.equal(hooks.frontOfHex('10'), 'front1')
  assert.equal(hooks.postureBenefitAt(s, '10', 'soviet'), true)   // regrouping + eligible
  assert.equal(hooks.postureBenefitAt(s, '10', 'axis'), false)    // not Soviet
  assert.equal(hooks.postureBenefitAt(s, '20', 'soviet'), false)  // front2 offensive
  assert.equal(hooks.postureBenefitAt(s, '30', 'soviet'), false)  // no front boundary
  assert.equal(hooks.postureBenefitAt(s, '11', 'soviet'), false)  // regrouping front but not trace-eligible
})

test('posture benefit fails when the front has no regrouping posture set', () => {
  const s = game().state
  s.frontPostures = {}
  assert.equal(hooks.postureBenefitAt(s, '10', 'soviet'), false)
})