import type { Side } from '@ocs-eastern/series/state-types'
import { actingSide } from '@ocs-eastern/series/turn'
import { campaignAircraftConsolidationOptions } from '../match/campaign-aircraft-consolidation.ts'
import { campaignReinforcementAtCursor } from '../match/campaign-reinforcement-phase.ts'
import { campaignBreakoutReturnOptions } from '../match/campaign-breakout-returns.ts'
import { campaignKhersonFerryOptions, previewCampaignKhersonFerry } from '../match/campaign-kherson-ferry.ts'
import type { UseCampaignKhersonFerry } from '../match/campaign-kherson-ferry.ts'
import { campaignGroundDestinations, campaignGroundMovementOptions, previewCampaignGroundMove } from '../match/campaign-ground-movement.ts'
import type { CampaignGroundMover, MoveCampaignGround } from '../match/campaign-ground-movement.ts'
import { campaignGroundMovementActor } from '../match/campaign-ground-march.ts'
import type { CampaignMarchInterruption } from '../match/campaign-ground-march.ts'
import { previewCampaignMarchResume } from '../match/campaign-march-response.ts'
import type { CampaignMarchResponse } from '../match/campaign-march-response.ts'
import { campaignPontoonOptions } from '../match/campaign-pontoon-phase.ts'
import { activeCampaignFerryHex } from '../match/campaign-movement-board.ts'
import type { CampaignMatch } from '../match/campaign-match.ts'
import type { CampaignCursor, CampaignTurnContext } from '../match/campaign-turn-state.ts'
import { projectCampaignReinforcementActive, projectCampaignSeat } from './campaign-reinforcement-view.ts'
import { projectCampaignBreakout } from './campaign-breakout-view.ts'

function preTurnStep(cursor: Extract<CampaignCursor, { phase: 'pre-turn' }>) {
  switch (cursor.segment) {
    case 'weather': return 'determine-weather'
    case 'random-event': return cursor.event ? 'await-event-effect' : 'roll-event'
    case 'initiative': return cursor.winner ? 'choose-first' : 'roll-initiative'
    case 'simulcast': return 'await-simulcast'
  }
}

function projectMarchInterruption(pending: CampaignMarchInterruption, viewer: Side) {
  const publicStep = { kind: pending.kind, hex: pending.hex }
  if (pending.kind === 'volga-bridge-demolition') {
    return viewer === 'axis' ? { ...publicStep, bridges: pending.bridges.map(({ id, hexside }) => ({ id, hexside: [...hexside] })) } : publicStep
  }
  return viewer === 'soviet' ? { ...publicStep, refusal: { ...pending.refusal },
    movers: pending.march.movers.map(({ id, unit, progress }) => ({ id, remainingMp: unit.allowance - progress.spent, stop: progress.stop })) } : publicStep
}

