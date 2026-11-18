import type { Side } from '@ocs-eastern/series/state-types'
import type { ScorpionMap } from '../import/scorpion-map.ts'
import { scorpionHexId } from '../import/hex-id.ts'
import { scorpionControlSites, scorpionOpeningFrontControl } from '../ttw/scorpion/initial-map.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'

type ControlState = Pick<ScorpionInPlay, 'railControl' | 'units'>

/** Only destinations with a control rule have a persistent controller. */
export function scorpionControlLookup(state: Readonly<ControlState>, map: ScorpionMap,
  fallback?: (hex: string) => Side | null) {
  const control = state.railControl ?? {}
  const sites = scorpionControlSites(map)
  const opening = [...sites].some((hex) => !control[hex]) ? scorpionOpeningFrontControl(map) : {}
  const occupied = new Map(Object.values(state.units).filter((unit) => unit.combat).map(({ hex, side }) => [hex, side]))
  return (hex: string): Side | null => sites.has(hex) ? control[hex] ?? occupied.get(hex) ?? opening[hex] ?? fallback?.(hex) ?? null : null
}

/** Discard the ordinary-hex entries written by older saves. */
export function pruneScorpionGroundControl(state: ScorpionInPlay, map: ScorpionMap): ScorpionInPlay {
  const sites = scorpionControlSites(map)
  const entries = Object.entries(state.railControl ?? {})
  const kept = entries.filter(([hex]) => sites.has(hex))
  return kept.length === entries.length ? state : { ...state, railControl: Object.fromEntries(kept) }
}

export function recordScorpionGroundControl(state: Readonly<ScorpionInPlay>, side: Side,
  entered: string, map: ScorpionMap): ScorpionInPlay {
  const hex = scorpionHexId(entered)
  if (!scorpionControlSites(map).has(hex) || state.railControl?.[hex] === side) return state
  return { ...state, railControl: { ...state.railControl, [hex]: side } }
}
