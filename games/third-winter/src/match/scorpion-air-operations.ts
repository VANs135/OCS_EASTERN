import { roll2d6, rollDie } from '@ocs-eastern/series/rng'
import type { Side } from '@ocs-eastern/series/state-types'
import { flakLossCandidates, rollAirCombat } from '@ocs-eastern/series/tables/air'
import { actingSide } from '@ocs-eastern/series/turn'
import { scorpionHexDistance, scorpionHexId } from '../import/hex-id.ts'
import { sovietMissionRestriction } from '../ttw/air/mission-permission.ts'
import { executeScorpionAirBarrage, prepareScorpionAirBarrage } from './scorpion-air-barrage.ts'
import type { AirBarrageTarget, ScorpionAirBarrageBoard, ScorpionAirBarragePlan } from './scorpion-air-barrage.ts'
import { activeAirfieldExcess, aircraftProfile, atAirBase, friendlyAirBases, inScorpionAirRange } from './scorpion-air-bases.ts'
import type { ScorpionAirBase } from './scorpion-air-bases.ts'
import { scorpionPhaseAirMissions, scorpionRegularBarrageTargets } from './scorpion-barrage-timing.ts'
import type { ScorpionBoxPiece } from './scorpion-box-pieces.ts'
import type { PlayerTurn } from './scorpion-player-turn.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'

type MissionKind = 'base-transfer' | 'fighter-sweep' | 'barrage' | 'hip-shoot'
type HexBase = Extract<ScorpionAirBase, { kind: 'hex' }>
type Flight = { id: string; origin: ScorpionAirBase; normalRange: boolean }
type AirRound = Omit<ReturnType<typeof rollAirCombat>, 'rng'> & { attackerId: string; defenderId: string }
type Flak = { dice: readonly number[]; modifier: number; lossDie?: number; lossId?: string }

type AirStep =
  | { kind: 'interception'; actor: Side; candidates: readonly string[] }
  | { kind: 'combat-aborts'; actor: Side; initiator: Side; lastSide: boolean; afterCombat: boolean }
  | { kind: 'pick-attacker'; actor: Side; initiator: Side }
  | { kind: 'pick-defender'; actor: Side; initiator: Side; attackerId: string }
  | { kind: 'flak-loss'; actor: Side; candidates: readonly string[] }
  | { kind: 'barrage' }
  | { kind: 'return' }

interface AirMissionData {
  kind: MissionKind
  side: Side
  target: ScorpionAirBase
  flights: readonly Flight[]
  strike?: ScorpionAirBarragePlan
  interceptor?: Flight
  patrol: boolean
  returning: readonly string[]
  rounds: readonly AirRound[]
  flak?: Flak
}

export type ScorpionAirMission = AirMissionData & { step: AirStep }
export type ScorpionAirReport = Omit<AirMissionData, 'returning'> & Pick<PlayerTurn, 'turn' | 'phasing' | 'phase'>

export type LaunchAirMission = { type: 'launch-air-mission'; mission: MissionKind; target: ScorpionAirBase;
  unitIds: readonly string[]; targetKind?: AirBarrageTarget }
export type RespondAirMission =
  | { type: 'respond-interception'; unitId: string | null }
  | { type: 'choose-air-aborts'; unitIds: readonly string[] }
  | { type: 'choose-air-combat-unit'; unitId: string } | { type: 'choose-flak-loss'; unitId: string }
  | { type: 'return-aircraft'; unitId: string; base: ScorpionAirBase }

const opponent = (side: Side): Side => side === 'axis' ? 'soviet' : 'axis'

function normalizedBase(base: ScorpionAirBase): ScorpionAirBase {
  if (base.kind === 'hex') return { kind: 'hex', hex: scorpionHexId(base.hex) }
  if (base.kind === 'off-map-air') return { kind: 'off-map-air' }
  throw new Error('Invalid Scorpion air base')
}

function activeAt(state: Readonly<ScorpionInPlay>, side: Side, target: ScorpionAirBase) {
  return state.pieces.filter((piece) => piece.side === side && piece.kind === 'aircraft' && piece.active &&
    atAirBase(piece.location, target))
}

