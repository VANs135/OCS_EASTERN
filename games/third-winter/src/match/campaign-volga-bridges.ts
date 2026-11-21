import { edgeKey } from '@ocs-eastern/series/ground-map'
import type { TtwVolgaCrossing } from '../ttw/campaign/volga-movement.ts'
import type { CampaignGroundMovementBoard } from './campaign-movement-board.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export type CampaignBridgeDecision = 'blown' | 'kept'

export interface CampaignVolgaBridge {
  id: string
  hexside: readonly [string, string]
}

export function campaignVolgaBridgeCostState(state: Readonly<CampaignTurnState>, crossing: TtwVolgaCrossing, from: string, to: string) {
  return crossing.bridge === 'intact' && state.volgaBridgeDecisions?.[edgeKey(from, to)] === 'blown'
    ? { ...crossing, bridge: 'blown' as const } : crossing
}

/** TTW 1.4a. At first Soviet combat entry, only uncommitted intact printed bridges are offered. */
export function campaignDemolishableBridges(state: Readonly<CampaignTurnState>, board: CampaignGroundMovementBoard, id: string, hex: string) {
  const bridges: CampaignVolgaBridge[] = []
  for (const near of board.map.neighbors(hex)) {
    const key = edgeKey(hex, near)
    if (!state.volgaBridgeDecisions?.[key] && board.intactVolgaBridgeAt?.(state, id, hex, near)) {
      bridges.push({ id: key, hexside: hex < near ? [hex, near] : [near, hex] })
    }
  }
  return bridges
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
