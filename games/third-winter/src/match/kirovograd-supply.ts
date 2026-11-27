import type { Side } from '@ocs-eastern/series/state-types'

export interface KirovogradEdgeMap {
  availableHexes?: ReadonlySet<string>
  neighbors?(hex: string): readonly string[]
  connection?(from: string, to: string): { sourceEdges: readonly { rail_present: boolean }[] } | undefined
}

/**
 * Scenario Book p.62: the Axis draws supply from the railway hexes on the
 * western map edge; the Soviets draw from the railway hexes on the eastern map
 * edge. The printed edge is the map's own play-area boundary, not a guessed
 * column: derive it from the loaded Scenario 9 hex window.
 */
export function kirovogradEdgeSupplySources(map: KirovogradEdgeMap): Readonly<Record<Side, readonly string[]>> {
  const available = map.availableHexes
  if (!available?.size || !map.neighbors || !map.connection) return { axis: [], soviet: [] }
  const columns = [...available].flatMap((hex) => {
    const column = Number(/^D(\d+)\./.exec(hex)?.[1])
    return Number.isSafeInteger(column) ? [column] : []
  })
  if (!columns.length) return { axis: [], soviet: [] }
  const west = Math.min(...columns)
  const east = Math.max(...columns)
  const columnOf = (hex: string) => Number(/^D(\d+)\./.exec(hex)?.[1])
  const railHex = (hex: string) => map.neighbors!(hex).some((to) =>
    map.connection!(hex, to)?.sourceEdges.some((edge) => edge.rail_present))
  const hexes = [...available].filter(railHex)
  return {
    axis: hexes.filter((hex) => columnOf(hex) === west).sort(),
    soviet: hexes.filter((hex) => columnOf(hex) === east).sort(),
  }
}
