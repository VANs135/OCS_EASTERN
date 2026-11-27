// OCS v4.3 14.1-14.11. Ported from Smolensk 06a9faa
// src/engine/rules/air-mission.ts, trimmed to the common rule layer.
// Smolensk boxes/cargo and TTW scenario permissions stay with the work modules.

import { AIR_MISSION_MAX_AIRCRAFT, interceptionMissionEligible } from './air.ts'
import type { AirMissionKind } from './fire-timing.ts'
import type { Phase } from './turn.ts'
import type { Side } from './state-types.ts'

export { AIR_MISSION_MAX_AIRCRAFT }

/** 14.2f: the seven-step mission sequence, in rule order. */
export const AIR_MISSION_STEP_IDS = [
  'declare', 'move', 'airCombat', 'interception', 'flak', 'resolveMission', 'returnToBase',
] as const
export type AirMissionStep = (typeof AIR_MISSION_STEP_IDS)[number]

export const AIR_MISSION_SEQUENCE: readonly { step: AirMissionStep; rule: string; note: string }[] = [
  { step: 'declare', rule: '14.2f-A', note: 'declare the mission type' },
  { step: 'move', rule: '14.2f-B', note: 'fly from every base to the target; four aircraft maximum' },
  { step: 'airCombat', rule: '14.2f-C', note: 'resolve all air combat at the target' },
  { step: 'interception', rule: '14.2f-D', note: 'resolve every interception' },
  { step: 'flak', rule: '14.2f-E', note: 'resolve all Flak' },
  { step: 'resolveMission', rule: '14.2f-F', note: 'resolve the mission itself' },
  { step: 'returnToBase', rule: '14.2f-G', note: 'return to base, normally becoming inactive' },
]

export function airMissionStepIndex(step: AirMissionStep): number {
  return AIR_MISSION_STEP_IDS.indexOf(step)
}

/** 14.2f: no aircraft may be added after step C (air combat). */
export function canAddAircraftAtStep(step: AirMissionStep): boolean {
  return airMissionStepIndex(step) <= airMissionStepIndex('move')
}

/** 14.2a / 14.2f-B: adding one aircraft may not push the mission over four. */
export function canJoinMission(currentAircraft: number, adding = 1): boolean {
  return Number.isSafeInteger(currentAircraft) && Number.isSafeInteger(adding) &&
    currentAircraft >= 0 && adding >= 0 && currentAircraft + adding <= AIR_MISSION_MAX_AIRCRAFT
}

/** 14.1a / 14.2e: active aircraft fly; each aircraft flies at most once per phase. */
export const MISSIONS_PER_AIRCRAFT_PER_PHASE = 1

export function canFlyMission(active: boolean): boolean {
  return active
}

export function canPerformMissionThisPhase(missionsFlownThisPhase: number): boolean {
  return Number.isSafeInteger(missionsFlownThisPhase) && missionsFlownThisPhase >= 0 &&
    missionsFlownThisPhase < MISSIONS_PER_AIRCRAFT_PER_PHASE
}

/** 14.2e: each mission type belongs to a movement or barrage segment; interception is a response. */
export function airMissionSegmentOf(kind: AirMissionKind): 'movement' | 'barrage' | 'intercept-response' {
  if (kind === 'interception') return 'intercept-response'
  if (kind === 'barrage' || kind === 'trainbusting') return 'barrage'
  return 'movement'
}

/** 14.3d: voluntary return is barred once air combat begins, unless combat is fully over. */
export type AirCombatWindow = 'beforeAirCombat' | 'duringAirCombat' | 'afterAirCombat'

export function airVoluntaryReturnRefusal(facts: {
  window: AirCombatWindow
  friendlyActiveRemainingAfterReturn: number
}): string | null {
  if (facts.window === 'duringAirCombat') return 'air-return-during-combat'
  if (facts.window === 'beforeAirCombat' && facts.friendlyActiveRemainingAfterReturn < 1)
    return 'air-return-must-keep-one-active'
  return null
}

/** 14.5: interception is one fighter, once per mission, inside its patrol zone, against a Flak-affected mission. */
export function interceptionRefusal(facts: {
  missionKind: AirMissionKind
  missionHexInPatrolZone: boolean
  hasActiveFighterInPatrolZone: boolean
  alreadyIntercepted: boolean
}): string | null {
  if (facts.alreadyIntercepted) return 'air-mission-already-intercepted'
  if (!facts.missionHexInPatrolZone) return 'air-mission-outside-patrol-zone'
  if (!interceptionMissionEligible(facts.missionKind, facts.missionHexInPatrolZone))
    return 'air-mission-not-flak-affected'
  if (!facts.hasActiveFighterInPatrolZone) return 'air-no-active-fighter-in-patrol-zone'
  return null
}

/** 14.5: a winning interceptor returns active and is not charged with a mission; a loser returns inactive. */
export function interceptionPostCombatActive(interceptorWon: boolean): boolean {
  return interceptorWon
}

/** 14.5: a winning interceptor was not charged with a mission and may intercept again this phase. */
export function canInterceptAgainSamePhase(interceptorWon: boolean): boolean {
  return interceptorWon
}

