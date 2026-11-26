/** Hexes within `radius` steps of a center along the map's geometric neighbors. The center is included. */
export function campaignHexesWithin(map: { neighbors(hex: string): readonly string[]; resolveHex?(hex: string): string | undefined },
  center: string, radius: number) {
  if (!Number.isSafeInteger(radius) || radius < 0) throw new Error('Invalid hex radius')
  const start = map.resolveHex?.(center) ?? center
  const seen = new Set([start])
  let frontier: readonly string[] = [start]
  for (let step = 0; step < radius && frontier.length; step++) {
    const next: string[] = []
    for (const hex of frontier) for (const neighbor of map.neighbors(hex)) {
      if (!seen.has(neighbor)) {
        seen.add(neighbor)
        next.push(neighbor)
      }
    }
    frontier = next
  }
  return [...seen]
}
