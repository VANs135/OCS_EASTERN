export type InternalStocks = 'low' | 'exhausted'

export function spendInternalStocks(level: InternalStocks | undefined): InternalStocks {
  if (level === 'exhausted') throw new Error('This unit has exhausted its internal stocks')
  return level === 'low' ? 'exhausted' : 'low'
}

export function internalRecoveryPerLevel(currentRe: number): number {
  return Math.max(1, currentRe) * 2
}
