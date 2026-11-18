import type { Side } from './state-types.ts'
import type { Phase } from './turn.ts'

export function reserveHexesInUse(
  units: Iterable<{ side: Side; hex: string; reserve?: string }>, side: Side,
): ReadonlySet<string> {
  const hexes = new Set<string>()
  for (const unit of units) {
    if (unit.side === side && unit.reserve) hexes.add(unit.hex)
  }
  return hexes
}

export function reserveMovementFactor(phase: Phase, inReserve: boolean, released: boolean): number {
  if (inReserve) return phase === 'movement' ? 0.25 : 0
  if (phase === 'reaction') return released ? 0.5 : 0
  if (phase === 'exploitation') return released ? 1 : 0.5
  return 1
}
