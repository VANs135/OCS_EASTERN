import type { Die } from './dice.ts'

// OCS v4.3 Charts p.2. Rows list the upper bounds for 0, 1, 2 and 4 losses, by AR 0–5.
const thresholds = [[1, 3, 5, 7], [2, 4, 6, 8], [3, 5, 7, 9], [5, 7, 9, 11], [7, 9, 10, 11], [8, 10, 11, 12]] as const
const losses = [0, 1, 2, 4] as const

export function attritionLoss(steps: number, rating: number, dice: readonly [Die, Die]): number {
  const row = thresholds[rating]
  if (!Number.isSafeInteger(steps) || steps < 1 || !row) throw new Error('Invalid stack for attrition')
  const total = dice[0] + dice[1] + (steps >= 5 ? 3 : 0)
  const result = row.findIndex((limit) => total <= limit)
  return result < 0 ? steps : Math.min(steps, losses[result]!)
}
