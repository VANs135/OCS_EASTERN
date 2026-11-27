// OCS v4.3 14.2f / 14.4e / 14.7 / 14.8. Campaign-level air strike flow for
// scenarios whose aircraft are off-map support and have no fighter opposition
// (TTW Scenario 9). Air combat, interception, transport, air drop and base
// transfer remain separate work; the launch gate refuses those target states
// instead of silently skipping them.

import { allowsBarrageSource, airMissionSegments } from '@ocs-eastern/series/fire-timing'
import { airbaseAaValue } from '@ocs-eastern/series/airbase'
import { airMissionLaunchRefusal, airMissionTargetCandidates } from '@ocs-eastern/series/air-mission'
import type { AirMissionTargetFacts, AirMissionTargetHexFacts, AirMissionAircraftFacts } from '@ocs-eastern/series/air-mission'
import type { FlakDrmFacts } from '@ocs-eastern/series/air'
import { flakDrm, flakKill } from '@ocs-eastern/series/air'
import { roll2d6, rollDie } from '@ocs-eastern/series/rng'
import type { DiceRoll, Side } from '@ocs-eastern/series/state-types'
import type { AirMissionKind } from '@ocs-eastern/series/fire-timing'
import { flakLossCandidates } from '@ocs-eastern/series/tables/air'
import { barrageColumn } from '@ocs-eastern/series/tables/barrage'
import type { BarrageTable } from '@ocs-eastern/series/tables/barrage'
import type { Phase } from '@ocs-eastern/series/turn'
import type { CampaignBarrage } from './campaign-barrage.ts'
import type { CampaignBarrageBoard } from './campaign-barrage.ts'
import type { CampaignCounter } from './campaign-reinforcement-state.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export type CampaignAirStrikeKind = Extract<AirMissionKind, 'barrage' | 'hip-shoot'>

export interface CampaignAirStrikeProfile {
  /** Printed range in hexes; off-map box flights may use a scenario override. */
  rangeHexes: number
  printedSteps: number
  airCombat: number
  bombing: number
  fighter: boolean
  hipShoot: boolean
  tankBuster: boolean
}

export interface CampaignAirStrikeBoard extends Pick<CampaignBarrageBoard, 'map' | 'table' | 'distance' | 'hedgehogAt'> {
  /** On-map hexes exposed for candidate lists; omitted leaves target enumeration unavailable. */
  targetHexes?: readonly string[]
  airProfileOf(state: Readonly<CampaignTurnState>, id: string): CampaignAirStrikeProfile | undefined
  /** 09 special rule: off-map air units reach every map hex. */
  rangeHexes?(state: Readonly<CampaignTurnState>, id: string): number | undefined
  /** Printed Flak value / AA DRM in a target hex; side filters out friendly AA. */
  flakValueAt?(state: Readonly<CampaignTurnState>, hex: string, side?: Side): number | undefined
  patrolZone?(state: Readonly<CampaignTurnState>, side: Side, hex: string): boolean
  railAt?(state: Readonly<CampaignTurnState>, hex: string): boolean
  facilityAt?(state: Readonly<CampaignTurnState>, hex: string): boolean
  /** TTW 3.2a/c/d, 3.2b and scenario restrictions; return a stable reason or null. */
  workRefusal?(state: Readonly<CampaignTurnState>, request: {
    kind: CampaignAirStrikeKind; side: Side; targetHex: string; aircraftIds: readonly string[]
  }): string | null
  /** Scenario 9: all air units return to their off-map box and may refit without SP. */
  returnLocation?(state: Readonly<CampaignTurnState>, id: string): CampaignCounter['location'] | undefined
}

export type CampaignAirMissionBoard = CampaignAirStrikeBoard

export interface CampaignAirFlight {
  id: string
  origin: CampaignCounter['location']
  distanceHexes: number
  normalRange: boolean
  printedSteps: number
}

export type CampaignAirMissionStep =
  | { kind: 'flak' }
  | { kind: 'flak-loss'; candidates: readonly string[] }
  | { kind: 'barrage' }

export interface CampaignAirMission {
  id: string
  kind: CampaignAirStrikeKind
  side: Side
  targetHex: string
  flights: readonly CampaignAirFlight[]
  step: CampaignAirMissionStep
  flak?: { dice: DiceRoll; modifier: number; lossDie?: number; lossId?: string }
}