export function projectCampaignMatch(record: Readonly<CampaignMatch>, viewer: Side, context: CampaignTurnContext) {
  const { state, revision } = record
  const { cursor, reinforcement, when, turn, weather, weatherHistory } = state
  const preTurnRolls = state.preTurnRolls.map(({ segment, check, dice }) => ({ segment, check,
    dice: { ...dice, faces: [...dice.faces] } }))
  const map = context.groundMovement?.map
  const ferries = state.ferries.flatMap((marker) => {
    const hex = map ? activeCampaignFerryHex(state, marker, map) : weatherHistory.ice ? undefined : marker.hex
    return hex ? [{ id: marker.id, side: marker.side, hex }] : []
  })
  const blownBridges = Object.entries(state.volgaBridgeDecisions ?? {}).flatMap(([id, decision]) =>
    decision === 'blown' ? [{ id, hexside: id.split('|') }] : [])
  const repairedBridges = Object.entries(state.volgaBridgeDecisions ?? {}).flatMap(([id, decision]) =>
    decision === 'repaired' ? [{ id, hexside: id.split('|') }] : [])
  const repairingBridges = Object.entries(state.volgaBridgeRepairs ?? {}).map(([id, { side, phases }]) => ({ id, hexside: id.split('|'), side, phases }))
  const pontoonTrackBridges = context.groundMovement?.pontoonTrackMarkers?.(state).filter(({ side }) => side === viewer) ?? []
  const base = { viewer, revision, turn, date: when.date, weather: weather ? { ...weather } : null, ice: weatherHistory.ice,
    ferries, blownBridges, repairingBridges, repairedBridges, pontoonTrackBridges, phase: cursor.phase, preTurnRolls, own: projectCampaignSeat(state, viewer) }
  if (cursor.phase === 'ended') return { ...base, reason: cursor.reason, phasing: null, actor: null }
  if (cursor.phase === 'pre-turn') {
    const event = cursor.segment === 'random-event' && cursor.event ? { ...cursor.event } : null
    const chooser = cursor.segment === 'initiative' ? cursor.winner : null
    return { ...base, segment: cursor.segment, step: preTurnStep(cursor), event, phasing: null, actor: chooser }
  }

  const pending = state.groundMovement?.interruption
  if (pending && cursor.phase === 'movement') return { ...base, first: cursor.first, phasing: cursor.phasing,
    actor: campaignGroundMovementActor(pending), segment: state.movementSegment, movement: null,
    marchResponse: projectMarchInterruption(pending, viewer) }
  const player = { ...base, first: cursor.first, phasing: cursor.phasing, actor: actingSide(cursor.phasing, cursor.phase),
    aircraftConsolidation: campaignAircraftConsolidationOptions(state, viewer, context) }
  if (cursor.phase === 'movement') return { ...player, segment: state.movementSegment,
    breakout: projectCampaignBreakout(state, viewer, context.breakoutBoard),
    movement: campaignGroundMovementOptions(state, viewer, context.groundMovement),
    pontoon: campaignPontoonOptions(state, viewer, context.groundMovement),
    khersonFerry: campaignKhersonFerryOptions(state, viewer, context.groundMovement),
    barrageEndBlockers: state.movementSegment === 'barrage' && viewer === cursor.phasing
      ? context.movementBarrageBlockers?.(state, viewer)?.slice() ?? null : null }
  if (cursor.phase !== 'reinforcement' || !reinforcement) return player
  const { stage } = reinforcement
  if (stage === 'ordinary') {
    const window = campaignReinforcementAtCursor(state)!
    const active = projectCampaignReinforcementActive(window, viewer, context.reinforcement)
    if (!active) return { ...player, segment: window.segment, active: null }
    const breakoutReturns = campaignBreakoutReturnOptions(window, context.breakoutReturns)
    return { ...player, segment: window.segment, active: { ...active, breakoutReturns } }
  }
  if (cursor.phasing !== viewer) return { ...player, segment: stage, active: null }
  const blockers = context.reinforcementBlockers?.(state, stage)
  const step = blockers?.length ? 'resolve-reinforcement-obligations' : blockers ? `complete-${stage}` : 'await-reinforcement-rules'
  return { ...player, segment: stage, active: { step, blockers: blockers?.slice() ?? null } }
}

export function projectCampaignGroundDestinations(record: Readonly<CampaignMatch>, viewer: Side, mover: CampaignGroundMover,
  context: CampaignTurnContext) {
  return { revision: record.revision, ...campaignGroundDestinations(record.state, viewer, mover, context.groundMovement) }
}

export function projectCampaignGroundRoute(record: Readonly<CampaignMatch>, viewer: Side, action: MoveCampaignGround,
  context: CampaignTurnContext) {
  return { revision: record.revision, ...previewCampaignGroundMove(record.state, viewer, action, context.groundMovement) }
}

export function projectCampaignMarchResume(record: Readonly<CampaignMatch>, viewer: Side,
  action: Extract<CampaignMarchResponse, { type: 'resume-campaign-ground-march' }>, context: CampaignTurnContext) {
  return { revision: record.revision, ...previewCampaignMarchResume(record.state, viewer, action, context.groundMovement) }
}

export function projectCampaignKhersonFerry(record: Readonly<CampaignMatch>, viewer: Side, action: UseCampaignKhersonFerry,
  context: CampaignTurnContext) {
  return { revision: record.revision, ...previewCampaignKhersonFerry(record.state, viewer, action, context.groundMovement) }
}
