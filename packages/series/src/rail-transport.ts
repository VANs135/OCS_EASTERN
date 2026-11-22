import type { Mobility } from './ground-map.ts'
import { zocAffectsAction } from './zoc.ts'

export type RailCargo = { kind: 'unit'; re: number; mobility: Mobility; moveMa: number }
  | { kind: 'sp'; amount: number }
  | { kind: 'transportPoint'; size: number }

// OCS 4.7a–c. Ported from Smolensk 5603e52, rail.ts (transportEquivalentOf).
export function transportEquivalentOf(cargo: RailCargo): number {
  switch (cargo.kind) {
    case 'unit': return cargo.mobility === 'leg' && cargo.moveMa >= 1 && cargo.moveMa <= 6 ? cargo.re / 2 : cargo.re
    case 'sp': return cargo.amount
    case 'transportPoint': return cargo.size
  }
}

export interface RailRouteBoard {
  /** Undefined if there is no railway connection. Gauge is evaluated for the transporting side. */
  edge(from: string, to: string): { usableGauge: boolean; multiTrack: boolean } | undefined
  rawEnemyZocAt(hex: string): boolean
  enemyCombatAt(hex: string): boolean
  /** True at a control point whose ownership blocks rail passage for this side. */
  controlBlocksAt(hex: string): boolean
  trainbustingAt(hex: string): boolean
}

/** OCS 4.5a-C, 13.3e–f, 13.3h. Adapted from Smolensk 5603e52, rail.ts
 * (validateRailMovement, railPathFacts). The caller checks loading and unloading eligibility. */
export function inspectRailRoute(path: readonly string[], board: RailRouteBoard) {
  if (path.length < 2) return { ok: false as const, reason: 'rail-route-too-short' as const }
  let entirePathMultiTrack = true
  let hasTrainbustingZone = false
  for (const [index, hex] of path.entries()) {
    const from = path[index - 1]
    if (from !== undefined) {
      const edge = from === hex ? undefined : board.edge(from, hex)
      if (!edge) return { ok: false as const, reason: 'rail-not-connected' as const, hex }
      if (!edge.usableGauge) return { ok: false as const, reason: 'rail-wrong-gauge' as const, hex }
      entirePathMultiTrack &&= edge.multiTrack
    }
    if (board.enemyCombatAt(hex)) return { ok: false as const, reason: 'rail-enemy-combat' as const, hex }
    if (board.controlBlocksAt(hex)) return { ok: false as const, reason: 'rail-control-blocked' as const, hex }
    if (zocAffectsAction('railTransport', board.rawEnemyZocAt(hex), false)) {
      return { ok: false as const, reason: 'rail-enemy-zoc' as const, hex }
    }
    hasTrainbustingZone ||= board.trainbustingAt(hex)
  }
  return { ok: true as const, entirePathMultiTrack, hasTrainbustingZone }
}

interface RailPathFacts {
  hasTrainbustingZone: boolean
  entirePathMultiTrack: boolean
}

// OCS 4.3, 13.3a. The effects are cumulative and apply once per route.
export function railCapacityFactor(path: RailPathFacts) {
  return (path.hasTrainbustingZone ? 2 : 1) * (path.entirePathMultiTrack ? 0.5 : 1)
}

// Adapted from Smolensk 5603e52, rail.ts (railCapacityCost).
export function railCapacityCost(cargo: readonly RailCargo[], path: RailPathFacts) {
  const equivalent = cargo.reduce((sum, item) => sum + transportEquivalentOf(item), 0)
  const factor = railCapacityFactor(path)
  return { equivalent, factor, cost: equivalent * factor }
}
