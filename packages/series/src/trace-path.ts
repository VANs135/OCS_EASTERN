import type { GroundMap, StepCost } from './ground-map.ts'

/** OCS 12.3d. The caller supplies eligible hexes and terrain costs for the trace mobility. */
export function traceReach(
  map: Pick<GroundMap<unknown>, 'neighbors'>,
  origin: string,
  range: number,
  allows: (hex: string) => boolean,
  stepCost: (from: string, to: string) => StepCost,
): ReadonlyMap<string, number> {
  const distances = new Map<string, number>()
  if (!allows(origin)) return distances
  distances.set(origin, 0)
  const pending = new Set([origin])
  while (pending.size) {
    let from: string | undefined
    let spent = Infinity
    for (const candidate of pending) {
      const distance = distances.get(candidate)!
      if (distance < spent) {
        from = candidate
        spent = distance
      }
    }
    if (from === undefined) break
    pending.delete(from)
    for (const to of map.neighbors(from)) {
      if (!allows(to)) continue
      const step = stepCost(from, to)
      if (step === null || step === 'all' && (from !== origin || range <= 0)) continue
      const total = step === 'all' ? range : spent + step
      if (total > range || total >= (distances.get(to) ?? Infinity)) continue
      distances.set(to, total)
      pending.add(to)
    }
  }
  return distances
}
