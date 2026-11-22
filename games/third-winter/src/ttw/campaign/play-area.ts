import { tryCampaignHexKey } from '../../import/hex-id.ts'
import type { TtwCampaignMapIndex } from '../../import/campaign-map-index.ts'

export type CampaignPlayArea = { kind: 'all-map' } | { kind: 'hex-list'; hexes: readonly string[] }

// Scenario 01 uses all four sheets, confirmed by the scenario data and the user.
export function ttwCampaignPlayArea(scenarioId: string): CampaignPlayArea | undefined {
  if (scenarioId === '01-dnepr-battles') return { kind: 'all-map' }
}

/** Apply the scenario boundary to geometric queries. Terrain and occupancy rules run separately. */
export function campaignMapInPlayArea(map: TtwCampaignMapIndex, area: CampaignPlayArea) {
  const indexedHex = (printed: string) => {
    const key = tryCampaignHexKey(printed)
    return key ? map.canonicalByHex.get(key) : undefined
  }
  const availableHexes: ReadonlySet<string> = area.kind === 'all-map'
    ? map.onMapHexes
    : new Set(area.hexes.map((printed) => {
      const hex = indexedHex(printed)
      if (!hex || !map.onMapHexes.has(hex)) throw new Error(`Unknown on-map hex in campaign play area: ${printed}`)
      return hex
    }))

  function resolveHex(printed: string) {
    const hex = indexedHex(printed)
    return hex && availableHexes.has(hex) ? hex : undefined
  }
  return {
    availableHexes,
    resolveHex,
    neighbors(printed: string) {
      const hex = resolveHex(printed)
      return hex ? map.neighbors(hex).filter((near) => availableHexes.has(near)) : []
    },
    connection(from: string, to: string) {
      const a = resolveHex(from)
      const b = resolveHex(to)
      return a && b ? map.connection(a, b) : undefined
    },
  }
}
