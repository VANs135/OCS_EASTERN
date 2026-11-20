import type { Side } from '@ocs-eastern/series/state-types'
import type { DeployedCounter } from '../import/scorpion-deployment.ts'

/** OCS 5.10. Retain combat/move orientation and clear conflicting markers across the hex. */
export function disorganizeScorpionHex(units: Record<string, DeployedCounter>, hex: string, side: Side) {
  for (const [id, unit] of Object.entries(units)) {
    if (unit.hex !== hex || unit.side !== side) continue
    if (unit.combat) units[id] = { ...unit, disorganized: true, reserve: undefined, exploit: false, exploitRating: undefined }
    else if (unit.organicTruck !== undefined && unit.reserve) units[id] = { ...unit, reserve: undefined }
  }
}
