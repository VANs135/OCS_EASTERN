export interface CounterPoolCapacity {
  count: number
  source: 'default' | 'scenario'
}

/** Explicit scenario amounts override the default, including an explicit zero. */
export function counterPoolCapacity(defaultCount: number | undefined, scenarioCount: number | undefined): CounterPoolCapacity | undefined {
  for (const count of [defaultCount, scenarioCount]) {
    if (count !== undefined && (!Number.isSafeInteger(count) || count < 0)) throw new Error('Invalid counter pool capacity')
  }
  if (scenarioCount !== undefined) return { count: scenarioCount, source: 'scenario' }
  if (defaultCount !== undefined) return { count: defaultCount, source: 'default' }
  return undefined
}
