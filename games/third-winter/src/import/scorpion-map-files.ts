import { scorpionMap } from './scorpion-map.ts'

/** Read-only asset adapter. The caller chooses the local third-winter source directory. */
export async function loadScorpionMap(readJson: (...path: string[]) => Promise<unknown>) {
  const [hexes, edges] = await Promise.all([
    readJson('地图数据库', 'map_hexes_scorpion.json'),
    readJson('地图数据库', 'map_edges_scorpion.json'),
  ])
  return scorpionMap(rows(hexes), rows(edges))
}

function rows<T>(source: unknown): readonly T[] {
  if (source === null || typeof source !== 'object' || !('items' in source) || !Array.isArray(source.items)) {
    throw new Error('Expected a Scorpion map table with an items array')
  }
  return source.items
}
