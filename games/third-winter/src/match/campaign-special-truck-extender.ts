import type { Side } from '@ocs-eastern/series/state-types'
import { steMovingBox, steReadyBox } from '../ttw/campaign/special-truck-extender.ts'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export type CampaignSteAction = { type: 'deploy-campaign-ste'; counterId: string; hex: string }
  | { type: 'withdraw-campaign-ste'; counterId: string }
export type CampaignStePlacement = (state: Readonly<CampaignTurnState>, hex: string) => boolean

function steOpen(state: Readonly<CampaignTurnState>, side: Side) {
  return side === 'soviet' && state.cursor.phase === 'movement' && state.cursor.phasing === side &&
    state.movementSegment === 'movement' && !state.groundMovement?.interruption
}

export function campaignSteOptions(state: Readonly<CampaignTurnState>, side: Side) {
  if (!steOpen(state, side)) return null
  const ready: string[] = []
  const deployed: { id: string; hex: string }[] = []
  for (const [id, unit] of Object.entries(state.counters)) {
    if (unit.side !== side || !unit.specialTruckExtender) continue
    if (unit.location.kind === 'box' && unit.location.box === steReadyBox) ready.push(id)
    if (unit.location.kind === 'map') deployed.push({ id, hex: unit.location.hex })
  }
  return { ready, deployed }
}

export function applyCampaignSte(state: Readonly<CampaignTurnState>, side: Side, action: CampaignSteAction, map?: CampaignGroundMap,
  legalLand?: CampaignStePlacement): CampaignTurnState {
  const choices = campaignSteOptions(state, side)
  if (!choices) throw new Error('Soviet STE movement is not open')
  const unit = state.counters[action.counterId]
  if (!unit) throw new Error('Choose a Soviet STE counter')
  if (action.type === 'withdraw-campaign-ste') {
    if (!choices.deployed.some(({ id }) => id === action.counterId)) throw new Error('Choose a deployed STE')
    return { ...state, counters: { ...state.counters, [action.counterId]: { ...unit, location: { kind: 'box', box: steMovingBox } } } }
  }
  if (!choices.ready.includes(action.counterId)) throw new Error('Choose an STE from the Ready box')
  const hex = map?.resolveHex(action.hex)
  if (!map || !hex || !legalLand?.(state, hex) || Object.values(state.counters).some((counter) =>
    counter.side !== side && counter.location.kind === 'map' && map.resolveHex(counter.location.hex) === hex)) {
    throw new Error('Choose available land without enemy counters for the STE')
  }
  return { ...state, counters: { ...state.counters, [action.counterId]: { ...unit, location: { kind: 'map', hex } } }
  }
}

export function displaceCampaignSte(state: CampaignTurnState, map: CampaignGroundMap, hex: string): CampaignTurnState {
  let counters: Record<string, CampaignTurnState['counters'][string]> | undefined
  for (const [id, counter] of Object.entries(state.counters)) {
    if (counter.side !== 'soviet' || !counter.specialTruckExtender || counter.location.kind !== 'map' || map.resolveHex(counter.location.hex) !== hex) continue
    counters ??= { ...state.counters }
    counters[id] = { ...counter, location: { kind: 'box', box: steMovingBox } }
  }
  return counters ? { ...state, counters } : state
}

export function readyCampaignSte(state: CampaignTurnState): CampaignTurnState {
  if (state.cursor.phase !== 'cleanup' || state.cursor.phasing !== 'soviet') return state
  const counters = { ...state.counters }
  for (const [id, unit] of Object.entries(counters)) {
    if (unit.side === 'soviet' && unit.specialTruckExtender && unit.location.kind === 'box' && unit.location.box === steMovingBox) {
      counters[id] = { ...unit, location: { kind: 'box', box: steReadyBox } }
    }
  }
  return { ...state, counters }
}
