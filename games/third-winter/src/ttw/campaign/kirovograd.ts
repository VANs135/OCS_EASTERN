export const kirovogradScenario = '09-kirovograd-armor-defense'

// Chinese Third Winter Scenario Book pp.62–64, Armor Defense.
export const kirovogradOpening = { weather: { ground: 'freeze', flight: 'limited' }, first: 'soviet' } as const
export const kirovogradDates = ['1944-01-05', '1944-01-08', '1944-01-12', '1944-01-15', '1944-01-19'] as const
export const kirovogradRadiusCenters = new Set(['D10.30', 'D14.26'])

// Chinese Third Winter Scenario Book pp.62–63. All amounts are physical supply tokens (T).
export const kirovogradSovietSupplyTokens = [8, 8, 4, 4, 3] as const
export const kirovogradAxisSupplyPerHq = 4

export function kirovogradAxisReceivesSupply(name: string) {
  return name === 'Ge HQ 8 Army' || /^Ge HQ .+ Corps$/.test(name)
}

// Denominations used to represent the scenario's ordinary Truck Points.
export const kirovogradTruckMix = {
  axis: { points: 2, refs: ['Axis Truck 2/45'] },
  soviet: { points: 3, refs: ['Sov Truck 2/45', 'Sov Truck'] },
} as const

// Chinese Third Winter Scenario Book p.62. The scenario names the city; the map database prints it on one hex.
export const kirovogradCityName = 'Kirovograd'

// p.62 and p.64. The 29th Tank Corps may not move until it is released.
export const kirovogradTankCorps = { formation: '29.Tk', releaseRadius: 5 } as const
/** Reason carried by every held 29th Tank Corps counter. */
export const kirovogradTankCorpsHold = 'ttw-scenario-9:29th-tank-corps'
export const kirovogradGermanNation = 'Ge'

/** p.62. The corps is released when Kirovograd is liberated, or once a German unit has come within five hexes of it. */
export function kirovogradTankCorpsReleased(facts: { kirovogradLiberated: boolean; germanWithin: boolean }) {
  return facts.kirovogradLiberated || facts.germanWithin
}

// p.62 and p.63. Both sides use air support only in stated turns.
export const kirovogradAircraftThrough = { axis: 5, soviet: 3 } as const

export interface KirovogradLosses {
  /** Axis units destroyed in armored or mechanized multi-unit formations. */
  axisArmorFormationUnits: number
  /** Soviet tank, mechanized and motorized units destroyed in multi-unit formations. */
  sovietArmorUnits: number
  /** Axis HQs destroyed. TTW 2.3b-c score Army and Army Group HQs a second time, by the user's ruling. */
  axisHq: { total: number; army: number; armyGroup: number }
}

export type KirovogradOutcome = { outcome: 'axis' | 'soviet'; level: 'major' | 'minor' }

/** Scenario Book p.62 with TTW 2.3b-c. Losses are destruction events, not the units currently in the dead pile. */
export function kirovogradVictoryPoints(
  facts: KirovogradLosses & { kirovogradLiberated: boolean; kirovogradSovietAtEnd: boolean },
) {
  const { axisHq } = facts
  const counts = [facts.axisArmorFormationUnits, facts.sovietArmorUnits, axisHq.total, axisHq.army, axisHq.armyGroup]
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) throw new Error('Invalid Kirovograd loss count')
  const soviet = Number(facts.kirovogradLiberated) + Number(facts.kirovogradSovietAtEnd) + facts.axisArmorFormationUnits +
    Math.floor(axisHq.total / 2) + axisHq.army + 2 * axisHq.armyGroup
  const axis = Math.floor(facts.sovietArmorUnits / 2)
  return { soviet, axis, net: soviet - axis }
}

/** Scenario Book p.62. Net VP of zero or less is an Axis major victory, from five a Soviet major victory. */
export function kirovogradOutcome(net: number): KirovogradOutcome {
  if (!Number.isSafeInteger(net)) throw new Error('Invalid Kirovograd net VP')
  if (net <= 0) return { outcome: 'axis', level: 'major' }
  if (net <= 2) return { outcome: 'axis', level: 'minor' }
  return { outcome: 'soviet', level: net >= 5 ? 'major' : 'minor' }
}
