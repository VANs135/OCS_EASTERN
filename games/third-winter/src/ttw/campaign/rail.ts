export interface CleanupRailHex {
  id: string
  gauge: 'soviet' | 'german'
  railNeighbors: readonly string[]
}

export interface CleanupAxisUnit {
  hex: string
  suppliedByKessel: boolean
}

/** TTW 1.2 / user ruling Q01. Evaluate on a single Soviet Clean Up snapshot. */
export function automaticSovietConversion(
  railway: readonly CleanupRailHex[],
  sovietNetworkAtStart: ReadonlySet<string>,
  axisCombatUnits: readonly CleanupAxisUnit[],
  hexDistance: (a: string, b: string) => number,
): string[] {
  const relevantUnits = axisCombatUnits.filter((unit) => !unit.suppliedByKessel)
  return railway.filter((hex) =>
    hex.gauge === 'german' &&
    hex.railNeighbors.some((neighbor) => sovietNetworkAtStart.has(neighbor)) &&
    relevantUnits.every((unit) => hexDistance(hex.id, unit.hex) > 20),
  ).map((hex) => hex.id)
}
