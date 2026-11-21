import type { Side } from '@ocs-eastern/series/state-types'
import { projectsZoc } from '@ocs-eastern/series/zoc'
import type { ScorpionMap } from '../import/scorpion-map.ts'
import { scorpionInitialRailGauge, scorpionSupplySources } from '../ttw/scorpion/initial-map.ts'
import type { TracePosition } from '../ttw/scorpion/supply-trace.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import { scorpionControlLookup } from './scorpion-hex-control.ts'

export interface SupplyRailBoard {
  controlOf?: (hex: string) => Side | null
  railGauge?: TracePosition['railGauge']
}

export function scorpionEnemyZoc(state: Readonly<ScorpionInPlay>, map: ScorpionMap, side: Side): ReadonlySet<string> {
  return new Set(Object.values(state.units).filter((unit) => unit.side !== side && unit.combat && projectsZoc({
    attackCapable: unit.attackCapable === true, outOfSupply: unit.outOfSupply === true,
    inCombatMode: !unit.reserve && !unit.disorganized && !unit.moveMode,
  })).flatMap((unit) => map.neighbors(unit.hex)))
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
  const unnegatedEnemyZoc = new Set([...scorpionEnemyZoc(state, map, side)].filter((hex) => !negators.has(hex)))
  const headquarters = friendly.flatMap(([id, unit]) => unit.headquarters ? [{ id, hex: unit.hex, ...unit.headquarters }] : [])
  const extenders = counters.flatMap(([, unit]) => unit.side === side && unit.extender
    ? [{ hex: unit.hex, range: unit.extender.range, mobility: unit.mobility }] : [])
  const controller = scorpionControlLookup(state, map, railroad.controlOf)
  const detrainableFacilities = new Set(friendly.filter(([, unit]) => unit.headquarters &&
    !unit.headquarters.kessel && !unit.moveMode && !unit.reserve && map.neighbors(unit.hex).some((near) => map.edge(unit.hex, near)?.rail))
    .map(([, unit]) => unit.hex))
  const controlled = new Set([...map.hexes.keys()].filter((hex) => !enemyCombat.has(hex) && controller(hex) === side))
  for (const hex of detrainableFacilities) if (!enemyCombat.has(hex)) controlled.add(hex)
  const sources = new Set(scorpionSupplySources[side].filter((hex) => controlled.has(hex)))
  return { side, sources, controlled, enemyCombat, unnegatedEnemyZoc,
    railGauge: railroad.railGauge ?? scorpionInitialRailGauge(map),
    detrainableFacilities,
    headquarters, extenders, weather: state.turn.weather.ground }
}
