/** TTW 2.3a / Q05. Available units may stay in the Axis off-map box. */
export interface KesselReserve {
  availableFromTurn: number
}

export function kesselReturnAfterRemoval(turn: number): KesselReserve {
  return { availableFromTurn: turn + 3 }
}

export function canPlaceKessel(
  reserve: Readonly<KesselReserve>, turn: number, friendlyCombatUnitInHex: boolean,
): boolean {
  return turn >= reserve.availableFromTurn && friendlyCombatUnitInHex
}
