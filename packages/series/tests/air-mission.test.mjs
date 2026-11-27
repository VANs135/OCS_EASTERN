import assert from 'node:assert/strict'
import { test } from 'node:test'
import { flakAppliesToMission, flakDrm, flakKill } from '../src/air.ts'
import {
  AIR_MISSION_MAX_AIRCRAFT, AIR_MISSION_SEQUENCE, airMissionLaunchRefusal, airMissionSegmentOf,
  airMissionStepIndex, airMissionTargetTypeAllowed, airVoluntaryReturnRefusal, baseTransferResult,
  canAddAircraftAtStep, canFlyMission, canJoinMission, canPerformMissionThisPhase,
  interceptionPostCombatActive, interceptionRefusal,
} from '../src/air-mission.ts'

const crew = (id, extra = {}) => ({
  id, side: 'soviet', active: true, steps: 2, missionsFlownThisPhase: 0, rangeHexes: 10, distanceHexes: 5,
  barrageCapable: true, fighter: true, hipShootCapable: false, transportCapacity: 0, ...extra,
})
const target = (extra = {}) => ({
  enemyGroundUnit: true, enemyFacility: false, enemyActiveAircraft: false, enemyAirBase: false,
  friendlyAirBase: false, rail: false, ...extra,
})
const launch = (extra = {}) => ({
  kind: 'barrage', side: 'soviet', phase: 'movement', turn: 1, flight: 'normal',
  aircraft: [crew('a')], targetFacts: target(), ...extra,
})

test('14.2f keeps the seven steps in order and freezes the mission after step C', () => {
  assert.equal(AIR_MISSION_MAX_AIRCRAFT, 4)
  assert.equal(airMissionStepIndex('declare'), 0)
  assert.equal(airMissionStepIndex('returnToBase'), 6)
  assert.deepEqual(AIR_MISSION_SEQUENCE.map(({ step }) => step),
    ['declare', 'move', 'airCombat', 'interception', 'flak', 'resolveMission', 'returnToBase'])
  assert.equal(canAddAircraftAtStep('move'), true)
  assert.equal(canAddAircraftAtStep('airCombat'), false)
  assert.equal(canJoinMission(3), true)
  assert.equal(canJoinMission(4), false)
})

test('14.1-14.2 aircraft must be active and unused, with at most four in the mission', () => {
  assert.equal(canFlyMission(true), true)
  assert.equal(canFlyMission(false), false)
  assert.equal(canPerformMissionThisPhase(0), true)
  assert.equal(canPerformMissionThisPhase(1), false)
  assert.equal(airMissionLaunchRefusal(launch({ aircraft: [] })), 'air-no-aircraft')
  assert.equal(airMissionLaunchRefusal(launch({ aircraft: Array.from({ length: 5 }, (_, i) => crew(`p${i}`)) })), 'air-mission-aircraft-limit')
  assert.equal(airMissionLaunchRefusal(launch({ aircraft: [crew('a', { active: false })] })), 'air-aircraft-inactive:a')
  assert.equal(airMissionLaunchRefusal(launch({ aircraft: [crew('a', { missionsFlownThisPhase: 1 })] })), 'air-aircraft-already-flew:a')
  assert.equal(airMissionLaunchRefusal(launch({ aircraft: [crew('a', { distanceHexes: 11 })] })), 'air-aircraft-out-of-range:a')
})

test('14.1f / 1.5 weather gates: no flight blocks all, limited flight only allows movement', () => {
  assert.equal(airMissionLaunchRefusal(launch({ flight: 'none' })), 'air-weather-prohibits-flying')
  assert.equal(airMissionLaunchRefusal(launch({ flight: 'limited', phase: 'reaction' })), 'air-limited-flight-movement-only')
  assert.equal(airMissionLaunchRefusal(launch({ flight: 'limited', kind: 'hip-shoot', aircraft: [crew('a', { hipShootCapable: true })] })), 'air-limited-flight-no-hip-shoot')
  assert.equal(airMissionLaunchRefusal(launch({ flight: 'limited', kind: 'barrage' })), null)
  assert.equal(airMissionLaunchRefusal(launch({ phase: 'combat' })), 'air-mission-phase-not-allowed')
})

