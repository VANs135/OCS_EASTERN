// TTW 1.7a-b. Third Winter rolls abstract replacement points and uses no physical Pax/Eq counters.
// Pax and Ally may be saved across turns; Air, Eq and special replacements are use-it-this-turn-or-lose-it.
// Per-unit rebuild costs and the replacement/special/rebuild chart dice values are data (G03-G05), supplied
// by the match context; this module holds only the game-specific point, eligibility and destination rules.

/** Savable abstract points carried between reinforcement phases (TTW 1.7a). */
export interface TtwReplacementHoldings {
  pax: number
  ally: number
}

export const emptyTtwReplacementHoldings = (): TtwReplacementHoldings => ({ pax: 0, ally: 0 })

/** The four ordinary replacement points. Eq is awarded per AR; Air fills aircraft; Ally is Rum/Hun only. */
export type TtwReplPoint = 'pax' | 'eq' | 'air' | 'ally'

/** TTW 1.7a: only Pax and Ally bank; Air/Eq/SR expire at the end of the reinforcement phase. */
export function ttwPointSavable(point: TtwReplPoint): boolean {
  return point === 'pax' || point === 'ally'
}

/** Normalized facts the point and destination rules need about a counter offered for rebuild. */
export interface TtwRebuildUnitFacts {
  isAircraft: boolean
  nation: string
  /** Unit armor rating; Eq rebuilds a unit of this AR or lower. */
  ar: number
  isGermanTiger: boolean
  /** Alert units may also rebuild at a Kessel HQ (TTW 2.4b). */
  isAlert: boolean
}

/** TTW 1.7a. Which ordinary point may rebuild this counter, before cost and destination. */
export function ttwPointRejection(point: TtwReplPoint, unit: Readonly<TtwRebuildUnitFacts>, awardedAr?: number): string | null {
  if (point === 'air') return unit.isAircraft ? null : 'air-rebuilds-aircraft-only'
  if (unit.isAircraft) return 'ground-point-cannot-rebuild-aircraft'
  if (point === 'ally') return unit.nation === 'Rum' || unit.nation === 'Hun' ? null : 'ally-rebuilds-rumanian-or-hungarian-only'
  if (point === 'eq') {
    if (unit.isGermanTiger) return 'eq-cannot-rebuild-german-tiger'
    if (awardedAr === undefined || !Number.isSafeInteger(awardedAr)) return 'eq-requires-an-awarded-ar'
    if (unit.ar > awardedAr) return 'unit-ar-exceeds-awarded-eq-ar'
    return null
  }
  return null // pax: a ground unit; the rebuild table decides affordability
}

/** TTW 1.7a / 2.4b / 3.5. Legal destination kinds for a rebuild, by side and unit. */
export type TtwRebuildDestinationKind = 'axis-hq' | 'kessel-hq' | 'rvgk' | 'airbase'

export function ttwRebuildDestinationKinds(side: 'axis' | 'soviet', unit: Readonly<TtwRebuildUnitFacts>): readonly TtwRebuildDestinationKind[] {
  if (unit.isAircraft) return ['airbase']
  if (side === 'soviet') return ['rvgk']
  return unit.isAlert ? ['axis-hq', 'kessel-hq'] : ['axis-hq']
}

/** TTW 1.7b. SR categories that rebuild a dead-pile counter for free. Hedgehog needs fortification placement
 * and Alert needs the off-map random pool; both await their own modules. Tiger save when no dead-pile Tiger is
 * available also awaits a persistent replacement-record marker. */
export const ttwSpecialUnitRebuildCategories: readonly string[] = ['artillery', 'assault', 'flak', 'aa', 'hq', 'pontoon', 'tiger']

export function ttwSpecialRebuildsUnit(category: string): boolean {
  return ttwSpecialUnitRebuildCategories.includes(category)
}