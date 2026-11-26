import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  TTW_DEFENSIVE_BARRAGE_COLUMN, TTW_MAX_OFFENSIVE_FRONTS, canAddOffensive, canDesignateOffensive,
  canDesignateRegrouping, mayUseBarrageMarker, mustLeaveOffensive, offensiveCount,
  ttwPostureCombatModifiers, turnsInPosture,
} from '../src/ttw/front-posture.ts'

// 批次 10 姿态规则层（§3.3c–e）：Offensive/Regrouping 二分、3/9 回合限制、最多 2 进攻、Regrouping 战斗收益。
const off = (sinceTurn) => ({ mode: 'offensive', sinceTurn })
const reg = (sinceTurn) => ({ mode: 'regrouping', sinceTurn })

test('posture change limits follow the 3/9 turn rule (§3.3e)', () => {
  assert.equal(turnsInPosture(off(10), 13), 3)
  assert.equal(canDesignateRegrouping(off(10), 12), false) // <3 turns
  assert.equal(canDesignateRegrouping(off(10), 13), true) // >=3
  assert.equal(mustLeaveOffensive(off(10), 18), false) // <9
  assert.equal(mustLeaveOffensive(off(10), 19), true) // >=9 must switch
  assert.equal(canDesignateOffensive(reg(10), 12), false)
  assert.equal(canDesignateOffensive(reg(10), 13), true)
  assert.equal(canDesignateOffensive(off(10), 20), false) // already offensive
})

test('at most two fronts may be offensive (§3.3c)', () => {
  const fronts = { a: off(1), b: off(1), c: reg(1), d: reg(1) }
  assert.equal(offensiveCount(fronts), 2)
  assert.equal(TTW_MAX_OFFENSIVE_FRONTS, 2)
  assert.equal(canAddOffensive(fronts, 'c', 10), false) // would be third
  assert.equal(canAddOffensive(fronts, 'a', 10), false) // already offensive
  const one = { a: off(1), c: reg(1) }
  assert.equal(canAddOffensive(one, 'c', 10), true)
})

test('regrouping benefit modifiers and barrage-marker gate (§3.3c/d, §3.4a)', () => {
  const benefit = ttwPostureCombatModifiers(true)
  assert.equal(benefit.defenderAr, 1)
  assert.equal(benefit.attackerAr, -2)
  assert.equal(benefit.freeDefensiveSupply, true)
  assert.equal(benefit.mayOwnArtilleryBarrage, false)
  assert.equal(benefit.defensiveBarrage, true)
  assert.equal(benefit.attackSupplyCap, 2)
  assert.equal(benefit.mayUseBarrageMarker, false)
  const none = ttwPostureCombatModifiers(false)
  assert.equal(none.defenderAr, 0)
  assert.equal(none.attackerAr, 0)
  assert.equal(none.freeDefensiveSupply, false)
  assert.equal(none.attackSupplyCap, null)
  assert.equal(TTW_DEFENSIVE_BARRAGE_COLUMN, '12-16')
  assert.equal(mayUseBarrageMarker(off(1)), true)
  assert.equal(mayUseBarrageMarker(reg(1)), false)
  assert.equal(mayUseBarrageMarker(undefined), false)
})