function basedAt(state: Readonly<ScorpionInPlay>, piece: ScorpionBoxPiece): ScorpionAirBase | undefined {
  return friendlyAirBases(state, piece.side).find((base) => atAirBase(piece.location, base))
}

function eligibleSector(mission: MissionKind | 'intercept', piece: ScorpionBoxPiece, target: ScorpionAirBase,
  assets: ScorpionSetupAssets): boolean {
  if (piece.side !== 'soviet' || target.kind !== 'hex') return true
  const column = Number(target.hex.slice(1).split('.')[0])
  return sovietMissionRestriction(mission, [aircraftProfile(piece, assets)], { kind: 'scorpion', column }) === null
}

export function launchScorpionAirMission(state: Readonly<ScorpionInPlay>, actor: Side,
  action: LaunchAirMission, assets: ScorpionSetupAssets, board: ScorpionAirBarrageBoard): ScorpionInPlay {
  const { phasing, phase } = state.cursor
  const weather = state.turn.weather.flight
  const { mission: kind, unitIds } = action
  const firedAt = scorpionRegularBarrageTargets(state)
  if (state.turn.step.kind !== 'player-turn' || state.combat || actor !== actingSide(phasing, phase) ||
    !['movement', 'reaction', 'exploitation'].includes(phase) || (kind !== 'barrage' && firedAt.size) ||
    (phase === 'exploitation' && state.combatTargets.length)) throw new Error('Air mission is unavailable in the current segment')
  if (weather === 'none' || (weather === 'limited' && (phase !== 'movement' || kind === 'hip-shoot'))) {
    throw new Error('Flight conditions prohibit this mission')
  }
  const isStrike = kind === 'barrage' || kind === 'hip-shoot'
  if ((!isStrike && kind !== 'fighter-sweep' && kind !== 'base-transfer') ||
    new Set(unitIds).size !== unitIds.length || !unitIds.length || unitIds.length > 4 ||
    ((kind === 'fighter-sweep' || kind === 'hip-shoot') && unitIds.length !== 1)) {
    throw new Error('Choose a legal mission and aircraft stack')
  }
  const target = normalizedBase(action.target)
  const enemy = opponent(actor)
  if (isStrike && (target.kind !== 'hex' || (kind === 'barrage' && firedAt.has(target.hex)))) {
    throw new Error('Choose an on-map target that is eligible for this air barrage')
  }
  if (kind === 'fighter-sweep') {
    // TTW 2.2c: the player's ruling places the entire Scorpion map under Axis air command.
    if (target.kind !== 'hex' || !state.airBases.some((base) => base.side === enemy && base.hex === target.hex) ||
      !activeAt(state, enemy, target).length) throw new Error('Fighter sweep requires active enemy aircraft at an air base')
  } else if (kind === 'base-transfer' && !friendlyAirBases(state, actor).some((base) => atAirBase(base, target))) {
    throw new Error('Base transfer requires a friendly destination')
  }
  const used = new Set(scorpionPhaseAirMissions(state).flatMap((record) => record.flights.map(({ id }) => id)))
  const flights: Flight[] = []
  const profiles: ReturnType<typeof aircraftProfile>[] = []
  for (const id of unitIds) {
    const piece = state.pieces.find((item) => item.id === id)
    const origin = piece && basedAt(state, piece)
    if (!piece || piece.kind !== 'aircraft' || piece.side !== actor || !piece.active || !origin ||
      used.has(id) || atAirBase(origin, target)) throw new Error('Choose unused active friendly aircraft at a different base')
    const profile = aircraftProfile(piece, assets)
    const normalRange = inScorpionAirRange(origin, target, profile.range)
    if (!normalRange && (kind !== 'base-transfer' || !inScorpionAirRange(origin, target, profile.range * 2))) {
      throw new Error('Aircraft is out of range')
    }
    if ((kind === 'fighter-sweep' && !profile.fighter) || (profile.tankBuster && !isStrike)) {
      throw new Error('Aircraft is ineligible for this mission')
    }
    if (kind !== 'hip-shoot' && !eligibleSector(kind, piece, target, assets)) {
      throw new Error('Mission hex is outside the Soviet Air Army sector')
    }
    profiles.push(profile)
    flights.push({ id, origin, normalRange })
  }
  if (actor === 'soviet' && new Set(profiles.flatMap(({ airArmy }) => airArmy === null ? [] : [airArmy])).size > 1) {
    throw new Error('Different Soviet Air Armies cannot fly a combined mission')
  }

  const strike = isStrike && target.kind === 'hex'
    ? prepareScorpionAirBarrage(state, actor, enemy, target.hex, action.targetKind ?? 'units', kind === 'hip-shoot', profiles, assets, board)
    : undefined
  const mission: AirMissionData = { kind, side: actor, target, flights, ...(strike ? { strike } : {}),
    patrol: false, returning: [], rounds: [] }
  const launched = { ...state, ...(kind === 'hip-shoot' ? {} : { overrunMarch: null, groundCaptureMove: null }),
    pieces: state.pieces.map((piece) => unitIds.includes(piece.id) ? { ...piece, location: target } : piece) }
  const opposing = isStrike ? activeAt(state, enemy, target) : []
  if (kind === 'fighter-sweep' || (opposing.length && (profiles.some(({ fighter }) => fighter) ||
    opposing.some((piece) => aircraftProfile(piece, assets).fighter)))) return openAirCombat(launched, mission, actor)
  return offerInterception(launched, mission, assets, board)
}

