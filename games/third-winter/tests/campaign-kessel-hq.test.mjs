import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  KESSEL_FREE_MOVE_MAX_HEXES, kesselDefenseStrength, kesselFreeMovePath, kesselFreeMoveUnitEligible,
  kesselPlacementValid, kesselReturnTurn,
} from '../src/ttw/kessel-hq.ts'

// TTW §2.3a Kessel HQ：返回计时/放置/防御值/免费移动限制。
const step = (over = {}) => ({ costAll: false, unbridgedVolga: false, unnegatedEzoc: false, ...over })
const west = { startEast: 10, endEast: 6 }

test('Kessel return timing, placement gate and defense strength (§2.3a)', () => {
  assert.equal(kesselReturnTurn(5), 8)
  assert.equal(kesselPlacementValid({ axisReinforcementPhase: true, withFriendlyCombatUnit: true }), true)
  assert.equal(kesselPlacementValid({ axisReinforcementPhase: false, withFriendlyCombatUnit: true }), false)
  assert.equal(kesselPlacementValid({ axisReinforcementPhase: true, withFriendlyCombatUnit: false }), false)
  assert.equal(kesselDefenseStrength('combat'), 2)
  assert.equal(kesselDefenseStrength('move'), 1)
})

test('free move requires combat/move mode with Leg MA (§2.3a B)', () => {
  assert.equal(kesselFreeMoveUnitEligible({ mode: 'combat', mobility: 'leg' }), true)
  assert.equal(kesselFreeMoveUnitEligible({ mode: 'move', mobility: 'leg' }), true)
  assert.equal(kesselFreeMoveUnitEligible({ mode: 'reserve', mobility: 'leg' }), false)
  assert.equal(kesselFreeMoveUnitEligible({ mode: 'combat', mobility: 'track' }), false)
})

test('free move path obeys the four-hex cap, stop rules and westward limit (§2.3a B)', () => {
  assert.equal(KESSEL_FREE_MOVE_MAX_HEXES, 4)
  assert.equal(kesselFreeMovePath([step(), step(), step(), step()], west).ok, true)
  assert.equal(kesselFreeMovePath([step(), step(), step(), step(), step()], west).reason, 'kessel-free-move-max-4-hexes')
  assert.equal(kesselFreeMovePath([step({ unnegatedEzoc: true }), step()], west).reason, 'kessel-free-move-must-stop')
  assert.equal(kesselFreeMovePath([step(), step({ unnegatedEzoc: true })], west).ok, true) // 末格停
  assert.equal(kesselFreeMovePath([step(), step({ costAll: true })], west).ok, true)
  assert.equal(kesselFreeMovePath([step({ unbridgedVolga: true })], west).reason, 'kessel-free-move-cannot-cross-volga')
  assert.equal(kesselFreeMovePath([step()], { startEast: 6, endEast: 10 }).reason, 'kessel-free-move-no-further-east')
  assert.equal(kesselFreeMovePath([step()], { startEast: 6, endEast: 6 }).ok, true)
})