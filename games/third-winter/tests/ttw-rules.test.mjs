import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { automaticSovietConversion } from '../src/ttw/campaign/rail.ts'
import { canMoveAcrossPontoonFerry, canTransportAtKherson } from '../src/ttw/campaign/crossings.ts'
import { mayRetainInitiative, retentionAfterRoll } from '../src/ttw/scorpion/initiative.ts'
import { sovietMissionRestriction } from '../src/ttw/air/mission-permission.ts'
import { interruptAfterMovementStep, answerBridgeInterruption } from '../src/match/bridge-interruption.ts'
import { bridgeRepairProgress, completeBridgeRepair, resetBridgeRepairOnEnemyOccupation } from '../src/ttw/campaign/bridge-repair.ts'
import { canPlaceKessel, kesselReturnAfterRemoval } from '../src/ttw/axis/kessel.ts'

test('TTW 1.2 / Q01 snapshot excludes Kessel supply and prevents cascades', () => {
  const railway = [
    {id: 'a', gauge: 'soviet', railNeighbors: ['b']},
    {id: 'b', gauge: 'german', railNeighbors: ['a', 'c']},
    {id: 'c', gauge: 'german', railNeighbors: ['b']},
    {id: 'd', gauge: 'german', railNeighbors: ['a']},
    {id: 'e', gauge: 'soviet', railNeighbors: ['f']},
    {id: 'f', gauge: 'german', railNeighbors: ['e']},
  ]
  const enemies = [{hex: 'b', suppliedByKessel: true}, {hex: 'z', suppliedByKessel: false}]
  const distance = (a) => a === 'd' ? 20 : 21
  assert.deepEqual(automaticSovietConversion(railway, new Set(['a']), enemies, distance), ['b'])
  assert.equal(railway[1].gauge, 'german')
})

test('TTW 1.4a bridge response survives serialization and consumes the first opportunity', () => {
  const bridge = { id: 'bridge', ends: ['a', 'b'], condition: 'intact', firstApproach: 'unseen' }
  const state = { bridges: [bridge], queue: [], continuation: null }
  const unit = { side: 'soviet', combat: true }
  assert.equal(interruptAfterMovementStep(state, {...unit, combat: false}, 'a', 'move:1'), state)
  const waiting = interruptAfterMovementStep(state, unit, 'a', 'move:1')
  const restored = JSON.parse(JSON.stringify(waiting))
  assert.throws(() => answerBridgeInterruption(restored, 'soviet', 'bridge', 'destroy'), /seat/)
  for (const choice of ['destroy', 'decline']) {
    const result = answerBridgeInterruption(restored, 'axis', 'bridge', choice)
    assert.equal(result.resume, 'move:1')
    assert.equal(result.state.bridges[0].condition, choice === 'destroy' ? 'destroyed' : 'intact')
    assert.equal(interruptAfterMovementStep(result.state, unit, 'b', 'move:2'), result.state)
    assert.throws(() => answerBridgeInterruption(result.state, 'axis', 'bridge', choice), /seat/)
  }
})

test('TTW 1.4d and 1.5a check endpoint, cargo, conditions and shared RE', () => {
  const rail = { from: 'D15.03', to: 'D14.03', beginsAtEndpoint: true, river: 'normal',
    enemyZoc: false, cargo: 'move-mode-unit', usedRe: 1, cargoRe: 2 }
  assert.equal(canTransportAtKherson(rail), true)
  assert.equal(canTransportAtKherson({...rail, enemyZoc: true}), false)
  assert.equal(canTransportAtKherson({...rail, cargoRe: 2.25}), false)
  const ferry = { side: 'soviet', owner: 'soviet', river: 'normal', mobility: 'leg',
    usedReOnHexside: 2, crossingRe: 1, ownDeployingPontoon: false }
  assert.equal(canMoveAcrossPontoonFerry(ferry), true)
  assert.equal(canMoveAcrossPontoonFerry({...ferry, river: 'ice'}), false)
  assert.equal(canMoveAcrossPontoonFerry({...ferry, crossingRe: 2}), false)
})

test('TTW 3.2 / Q08 independent aircraft can sweep using a regrouping HQ as range anchor', () => {
  const commands = [{airArmy: '2', posture: 'regrouping', frontDistance: 15, airArmyDistance: 30}]
  assert.equal(sovietMissionRestriction('fighter-sweep', [{airArmy: null}], {kind: 'fronts', commands}), null)
  assert.equal(sovietMissionRestriction('fighter-sweep', [{airArmy: '2'}], {kind: 'fronts', commands}), 'ttw:3.2d')
  assert.equal(sovietMissionRestriction('facility-barrage', [{airArmy: '2'}], {kind: 'fronts', commands}), null)
  assert.equal(sovietMissionRestriction('hip-shoot', [{airArmy: null}], {kind: 'scorpion', column: 1}), 'ttw:3.2a')
  assert.equal(sovietMissionRestriction('fighter-sweep', [{airArmy: '5'}], {kind: 'scorpion', column: 8}), 'ttw:scenario-8:p53')
})

test('Scorpion initiative may transfer from Soviet to Axis once and requires an on-map SP', () => {
  assert.equal(mayRetainInitiative(1, 'soviet', 'soviet', 2), false)
  assert.equal(mayRetainInitiative(2, 'soviet', 'soviet', 1), true)
  assert.equal(mayRetainInitiative(2, 'soviet', 'soviet', 0.75), false)
  assert.equal(retentionAfterRoll('soviet', 'axis'), 'axis')
  assert.equal(retentionAfterRoll('axis', 'axis'), 'closed')
  assert.equal(retentionAfterRoll('closed', 'soviet'), 'closed')
})

test('TTW 1.5b repairs after four work phases and enemy occupation erases progress', () => {
  const bridge = {id: 'bridge', ends: ['a', 'b'], condition: 'destroyed', firstApproach: 'resolved'}
  const work = {completedMovementPhases: 3, combatModePontoonAtEndpointThroughout: true,
    enemyCombatAdjacentToPontoon: false, enemyAttackCapableAtEndpoint: false}
  const progress = bridgeRepairProgress(bridge, work)
  assert.equal(progress, 4)
  assert.equal(completeBridgeRepair(bridge, 3), bridge)
  assert.equal(completeBridgeRepair(bridge, progress).condition, 'repaired')
  assert.equal(bridgeRepairProgress(bridge, {...work, enemyCombatAdjacentToPontoon: true}), 3)
  assert.equal(bridgeRepairProgress(bridge, {...work, enemyAttackCapableAtEndpoint: true}), 0)
  assert.equal(resetBridgeRepairOnEnemyOccupation(3, true), 0)
})

test('TTW 2.3a / Q05 Kessel remains available in the box after the first eligible turn', () => {
  const reserve = kesselReturnAfterRemoval(5)
  assert.equal(canPlaceKessel(reserve, 7, true), false)
  assert.equal(canPlaceKessel(reserve, 8, true), true)
  assert.equal(canPlaceKessel(reserve, 12, true), true)
  assert.equal(canPlaceKessel(reserve, 12, false), false)
})
