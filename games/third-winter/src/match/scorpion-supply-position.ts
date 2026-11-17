import type { Side } from '@ocs-eastern/series/state-types'
import type { ScorpionMap } from '../import/scorpion-map.ts'
import { scorpionInitialRailGauge, scorpionSupplySources } from '../ttw/scorpion/initial-map.ts'
import type { TracePosition } from '../ttw/scorpion/supply-trace.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'

export interface SupplyRailBoard {
  controlOf?: (hex: string) => Side | null
  railGauge?: TracePosition['railGauge']
}

/** Current combat units and HQs supply the facts for 4.5, 12.3 and 13.3c. */
export function scorpionSupplyPosition(
  state: Readonly<ScorpionInPlay>, map: ScorpionMap, side: Side, railroad: SupplyRailBoard = {},
  forMovement = false,
): TracePosition {
  const counters = Object.entries(state.units)
  const friendly = counters.filter(([, unit]) => unit.combat && unit.side === side)
  const enemy = counters.filter(([, unit]) => unit.combat && unit.side !== side)
  const enemyCombat = new Set(enemy.map(([, unit]) => unit.hex))
  const anchors = new Set(friendly.map(([, unit]) => unit.hex))
  const negators = forMovement ? new Set(friendly.filter(([id, unit]) => unit.allowance === 0 || state.moved.includes(id))
    .map(([, unit]) => unit.hex)) : anchors
  const unnegatedEnemyZoc = new Set(enemy.filter(([, unit]) => unit.attackCapable && !unit.outOfSupply)
    .flatMap(([, unit]) => map.neighbors(unit.hex)).filter((hex) => !negators.has(hex)))
  const headquarters = friendly.flatMap(([id, unit]) => unit.headquarters ? [{ id, hex: unit.hex, ...unit.headquarters }] : [])
  const controlled = new Set([...map.hexes.keys()].filter((hex) => !enemyCombat.has(hex) &&
    (anchors.has(hex) || (railroad.controlOf?.(hex) ?? state.railControl?.[hex]) === side)))
  return { side, sources: new Set(scorpionSupplySources[side]), controlled, enemyCombat, unnegatedEnemyZoc,
    railGauge: railroad.railGauge ?? scorpionInitialRailGauge(map),
    detrainableFacilities: new Set(headquarters.filter((hq) => !hq.kessel).map((hq) => hq.hex)),
    headquarters, weather: state.turn.weather.ground }
}
