import type { BackupUnit } from '../import/unit-backup.ts'
import type { Definition } from '../import/unit-catalog.ts'
import { campaignHexesWithin } from '../ttw/campaign/hex-range.ts'
import { kirovogradGermanNation, kirovogradTankCorps, kirovogradTankCorpsHold,
  kirovogradTankCorpsReleased } from '../ttw/campaign/kirovograd.ts'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignGroundMovementBoard } from './campaign-movement-board.ts'
import type { CampaignCounter } from './campaign-reinforcement-state.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface KirovogradReleaseData {
  map: CampaignGroundMap
  definitions: ReadonlyMap<string, Definition<BackupUnit>>
  /** The Kirovograd city hex, resolved from the map database. */
  kirovogradHex: string
}

function mapHex(map: CampaignGroundMap, counter: Readonly<CampaignCounter>) {
  return counter.location.kind === 'map' ? map.resolveHex(counter.location.hex) ?? counter.location.hex : undefined
}

/** Hexes the march had entered when it settled. An interrupted march commits only the route up to its pause. */
function reachedPath(state: Readonly<CampaignTurnState>, path: readonly string[], resolveHex: (hex: string) => string) {
  const route = path.map(resolveHex)
  const pause = state.groundMovement?.interruption?.hex
  return pause === undefined ? route : route.slice(0, route.indexOf(resolveHex(pause)) + 1)
}

/** Scenario Book p.62. Kirovograd liberated, or a German unit within five hexes of the corps, releases the whole corps. */
export function kirovogradReleaseRule(data: KirovogradReleaseData): NonNullable<CampaignGroundMovementBoard['releases']> {
  const canonical = (hex: string) => data.map.resolveHex(hex) ?? hex
  const city = canonical(data.kirovogradHex)
  return (state, _side, { path, movers }) => {
    const counters = Object.values(state.counters)
    const near = new Set(counters.filter((counter) => counter.held === kirovogradTankCorpsHold)
      .flatMap((counter) => {
        const hex = mapHex(data.map, counter)
        return hex ? campaignHexesWithin(data.map, hex, kirovogradTankCorps.releaseRadius) : []
      }))
    if (!near.size) return []
    const germanWithin = counters.some((counter) => {
      if (counter.side !== 'axis' || data.definitions.get(counter.definition)?.source.nation !== kirovogradGermanNation) return false
      const hex = mapHex(data.map, counter)
      return hex !== undefined && near.has(hex)
    })
    const reached = reachedPath(state, path, canonical)
    const kirovogradLiberated = movers.some(({ id, combat }) => combat && state.counters[id]?.side === 'soviet' && reached.includes(city))
    if (!kirovogradTankCorpsReleased({ kirovogradLiberated, germanWithin })) return []
    return Object.keys(state.counters).filter((id) => state.counters[id]?.held === kirovogradTankCorpsHold)
  }
}
