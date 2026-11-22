import type { Mobility, StepCost } from '@ocs-eastern/series/ground-map'
import type { Side } from '@ocs-eastern/series/state-types'
import { supplyNetwork } from '@ocs-eastern/series/supply-network'
import type { SupplyNetworkBoard, SupplyNetworkPosition } from '@ocs-eastern/series/supply-network'
import { ttwRailGauge } from '../ttw/campaign/rail-gauge.ts'
import { campaignGroundPosition } from './campaign-ground-position.ts'
import type { CampaignGroundMap, CampaignGroundProfiles } from './campaign-ground-position.ts'
import { campaignKhersonRailTrace } from './campaign-kherson-trace.ts'
import { campaignRailEdge } from './campaign-rail-network.ts'
import type { CampaignRailNetwork } from './campaign-rail-network.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignSupplyFacts extends Pick<SupplyNetworkPosition, 'sources' | 'controlled' | 'headquarters' | 'extenders'> {
  /** Printed or currently created unload facility. The network derives its supply connection. */
  detrainable: SupplyNetworkBoard['detrainable']
  /** Legacy network binding for boards without normalized rail edges. */
  railCanTrace?: SupplyNetworkBoard['railCanTrace']
  /** Work-specific restrictions in addition to current gauge on a normalized network. */
  railTraceBlocked?(from: string, to: string): boolean
}

export interface CampaignSupplyBoard {
  map: CampaignGroundMap
  profileOf: CampaignGroundProfiles
  railNetwork?: CampaignRailNetwork
  traceCost(state: Readonly<CampaignTurnState>, from: string, to: string, mobility: Mobility): StepCost
}

export function campaignTraceSupply(state: Readonly<CampaignTurnState>, side: Side, board: CampaignSupplyBoard, facts: CampaignSupplyFacts) {
  const { map, railNetwork } = board
  const ground = campaignGroundPosition(state, side, map, board.profileOf)
  if (!ground || (!railNetwork && !facts.railCanTrace)) return undefined
  const sources = [...facts.sources].map((hex) => map.resolveHex(hex))
  const controlled = [...facts.controlled].map((hex) => map.resolveHex(hex))
  const headquarters = facts.headquarters.map((hq) => ({ ...hq, hex: map.resolveHex(hq.hex) }))
  const extenders = (facts.extenders ?? []).filter((unit) => side !== 'soviet' || unit.mobility !== 'truck')
    .map((unit) => ({ ...unit, hex: map.resolveHex(unit.hex) }))
  if (side === 'soviet') {
    for (const unit of Object.values(state.counters)) {
      if (unit.side !== side || !unit.specialTruckExtender || unit.location.kind !== 'map') continue
      const { range } = unit.specialTruckExtender
      if (!Number.isFinite(range) || range <= 0) return undefined
      extenders.push({ hex: map.resolveHex(unit.location.hex), range, mobility: 'truck' })
    }
  }
  if (!sources.every(knownHex) || !controlled.every(knownHex) || !headquarters.every(hasHex) || !extenders.every(hasHex)) {
    return undefined
  }
  const canTrace = railNetwork
    ? (from: string, to: string) => campaignRailEdge(state, map, railNetwork, from, to)?.gauge === ttwRailGauge(side) && !facts.railTraceBlocked?.(from, to)
    : (from: string, to: string) => facts.railCanTrace?.(from, to) === true
  const supplyBoard: SupplyNetworkBoard = { hasHex: (hex) => map.resolveHex(hex) === hex, neighbors: (hex) => map.neighbors(hex),
    traceCost: (from, to, mobility) => board.traceCost(state, from, to, mobility),
    railCanTrace: canTrace, detrainable: (hex) => facts.detrainable(hex) }
  const position = { sources: new Set(sources), controlled: new Set(controlled), headquarters,
    enemyCombat: ground.enemyCombat, unnegatedEnemyZoc: ground.unnegatedEnemyZoc }
  const network = supplyNetwork({ ...supplyBoard, ...campaignKhersonRailTrace(map, state.weatherHistory.ice, canTrace) }, { ...position, extenders })
  let cargoNetwork: ReturnType<typeof supplyNetwork> | undefined
  return { ground, network, hasRailCargoUnloadSite(hex: string) {
    // 13.3c and TTW 1.4d. Only Trace Supply uses extenders or the Kherson link.
    cargoNetwork ??= supplyNetwork(supplyBoard, position)
    return cargoNetwork.hasConnectedUnloadSite(hex)
  } }
}

function knownHex(hex: string | undefined): hex is string {
  return hex !== undefined
}

function hasHex<T extends { hex: string | undefined }>(value: T): value is T & { hex: string } {
  return knownHex(value.hex)
}