function offerInterception(state: Readonly<ScorpionInPlay>, mission: AirMissionData, assets: ScorpionSetupAssets,
  board: ScorpionAirBarrageBoard): ScorpionInPlay {
  const { target } = mission
  const enemy = opponent(mission.side)
  const patrol = target.kind === 'hex' && activeMissionAircraft(state, mission).length ? patrolFighters(state, enemy, target, assets) : []
  const data = { ...mission, patrol: patrol.length > 0 }
  const candidates = patrol.filter((piece) => eligibleSector('intercept', piece, target, assets)).map(({ id }) => id)
  if (candidates.length) return { ...state, airMission: { ...data, step: { kind: 'interception', actor: enemy, candidates } } }
  return resolveAirMission(state, data, assets, board)
}

function patrolFighters(state: Readonly<ScorpionInPlay>, side: Side, target: HexBase, assets: ScorpionSetupAssets) {
  return state.pieces.filter((piece) => {
    if (piece.kind !== 'aircraft' || !piece.active || piece.side !== side || piece.location.kind !== 'hex') return false
    const base = basedAt(state, piece)
    return base?.kind === 'hex' && scorpionHexDistance(base.hex, target.hex) <= 10 && aircraftProfile(piece, assets).fighter
  })
}

function openAirCombat(state: Readonly<ScorpionInPlay>, mission: AirMissionData, initiator: Side): ScorpionInPlay {
  return { ...state, airMission: { ...mission,
    step: { kind: 'combat-aborts', actor: initiator, initiator, lastSide: false, afterCombat: false } } }
}

