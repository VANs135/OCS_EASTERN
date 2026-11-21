import type { Die } from './dice.ts'
import type { Side } from './state-types.ts'

// OCS 2.3. One contest from Smolensk 06a9faa, src/engine/turn-driver.ts.
// Keep tied attempts separate so the session can record them and draw fresh dice.
export function rollInitiativeContest(roll: (side: Side) => Die): Side | null {
  const axis = roll('axis') + roll('axis')
  const soviet = roll('soviet') + roll('soviet')
  return axis === soviet ? null : axis > soviet ? 'axis' : 'soviet'
}
