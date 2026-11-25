import { tryCampaignHexKey } from '../../import/hex-id.ts'
import type { TtwCampaignMapIndex } from '../../import/campaign-map-index.ts'
import { kirovogradScenario } from './kirovograd.ts'

export type CampaignPlayArea = { kind: 'all-map' } | { kind: 'hex-list'; hexes: readonly string[] }
  | { kind: 'panel-window'; panel: 'A' | 'B' | 'C' | 'D'; columns: readonly [number, number]; rows: readonly [number, number] }

// Scenario 01 uses all four sheets, confirmed by the scenario data and the user.
export function ttwCampaignPlayArea(scenarioId: string): CampaignPlayArea | undefined {
  if (scenarioId === '01-dnepr-battles') return { kind: 'all-map' }
  // Armor Defense, Chinese Scenario Book p.62. These limits refer to printed D-map IDs.
  if (scenarioId === kirovogradScenario) return { kind: 'panel-window', panel: 'D', columns: [1, 31], rows: [23, 35] }
}

/** Apply the scenario boundary to geometric queries. Terrain and occupancy rules run separately. */
export function campaignMapInPlayArea(map: TtwCampaignMapIndex, area: CampaignPlayArea) {
  const indexedHex = (printed: string) => {
    const key = tryCampaignHexKey(printed)
    return key ? map.canonicalByHex.get(key) : undefined
  }
  function scenarioHexes() {
    if (area.kind === 'all-map') return map.onMapHexes
    if (area.kind === 'panel-window') {
      const { panel, columns, rows } = area
      const hexes = new Set<string>()
      for (let col = columns[0]; col <= columns[1]; col++) for (let row = rows[0]; row <= rows[1]; row++) {
        const hex = indexedHex(`${panel}${col}.${row}`)
        if (hex && map.onMapHexes.has(hex)) hexes.add(hex)
      }
      return hexes
    }
    return new Set(area.hexes.map((printed) => {
      const hex = indexedHex(printed)
      if (!hex || !map.onMapHexes.has(hex)) throw new Error(`Unknown on-map hex in campaign play area: ${printed}`)
      return hex
    }))
  }
  const availableHexes: ReadonlySet<string> = scenarioHexes()

  function resolveHex(printed: string) {
    const hex = indexedHex(printed)
    return hex && availableHexes.has(hex) ? hex : undefined
  }
  function neighbors(printed: string) {
    const hex = resolveHex(printed)
    return hex ? map.neighbors(hex).filter((near) => availableHexes.has(near)) : []
  }
  return {
    availableHexes,
    resolveHex,
    terrainAt(printed: string) {
      const hex = resolveHex(printed)
      return hex ? map.terrainAt(hex) : undefined
    },
    neighbors, incomingNeighbors: neighbors,
    connection(from: string, to: string) {
      const a = resolveHex(from)
      const b = resolveHex(to)
      return a && b ? map.connection(a, b) : undefined
    },
  }
}
