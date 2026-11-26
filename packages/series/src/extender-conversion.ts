// OCS 12.7a/d/e, 5.7f. From Smolensk extender.ts (canConvertTransportToExtender / planConvertTransportToExtender).
// General transport points (printed 1-5, freely splittable) convert to supply extenders during a movement segment;
// organic trucks never participate (5.7f). Loaded points must unload first (12.7d); each point pays half its own MA (12.7e).

export const EXTENDER_REQUIRED_POINTS = 5
export const EXTENDER_FLIP_MA_FRACTION = 0.5
export const EXTENDER_SEGMENTS = ['movement', 'reaction', 'exploitation'] as const
export type ExtenderMovementSegment = typeof EXTENDER_SEGMENTS[number]
export type ExtenderTransportKind = 'truck' | 'wagon'

export interface ExtenderTransportPoint {
  id: string
  kind: ExtenderTransportKind
  points: number
  /** 12.7e: the point's own printed MA; falls back to the kind default when absent. */
  ma?: number
  /** 12.7e: MP already spent by this point. */
  mpSpent?: number
  /** 12.7d: a loaded point cannot convert until it unloads. */
  loaded?: boolean
}

function ownMa(point: ExtenderTransportPoint, fallbackMa: number): number {
  return point.ma ?? fallbackMa
}
function hasHalfMaLeft(point: ExtenderTransportPoint, fallbackMa: number): boolean {
  if (point.mpSpent === undefined) return true
  const ma = ownMa(point, fallbackMa)
  return ma - point.mpSpent >= ma * EXTENDER_FLIP_MA_FRACTION
}
function convertibleOf(entries: readonly ExtenderTransportPoint[], kind: ExtenderTransportKind, fallbackMa: number) {
  const sameKind = entries.filter((entry) => entry.kind === kind)
  const usable = sameKind.filter((entry) => entry.loaded !== true)
  const points = usable.filter((entry) => hasHalfMaLeft(entry, fallbackMa)).reduce((sum, entry) => sum + entry.points, 0)
  const loadedPoints = sameKind.filter((entry) => entry.loaded === true).reduce((sum, entry) => sum + entry.points, 0)
  const shortMaPoints = usable.filter((entry) => !hasHalfMaLeft(entry, fallbackMa)).reduce((sum, entry) => sum + entry.points, 0)
  return { points, loadedPoints, shortMaPoints }
}

/** 12.7a/d/e: refusal reason for converting transport points to extenders in this hex, or null when allowed. */
export function extenderConversionRefusal(facts: {
  segment: string
  entries: readonly ExtenderTransportPoint[]
  truckMa?: number
  wagonMa?: number
}): string | null {
  if (!(EXTENDER_SEGMENTS as readonly string[]).includes(facts.segment)) return 'extender-wrong-segment'
  const truck = convertibleOf(facts.entries, 'truck', facts.truckMa ?? 20)
  const wagon = convertibleOf(facts.entries, 'wagon', facts.wagonMa ?? 10)
  if (truck.points >= EXTENDER_REQUIRED_POINTS || wagon.points >= EXTENDER_REQUIRED_POINTS) return null
  if ([truck, wagon].some((group) => group.loadedPoints > 0 && group.points + group.loadedPoints >= EXTENDER_REQUIRED_POINTS)) {
    return 'extender-loaded-must-unload'
  }
  if ([truck, wagon].some((group) => group.shortMaPoints > 0 && group.points + group.shortMaPoints >= EXTENDER_REQUIRED_POINTS)) {
    return 'extender-insufficient-ma'
  }
  return 'extender-insufficient-points'
}

export interface ExtenderConversionOption {
  kind: ExtenderTransportKind
  count: number
  consumedPoints: number
  remainder: number
}

