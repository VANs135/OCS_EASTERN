import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { campaignHexKey, scorpionGridKey, scorpionPrintedHex } from '../src/import/hex-id.ts'
import { catalogSources, unitCatalog } from '../src/import/unit-catalog.ts'

const root = process.argv[2]
if (!root) throw new Error('Usage: npm run audit:data -- <TTW source directory>')
const read = async (...path) => JSON.parse((await readFile(join(root, ...path), 'utf8')).replace(/^\uFEFF/, ''))

const catalogs = await Promise.all(catalogSources.map(async ([kind, file, key]) => ({
  kind, file, rows: (await read('data', file))[key],
})))
const { definitions, aliases, rawIds } = unitCatalog(catalogs)
const scenarioPath = ['data', 'scenarios', '08-scorpion']
const [setup, reinforcement, scorpionHexes, scorpionEdges, hexes, edges] = await Promise.all([
  read(...scenarioPath, 'setup.json'),
  read(...scenarioPath, 'reinforcements.json'),
  read('data', 'terrain_hexes.json'),
  read('data', 'terrain_hexsides.json'),
  read('地图数据库', 'map_hexes.json'),
  read('地图数据库', 'map_edges.json'),
])
const byHex = new Map(hexes.items.map((hex) => [campaignHexKey(hex.hex_id), hex]))
if (byHex.size !== hexes.items.length) throw new Error('Campaign source hex ID collision')
const seamIssues = hexes.items.filter((hex) => {
  if (!hex.seam_twin) return false
  const peer = byHex.get(campaignHexKey(hex.seam_twin))
  return peer?.seam_twin !== hex.hex_id || peer.seam_primary === hex.seam_primary
})
const danglingEdges = edges.items.filter((edge) =>
  [edge.hex_a, edge.hex_b].some((id) => id !== null && !byHex.has(campaignHexKey(id))),
)
const edgeGroups = new Map()
for (const edge of edges.items) {
  if (!edge.seam_dup_group) continue
  const keys = edgeGroups.get(edge.seam_dup_group) ?? new Set()
  keys.add(JSON.stringify([edge.road_present, edge.road_subclass, edge.rail_present, edge.rail_class]))
  edgeGroups.set(edge.seam_dup_group, keys)
}
function references(value) {
  if (Array.isArray(value)) return value.flatMap(references)
  if (value === null || typeof value !== 'object') return []
  return typeof value.ref === 'string' ? [value.ref] : Object.values(value).flatMap(references)
}
const sourceRefs = [...references(setup), ...references(reinforcement)]
const unresolved = [...new Set(sourceRefs.filter((name) => aliases.get(name)?.length !== 1))]
const scorpionGrid = new Set(Object.keys(scorpionHexes.hexes))
const missingSetupHexes = [...new Set(
  [setup.units, setup.air, setup.markers].flat().filter(({ at }) => at)
    .filter(({ at }) => !scorpionGrid.has(`${at.col},${at.row}`))
    .map(({ at }) => scorpionPrintedHex(at.col, at.row)),
)]
const missingArrivalHexes = [...new Set(reinforcement.flatMap(({ entries }) =>
  entries.flatMap(({ entry }) => entry).filter((entry) =>
    typeof entry === 'string' && /^s\d+\.\d+$/i.test(entry) &&
    !scorpionGrid.has(scorpionGridKey(entry)),
  ),
))]
const report = {
  definitions: definitions.size,
  legacyIdCollisions: [...rawIds].filter(([, rows]) => rows.length > 1).map(([id, rows]) => ({
    id, matches: rows.map(({ kind, source }) => ({ kind, name: source.name })),
  })),
  missingLegacyIds: [...definitions.values()].filter((entry) => entry.sourceId === null).length,
  scorpion: {
    setupRefs: references(setup).length,
    reinforcementRefs: references(reinforcement).length,
    unresolved,
    missingSetupHexes,
    missingArrivalHexes,
    edgesOutsideOldGrid: Object.keys(scorpionEdges.hexsides)
      .filter((key) => key.split('|').some((hex) => !scorpionGrid.has(hex))).length,
  },
  campaign: {
    sourceHexes: hexes.items.length,
    sourceEdges: edges.items.length,
    openEndedEdges: edges.items.filter((edge) => edge.hex_a === null || edge.hex_b === null).length,
    danglingEdges: danglingEdges.map(({ edge_key }) => edge_key),
    mismatchedHexTwins: seamIssues.map(({ hex_id }) => hex_id),
    seamTransportDisagreements: [...edgeGroups].filter(([, values]) => values.size > 1).map(([id]) => id),
  },
}
console.log(JSON.stringify(report, null, 2))
if (unresolved.length || danglingEdges.length || seamIssues.length ||
    missingSetupHexes.length || missingArrivalHexes.length) process.exitCode = 1