export type CampaignAirMissionRecord = Omit<CampaignAirMission, 'step'> & {
  turn: number
  phasing: Side
  phase: Phase
}

export type CampaignAirMissionAction =
  | { type: 'launch-campaign-air-strike'; kind: CampaignAirStrikeKind; targetHex: string; aircraftIds: readonly string[] }
  | { type: 'resolve-campaign-air-flak' }
  | { type: 'choose-campaign-air-flak-loss'; unitId: string }
  | { type: 'complete-campaign-air-strike' }

type LaunchAction = Extract<CampaignAirMissionAction, { type: 'launch-campaign-air-strike' }>

function opponent(side: Side): Side {
  return side === 'axis' ? 'soviet' : 'axis'
}

function sameHex(a: string, b: string) {
  return a === b
}

function atTarget(state: Readonly<CampaignTurnState>, side: Side, hex: string) {
  return Object.entries(state.counters).filter(([, counter]) =>
    counter.side === side && counter.location.kind === 'map' && sameHex(counter.location.hex, hex))
}

function targetFacts(state: Readonly<CampaignTurnState>, side: Side, hex: string, board: CampaignAirStrikeBoard): AirMissionTargetFacts {
  const enemy = opponent(side)
  const enemyUnits = atTarget(state, enemy, hex)
  const friendlyAirBase = (state.airBases ?? []).some((base) => base.side === side && base.hex === hex)
  return {
    enemyGroundUnit: enemyUnits.some(([, counter]) => counter.kind === 'land' || counter.kind === 'hq'),
    enemyFacility: !enemyUnits.some(([, counter]) => counter.kind === 'land' || counter.kind === 'hq') &&
      (board.facilityAt?.(state, hex) ?? false),
    enemyActiveAircraft: enemyUnits.some(([, counter]) => counter.kind === 'aircraft' && counter.active === true),
    enemyAirBase: (state.airBases ?? []).some((base) => base.side === enemy && base.hex === hex),
    friendlyAirBase,
    rail: board.railAt?.(state, hex) ?? false,
  }
}

/**
 * Enumerate hexes this 09 air-strike board permits for a mission type.
 * The candidate list is a UI/selection helper; launch still performs the
 * full phase, weather, aircraft and Flak checks. Aircraft with active enemy
 * air or an airbase are excluded because this scenario has no air combat.
 */
export function campaignAirStrikeTargetCandidates(state: Readonly<CampaignTurnState>, side: Side,
  board: CampaignAirStrikeBoard, kind: CampaignAirStrikeKind): string[] {
  if (!board.targetHexes?.length) return []
  const hexes: AirMissionTargetHexFacts[] = board.targetHexes.map((hex) => ({ hex, ...targetFacts(state, side, hex, board) }))
  return airMissionTargetCandidates({
    kind,
    hexes,
    reachable: (hex) => {
      const facts = targetFacts(state, side, hex, board)
      return board.map.resolveHex(hex) === hex && !facts.enemyActiveAircraft && !facts.enemyAirBase
    },
  })
}

function airProfile(state: Readonly<CampaignTurnState>, id: string, board: CampaignAirStrikeBoard) {
  const counter = Object.hasOwn(state.counters, id) ? state.counters[id] : undefined
  const profile = board.airProfileOf(state, id)
  if (!counter || counter.kind !== 'aircraft' || counter.location.kind === 'dead-pile' || !profile) return undefined
  return { counter, profile }
}

function survivingProfiles(state: Readonly<CampaignTurnState>, mission: CampaignAirMission, board: CampaignAirStrikeBoard) {
  return mission.flights.flatMap(({ id }) => {
    const found = airProfile(state, id, board)
    return found ? [found.profile] : []
  })
}

function phaseMissions(state: Readonly<CampaignTurnState>) {
  const { cursor } = state
  if (!('phasing' in cursor)) return []
  return (state.airHistory ?? []).filter((record) => record.turn === state.turn &&
    record.phasing === cursor.phasing && record.phase === cursor.phase)
}

function missionsFlown(state: Readonly<CampaignTurnState>, id: string) {
  return phaseMissions(state).filter((record) => record.flights.some((flight) => flight.id === id)).length
}

