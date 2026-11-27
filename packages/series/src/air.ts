// OCS v4.3 14.4e / 15.0b. Ported from Smolensk 06a9faa
// src/engine/rules/air.ts. Work-specific aircraft abilities remain with the caller.

import { airbaseAaValue } from './airbase.ts'
import type { AirMissionKind } from './fire-timing.ts'

/** 14.2a / 14.2f-B: at most four aircraft in one mission. */
export const AIR_MISSION_MAX_AIRCRAFT = 4
/** 14.5: a patrol zone reaches ten hexes from the fighter's base. */
export const AIR_PATROL_ZONE_HEXES = 10
/** 14.4e: a modified 2d6 of 11 or more kills one mission aircraft. */
export const FLAK_KILL_MINIMUM = 11

export const FLAK_APPLIES = {
  always: ['barrage', 'hip-shoot', 'trainbusting'] as const satisfies readonly AirMissionKind[],
  onlyInPatrolZone: ['transport', 'air-drop', 'base-transfer'] as const satisfies readonly AirMissionKind[],
  never: ['fighter-sweep', 'interception'] as const satisfies readonly AirMissionKind[],
}

/** 14.4e: the mission is subject to Flak now, given where its target lies. */
export function flakAppliesToMission(mission: AirMissionKind, inEnemyPatrolZone: boolean): boolean {
  if (FLAK_APPLIES.always.includes(mission as (typeof FLAK_APPLIES.always)[number])) return true
  if (FLAK_APPLIES.onlyInPatrolZone.includes(mission as (typeof FLAK_APPLIES.onlyInPatrolZone)[number]))
    return inEnemyPatrolZone
  return false
}

export interface FlakDrmFacts {
  /** 14.4e: three or more aircraft in the mission add one. */
  missionAircraftCount: number
  /** 14.4e: an HQ in the target hex adds one. */
  targetHasHq: boolean
  /** 15.0b-B: target air-base level; airstrips contribute zero. */
  airBaseLevel?: number
  baseIsAirstrip?: boolean
  /** Printed map Flak value, if any. */
  printedFlakValue?: number
  /** 14.4e: the patrol-zone modifiers apply only when the target is in an enemy patrol zone. */
  inEnemyPatrolZone: boolean
  /** 14.4e: +1 if the mission has a fighter, +2 if it has none. */
  missionHasFighter?: boolean
  /** 14.4e: trainbusting inside an enemy patrol zone adds one more. */
  trainbustingInPatrolZone?: boolean
}

/** 14.4e: total Flak DRM, before rolling 2d6. */
export function flakDrm(facts: FlakDrmFacts): number {
  let drm = 0
  if (facts.missionAircraftCount >= 3) drm += 1
  if (facts.targetHasHq) drm += 1
  drm += airbaseAaValue(facts.airBaseLevel ?? 0, facts.baseIsAirstrip === true)
  if (facts.printedFlakValue) drm += facts.printedFlakValue
  if (facts.inEnemyPatrolZone) drm += facts.missionHasFighter ? 1 : 2
  if (facts.trainbustingInPatrolZone) drm += 1
  return drm
}

/** 14.4e: 11 or more on the modified 2d6 kills one aircraft. */
export function flakKill(modified2d6: number): boolean {
  return modified2d6 >= FLAK_KILL_MINIMUM
}

/** 14.5: only Flak-affected missions can be intercepted, and only inside a patrol zone. */
export function interceptionMissionEligible(
  mission: AirMissionKind,
  missionHexInPatrolZone: boolean,
): boolean {
  return missionHexInPatrolZone && flakAppliesToMission(mission, missionHexInPatrolZone)
}
