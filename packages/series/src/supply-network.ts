import type { Mobility, StepCost } from './ground-map.ts'
import { incomingTraceCoverage, traceReach } from './trace-path.ts'
import { TraceTargets } from './trace-targets.ts'

export interface SupplyExtender {
  hex: string
  range: number
  mobility: Mobility
}

export interface SupplyHeadquarter {
  id?: string
  hex: string
  throwRange: number
  mobility: Mobility
  selfContained?: boolean
}

export interface SupplyNetworkBoard {
  hasHex(hex: string): boolean
  neighbors(hex: string): readonly string[]
  /** Predecessors in the same geometric graph; optional for callers with directed/custom maps. */
  incomingNeighbors?(hex: string): readonly string[]
  railNeighbors?(hex: string): readonly string[]
  traceCost(from: string, to: string, mobility: Mobility): StepCost
  railCanTrace(from: string, to: string): boolean
  detrainable(hex: string): boolean
}

export interface SupplyNetworkPosition {
  sources: ReadonlySet<string>
  controlled: ReadonlySet<string>
  enemyCombat: ReadonlySet<string>
  unnegatedEnemyZoc: ReadonlySet<string>
  headquarters: readonly SupplyHeadquarter[]
  extenders?: readonly SupplyExtender[]
}

export interface SupplyTraceOption {
  kind: 'direct' | 'hq' | 'self-contained'
  from: string
  source: string
  headquarters?: string
}

