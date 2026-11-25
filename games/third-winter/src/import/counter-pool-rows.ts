import { counterPoolCapacity } from '@ocs-eastern/series/counter-pool'
import type { Side } from '@ocs-eastern/series/state-types'

/** Normalize quantity rows supplied by a scenario. The caller owns the pool's eligibility and basis. */
export function readCounterPoolRows(input: unknown, resolve: (ref: string) => string | undefined, label: string) {
  if (!Array.isArray(input)) throw new Error(`${label} requires an array of quantity rows`)
  const seen = new Set<string>()
  return input.map((row: unknown, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Invalid ${label} row ${index + 1}`)
    const { ref, count } = row as Record<string, unknown>
    if (typeof ref !== 'string' || !ref.trim() || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Invalid ${label} quantity at row ${index + 1}`)
    }
    const definition = resolve(ref)
    if (!definition || seen.has(definition)) throw new Error(`Unresolved or duplicate ${label} reference: ${ref}`)
    seen.add(definition)
    return { ref, definition, count }
  })
}
/** A limit shared by several eligible definitions; do not allocate that limit to each ref. */
export function readAggregateCounterPool(input: unknown, resolve: (ref: string, side: Side) => string | undefined, label: string) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`Invalid ${label}`)
  const { side, refs, default_max: defaultMax, available } = input as Record<string, unknown>
  if ((side !== 'axis' && side !== 'soviet') || !Array.isArray(refs) || !refs.length ||
    (defaultMax !== undefined && typeof defaultMax !== 'number') || (available !== undefined && typeof available !== 'number')) {
    throw new Error(`Invalid ${label} aggregate quantities`)
  }
  const capacity = counterPoolCapacity(defaultMax, available)
  if (!capacity) throw new Error(`Missing ${label} capacity`)
  const definitions = new Set<string>()
  for (const ref of refs) {
    const definition = typeof ref === 'string' && resolve(ref, side)
    if (!definition || definitions.has(definition)) throw new Error(`Unresolved or duplicate ${label} reference: ${String(ref)}`)
    definitions.add(definition)
  }
  return { side, capacity, defaultMax, available, definitions: [...definitions] }
}