/** 12.7a: how many extenders each kind can form from the convertible points in this hex. */
export function extenderConversionOptions(facts: {
  entries: readonly ExtenderTransportPoint[]
  truckMa?: number
  wagonMa?: number
}): ExtenderConversionOption[] {
  const options: ExtenderConversionOption[] = []
  for (const [kind, fallbackMa] of [['truck', facts.truckMa ?? 20], ['wagon', facts.wagonMa ?? 10]] as const) {
    const { points } = convertibleOf(facts.entries, kind, fallbackMa)
    if (points < EXTENDER_REQUIRED_POINTS) continue
    const count = Math.floor(points / EXTENDER_REQUIRED_POINTS)
    options.push({ kind, count, consumedPoints: count * EXTENDER_REQUIRED_POINTS, remainder: points - count * EXTENDER_REQUIRED_POINTS })
  }
  return options
}

export interface ExtenderSwap { transportUnitId: string; points: number }
export interface ExtenderConversionPlan {
  kind: ExtenderTransportKind
  consumedPoints: number
  extenderCount: number
  swaps: ExtenderSwap[]
  removedPoints: number
  leftoverPoints: number
  leftoverPlacement: number[]
  totalCostMa: number
}

/** Smallest-sum subset of candidates whose points reach the target (fewest counters on a tie). */
function minimalSumSubset(entries: readonly ExtenderTransportPoint[], target: number): ExtenderSwap[] {
  let best: { count: number; sum: number; picked: ExtenderSwap[] } | null = null
  for (let mask = 1; mask < (1 << entries.length); mask += 1) {
    let sum = 0
    let count = 0
    const picked: ExtenderSwap[] = []
    for (let i = 0; i < entries.length; i += 1) {
      if ((mask & (1 << i)) === 0) continue
      sum += entries[i]!.points
      count += 1
      picked.push({ transportUnitId: entries[i]!.id, points: entries[i]!.points })
    }
    if (sum < target) continue
    if (best === null || sum < best.sum || (sum === best.sum && count < best.count)) best = { count, sum, picked }
  }
  return best?.picked ?? []
}
function decomposePoints(points: number): number[] {
  const faces: number[] = []
  let rest = points
  while (rest > 0) {
    const face = Math.min(EXTENDER_REQUIRED_POINTS, rest)
    faces.push(face)
    rest -= face
  }
  return faces
}

/** 12.7a/e: replacement plan — which transport counters leave, the leftover that stays, and the per-point MA cost. */
export function planExtenderConversion(facts: {
  kind: ExtenderTransportKind
  count: number
  entries: readonly ExtenderTransportPoint[]
  truckMa?: number
  wagonMa?: number
}): ExtenderConversionPlan | string {
  if (!Number.isSafeInteger(facts.count) || facts.count <= 0) return 'extender-count-positive'
  const fallbackMa = facts.kind === 'truck' ? (facts.truckMa ?? 20) : (facts.wagonMa ?? 10)
  const need = EXTENDER_REQUIRED_POINTS * facts.count
  const group = convertibleOf(facts.entries, facts.kind, fallbackMa)
  if (group.points < need) {
    if (group.loadedPoints > 0 && group.points + group.loadedPoints >= need) return 'extender-loaded-must-unload'
    if (group.shortMaPoints > 0 && group.points + group.shortMaPoints >= need) return 'extender-insufficient-ma'
    return 'extender-insufficient-points'
  }
  const candidates = facts.entries.filter((entry) => entry.kind === facts.kind && entry.loaded !== true && hasHalfMaLeft(entry, fallbackMa))
  const swaps = minimalSumSubset(candidates, need)
  const removedPoints = swaps.reduce((sum, swap) => sum + swap.points, 0)
  const leftoverPoints = removedPoints - need
  const totalCostMa = swaps.reduce((sum, swap) => {
    const entry = candidates.find((item) => item.id === swap.transportUnitId)
    return sum + (entry === undefined ? 0 : ownMa(entry, fallbackMa) * EXTENDER_FLIP_MA_FRACTION)
  }, 0)
  return { kind: facts.kind, consumedPoints: need, extenderCount: facts.count, swaps, removedPoints,
    leftoverPoints, leftoverPlacement: decomposePoints(leftoverPoints), totalCostMa }
}