function distance(state: Readonly<CampaignTurnState>, id: string, target: string, board: CampaignAirStrikeBoard) {
  const flight = airProfile(state, id, board)
  if (!flight) return undefined
  // Scenario 9 reaches every map hex from its off-map box; otherwise a box has no measurable map distance.
  if (flight.counter.location.kind === 'box')
    return board.rangeHexes?.(state, id) === undefined ? undefined : 0
  if (flight.counter.location.kind !== 'map') return undefined
  return board.distance(flight.counter.location.hex, target)
}

function rangeOf(state: Readonly<CampaignTurnState>, id: string, board: CampaignAirStrikeBoard) {
  return board.rangeHexes?.(state, id) ?? board.airProfileOf(state, id)?.rangeHexes
}

function missionFlightFacts(state: Readonly<CampaignTurnState>, action: LaunchAction, board: CampaignAirStrikeBoard): AirMissionAircraftFacts[] {
  const target = board.map.resolveHex(action.targetHex)
  if (!target) throw new Error('Choose an on-map air target')
  if (new Set(action.aircraftIds).size !== action.aircraftIds.length || !action.aircraftIds.length)
    throw new Error('Choose distinct aircraft')
  return action.aircraftIds.map((id) => {
    const found = airProfile(state, id, board)
    if (!found) throw new Error(`Air strike aircraft is unavailable: ${id}`)
    const { counter, profile } = found
    const distanceHexes = distance(state, id, target, board)
    const rangeHexes = rangeOf(state, id, board)
    if (distanceHexes === undefined || rangeHexes === undefined) throw new Error(`Air strike range is unavailable: ${id}`)
    return {
      id, side: counter.side, active: counter.active === true,
      steps: profile.printedSteps - (counter.stepsLost ?? 0),
      missionsFlownThisPhase: missionsFlown(state, id),
      rangeHexes, distanceHexes,
      barrageCapable: profile.bombing >= 1,
      fighter: profile.fighter,
      hipShootCapable: profile.hipShoot,
      availableThrough: counter.availableThrough,
    }
  })
}

function weatherFlight(state: Readonly<CampaignTurnState>): 'normal' | 'limited' | 'none' {
  if (!state.weather) throw new Error('Weather has not been determined')
  return state.weather.flight ?? 'none'
}

function flakFacts(state: Readonly<CampaignTurnState>, mission: CampaignAirMission, board: CampaignAirStrikeBoard): FlakDrmFacts {
  const target = mission.targetHex
  const targetCounters = atTarget(state, opponent(mission.side), target)
  const baseLevel = (state.airBases ?? []).find((base) => base.hex === target)?.level ?? 0
  const inEnemyPatrolZone = board.patrolZone?.(state, opponent(mission.side), target) ?? false
  const missionHasFighter = mission.flights.some((flight) => board.airProfileOf(state, flight.id)?.fighter === true)
  return {
    missionAircraftCount: mission.flights.length,
    targetHasHq: targetCounters.some(([, counter]) => counter.kind === 'hq'),
    airBaseLevel: baseLevel,
    printedFlakValue: board.flakValueAt?.(state, target, opponent(mission.side)),
    inEnemyPatrolZone,
    missionHasFighter,
    trainbustingInPatrolZone: false,
    baseIsAirstrip: false,
  }
}

function strikeBarrage(state: Readonly<CampaignTurnState>, mission: CampaignAirMission, board: CampaignAirStrikeBoard): CampaignBarrage {
  const profiles = survivingProfiles(state, mission, board)
  const tankBuster = profiles.some((profile) => profile.tankBuster)
  const strength = profiles.reduce((sum, profile) => sum + (tankBuster && !profile.tankBuster ? 0 : profile.bombing), 0)
  if (strength < 1) throw new Error('An air strike needs at least one bombing point')
  const { initialColumn } = barrageColumn(board.table as BarrageTable, strength)
  const hedgehog = board.hedgehogAt(state, mission.targetHex)
  if (!Number.isInteger(hedgehog) || hedgehog < 0 || hedgehog > 4) throw new Error('Invalid hedgehog level')
  return {
    target: mission.targetHex, defender: opponent(mission.side), batteries: [], strength, initialColumn,
    cost: 0, hedgehog, air: { missionId: mission.id, kind: mission.kind, hipShoot: mission.kind === 'hip-shoot',
      tankBuster, shortRange: mission.flights.every((flight) => flight.normalRange) },
  }
}

