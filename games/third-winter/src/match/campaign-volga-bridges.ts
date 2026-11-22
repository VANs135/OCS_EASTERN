import { edgeKey } from '@ocs-eastern/series/ground-map'
import { groundModeEffect } from '@ocs-eastern/series/modes'
import type { Side } from '@ocs-eastern/series/state-types'
import { bridgeRepairReady } from '../ttw/campaign/bridge-repair.ts'
import type { TtwVolgaCrossing } from '../ttw/campaign/volga-movement.ts'
import { campaignCounterGroundMode } from './campaign-ground-position.ts'
import type { CampaignGroundMovementBoard } from './campaign-movement-board.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export type CampaignBridgeDecision = 'blown' | 'kept' | 'repaired'
export interface CampaignBridgeRepair {
  side: Side
  phases: number
  pontoonIds?: readonly string[]
}

export interface CampaignVolgaBridge {
  id: string
  hexside: readonly [string, string]
}

export function campaignVolgaBridgeCostState(state: Readonly<CampaignTurnState>, crossing: TtwVolgaCrossing, from: string, to: string) {
  const decision = state.volgaBridgeDecisions?.[edgeKey(from, to)]
  if (crossing.bridge !== 'none' && decision === 'repaired') return { ...crossing, bridge: 'repaired' as const }
  if (crossing.bridge === 'intact' && decision === 'blown') return { ...crossing, bridge: 'blown' as const }
  return crossing
}

/** TTW 1.4a. At first Soviet combat entry, only uncommitted intact printed bridges are offered. */
export function campaignDemolishableBridges(state: Readonly<CampaignTurnState>, board: CampaignGroundMovementBoard, id: string, hex: string) {
  const bridges: CampaignVolgaBridge[] = []
  for (const near of board.map.neighbors(hex)) {
    const key = edgeKey(hex, near)
    const crossing = board.volgaCrossingAt?.(state, id, hex, near)
    if (!state.volgaBridgeDecisions?.[key] && crossing?.bridge === 'intact' && crossing.routes.length) {
      bridges.push({ id: key, hexside: hex < near ? [hex, near] : [near, hex] })
    }
  }
  return bridges
}

/** TTW 1.5b. Only enemy occupation by an attack-capable combat unit erases work. */
export function reconcileCampaignBridgeRepairs(state: Readonly<CampaignTurnState>, board: CampaignGroundMovementBoard): CampaignTurnState {
  const repairs = Object.entries(state.volgaBridgeRepairs ?? {})
  if (!repairs.length) return state
  const occupied = { axis: new Set<string>(), soviet: new Set<string>() }
  for (const [id, counter] of Object.entries(state.counters)) {
    if (counter.location.kind !== 'map' || counter.kind === 'aircraft') continue
    const profile = board.profileOf(state, id)
    if (!profile?.combat || !profile.attackCapable || !groundModeEffect(campaignCounterGroundMode(counter, profile.inCombatMode)).canAttack) continue
    const hex = board.map.resolveHex(counter.location.hex)
    if (hex) occupied[counter.side].add(hex)
  }
  const remaining = repairs.filter(([id, { side }]) => {
    const enemy = occupied[side === 'axis' ? 'soviet' : 'axis']
    return id.split('|').every((hex) => !enemy.has(hex))
  })
  return remaining.length === repairs.length ? state : { ...state, volgaBridgeRepairs: Object.fromEntries(remaining) }
}

export function finishReadyVolgaBridgeRepairs(state: Readonly<CampaignTurnState>, side: Side): CampaignTurnState {
  const repairs = Object.entries(state.volgaBridgeRepairs ?? {})
  const ready = repairs.filter(([, repair]) => repair.side === side && bridgeRepairReady(repair.phases))
  if (!ready.length) return state
  const volgaBridgeDecisions = { ...state.volgaBridgeDecisions }
  const volgaBridgeRepairs = { ...state.volgaBridgeRepairs }
  for (const [id] of ready) {
    volgaBridgeDecisions[id] = 'repaired'
    delete volgaBridgeRepairs[id]
  }
  return { ...state, volgaBridgeDecisions, volgaBridgeRepairs }
}

export function recordCampaignBridgeDecisions(state: Readonly<CampaignTurnState>, bridges: readonly CampaignVolgaBridge[],
  blow: readonly string[]): CampaignTurnState {
  const selected = new Set(blow)
  if (selected.size !== blow.length || blow.some((id) => !bridges.some((bridge) => bridge.id === id))) {
    throw new Error('Choose distinct offered Volga bridges')
  }
  const volgaBridgeDecisions = { ...state.volgaBridgeDecisions }
  for (const { id } of bridges) volgaBridgeDecisions[id] = selected.has(id) ? 'blown' : 'kept'
  return { ...state, volgaBridgeDecisions }
}
