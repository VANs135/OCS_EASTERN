// OCS 16.0b-c and 13.8d. From Smolensk hedgehog.ts/construction.ts and the Scorpion implementation.
// Hedgehog work (build/reduce) is a Movement-Phase action: a stationary local RE, or one Engineer-Capable
// unit within two hexes, changes the level by one; building costs 8T (2 SP), reducing costs nothing.
// Work-specific caps (e.g. TTW 1.1b Level-2 ceiling) are passed in as facts, never hard-coded here.

import type { Side } from './state-types.ts'

/** 16.0a: printed hedgehog levels run 1-2 in the standard counter mix. */
export const HEDGEHOG_STANDARD_MAX_LEVEL = 2
/** 16.0b: building one level costs 8 transport points (2 SP). */
export const HEDGEHOG_BUILD_COST_TOKENS = 8

export type HedgehogOperation = 'build' | 'reduce'
export interface HedgehogOnMap { side: Side; level: number }

/**
 * 16.0b-c, 13.8d: refusal reason for hedgehog work, or null when the action may proceed.
 *
 * Facts keep the work-specific and map-specific judgments with the caller:
 * `maxLevel` (work cap), `onMap` (hex exists), `enemyInHex` (16.0c no work under enemy occupation),
 * `levelChangedThisTurn` (one level per hex per operation and turn), `localRe` (stationary local combat RE)
 * and `engineerWithin2` (13.8d engineer at the hex or within two hexes).
 */
export function hedgehogWorkRefusal(facts: {
  operation: HedgehogOperation
  onMap: boolean
  current?: HedgehogOnMap | null
  side: Side
  maxLevel?: number
  enemyInHex: boolean
  levelChangedThisTurn: boolean
  localRe: number
  engineerWithin2: boolean
}): string | null {
  const maxLevel = facts.maxLevel ?? HEDGEHOG_STANDARD_MAX_LEVEL
  if (facts.operation !== 'build' && facts.operation !== 'reduce') return 'hedgehog-operation-invalid'
  if (!facts.onMap) return 'hedgehog-hex-off-map'
  if (facts.enemyInHex) return 'hedgehog-enemy-in-hex'
  if (facts.current && facts.current.side !== facts.side) return 'hedgehog-enemy-owned'
  if (facts.levelChangedThisTurn) return 'hedgehog-once-per-turn'
  const level = facts.current?.level ?? 0
  if (facts.operation === 'build' ? level >= maxLevel : level < 1) return 'hedgehog-level-illegal'
  if (!facts.engineerWithin2 && !(facts.localRe >= 1)) return 'hedgehog-workers-required'
  return null
}

/** 16.0b-c: one-step level transition; returns null when the hedgehog disappears (level 0). */
export function hedgehogNextLevel(operation: HedgehogOperation, currentLevel: number): number | null {
  if (operation === 'build') return Math.floor(currentLevel) + 1
  const next = Math.floor(currentLevel) - 1
  return next < 1 ? null : next
}

/** 16.0b: transport points due for the work (building 8T, reducing free). */
export function hedgehogWorkTokenCost(operation: HedgehogOperation): number {
  return operation === 'build' ? HEDGEHOG_BUILD_COST_TOKENS : 0
}