export function respondScorpionAirMission(state: Readonly<ScorpionInPlay>, actor: Side,
  action: RespondAirMission, assets: ScorpionSetupAssets, board: ScorpionAirBarrageBoard): ScorpionInPlay {
  const mission = state.airMission
  if (!mission || mission.step.kind === 'barrage' || (mission.step.kind !== 'return' && mission.step.actor !== actor)) {
    throw new Error('No air decision for this side')
  }
  const { step } = mission
  if (action.type === 'respond-interception' && step.kind === 'interception') {
    if (action.unitId === null) return resolveAirMission(state, mission, assets, board)
    if (!step.candidates.includes(action.unitId)) throw new Error('Choose an eligible patrol fighter')
    const piece = state.pieces.find(({ id }) => id === action.unitId)!
    const interceptor = { id: piece.id, origin: basedAt(state, piece)!, normalRange: true }
    return openAirCombat({ ...state, pieces: state.pieces.map((item) =>
      item.id === piece.id ? { ...item, location: mission.target } : item) }, { ...mission, interceptor }, actor)
  }
  if (action.type === 'choose-air-aborts' && step.kind === 'combat-aborts') {
    const offered = activeAt(state, actor, mission.target)
    const ids = new Set(action.unitIds)
    if (ids.size !== action.unitIds.length || action.unitIds.some((id) => !offered.some((piece) => piece.id === id)) ||
      (!step.afterCombat && ids.size >= offered.length)) throw new Error('Choose active aircraft and leave at least one before combat')
    const changed = abortAircraft(state, mission, action.unitIds, false, !step.afterCombat)
    if (!step.lastSide) return { ...changed.state, airMission: { ...changed.mission,
      step: { ...step, actor: opponent(actor), lastSide: true } } }
    return step.afterCombat ? afterAirCombat(changed.state, changed.mission, assets, board)
      : nextAirRound(changed.state, changed.mission, step.initiator, assets, board)
  }
  if (action.type === 'choose-air-combat-unit' && (step.kind === 'pick-attacker' || step.kind === 'pick-defender')) {
    const piece = activeAt(state, actor, mission.target).find(({ id }) => id === action.unitId)
    if (!piece) throw new Error('Choose active aircraft in the air combat')
    const profile = aircraftProfile(piece, assets)
    if (step.kind === 'pick-attacker') {
      if (!profile.fighter) throw new Error('Only a fighter may attack in air combat')
      return { ...state, airMission: { ...mission, step: { kind: 'pick-defender', actor: opponent(actor),
        initiator: step.initiator, attackerId: piece.id } } }
    }
    const attacker = state.pieces.find(({ id }) => id === step.attackerId)!
    const { rng, ...roll } = rollAirCombat(state.rng, aircraftProfile(attacker, assets).airCombat, profile.airCombat)
    const aborts = [...(roll.attackerAborts ? [attacker.id] : []), ...(roll.defenderAborts ? [piece.id] : [])]
    const changed = abortAircraft({ ...state, rng }, { ...mission,
      rounds: [...mission.rounds, { attackerId: attacker.id, defenderId: piece.id, ...roll }] }, aborts, roll.stepLoss)
    return nextAirRound(changed.state, changed.mission, step.initiator, assets, board)
  }
  if (action.type === 'choose-flak-loss' && step.kind === 'flak-loss') {
    if (!step.candidates.includes(action.unitId)) throw new Error('Choose an eligible Flak loss')
    return applyFlakLoss(state, mission, action.unitId, assets, board)
  }
  if (action.type === 'return-aircraft' && step.kind === 'return') {
    const base = normalizedBase(action.base)
    if (!scorpionAirReturnOptions(state, actor, action.unitId, assets).some((allowed) => atAirBase(allowed, base))) {
      throw new Error('Choose a friendly base in return range for this aircraft')
    }
    const pieces = state.pieces.map((piece) => piece.id === action.unitId ? { ...piece, location: base, active: false } : piece)
    return closeAirMission({ ...state, pieces }, { ...mission, returning: mission.returning.filter((id) => id !== action.unitId) })
  }
  throw new Error('This action does not resolve the current air decision')
}

function nextAirRound(state: Readonly<ScorpionInPlay>, mission: AirMissionData, initiator: Side,
  assets: ScorpionSetupAssets, board: ScorpionAirBarrageBoard): ScorpionInPlay {
  const first = activeAt(state, initiator, mission.target)
  const second = activeAt(state, opponent(initiator), mission.target)
  const attack = first.some((piece) => aircraftProfile(piece, assets).fighter)
  const counterattack = second.some((piece) => aircraftProfile(piece, assets).fighter)
  if (first.length && second.length && (attack || counterattack)) {
    return { ...state, airMission: { ...mission,
      step: { kind: 'pick-attacker', actor: attack ? initiator : opponent(initiator), initiator } } }
  }
  const offerFirst = first.length > 0 && !(mission.kind === 'fighter-sweep' && initiator === mission.side)
  const offerSecond = second.length > 0 && !(mission.kind === 'fighter-sweep' && opponent(initiator) === mission.side)
  if (!mission.rounds.length || (!offerFirst && !offerSecond)) return afterAirCombat(state, mission, assets, board)
  return { ...state, airMission: { ...mission,
    step: { kind: 'combat-aborts', actor: offerFirst ? initiator : opponent(initiator), initiator,
      lastSide: !(offerFirst && offerSecond), afterCombat: true } } }
}