/** 14.11: base transfer may use twice the printed range. */
export const BASE_TRANSFER_RANGE_MULTIPLIER = 2

/** 14.11: base transfer range is twice the printed range; only fighters inside normal range stay active. */
export function baseTransferResult(facts: {
  isFighter: boolean
  rangeHexes: number
  distanceHexes: number
}): { allowed: boolean; activeOnArrival: boolean; maximumDistance: number } {
  const maximumDistance = Math.max(0, facts.rangeHexes) * BASE_TRANSFER_RANGE_MULTIPLIER
  if (facts.distanceHexes > maximumDistance)
    return { allowed: false, activeOnArrival: false, maximumDistance }
  return {
    allowed: true,
    activeOnArrival: facts.isFighter && facts.distanceHexes <= facts.rangeHexes,
    maximumDistance,
  }
}

/** 14.2f-B target facts for the mission-type gate. */
export interface AirMissionTargetFacts {
  enemyGroundUnit: boolean
  enemyFacility: boolean
  enemyActiveAircraft: boolean
  enemyAirBase: boolean
  friendlyAirBase: boolean
  rail: boolean
}

/** 14.6-14.11: whether this mission type may target the hex at all. */
export function airMissionTargetTypeAllowed(kind: AirMissionKind, facts: AirMissionTargetFacts): boolean {
  switch (kind) {
    case 'barrage': return facts.enemyGroundUnit || facts.enemyFacility
    case 'hip-shoot': return facts.enemyGroundUnit
    case 'trainbusting': return facts.rail
    case 'transport':
    case 'base-transfer': return facts.friendlyAirBase
    case 'air-drop': return !facts.enemyGroundUnit
    case 'fighter-sweep': return facts.enemyActiveAircraft && facts.enemyAirBase
    case 'interception': return false
  }
}

export interface AirMissionAircraftFacts {
  id: string
  side: Side
  active: boolean
  steps: number
  missionsFlownThisPhase: number
  /** Printed range, already adjusted for the face in use. */
  rangeHexes: number
  distanceHexes: number
  barrageCapable: boolean
  fighter: boolean
  hipShootCapable?: boolean
  transportCapacity?: number
  /** Scenario Book availability: inclusive last turn, e.g. TTW Scenario 9. */
  availableThrough?: number
}

/** 14.1f / 14.2a / 14.2d / 14.2e / 14.5 / 14.7: one refusal reason for a proposed mission. */
export function airMissionLaunchRefusal(facts: {
  kind: AirMissionKind
  side: Side
  phase: Phase
  turn: number
  flight: 'normal' | 'limited' | 'none'
  aircraft: readonly AirMissionAircraftFacts[]
  targetFacts: AirMissionTargetFacts
}): string | null {
  const { kind, aircraft, targetFacts } = facts
  if (kind === 'interception') return 'air-interception-is-not-a-declared-mission'
  if (facts.flight === 'none') return 'air-weather-prohibits-flying'
  if (facts.flight === 'limited' && facts.phase !== 'movement') return 'air-limited-flight-movement-only'
  if (facts.flight === 'limited' && kind === 'hip-shoot') return 'air-limited-flight-no-hip-shoot'
  if (facts.phase !== 'movement' && facts.phase !== 'reaction' && facts.phase !== 'exploitation')
    return 'air-mission-phase-not-allowed'
  if (!aircraft.length) return 'air-no-aircraft'
  if (!canJoinMission(aircraft.length, 0)) return 'air-mission-aircraft-limit'
  if ((kind === 'hip-shoot' || kind === 'fighter-sweep') && aircraft.length !== 1)
    return 'air-single-aircraft-mission-required'
  if (!airMissionTargetTypeAllowed(kind, targetFacts)) return 'air-target-type-not-allowed'

  for (const plane of aircraft) {
    if (plane.side !== facts.side) return `air-aircraft-not-owned:${plane.id}`
    if (plane.steps <= 0) return `air-aircraft-eliminated:${plane.id}`
    if (!canFlyMission(plane.active)) return `air-aircraft-inactive:${plane.id}`
    if (!canPerformMissionThisPhase(plane.missionsFlownThisPhase))
      return `air-aircraft-already-flew:${plane.id}`
    if (plane.availableThrough !== undefined && facts.turn > plane.availableThrough)
      return `air-aircraft-not-available-this-turn:${plane.id}`
    const cargo = kind === 'transport' || kind === 'air-drop'
    if (plane.distanceHexes > plane.rangeHexes * (cargo ? 2 : 1))
      return `air-aircraft-out-of-range:${plane.id}`
  }

  if ((kind === 'barrage' || kind === 'trainbusting') && !aircraft.some((plane) => plane.barrageCapable))
    return 'air-no-barrage-capable-aircraft'
  if (kind === 'hip-shoot' && !aircraft.some((plane) => plane.hipShootCapable === true))
    return 'air-no-hip-shoot-capable-aircraft'
  if ((kind === 'transport' || kind === 'air-drop') &&
    !aircraft.some((plane) => (plane.transportCapacity ?? 0) > 0))
    return 'air-no-transport-capable-aircraft'
  if (kind === 'fighter-sweep' && !aircraft.some((plane) => plane.fighter))
    return 'air-no-air-combat-capable-aircraft'
  return null
}
