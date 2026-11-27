// Scenario Book p.62: aircraft are usable only through a stated game turn.
// The mission layer calls this before a sortie; it is not an air-combat modifier.

import type { CampaignCounter } from './campaign-reinforcement-state.ts'

/** Inclusive last-turn gate. An aircraft with no scenario limit is always available. */
export function aircraftAvailabilityRefusal(
  counter: Pick<CampaignCounter, 'kind' | 'availableThrough'> | undefined,
  turn: number,
): string | null {
  if (!counter || counter.kind !== 'aircraft') return 'scenario-aircraft-counter-required'
  if (!Number.isSafeInteger(turn) || turn < 1) return 'scenario-air-turn-invalid'
  if (counter.availableThrough !== undefined &&
    (!Number.isSafeInteger(counter.availableThrough) || turn > counter.availableThrough))
    return 'scenario-aircraft-not-available-this-turn'
  return null
}
