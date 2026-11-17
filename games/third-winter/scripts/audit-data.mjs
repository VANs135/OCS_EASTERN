import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { campaignHexKey, scorpionHexId, scorpionPrintedHex } from '../src/import/hex-id.ts'
import { scorpionGroundProfile } from '../src/import/ground-profile.ts'
import { scorpionGroundDeployment } from '../src/import/scorpion-deployment.ts'
import { loadScorpionMap } from '../src/import/scorpion-map-files.ts'
import { loadScorpionUnits } from '../src/import/scorpion-unit-sources.ts'
import { scorpionArrivalCatalog } from '../src/import/scorpion-arrivals.ts'
import { scorpionFixedSupply } from '../src/ttw/scorpion/fixed-supply.ts'
import { scorpionAxisSources, scorpionInitialRailGauge } from '../src/ttw/scorpion/initial-map.ts'
import { scorpionTraceOptions } from '../src/ttw/scorpion/supply-trace.ts'

const root = process.argv[2]
if (!root) throw new Error('Usage: npm run audit:data --workspace=@ocs-eastern/third-winter -- <TTW directory> [unit backup directory]')
const unitRoot = process.argv[3] ?? join(dirname(resolve(root)), 'DATA备份')
const readAt = async (folder, ...path) => JSON.parse((await readFile(join(folder, ...path), 'utf8')).replace(/^\uFEFF/, ''))
const read = (...path) => readAt(root, ...path)
const scenarioPath = ['data', 'scenarios', '08-scorpion']
const [{ definitions, aliases, rawIds }, setup, reinforcement, map, hexes, edges] = await Promise.all([
  loadScorpionUnits((file) => readAt(unitRoot, file)),
  read(...scenarioPath, 'setup.json'),
  read(...scenarioPath, 'reinforcements.json'),
  loadScorpionMap(read),
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
const playableArrivals = unresolved.length === 0 ? scorpionArrivalCatalog(reinforcement, aliases) : []
const missingSetupHexes = [...new Set(
  [setup.units, setup.air, setup.markers].flat().filter(({ at }) => at)
    .map(({ at }) => scorpionPrintedHex(at.col, at.row)).filter((hex) => !map.hexes.has(hex)),
)]
const placementHexes = [...playableArrivals, ...scorpionFixedSupply].flatMap(({ destinations }) => destinations)
const missingArrivalHexes = [...new Set(placementHexes.filter((hex) =>
  !map.hexes.has(scorpionHexId(hex)),
))]
const deployment = unresolved.length === 0 && missingSetupHexes.length === 0
  ? scorpionGroundDeployment(setup.units, aliases, map)
  : { units: {}, lossChoices: [] }
function unknownMovement(keys) {
  return [...new Set(keys)].flatMap((key) => {
    const definition = definitions.get(key)
    if (!definition || !['land', 'hq', 'transport'].includes(definition.kind)) return []
    const unknownModes = ['combat', 'move'].filter((mode) => !scorpionGroundProfile(definition, mode))
    return unknownModes.length ? [{ name: definition.source.name, modes: unknownModes }] : []
  })
}
const unknownSetupMovement = unknownMovement(Object.values(deployment.units).map(({ definition }) => definition))
const unknownArrivalMovement = unknownMovement(playableArrivals.map(({ definition }) => definition))
const railGauge = scorpionInitialRailGauge(map)
const axisSources = new Set(scorpionAxisSources)
const empty = new Set()
const axisTrace = { side: 'axis', sources: axisSources, controlled: empty, enemyCombat: empty,
  unnegatedEnemyZoc: empty, railGauge, detrainableFacilities: empty, headquarters: [], weather: 'freeze' }
const unusableAxisSources = scorpionAxisSources.filter((hex) =>
  !scorpionTraceOptions(map, axisTrace, hex).some(({ source }) => source === hex),
)
const report = {
  definitions: definitions.size,
  legacyIdCollisions: [...rawIds].filter(([, rows]) => rows.length > 1).map(([id, rows]) => ({
    id, matches: rows.map(({ kind, source }) => ({ kind, name: source.name })),
  })),
  missingLegacyIds: [...definitions.values()].filter((entry) => entry.sourceId === null).length,
  scorpion: {
    sourceHexes: map.hexes.size,
    sourceEdges: map.edgeCount,
    setupRefs: references(setup).length,
    reinforcementRefs: references(reinforcement).length,
    playableArrivals: playableArrivals.length,
    fixedSupplyDeliveries: scorpionFixedSupply.length,
    groundCounters: Object.keys(deployment.units).length,
    printedStepLossChoices: deployment.lossChoices.length,
    fullOrganicTrucks: Object.values(deployment.units).filter((unit) => unit.organicTruck === 'full').length,
    unknownSetupMovement,
    unknownArrivalMovement,
    unresolved,
    missingSetupHexes,
    missingArrivalHexes,
    unusableAxisSources,
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
if (unresolved.length || danglingEdges.length || seamIssues.length || unusableAxisSources.length ||
    unknownSetupMovement.length || unknownArrivalMovement.length ||
    missingSetupHexes.length || missingArrivalHexes.length) process.exitCode = 1
