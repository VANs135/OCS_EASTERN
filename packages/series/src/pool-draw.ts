import { pickIndex } from './rng.ts'
import type { RngState } from './state-types.ts'

export interface PoolDraw<T> {
  item: T
  before: number
  after: number
}

/** Draw distinct physical entries from a finite pool without modifying the input. */
export function drawWithoutReplacement<T>(rng: RngState, pool: readonly T[], count: number) {
  if (!Number.isSafeInteger(count) || count < 0 || count > pool.length) throw new Error('Invalid pool draw count')
  const remaining = [...pool]
  const draws: PoolDraw<T>[] = []
  let current = rng
  for (let i = 0; i < count; i++) {
    const selected = pickIndex(current, remaining.length)
    const item = remaining.splice(selected.value, 1)[0]!
    draws.push({ item, before: current.drawCount, after: selected.rng.drawCount })
    current = selected.rng
  }
  return { rng: current, draws, remaining }
}
