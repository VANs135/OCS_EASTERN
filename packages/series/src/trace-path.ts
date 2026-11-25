import type { GroundMap, StepCost } from './ground-map.ts'

interface PendingHex {
  hex: string
  spent: number
  order: number
}

const earlier = (a: PendingHex, b: PendingHex) => a.spent < b.spent || (a.spent === b.spent && a.order < b.order)

/** Stable binary heap, shared by forward and reverse searches. */
class TraceQueue {
  private entries: PendingHex[] = []

  push(entry: PendingHex) {
    const heap = this.entries
    heap.push(entry)
    let index = heap.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (!earlier(heap[index]!, heap[parent]!)) break
      const swapped = heap[parent]!
      heap[parent] = heap[index]!
      heap[index] = swapped
      index = parent
    }
  }

  pop(): PendingHex | undefined {
    const heap = this.entries
    const first = heap[0]
    const last = heap.pop()
    if (!last || !heap.length) return first
    heap[0] = last
    let index = 0
    while (true) {
      const left = index * 2 + 1
      const right = left + 1
      let next = index
      if (left < heap.length && earlier(heap[left]!, heap[next]!)) next = left
      if (right < heap.length && earlier(heap[right]!, heap[next]!)) next = right
      if (next === index) break
      const swapped = heap[next]!
      heap[next] = heap[index]!
      heap[index] = swapped
      index = next
    }
    return first
  }
}

function boundedReach(
  origins: Iterable<string>,
  range: number,
  allows: (hex: string) => boolean,
  neighbors: (hex: string) => readonly string[],
  nextCost: (from: string, to: string, spent: number) => number | undefined,
): ReadonlyMap<string, number> {
  const distances = new Map<string, number>()
  const pending = new Map<string, number>()
  const queue = new TraceQueue()
  let nextOrder = 0
  function enter(hex: string, spent: number) {
    distances.set(hex, spent)
    const order = pending.get(hex) ?? nextOrder++
    pending.set(hex, order)
    queue.push({ hex, spent, order })
  }
  for (const origin of origins) if (allows(origin) && !distances.has(origin)) enter(origin, 0)
  for (let entry = queue.pop(); entry; entry = queue.pop()) {
    const { hex: from, spent, order } = entry
    if (pending.get(from) !== order || distances.get(from) !== spent) continue
    pending.delete(from)
    for (const to of neighbors(from)) {
      if (!allows(to)) continue
      const total = nextCost(from, to, spent)
      if (total === undefined || total > range || total >= (distances.get(to) ?? Infinity)) continue
      enter(to, total)
    }
  }
  return distances
}

/** OCS 12.3d. The caller supplies eligible hexes and terrain costs for the trace mobility. */
export function traceReach(
  map: Pick<GroundMap<unknown>, 'neighbors'>,
  origin: string,
  range: number,
  allows: (hex: string) => boolean,
  stepCost: (from: string, to: string) => StepCost,
): ReadonlyMap<string, number> {
  return boundedReach([origin], range, allows, (hex) => map.neighbors(hex), (from, to, spent) => {
    const step = stepCost(from, to)
    if (step === null || step === 'all' && (from !== origin || range <= 0)) return undefined
    return step === 'all' ? range : spent + step
  })
}

/** Reverse multi-source reach. Every tested edge still uses its forward direction and cost. */
export function incomingTraceCoverage(
  targets: Iterable<string>, range: number,
  incoming: (hex: string) => readonly string[], allows: (hex: string) => boolean,
  stepCost: (from: string, to: string) => StepCost,
): Set<string> | undefined {
  const allCostOrigins = new Set<string>()
  let exact = true
  const numeric = boundedReach(targets, range, allows, incoming, (current, previous, spent) => {
    const step = stepCost(previous, current)
    if (step === 'all') {
      // An all-cost edge may only be the first forward step. It cannot extend a reverse path.
      if (spent === 0 && range > 0) allCostOrigins.add(previous)
      return undefined
    }
    if (step === null) return undefined
    // Whole and half MP preserve exact sums in either direction. Other costs use forward queries.
    if (step < 0 || !Number.isSafeInteger(step * 2)) {
      exact = false
      return undefined
    }
    return spent + step
  })
  return exact ? new Set([...numeric.keys(), ...allCostOrigins]) : undefined
}
