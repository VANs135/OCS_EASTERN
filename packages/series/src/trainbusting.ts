import type { Mobility } from './ground-map.ts'
import { railCapacityFactor } from './rail-transport.ts'
import type { Side } from './state-types.ts'

export interface TrainbustingMarker {
  hex: string
  side: Side
}

/** OCS 14.8b-c. A side's markers only impede its opponent. */
export function inTrainbustingZone(markers: readonly TrainbustingMarker[], side: Side, hex: string,
  neighbors: (hex: string) => readonly string[], movement: Mobility | 'rail'): boolean {
  return markers.some((marker) => marker.side !== side &&
    (marker.hex === hex || (movement !== 'leg' && neighbors(marker.hex).includes(hex))))
}

/** OCS 13.3a and 14.8c. The route includes loading and unloading hexes. */
export function railCapacityCost(cargoEquivalents: number, route: readonly string[], allMultiTrack: boolean,
  markers: readonly TrainbustingMarker[], side: Side, neighbors: (hex: string) => readonly string[]) {
  const hasTrainbustingZone = route.some((hex) => inTrainbustingZone(markers, side, hex, neighbors, 'rail'))
  return cargoEquivalents * railCapacityFactor({ hasTrainbustingZone, entirePathMultiTrack: allMultiTrack })
}