test('14.6-14.11 target types and mission abilities are type-specific', () => {
  assert.equal(airMissionTargetTypeAllowed('barrage', target({ enemyGroundUnit: false, enemyFacility: true })), true)
  assert.equal(airMissionTargetTypeAllowed('hip-shoot', target({ enemyGroundUnit: false })), false)
  assert.equal(airMissionTargetTypeAllowed('trainbusting', target({ rail: true })), true)
  assert.equal(airMissionTargetTypeAllowed('transport', target({ friendlyAirBase: true })), true)
  assert.equal(airMissionTargetTypeAllowed('air-drop', target({ enemyGroundUnit: false })), true)
  assert.equal(airMissionTargetTypeAllowed('fighter-sweep', target({ enemyActiveAircraft: true, enemyAirBase: true })), true)
  assert.equal(airMissionSegmentOf('barrage'), 'barrage')
  assert.equal(airMissionSegmentOf('trainbusting'), 'barrage')
  assert.equal(airMissionSegmentOf('fighter-sweep'), 'movement')
  assert.equal(airMissionSegmentOf('interception'), 'intercept-response')
  assert.equal(airMissionLaunchRefusal(launch({ kind: 'hip-shoot', aircraft: [crew('a', { hipShootCapable: true })] })), null)
  assert.equal(airMissionLaunchRefusal(launch({ kind: 'hip-shoot', aircraft: [crew('a'), crew('b')] })), 'air-single-aircraft-mission-required')
  assert.equal(airMissionLaunchRefusal(launch({ kind: 'fighter-sweep', aircraft: [crew('a', { fighter: false })],
    targetFacts: target({ enemyGroundUnit: false, enemyActiveAircraft: true, enemyAirBase: true }) })), 'air-no-air-combat-capable-aircraft')
})

test('scenario availability is an inclusive last turn and blocks later sorties', () => {
  const plane = crew('a', { availableThrough: 3 })
  assert.equal(airMissionLaunchRefusal(launch({ aircraft: [plane], turn: 3 })), null)
  assert.equal(airMissionLaunchRefusal(launch({ aircraft: [plane], turn: 4 })), 'air-aircraft-not-available-this-turn:a')
})

test('14.3d voluntary return windows: keep one active before combat, none during combat, free afterwards', () => {
  assert.equal(airVoluntaryReturnRefusal({ window: 'beforeAirCombat', friendlyActiveRemainingAfterReturn: 1 }), null)
  assert.equal(airVoluntaryReturnRefusal({ window: 'beforeAirCombat', friendlyActiveRemainingAfterReturn: 0 }), 'air-return-must-keep-one-active')
  assert.equal(airVoluntaryReturnRefusal({ window: 'duringAirCombat', friendlyActiveRemainingAfterReturn: 2 }), 'air-return-during-combat')
  assert.equal(airVoluntaryReturnRefusal({ window: 'afterAirCombat', friendlyActiveRemainingAfterReturn: 0 }), null)
})

test('14.5 interception needs a Flak-affected mission, a patrol zone and an unused fighter', () => {
  assert.equal(flakAppliesToMission('barrage', false), true)
  assert.equal(flakAppliesToMission('transport', false), false)
  assert.equal(flakAppliesToMission('transport', true), true)
  assert.equal(flakAppliesToMission('fighter-sweep', true), false)
  assert.equal(interceptionRefusal({ missionKind: 'barrage', missionHexInPatrolZone: true, hasActiveFighterInPatrolZone: true, alreadyIntercepted: false }), null)
  assert.equal(interceptionRefusal({ missionKind: 'barrage', missionHexInPatrolZone: false, hasActiveFighterInPatrolZone: true, alreadyIntercepted: false }), 'air-mission-outside-patrol-zone')
  assert.equal(interceptionRefusal({ missionKind: 'barrage', missionHexInPatrolZone: true, hasActiveFighterInPatrolZone: false, alreadyIntercepted: false }), 'air-no-active-fighter-in-patrol-zone')
  assert.equal(interceptionRefusal({ missionKind: 'barrage', missionHexInPatrolZone: true, hasActiveFighterInPatrolZone: true, alreadyIntercepted: true }), 'air-mission-already-intercepted')
  assert.equal(interceptionPostCombatActive(true), true)
  assert.equal(interceptionPostCombatActive(false), false)
})

test('14.11 base transfer doubles range; only fighters inside normal range stay active', () => {
  assert.equal(baseTransferResult({ isFighter: true, rangeHexes: 10, distanceHexes: 10 }).activeOnArrival, true)
  assert.equal(baseTransferResult({ isFighter: true, rangeHexes: 10, distanceHexes: 15 }).activeOnArrival, false)
  assert.equal(baseTransferResult({ isFighter: false, rangeHexes: 10, distanceHexes: 5 }).activeOnArrival, false)
  assert.equal(baseTransferResult({ isFighter: true, rangeHexes: 10, distanceHexes: 21 }).allowed, false)
})

test('14.4e Flak DRM and kill threshold', () => {
  assert.equal(flakDrm({ missionAircraftCount: 3, targetHasHq: true, airBaseLevel: 2, inEnemyPatrolZone: true, missionHasFighter: true }), 5)
  assert.equal(flakDrm({ missionAircraftCount: 1, targetHasHq: false, airBaseLevel: 0, baseIsAirstrip: true, inEnemyPatrolZone: false }), 0)
  assert.equal(flakDrm({ missionAircraftCount: 1, inEnemyPatrolZone: true, missionHasFighter: false, trainbustingInPatrolZone: true }), 3)
  assert.equal(flakKill(11), true)
  assert.equal(flakKill(10), false)
})
