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
