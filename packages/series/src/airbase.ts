export const airbaseActiveCapacity = (level: number) => 4 + level
// OCS 15.2. Use level zero for a strip with no Flak of its own.
export const airbaseRefitCapacity = (level: number) => level === 0 ? 1 : 2 * level
export const airbaseUnloadCapacity = (level: number) => 2 * Math.max(1, level)
