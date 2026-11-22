import type { Side } from './state-types.ts'

// OCS 2.2, 5.9, 5.10, 12.5d and 14.8d. Adapted from Smolensk 5603e52, cleanup.ts (planCleanUp).
export function cleanupUnitMarkers(unit: { side: Side; disorganized?: boolean; exploiting?: boolean; fueled?: boolean }, actor: Side) {
  if (unit.side !== actor || (!unit.disorganized && !unit.exploiting && !unit.fueled)) return undefined
  return { disorganized: false, exploiting: false, fueled: false }
}

export function removeExpiredTrainbusting<Marker extends { side: Side }>(markers: readonly Marker[] | undefined, actor: Side) {
  return markers?.filter((marker) => marker.side === actor)
}
