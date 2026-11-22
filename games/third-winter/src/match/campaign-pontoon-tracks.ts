import { edgeKey } from '@ocs-eastern/series/ground-map'
import type { Side } from '@ocs-eastern/series/state-types'
import { admitsPontoonTrackBridge } from '../ttw/ground-terrain.ts'
import type { TtwOrdinaryCrossing } from '../ttw/ground-terrain.ts'
import { campaignCombatPontoon } from './campaign-ground-position.ts'
import type { CampaignGroundMap, CampaignGroundProfiles } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface PontoonStepPosition {
  moverAt: string
  ownDeparture: boolean
}

export interface CampaignPontoonTrackMarker {
  id: string
  side: Side
  hexside: readonly [string, string]
}

type Pontoon = { id: string; hex: string; side: Side }

/** Board snapshot for TTW 1.5. Costs and public markers use the same live pontoon positions. */
export function campaignPontoonTrackBoard(map: CampaignGroundMap, profileOf: CampaignGroundProfiles) {
  const snapshots = new WeakMap<Readonly<CampaignTurnState>, readonly Pontoon[]>()
  function pontoons(state: Readonly<CampaignTurnState>) {
    const cached = snapshots.get(state)
    if (cached) return cached
    const units = Object.entries(state.counters).flatMap<Pontoon>(([id, unit]) => {
      if (unit.location.kind !== 'map' || unit.kind === 'aircraft') return []
      const profile = profileOf(state, id)
      if (!profile || !campaignCombatPontoon(unit, profile)) return []
      const hex = map.resolveHex(unit.location.hex)
      return hex ? [{ id, hex, side: unit.side }] : []
    })
    snapshots.set(state, units)
    return units
  }

  return {
    connects(state: Readonly<CampaignTurnState>, id: string, from: string, to: string, step?: PontoonStepPosition) {
      const touches = (hex: string) => hex === from || hex === to
      const side = state.counters[id]?.side
      // OCS 13.8b. Only the pontoon that changed orientation may use its former bridge to leave.
      return Boolean(step?.ownDeparture && touches(step.moverAt)) || pontoons(state).some((pontoon) =>
        pontoon.side === side && touches(pontoon.id === id && step ? step.moverAt : pontoon.hex))
    },
    markers(state: Readonly<CampaignTurnState>, crossingAt: (id: string, from: string, to: string) => TtwOrdinaryCrossing | undefined) {
      const markers = new Map<string, CampaignPontoonTrackMarker>()
      for (const { hex, id, side } of pontoons(state)) for (const near of map.neighbors(hex)) {
        if (!admitsPontoonTrackBridge(crossingAt(id, hex, near))) continue
        const key = `${side}:pontoon-track:${edgeKey(hex, near)}`
        markers.set(key, { id: key, side, hexside: hex < near ? [hex, near] : [near, hex] })
      }
      return [...markers.values()]
    },
  }
}