function afterAirCombat(state: Readonly<ScorpionInPlay>, mission: AirMissionData, assets: ScorpionSetupAssets,
  board: ScorpionAirBarrageBoard): ScorpionInPlay {
  return mission.strike && !mission.interceptor ? offerInterception(state, mission, assets, board)
    : resolveAirMission(state, mission, assets, board)
}

function abortAircraft(state: Readonly<ScorpionInPlay>, mission: AirMissionData, ids: readonly string[], loss: boolean,
  forceFriendlyBase = true) {
  const returning = [...mission.returning]
  const pieces = state.pieces.map((piece): ScorpionBoxPiece => {
    if (!ids.includes(piece.id)) return piece
    if (loss && piece.reduced) return { ...piece, location: { kind: 'dead-pile' }, active: false }
    const forcedBase = mission.interceptor?.id === piece.id ? mission.interceptor.origin
      : forceFriendlyBase ? basedAt(state, piece) : undefined
    if (!forcedBase) returning.push(piece.id)
    return { ...piece, location: forcedBase ?? piece.location, reduced: loss || piece.reduced, active: false }
  })
  return { state: { ...state, pieces }, mission: { ...mission, returning } }
}

function resolveAirMission(state: Readonly<ScorpionInPlay>, mission: AirMissionData,
  assets: ScorpionSetupAssets, board: ScorpionAirBarrageBoard): ScorpionInPlay {
  if (mission.kind === 'fighter-sweep') return returnSurvivors(state, mission)
  const interceptor = mission.interceptor
  const resolved = interceptor ? { ...state, pieces: state.pieces.map((piece) =>
    piece.id === interceptor.id && piece.active ? { ...piece, location: interceptor.origin } : piece) } : state
  const target = mission.target
  const planes = activeMissionAircraft(resolved, mission)
  if (target.kind !== 'hex' || !planes.length || (!mission.strike && !mission.patrol)) {
    return settleAirAction(resolved, mission, assets, board)
  }

  const hq = Object.values(state.units).some((unit) => unit.hex === target.hex && unit.headquarters)
  const airLevel = state.airBases.find((base) => base.hex === target.hex)?.level ?? 0
  const profile = planes.map((piece) => aircraftProfile(piece, assets))
  const patrolModifier = mission.patrol ? (profile.some(({ fighter }) => fighter) ? 1 : 2) : 0
  const modifier = Number(planes.length >= 3) + Number(hq) + airLevel + patrolModifier
  const flak = roll2d6(resolved.rng)
  const data: AirMissionData = { ...mission, flak: { dice: flak.value.faces, modifier } }
  const rolled = { ...resolved, rng: flak.rng }
  if (flak.value.total + modifier < 11) return settleAirAction(rolled, data, assets, board)
  // TTW 2.2f(D). Restrict the normal mission loss table to the surviving tank-buster aircraft.
  const stack = mission.strike?.tankBuster ? planes.filter((_, index) => profile[index]!.tankBuster) : planes
  if (!stack.length) return returnSurvivors(rolled, data)
  if (stack.length === 1) return applyFlakLoss(rolled, data, stack[0]!.id, assets, board)

  const loss = rollDie(rolled.rng)
  const candidates = flakLossCandidates(stack.map((plane) => aircraftProfile(plane, assets).bombing), loss.value)
    .map((index) => stack[index]!.id)
  const next = { ...rolled, rng: loss.rng }
  const pending = { ...data, flak: { dice: flak.value.faces, modifier, lossDie: loss.value } }
  return candidates.length === 1 ? applyFlakLoss(next, pending, candidates[0]!, assets, board)
    : { ...next, airMission: { ...pending, step: { kind: 'flak-loss', actor: mission.side, candidates } } }
}

