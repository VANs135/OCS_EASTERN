// OCS 15.2-15.4 and 13.8d. From the Scorpion airfield-work implementation as pure series judgments.
// Build: one eligible engineer, +1 level per turn up to level 3, 4T (3T when upgrading an existing strip).
// Reduce: an engineer or a stationary local combat RE, one level per turn, never below level 1, free.
// Build strip: an Axis engineer in a hex without an airfield, 1T, consumes one strip counter from the pool.
// Work-specific extras (TTW 2.2h strip capture) stay with the caller.

import type { Side } from './state-types.ts'

export const AIRBASE_MAX_LEVEL = 3
export const AIRBASE_BUILD_COST_TOKENS = 4
export const AIRBASE_BUILD_ON_STRIP_COST_TOKENS = 3
export const AIRSTRIP_BUILD_COST_TOKENS = 1

export type AirfieldOperation = 'build' | 'reduce' | 'build-strip'
export interface AirfieldOnMap { side: Side; level: number; strip?: boolean }

/** 15.2-15.4, 13.8d: refusal reason for airfield work, or null when the action may proceed. */
export function airfieldWorkRefusal(facts: {
  operation: AirfieldOperation
  side: Side
  onMap: boolean
  current?: AirfieldOnMap | null
  enemyInHex: boolean
  changedThisTurn: boolean
  engineerWithin2: boolean
  localRe: number
  stripInPool: boolean
}): string | null {
  if (facts.operation !== 'build' && facts.operation !== 'reduce' && facts.operation !== 'build-strip') return 'airfield-operation-invalid'
  if (!facts.onMap) return 'airfield-hex-off-map'
  if (facts.enemyInHex) return 'airfield-enemy-in-hex'
  const current = facts.current ?? null
  if (current && current.side !== facts.side) return 'airfield-enemy-owned'
  if (facts.changedThisTurn) return 'airfield-once-per-turn'
  if (facts.operation === 'build') {
    if (!facts.engineerWithin2) return 'airfield-engineer-required'
    if (current && current.level >= AIRBASE_MAX_LEVEL) return 'airfield-max-level'
    return null
  }
  if (facts.operation === 'reduce') {
    if (!current || current.level <= 1) return 'airfield-level-illegal'
    if (!facts.engineerWithin2 && facts.localRe < 1) return 'airfield-workers-required'
    return null
  }
  if (facts.side !== 'axis') return 'airfield-strip-axis-only'
  if (!facts.engineerWithin2) return 'airfield-engineer-required'
  if (current) return 'airfield-strip-needs-empty-hex'
  if (!facts.stripInPool) return 'airfield-strip-pool-empty'
  return null
}

/** 15.2: transport points due for the work (build 4T / 3T over a strip, reduce free, strip 1T). */
export function airfieldWorkTokenCost(operation: AirfieldOperation, current?: AirfieldOnMap | null): number {
  if (operation === 'build') return current?.strip ? AIRBASE_BUILD_ON_STRIP_COST_TOKENS : AIRBASE_BUILD_COST_TOKENS
  if (operation === 'build-strip') return AIRSTRIP_BUILD_COST_TOKENS
  return 0
}

/** 15.2: resulting level (0 with a strip for strip construction). */
export function airfieldNextLevel(operation: AirfieldOperation, currentLevel: number): number {
  if (operation === 'build') return Math.min(AIRBASE_MAX_LEVEL, Math.floor(currentLevel) + 1)
  if (operation === 'reduce') return Math.max(1, Math.floor(currentLevel) - 1)
  return 0
}