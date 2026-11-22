import { edgeKey } from '@ocs-eastern/series/ground-map'
import { railConversionRefusal } from '@ocs-eastern/series/rail-conversion'
import type { Side } from '@ocs-eastern/series/state-types'
import { ttwRailGauge } from '../ttw/campaign/rail-gauge.ts'
import { campaignCounterGroundMode } from './campaign-ground-position.ts'
import type { CampaignGroundMovementBoard } from './campaign-movement-board.ts'
import { campaignRailEdge } from './campaign-rail-network.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignRailWork {
  /** One-based entry step for this unit's ground march. */
  step: number
  /** Connected railway hexes whose edges at the entered hex are to change gauge. */
  connections: readonly string[]
}

/** Called with the board immediately after entry, before the march can take another step. */
export function planCampaignRailConversion(state: CampaignTurnState, side: Side, board: CampaignGroundMovementBoard,
  id: string, hex: string, connections: readonly string[], rawEnemyZoc: boolean, currentMa: number) {
  const refused = (reason: string) => ({ ok: false as const, reason, hex })
  const network = board.railNetwork
  const counter = state.counters[id]!
  if (!network?.isRepairUnit?.(state, id)) return refused('rail-repair-unit-required')
  const movement = state.groundMovement!
  const converted = movement.railConversionCount?.[id] ?? 0
  const profile = board.profileOf(state, id)
  if (!profile) return refused('rail-conversion-profile-unavailable')
  const mode = campaignCounterGroundMode(counter, profile.inCombatMode)
  const reason = railConversionRefusal({ mode, currentMa, rawEnemyZoc, converted,
    usedNewlyConvertedRail: movement.railRepairRides?.[id]?.usedNewTrack === true })
  if (reason) return refused(reason)

  const gauge = ttwRailGauge(side)
  const edges = { ...state.railGaugeByEdge }
  for (const to of connections) {
    const edge = campaignRailEdge(state, board.map, network, hex, to)
    if (!edge || edge.gauge === gauge) return refused('rail-edge-not-convertible')
    edges[edgeKey(hex, to)] = gauge
  }
  const changed = new Set(movement.railConvertedHexes)
  changed.add(hex)
  return { ok: true as const, settled: { ...state, railGaugeByEdge: edges, groundMovement: { ...movement,
    railConversionCount: { ...movement.railConversionCount, [id]: converted + 1 }, railConvertedHexes: [...changed] } } }
}