function applyFlakLoss(state: Readonly<ScorpionInPlay>, mission: AirMissionData, id: string,
  assets: ScorpionSetupAssets, board: ScorpionAirBarrageBoard): ScorpionInPlay {
  const pieces = state.pieces.map((piece): ScorpionBoxPiece => piece.id !== id ? piece
    : piece.reduced ? { ...piece, location: { kind: 'dead-pile' }, active: false } : { ...piece, reduced: true })
  return settleAirAction({ ...state, pieces }, { ...mission, flak: { ...mission.flak!, lossId: id } }, assets, board)
}

function activeMissionAircraft(state: Readonly<ScorpionInPlay>, mission: AirMissionData) {
  const aircraft = activeAt(state, mission.side, mission.target)
  return mission.flights.flatMap(({ id }) => aircraft.filter((plane) => plane.id === id))
}

function settleAirAction(state: Readonly<ScorpionInPlay>, mission: AirMissionData, assets: ScorpionSetupAssets,
  board: ScorpionAirBarrageBoard): ScorpionInPlay {
  if (!mission.strike || mission.target.kind !== 'hex') return landTransfer(state, mission, assets)
  const flights = activeMissionAircraft(state, mission).map((piece) =>
    ({ piece, origin: mission.flights.find(({ id }) => id === piece.id)!.origin }))
  const resolved = executeScorpionAirBarrage(state, mission.strike, opponent(mission.side), mission.target.hex,
    flights, assets, board)
  return resolved.barrage ? { ...resolved, airMission: { ...mission, step: { kind: 'barrage' } } }
    : returnSurvivors(resolved, mission)
}

export function finishScorpionAirBarrage(state: Readonly<ScorpionInPlay>): ScorpionInPlay {
  return state.airMission?.step.kind === 'barrage' && !state.barrage ? returnSurvivors(state, state.airMission) : state
}

function returnSurvivors(state: Readonly<ScorpionInPlay>, mission: AirMissionData): ScorpionInPlay {
  const changed = abortAircraft(state, mission, activeMissionAircraft(state, mission).map(({ id }) => id), false, false)
  return closeAirMission(changed.state, changed.mission)
}

function landTransfer(state: Readonly<ScorpionInPlay>, mission: AirMissionData, assets: ScorpionSetupAssets): ScorpionInPlay {
  const pieces = state.pieces.map((piece) => {
    const flight = mission.flights.find(({ id }) => id === piece.id)
    if (!flight || !piece.active) return piece
    return { ...piece, active: flight.normalRange && aircraftProfile(piece, assets).fighter }
  })
  const landed = { ...state, pieces }
  return closeAirMission({ ...landed, airfieldCapacityChoice: activeAirfieldExcess(landed, mission.side, mission.target) }, mission)
}

function closeAirMission(state: Readonly<ScorpionInPlay>, mission: AirMissionData): ScorpionInPlay {
  if (mission.returning.length) return { ...state, airMission: { ...mission, step: { kind: 'return' } } }
  const { turn, phasing, phase } = state.cursor
  const { kind, side, target, flights, interceptor, patrol, rounds, flak, strike } = mission
  const report = { turn, phasing, phase, kind, side, target, flights, interceptor, patrol, rounds, flak,
    ...(strike ? { strike } : {}) }
  return { ...state, airMission: null, airHistory: [...(state.airHistory ?? []), report] }
}

export function scorpionAirReturnOptions(state: Readonly<ScorpionInPlay>, actor: Side, id: string,
  assets: ScorpionSetupAssets): ScorpionAirBase[] {
  const mission = state.airMission
  const piece = state.pieces.find((item) => item.id === id && item.side === actor)
  if (!mission?.returning.includes(id) || !piece) return []
  const range = aircraftProfile(piece, assets).range
  return friendlyAirBases(state, actor).filter((base) => inScorpionAirRange(mission.target, base, range))
}