/** OCS 12.3, 12.6 and 12.7. One network instance represents an immutable board snapshot. */
export function supplyNetwork(board: SupplyNetworkBoard, state: SupplyNetworkPosition) {
  const adjacency = new Map<string, readonly string[]>()
  function neighbors(hex: string) {
    const cached = adjacency.get(hex)
    if (cached) return cached
    const result = board.neighbors(hex)
    adjacency.set(hex, result)
    return result
  }
  const incomingAdjacency = new Map<string, readonly string[]>()
  function incoming(hex: string) {
    if (board.incomingNeighbors === board.neighbors) return neighbors(hex)
    const cached = incomingAdjacency.get(hex)
    if (cached) return cached
    const result = board.incomingNeighbors!(hex)
    incomingAdjacency.set(hex, result)
    return result
  }
  const eligibility = new Map<string, boolean>()
  function eligible(id: string) {
    const cached = eligibility.get(id)
    if (cached !== undefined) return cached
    const result = board.hasHex(id) && !state.enemyCombat.has(id)
    eligibility.set(id, result)
    return result
  }
  const railAccessible = (id: string) => eligible(id) && !state.unnegatedEnemyZoc.has(id)
  const allows = (hex: string, mobility: Mobility) => eligible(hex) && (mobility !== 'truck' || !state.unnegatedEnemyZoc.has(hex))
  const railNeighbors = (hex: string) => board.railNeighbors?.(hex) ?? neighbors(hex)
  const costs: Record<Mobility, Map<string, Map<string, StepCost>>> = {
    leg: new Map(), truck: new Map(), track: new Map(),
  }
  function traceCost(from: string, to: string, mobility: Mobility): StepCost {
    const byOrigin = costs[mobility]
    let edges = byOrigin.get(from)
    if (!edges) {
      edges = new Map()
      byOrigin.set(from, edges)
    }
    const cached = edges.get(to)
    if (cached !== undefined) return cached
    const cost = board.traceCost(from, to, mobility)
    edges.set(to, cost)
    return cost
  }
  const ranges = new Map<string, ReadonlyMap<string, number>>()
  function reach(origin: string, range: number, mobility: Mobility) {
    const key = [origin, range, mobility].join(':')
    const stored = ranges.get(key)
    if (stored) return stored
    const result = traceReach({ neighbors }, origin, range, (id) => allows(id, mobility), (from, to) => traceCost(from, to, mobility))
    ranges.set(key, result)
    return result
  }

  // OCS 12.3c. The final adjacent hexside does not consume movement points.
  const reaches = (within: ReadonlyMap<string, number>, id: string) =>
    within.has(id) || neighbors(id).some((near) => within.has(near))
  const canDraw = (origin: string, source: string, mobility: Mobility) => reaches(reach(origin, 5, mobility), source)
  const canThrow = (hq: SupplyHeadquarter, hex: string) => reaches(reach(hq.hex, hq.throwRange, hq.mobility), hex)
  const railNode = (hex: string) => railAccessible(hex) && (!board.detrainable(hex) || state.controlled.has(hex))
  const sources = new Set<string>()
  const sourceTargets = new TraceTargets(neighbors)
  function addSource(hex: string) {
    sources.add(hex)
    sourceTargets.add(hex)
  }
  const railSeen = new Set<string>()
  let railTargets: TraceTargets | undefined
  const queue: string[] = []
  function addRail(hex: string) {
    if (railSeen.has(hex)) return
    railSeen.add(hex)
    railTargets?.add(hex)
    queue.push(hex)
    if (board.detrainable(hex) && state.controlled.has(hex)) addSource(hex)
  }
  const outgoingRail = (link: SupplyExtender) => [link.hex, ...neighbors(link.hex)]
    .filter((hex) => railNode(hex) && railNeighbors(hex).some((near) => board.railCanTrace(hex, near)))
  function reachesRail(within: ReadonlyMap<string, number>) {
    if (!railTargets) {
      railTargets = new TraceTargets(neighbors)
      for (const hex of railSeen) railTargets.add(hex)
    }
    return railTargets.intersects(within)
  }
  function connectsExtender(link: SupplyExtender) {
    if (!railAccessible(link.hex)) return false
    const reachable = reach(link.hex, link.range, link.mobility)
    return sourceTargets.intersects(reachable) ||
      (outgoingRail(link).length > 0 && reachesRail(reachable))
  }
  let connected = false
  function connectSources() {
    if (connected) return
    for (const source of state.sources) if (railAccessible(source)) addSource(source)
    for (const source of sources) addRail(source)
    let examined = 0
    const pending = new Set(state.extenders)
    // Grow from genuine sources. A disconnected cycle cannot make itself a source.
    while (true) {
      while (examined < queue.length) {
        const from = queue[examined++]!
        for (const to of railNeighbors(from)) if (railNode(to) && board.railCanTrace(from, to)) addRail(to)
      }
      let linked = false
      for (const extender of pending) {
        if (!connectsExtender(extender)) continue
        addSource(extender.hex)
        for (const hex of outgoingRail(extender)) addRail(hex)
        pending.delete(extender)
        linked = true
      }
      if (!linked) break
    }
    connected = true
  }
  function canConnectExtender(link: SupplyExtender) {
    connectSources()
    return connectsExtender(link)
  }
  const sourceMatches = new Map<string, readonly string[]>()
  function drawSources(origin: string, mobility: Mobility) {
    const key = [origin, mobility].join(':')
    const cached = sourceMatches.get(key)
    if (cached) return cached
    const result = sourceTargets.matching(reach(origin, 5, mobility))
    sourceMatches.set(key, result)
    return result
  }

  let throwingByHex: Map<string, number[]> | undefined
  function headquartersInRange(hex: string) {
    if (!throwingByHex) {
      throwingByHex = new Map()
      for (const [index, hq] of state.headquarters.entries()) {
        for (const reached of reach(hq.hex, hq.throwRange, hq.mobility).keys()) {
          const ids = throwingByHex.get(reached) ?? []
          ids.push(index)
          throwingByHex.set(reached, ids)
        }
      }
    }
    const candidates = new Set<number>()
    for (const reached of [hex, ...neighbors(hex)]) {
      for (const index of throwingByHex.get(reached) ?? []) candidates.add(index)
    }
    return [...candidates].sort((a, b) => a - b).map((index) => state.headquarters[index]!)
  }

  function trace(hex: string, mobility: Mobility = 'truck'): SupplyTraceOption[] {
    if (!eligible(hex)) return []
    connectSources()
    const options = drawSources(hex, mobility)
      .map((source): SupplyTraceOption => ({ kind: 'direct', from: hex, source }))
    for (const hq of headquartersInRange(hex)) {
      const headquarters = hq.id ? { headquarters: hq.id } : {}
      if (hq.selfContained) {
        options.push({ kind: 'self-contained', from: hq.hex, source: hq.hex, ...headquarters })
        continue
      }
      const linked = drawSources(hq.hex, hq.mobility)
      for (const source of linked) options.push({ kind: 'hq', from: hq.hex, source, ...headquarters })
    }
    return options
  }

  const coverage = new Map<Mobility, ReadonlySet<string> | null>()
  let hqCoverage: ReadonlySet<string> | undefined
  function prepareTraceCoverage(mobility: Mobility = 'truck') {
    if (!board.incomingNeighbors || coverage.has(mobility)) return
    connectSources()
    const targets = [...sources].flatMap((source) => [source, ...neighbors(source)])
    const direct = incomingTraceCoverage(targets, 5, incoming, (hex) => allows(hex, mobility),
      (from, to) => traceCost(from, to, mobility))
    if (!direct) {
      coverage.set(mobility, null)
      return
    }
    if (!hqCoverage) {
      const supplied = new Set<string>()
      for (const hq of state.headquarters) {
        if (!hq.selfContained && !sourceTargets.intersects(reach(hq.hex, 5, hq.mobility))) continue
        for (const reached of reach(hq.hex, hq.throwRange, hq.mobility).keys()) {
          supplied.add(reached)
          for (const hex of incoming(reached)) if (eligible(hex)) supplied.add(hex)
        }
      }
      hqCoverage = supplied
    }
    for (const hex of hqCoverage) direct.add(hex)
    coverage.set(mobility, direct)
  }

  function hasTrace(hex: string, mobility: Mobility = 'truck'): boolean {
    if (!eligible(hex)) return false
    const prepared = coverage.get(mobility)
    if (prepared) return prepared.has(hex)
    connectSources()
    return sourceTargets.intersects(reach(hex, 5, mobility)) || headquartersInRange(hex).some((hq) =>
      hq.selfContained || sourceTargets.intersects(reach(hq.hex, 5, hq.mobility)))
  }

  function canUseDump(location: string, source: string, mobility: Mobility = 'truck'): boolean {
    if (!eligible(location) || !eligible(source)) return false
    return canDraw(location, source, mobility) || headquartersInRange(location).some((hq) => canDraw(hq.hex, source, hq.mobility))
  }
  function canDrawDump(location: string, source: string, mobility: Mobility = 'truck') {
    return eligible(location) && eligible(source) && canDraw(location, source, mobility)
  }
  function canUseDumpVia(hqId: string, location: string, source: string) {
    const hq = state.headquarters.find((candidate) => candidate.id === hqId)
    return Boolean(hq && eligible(hq.hex) && eligible(location) && eligible(source) &&
      canDraw(hq.hex, source, hq.mobility) && canThrow(hq, location))
  }
  function inThrowRange(hqId: string, location: string) {
    const hq = state.headquarters.find((candidate) => candidate.id === hqId)
    return Boolean(hq && canThrow(hq, location))
  }

  function hasConnectedUnloadSite(hex: string): boolean {
    connectSources()
    return board.detrainable(hex) && state.controlled.has(hex) && railSeen.has(hex)
  }

  return { trace, hasTrace, prepareTraceCoverage, canUseDump, canDrawDump, canUseDumpVia, inThrowRange, canConnectExtender, hasConnectedUnloadSite }
}