function beginBarrage(state: Readonly<CampaignTurnState>, mission: CampaignAirMission, board: CampaignAirStrikeBoard) {
  if (!survivingProfiles(state, mission, board).length)
    return { ...state, airMission: { ...mission, step: { kind: 'barrage' as const } }, barrage: null }
  return { ...state, airMission: { ...mission, step: { kind: 'barrage' as const } }, barrage: strikeBarrage(state, mission, board) }
}

function applyFlakLoss(state: Readonly<CampaignTurnState>, mission: CampaignAirMission, id: string) {
  const counter = state.counters[id]
  const flight = mission.flights.find((item) => item.id === id)
  if (!counter || !flight) throw new Error('Flak loss aircraft is unavailable')
  const lost = (counter.stepsLost ?? 0) + 1
  const destroyed = lost >= flight.printedSteps
  return { ...state, counters: { ...state.counters, [id]: destroyed
    ? { ...counter, location: { kind: 'dead-pile' as const }, active: false }
    : { ...counter, stepsLost: lost } }, airMission: { ...mission,
      flak: { ...mission.flak!, lossId: id } } }
}

function afterFlak(state: Readonly<CampaignTurnState>, mission: CampaignAirMission, board: CampaignAirStrikeBoard) {
  const facts = flakFacts(state, mission, board)
  const modifier = flakDrm(facts)
  const rolled = roll2d6(state.rng)
  const dice = rolled.value
  const pending = { ...state, rng: rolled.rng, airMission: { ...mission,
    flak: { dice, modifier } } }
  if (!flakKill((dice.faces[0] ?? 0) + (dice.faces[1] ?? 0) + modifier)) return beginBarrage(pending, pending.airMission!, board)
  const ratings = mission.flights.map((flight) => board.airProfileOf(state, flight.id)!.bombing)
  const loss = rollDie(rolled.rng)
  const candidates = flakLossCandidates(ratings, loss.value)
    .map((index) => mission.flights[index]!.id)
  const advanced = { ...pending, rng: loss.rng,
    airMission: { ...pending.airMission!, flak: { dice, modifier, lossDie: loss.value } } }
  if (candidates.length === 1) {
    const lost = applyFlakLoss(advanced, advanced.airMission!, candidates[0]!)
    return beginBarrage(lost, lost.airMission!, board)
  }
  return { ...advanced, airMission: { ...advanced.airMission!, step: { kind: 'flak-loss' as const, candidates } } }
}

export function launchCampaignAirStrike(state: Readonly<CampaignTurnState>, actor: Side,
  action: LaunchAction, board: CampaignAirStrikeBoard | undefined): CampaignTurnState {
  if (!board) throw new Error('Campaign air strike rules are not configured')
  const { cursor } = state
  if (!('phasing' in cursor) || cursor.phasing !== actor) throw new Error('Air strike requires the phasing side')
  if (state.airMission || state.barrage) throw new Error('Resolve the current air strike first')
  const target = board.map.resolveHex(action.targetHex)
  if (!target) throw new Error('Choose an on-map air target')
  const phase = cursor.phase
  if (phase !== 'movement' && phase !== 'reaction' && phase !== 'exploitation')
    throw new Error('Air strike is unavailable in the current phase')
  if (!allowsBarrageSource(phase, 'air')) throw new Error('Air strike is unavailable in the current segment')
  if (phase === 'movement' && airMissionSegments[action.kind] === 'barrage' && state.movementSegment !== 'barrage')
    throw new Error('Air barrage is available only in the Barrage Segment')
  if (phase === 'exploitation' && (state.combatTargets?.length ?? 0) > 0)
    throw new Error('Air strike is unavailable after combat in Exploitation')
  const flight = weatherFlight(state)
  if (flight === 'none') throw new Error('Air strike: weather prohibits flight')
  if (flight === 'limited' && phase !== 'movement') throw new Error('Air strike: limited flight is movement-only')

  const strikeTargetFacts = targetFacts(state, actor, target, board)
  if ((action.kind === 'barrage' || action.kind === 'hip-shoot') && strikeTargetFacts.enemyActiveAircraft)
    throw new Error('Air combat air support is not implemented for this scenario')
  if (strikeTargetFacts.enemyActiveAircraft || strikeTargetFacts.enemyAirBase)
    throw new Error('Air combat/interception is not implemented for this scenario')
  const facts = missionFlightFacts(state, action, board)
  const refusal = airMissionLaunchRefusal({ kind: action.kind, side: actor, phase, turn: state.turn,
    flight, aircraft: facts, targetFacts: strikeTargetFacts })
  if (refusal) throw new Error(`Air strike: ${refusal}`)
  const workRefusal = board.workRefusal?.(state, { kind: action.kind, side: actor, targetHex: target,
    aircraftIds: action.aircraftIds })
  if (workRefusal) throw new Error(`Air strike: ${workRefusal}`)

  const mission: CampaignAirMission = {
    id: `air-${state.turn}-${state.airHistory?.length ?? 0}`,
    kind: action.kind, side: actor, targetHex: target,
    flights: facts.map(({ id, distanceHexes, rangeHexes }) =>
      ({ id, origin: state.counters[id]!.location, distanceHexes, normalRange: distanceHexes <= rangeHexes,
        printedSteps: board.airProfileOf(state, id)!.printedSteps })),
    step: { kind: 'flak' },
  }
  return { ...state, airMission: mission }
}

