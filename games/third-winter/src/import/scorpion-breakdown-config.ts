import type { BackupUnit } from './unit-backup.ts'
import type { Definition } from './unit-catalog.ts'

function record(value: unknown, location: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Invalid breakdown ${location}`)
  return value as Record<string, unknown>
}

/** Explicit scenario pool membership and optional native-pixel box coordinates. */
export function readScorpionBreakdowns(input: unknown, catalog: ReadonlyMap<string, Definition<BackupUnit>>) {
  const config = record(input, 'configuration')
  if (!Array.isArray(config.parents) || !Array.isArray(config.counters)) throw new Error('Breakdown configuration requires parents and counters')
  const parentPools = new Map<string, string>()
  const counters = new Map<string, { pool: string; copies: number }>()
  const boxes = new Map<string, { x: number; y: number; w: number; h: number }>()
  const pools = new Map<string, Set<string>>()
  for (const [index, value] of config.counters.entries()) {
    const at = `counter ${index + 1}`
    const { definition, pool, copies, box } = record(value, at)
    const model = typeof definition === 'string' ? catalog.get(definition) : undefined
    if (typeof definition !== 'string' || model?.kind !== 'land' || !model.source.side || model.source.re !== 1 ||
      typeof pool !== 'string' || !pool.trim() || typeof copies !== 'number' || !Number.isSafeInteger(copies) || copies < 0 ||
      counters.has(definition)) throw new Error(`Invalid breakdown ${at}`)
    counters.set(definition, { pool, copies })
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
