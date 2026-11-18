import type { Side } from '@ocs-eastern/series/state-types'
import type { ScorpionMap } from '../import/scorpion-map.ts'
import { scorpionHexId } from '../import/hex-id.ts'
import { scorpionOpeningFrontControl } from '../ttw/scorpion/initial-map.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'

type ControlState = Pick<ScorpionInPlay, 'railControl' | 'units'>

/** Older saves recorded only entries and initially occupied hexes. Keep those over the opening front. */
export function scorpionControlLookup(state: Readonly<ControlState>, map: ScorpionMap,
  fallback?: (hex: string) => Side | null) {
  const control = state.railControl ?? {}
  const opening = Object.keys(control).length < map.hexes.size ? scorpionOpeningFrontControl(map) : {}
  const occupied = new Map(Object.values(state.units).filter((unit) => unit.combat).map(({ hex, side }) => [hex, side]))
  return (hex: string): Side | null => control[hex] ?? occupied.get(hex) ?? opening[hex] ?? fallback?.(hex) ?? null
}

/** Record actual ground entries, in path order. Leaving a hex does not remove its controller. */
export function recordScorpionGroundControl(state: Readonly<ScorpionInPlay>, side: Side,
  entered: readonly string[]): ScorpionInPlay {
  if (!entered.length) return state
  return { ...state, railControl: { ...state.railControl,
    ...Object.fromEntries(entered.map((hex) => [scorpionHexId(hex), side])) } }
}
