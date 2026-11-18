import { roll2d6 } from '../rng.ts'
import type { RngState } from '../state-types.ts'

/** OCS v4.3 Air Transport Success Table (14.10d). Standard parachute drop. */
export function rollParachuteDrop(rng: RngState, friendly: boolean, clear: boolean, soviet: boolean) {
  const draw = roll2d6(rng)
  const threshold = 5 + Number(!friendly) + Number(!clear)
  const modifier = soviet ? -1 : 0
  const total = draw.value.total + modifier
  return { rng: draw.rng, dice: draw.value.faces, threshold, modifier, total, success: total >= threshold }
}
