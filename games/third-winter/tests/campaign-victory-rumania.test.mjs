import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAP_EDGE_BREAKTHROUGH_MIN_RE, VICTORY_CITIES, VICTORY_CITY_VP, VP_PER_AXIS_ARMY_HQ_ELIMINATED,
  campaignSuddenDeath, campaignVictoryOutcome, mapEdgeBreakthroughQualifies,
} from '../src/ttw/campaign/victory.ts'
import { rumaniaSurrenderEffects, rumaniaSurrenderEligible } from '../src/ttw/campaign/rumania.ts'

// TTW §5.0：胜负判定、突然死亡、VP 来源与边缘突破。
test('campaign victory outcome, sudden death and VP sources (§5.0)', () => {
  assert.equal(campaignVictoryOutcome(12), 'soviet')
  assert.equal(campaignVictoryOutcome(6), 'axis')
  assert.equal(campaignVictoryOutcome(9), 'draw')
  assert.equal(campaignSuddenDeath(-2), 'axis')
  assert.equal(campaignSuddenDeath(16), 'soviet')
  assert.equal(campaignSuddenDeath(9), null)
  assert.equal(VICTORY_CITY_VP, 2)
  assert.equal(VICTORY_CITIES.length, 5)
  assert.equal(VP_PER_AXIS_ARMY_HQ_ELIMINATED, 1)
  assert.equal(MAP_EDGE_BREAKTHROUGH_MIN_RE, 4)
  assert.equal(mapEdgeBreakthroughQualifies({ tankOrMechCorps: true, reOnEdge: 4, sovietCleanupPhase: true }), true)
  assert.equal(mapEdgeBreakthroughQualifies({ tankOrMechCorps: true, reOnEdge: 3, sovietCleanupPhase: true }), false)
  assert.equal(mapEdgeBreakthroughQualifies({ tankOrMechCorps: false, reOnEdge: 5, sovietCleanupPhase: true }), false)
})

// 罗马尼亚投降：前提与效果。
test('Rumanian surrender precondition and effects', () => {
  assert.equal(rumaniaSurrenderEligible({ year: 1944, alreadySurrendered: false }), true)
  assert.equal(rumaniaSurrenderEligible({ year: 1943, alreadySurrendered: false }), false)
  assert.equal(rumaniaSurrenderEligible({ year: 1944, alreadySurrendered: true }), false)
  const e = rumaniaSurrenderEffects()
  assert.equal(e.removeAirImmediately, true)
  assert.equal(e.removeGroundEndOfTurn, true)
  assert.equal(e.mayMove, false)
  assert.equal(e.mayAttack, false)
  assert.equal(e.mayBarrage, false)
  assert.equal(e.mayDefend, true)
  assert.equal(e.sovietVp, 2)
})