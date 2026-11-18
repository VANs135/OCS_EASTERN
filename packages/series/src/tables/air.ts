import { roll2d6, rollDie } from '../rng.ts'
import type { RngState } from '../state-types.ts'

/** OCS v4.3 Air Combat Table (14.3e). The loss die applies to every aborting aircraft. */
export function rollAirCombat(rng: RngState, attack: number, defense: number) {
  const combat = roll2d6(rng)
  const loss = rollDie(combat.rng)
  const total = combat.value.total + attack - defense
  return { rng: loss.rng, combatDice: combat.value.faces, total, lossDie: loss.value,
    attackerAborts: total <= 7, defenderAborts: total >= 7, stepLoss: loss.value >= 5 }
}

/** OCS v4.3 Mission Loss Table (14.4f). Indices follow the declared stack order. */
export function flakLossCandidates(barrage: readonly number[], die: number): readonly number[] {
  if (barrage.length === 1) return [0]
  if (barrage.length === 2) return [die <= 3 ? 0 : 1]
  if (barrage.length === 3) return [Math.floor((die - 1) / 2)]
  if (die <= 4) return [die - 1]
  const strength = die === 5 ? Math.min(...barrage) : Math.max(...barrage)
  return barrage.flatMap((rating, index) => rating === strength ? [index] : [])
}
