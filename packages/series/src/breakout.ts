import type { RollDie } from './dice.ts'
import type { Mobility } from './ground-map.ts'

export interface BreakoutUnitFacts {
  combat: boolean
  singleTransportPoint: boolean
  moveMa: number
  hasTrace: boolean
  firstTurnWithoutTrace: boolean
}

export interface BreakoutPathBoard {
  neighbors(hex: string): readonly string[]
  canCross(from: string, to: string, mobility: Mobility): boolean
  enemyCombatAt(hex: string): boolean
  unnegatedEnemyZocAt(hex: string): boolean
}

// Smolensk 4b07878, rules/breakout.ts and the path search in stores/workbench.ts. OCS 12.8e-A.
export function hasBreakoutPath(start: string, mobility: Mobility, tracedFriends: ReadonlySet<string>,
  board: BreakoutPathBoard): boolean {
  if (!tracedFriends.size) return false
  const visited = new Set([start])
  const queue = [start]
  for (let index = 0; index < queue.length; index++) {
    const from = queue[index]!
    if (tracedFriends.has(from)) return true
    for (const to of board.neighbors(from)) {
      if (visited.has(to) || board.enemyCombatAt(to) || !board.canCross(from, to, mobility) ||
        (mobility === 'truck' && board.unnegatedEnemyZocAt(to))) continue
      visited.add(to)
      queue.push(to)
    }
  }
  return false
}

// Smolensk 4b07878, rules/breakout.ts. Test A (path) and B (straight-line distance) separately.
export function breakoutRejection(unit: BreakoutUnitFacts,
  conditions: () => { pathToTracedFriend: () => boolean; nearestTracedCombatDistance: number | null }) {
  if (unit.hasTrace) return 'has-trace-supply'
  if (!unit.combat && !(unit.firstTurnWithoutTrace && unit.singleTransportPoint)) return 'not-eligible-unit'
  if (!Number.isFinite(unit.moveMa) || unit.moveMa < 1) return 'insufficient-printed-ma'
  if (unit.firstTurnWithoutTrace) return null
  const facts = conditions()
  const distance = facts.nearestTracedCombatDistance
  if (distance === null || !Number.isSafeInteger(distance) || distance < 0 || distance > 15) return 'no-traced-combat-unit-within-15'
  if (!facts.pathToTracedFriend()) return 'no-passable-path-to-traced-friend'
  return null
}

/** OCS 12.8e. One die for the attempt. Only success draws the separate return die. */
export function resolveBreakout(turn: number, firstTurnWithoutTrace: boolean, roll: RollDie) {
  const attempt = roll()
  const drm = firstTurnWithoutTrace ? 1 : 0
  if (attempt + drm < 5) return { attempt, drm, result: 'dead-pile' as const }
  const returnDie = roll()
  return { attempt, drm, result: 'return' as const, returnDie, returnTurn: turn + returnDie }
}
