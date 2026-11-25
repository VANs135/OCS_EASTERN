import { counterPoolCapacity } from '@ocs-eastern/series/counter-pool'
import { readCounterPoolRows } from './counter-pool-rows.ts'
import { resolveCampaignReference } from './campaign-reference.ts'
import type { CampaignAliases } from './campaign-reference.ts'
import type { BackupUnit } from './unit-backup.ts'
import type { Definition } from './unit-catalog.ts'

function record(value: unknown, location: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Invalid breakdown ${location}`)
  return value as Record<string, unknown>
}

/** Per-definition amounts supplied by a scenario, separate from parent membership and box geometry. */
export function readScorpionBreakdownCounts(input: unknown, aliases: CampaignAliases) {
  const groups = record(input, 'counts')
  if (Object.keys(groups).some((side) => side !== 'axis' && side !== 'soviet')) throw new Error('Invalid breakdown pool side')
  const counts = new Map<string, number>()
  for (const side of ['axis', 'soviet'] as const) {
    if (groups[side] === undefined) continue
    for (const { definition, count } of readCounterPoolRows(groups[side], (ref) => {
      const match = resolveCampaignReference(aliases, ref, side)
      if ('definition' in match && match.definition.kind === 'land' && match.definition.source.re === 1 &&
        (!match.definition.source.instancePool || match.definition.source.instancePool === 'breakdown')) return match.definition.key
    }, `${side} breakdown pool`)) counts.set(definition, count)
  }
  return counts
}

/** Explicit pool membership, scenario quantities and optional native-pixel box coordinates. */
export function readScorpionBreakdowns(input: unknown, catalog: ReadonlyMap<string, Definition<BackupUnit>>,
  scenarioCounts?: ReadonlyMap<string, number>) {
  const config = record(input, 'configuration')
  if (!Array.isArray(config.parents) || !Array.isArray(config.counters)) throw new Error('Breakdown configuration requires parents and counters')
  const parentPools = new Map<string, string>()
  const counters = new Map<string, { pool: string; copies: number | null }>()
  const boxes = new Map<string, { x: number; y: number; w: number; h: number }>()
  const pools = new Map<string, Set<string>>()
  for (const [index, value] of config.counters.entries()) {
    const at = `counter ${index + 1}`
    const { definition, pool, copies, box } = record(value, at)
    const model = typeof definition === 'string' ? catalog.get(definition) : undefined
    if (typeof definition !== 'string' || model?.kind !== 'land' || !model.source.side || model.source.re !== 1 ||
      typeof pool !== 'string' || !pool.trim() || (copies != null && (typeof copies !== 'number' || !Number.isSafeInteger(copies) || copies < 0)) ||
      counters.has(definition)) throw new Error(`Invalid breakdown ${at}`)
    const scenarioLimit = scenarioCounts ? scenarioCounts.get(definition) : copies ?? undefined
    const capacity = counterPoolCapacity(undefined, scenarioLimit)
    counters.set(definition, { pool, copies: capacity?.count ?? null })
    const owners = pools.get(pool) ?? new Set<string>()
    owners.add(model.source.side)
    pools.set(pool, owners)
    if (box !== undefined) {
      const { x, y, w, h } = record(box, `${at} box`)
      if (typeof x !== 'number' || typeof y !== 'number' || typeof w !== 'number' || typeof h !== 'number' ||
        ![x, y, w, h].every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0) throw new Error(`Invalid breakdown ${at} box`)
      boxes.set(definition, { x, y, w, h })
    }
  }
  for (const definition of scenarioCounts?.keys() ?? []) {
    if (!counters.has(definition)) throw new Error(`Missing breakdown pool membership: ${definition}`)
  }
  for (const [index, value] of config.parents.entries()) {
    const { definition, pool } = record(value, `parent ${index + 1}`)
    const model = typeof definition === 'string' ? catalog.get(definition) : undefined
    if (typeof definition !== 'string' || model?.kind !== 'land' || !model.source.side || (model.source.re ?? 0) <= 1 ||
      typeof pool !== 'string' || !pools.get(pool)?.has(model.source.side) || parentPools.has(definition)) {
      throw new Error(`Invalid breakdown parent ${index + 1}`)
    }
    parentPools.set(definition, pool)
  }
  return { rules: { parentPools, counters }, boxes }
}
