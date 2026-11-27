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
  /**
   * Rails the caller believes it is entering. The actual conversion is hex-wide:
   * 13.3f-B converts the rail hex, not a selected subset of its outgoing edges.
   */
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

  // 13.3f-B: conversion happens on entering a rail hex, so every rail edge at
  // that hex changes gauge together. A per-edge subset would leave a half-
  // converted junction and invent a second railhead on the same boundary.
  const railEdges = board.map.neighbors(hex).flatMap((to) => {
    const edge = campaignRailEdge(state, board.map, network, hex, to)
    return edge ? [{ to, edge }] : []
  })
  if (!railEdges.length) return refused('rail-edge-not-convertible')
  for (const to of connections) {
    if (!railEdges.some((candidate) => candidate.to === to)) return refused('rail-edge-not-convertible')
  }
  const gauge = ttwRailGauge(side)
  const edges = { ...state.railGaugeByEdge }
  let changedGauge = false
  for (const { to, edge } of railEdges) {
    if (edge.gauge === gauge) continue
    edges[edgeKey(hex, to)] = gauge
    changedGauge = true
  }
  if (!changedGauge) return refused('rail-edge-not-convertible')
  const changed = new Set(movement.railConvertedHexes)
  changed.add(hex)
  return { ok: true as const, settled: { ...state, railGaugeByEdge: edges, groundMovement: { ...movement,
    railConversionCount: { ...movement.railConversionCount, [id]: converted + 1 }, railConvertedHexes: [...changed] } } }
}