export function resolveCampaignAirFlak(state: Readonly<CampaignTurnState>, actor: Side,
  board: CampaignAirStrikeBoard | undefined): CampaignTurnState {
  if (!board) throw new Error('Campaign air strike rules are not configured')
  const mission = state.airMission
  if (!mission || mission.step.kind !== 'flak' || mission.side !== actor) throw new Error('No air flak decision for this side')
  return afterFlak(state, mission, board)
}

export function chooseCampaignAirFlakLoss(state: Readonly<CampaignTurnState>, actor: Side, unitId: string,
  board: CampaignAirStrikeBoard | undefined): CampaignTurnState {
  if (!board) throw new Error('Campaign air strike rules are not configured')
  const mission = state.airMission
  if (!mission || mission.step.kind !== 'flak-loss' || mission.side !== actor ||
    !mission.step.candidates.includes(unitId)) throw new Error('Choose a listed Flak loss aircraft')
  const lost = applyFlakLoss(state, mission, unitId)
  return beginBarrage(lost, lost.airMission!, board)
}

export function completeCampaignAirStrike(state: Readonly<CampaignTurnState>, actor: Side,
  board: CampaignAirStrikeBoard | undefined): CampaignTurnState {
  if (!board) throw new Error('Campaign air strike rules are not configured')
  const mission = state.airMission
  if (!mission || mission.side !== actor || mission.step.kind !== 'barrage' || state.barrage)
    throw new Error('Resolve the air barrage before completing the mission')
  const counters = { ...state.counters }
  for (const flight of mission.flights) {
    const counter = counters[flight.id]
    if (!counter || counter.location.kind === 'dead-pile') continue
    const location = board.returnLocation?.(state, flight.id) ?? flight.origin
    counters[flight.id] = { ...counter, location, active: false }
  }
  const { cursor } = state
  const record: CampaignAirMissionRecord = {
    ...mission, turn: state.turn,
    phasing: 'phasing' in cursor ? cursor.phasing : actor,
    phase: cursor.phase === 'ended' || cursor.phase === 'pre-turn' ? 'movement' : cursor.phase,
  }
  return { ...state, counters, airMission: null, airHistory: [...(state.airHistory ?? []), record] }
}

/** A pending mission blocks movement-phase end, like an unresolved barrage. */
export function campaignAirMissionBlockers(state: Readonly<CampaignTurnState>): readonly string[] {
  return state.airMission ? ['air-mission'] : []
}

export function applyCampaignAirMission(state: Readonly<CampaignTurnState>, actor: Side,
  action: CampaignAirMissionAction, board: CampaignAirStrikeBoard | undefined): CampaignTurnState {
  if (action.type === 'launch-campaign-air-strike') return launchCampaignAirStrike(state, actor, action, board)
  if (action.type === 'resolve-campaign-air-flak') return resolveCampaignAirFlak(state, actor, board)
  if (action.type === 'choose-campaign-air-flak-loss') return chooseCampaignAirFlakLoss(state, actor, action.unitId, board)
  return completeCampaignAirStrike(state, actor, board)
}
