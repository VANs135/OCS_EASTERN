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

/** Steps of the route the march had committed when it settled. An interrupted march commits only up to its pause. */
function committedSteps(state: Readonly<CampaignTurnState>, route: readonly string[], resolveHex: (hex: string) => string) {
  const pause = state.groundMovement?.interruption?.hex
  return pause === undefined ? route.length : Math.max(0, route.indexOf(resolveHex(pause)) + 1)
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
    const route = path.map(canonical)
    const cityIndex = route.indexOf(city)
    const committed = committedSteps(state, route, canonical)
    // Only a mover that actually entered the city liberates it; one that stopped short does not, even if a stack-mate went on.
    const kirovogradLiberated = cityIndex >= 0 && movers.some(({ id, combat, stepsLeft }) =>
      combat && state.counters[id]?.side === 'soviet' && cityIndex < Math.min(stepsLeft, committed))
    if (!kirovogradTankCorpsReleased({ kirovogradLiberated, germanWithin })) return []
    return Object.keys(state.counters).filter((id) => state.counters[id]?.held === kirovogradTankCorpsHold)
  }
}
