import { edgeKey } from '@ocs-eastern/series/ground-map'

// TTW 1.4d. Canonical IDs for the permanent rail ferry, independent of ordinary river crossings.
export const khersonFerryHexes = ['D14.3', 'D15.3'] as const
export const khersonRailFerryHexside = edgeKey(...khersonFerryHexes)

export function khersonFerryBanks(resolveHex: (hex: string) => string | undefined) {
  const [first, second] = khersonFerryHexes.map(resolveHex)
  if (first && second && first !== second) return [first, second] as const
}
