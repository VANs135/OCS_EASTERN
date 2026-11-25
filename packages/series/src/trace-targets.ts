/** Index a target and its neighbors, preserving target insertion order. */
export class TraceTargets {
  private readonly ids: string[] = []
  private readonly byHex = new Map<string, number[]>()
  private readonly seen = new Set<string>()
  private readonly neighbors: (hex: string) => readonly string[]

  constructor(neighbors: (hex: string) => readonly string[]) {
    this.neighbors = neighbors
  }

  add(id: string) {
    if (this.seen.has(id)) return
    this.seen.add(id)
    const index = this.ids.length
    this.ids.push(id)
    for (const hex of new Set([id, ...this.neighbors(id)])) {
      const targets = this.byHex.get(hex) ?? []
      targets.push(index)
      this.byHex.set(hex, targets)
    }
  }

  intersects(within: ReadonlyMap<string, number>): boolean {
    for (const hex of within.keys()) if (this.byHex.has(hex)) return true
    return false
  }

  matching(within: ReadonlyMap<string, number>): string[] {
    const found = new Set<number>()
    for (const hex of within.keys()) {
      for (const index of this.byHex.get(hex) ?? []) found.add(index)
    }
    return [...found].sort((a, b) => a - b).map((index) => this.ids[index]!)
  }
}
