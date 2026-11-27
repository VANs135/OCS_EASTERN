export const airbaseActiveCapacity = (level: number) => 4 + level
// OCS 15.2. Use level zero for a strip with no Flak of its own.
export const airbaseRefitCapacity = (level: number) => level === 0 ? 1 : 2 * level
export const airbaseUnloadCapacity = (level: number) => 2 * Math.max(1, level)
/** OCS 15.0b / 15.2F: a printed air base contributes AA equal to its level; airstrips contribute zero. */
export const airbaseAaValue = (level: number, isAirstrip = false) =>
  isAirstrip ? 0 : Math.max(0, Math.floor(level))
