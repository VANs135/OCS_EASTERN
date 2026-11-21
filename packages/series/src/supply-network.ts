import type { Mobility, StepCost } from './ground-map.ts'
import { traceReach } from './trace-path.ts'

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

/** OCS 12.3, 12.6 and 12.7. Extracted from the Scorpion supply network. */
export function supplyNetwork(board: SupplyNetworkBoard, state: SupplyNetworkPosition) {
  const eligible = (id: string) => board.hasHex(id) && !state.enemyCombat.has(id)
  const railAccessible = (id: string) => eligible(id) && !state.unnegatedEnemyZoc.has(id)
  const ranges = new Map<string, ReadonlyMap<string, number>>()
  function reach(origin: string, range: number, mobility: Mobility) {
    const key = [origin, range, mobility].join(':')
    const stored = ranges.get(key)
    if (stored) return stored
    const result = traceReach(board, origin, range, (id) => eligible(id) &&
      (mobility !== 'truck' || !state.unnegatedEnemyZoc.has(id)), (from, to) => board.traceCost(from, to, mobility))
    ranges.set(key, result)
    return result
  }

  // OCS 12.3c. The final adjacent hexside does not consume movement points.
  const reaches = (within: ReadonlyMap<string, number>, id: string) =>
    within.has(id) || board.neighbors(id).some((near) => within.has(near))
  const canDraw = (origin: string, source: string, mobility: Mobility) => reaches(reach(origin, 5, mobility), source)
  const canThrow = (hq: SupplyHeadquarter, hex: string) => reaches(reach(hq.hex, hq.throwRange, hq.mobility), hex)
  const railNode = (hex: string) => railAccessible(hex) && (!board.detrainable(hex) || state.controlled.has(hex))
  const sources = new Set([...state.sources].filter(railAccessible))
  const railSeen = new Set<string>()
  const queue: string[] = []
  function addRail(hex: string) {
    if (railSeen.has(hex)) return
    railSeen.add(hex)
    queue.push(hex)
    if (board.detrainable(hex) && state.controlled.has(hex)) sources.add(hex)
  }
  const outgoingRail = (link: SupplyExtender) => [link.hex, ...board.neighbors(link.hex)]
    .filter((hex) => railNode(hex) && board.neighbors(hex).some((near) => board.railCanTrace(hex, near)))
  function canConnectExtender(link: SupplyExtender) {
    if (!railAccessible(link.hex)) return false
    const reachable = reach(link.hex, link.range, link.mobility)
    return [...sources].some((hex) => reaches(reachable, hex)) ||
      (outgoingRail(link).length > 0 && [...railSeen].some((hex) => reaches(reachable, hex)))
  }
  for (const source of sources) addRail(source)
  let examined = 0
  const pending = new Set(state.extenders)
  // Grow from genuine sources. A disconnected cycle cannot make itself a source.
  while (true) {
    while (examined < queue.length) {
      const from = queue[examined++]!
      for (const to of board.neighbors(from)) if (railNode(to) && board.railCanTrace(from, to)) addRail(to)
    }
    let linked = false
    for (const extender of pending) {
      if (!canConnectExtender(extender)) continue
      sources.add(extender.hex)
      for (const hex of outgoingRail(extender)) addRail(hex)
      pending.delete(extender)
      linked = true
    }
    if (!linked) break
  }
  const supplySources = [...sources]
  const hqSources = new Map<SupplyHeadquarter, string[]>()

  function trace(hex: string, mobility: Mobility = 'truck'): SupplyTraceOption[] {
    if (!eligible(hex)) return []
    const options = supplySources.filter((source) => canDraw(hex, source, mobility))
      .map((source): SupplyTraceOption => ({ kind: 'direct', from: hex, source }))
    for (const hq of state.headquarters) {
      if (!canThrow(hq, hex)) continue
      const headquarters = hq.id ? { headquarters: hq.id } : {}
      if (hq.selfContained) {
        options.push({ kind: 'self-contained', from: hq.hex, source: hq.hex, ...headquarters })
        continue
      }
      let linked = hqSources.get(hq)
      if (!linked) {
        linked = supplySources.filter((id) => canDraw(hq.hex, id, hq.mobility))
        hqSources.set(hq, linked)
      }
      for (const source of linked) options.push({ kind: 'hq', from: hq.hex, source, ...headquarters })
    }
    return options
  }

  function canUseDump(location: string, source: string, mobility: Mobility = 'truck'): boolean {
    if (!eligible(location) || !eligible(source)) return false
    return canDraw(location, source, mobility) || state.headquarters.some((hq) =>
      canDraw(hq.hex, source, hq.mobility) && canThrow(hq, location))
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

  return { trace, canUseDump, canDrawDump, canUseDumpVia, inThrowRange, canConnectExtender }
}
