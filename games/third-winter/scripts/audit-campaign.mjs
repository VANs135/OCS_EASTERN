import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { campaignHexKey } from '../src/import/hex-id.ts'
import { loadThirdWinterV2Units } from '../src/import/unit-v2.ts'
import { campaignMapInPlayArea, ttwCampaignPlayArea } from '../src/ttw/campaign/play-area.ts'

const [root, scenario = '01-dnepr-battles'] = process.argv.slice(2)
if (!root || !/^0[1-9]-[a-z0-9-]+$/.test(scenario)) {
  throw new Error('Usage: npm run audit:campaign --workspace=@ocs-eastern/third-winter -- <TTW directory> [scenario directory]')
}
const read = async (...parts) => JSON.parse((await readFile(join(root, ...parts), 'utf8')).replace(/^\uFEFF/, ''))
const scenarioFile = (name) => read('scenarios', scenario, name)
const [hexes, edges, catalog, setup, arrivals, objectives] = await Promise.all([
  read('地图数据库', 'map_hexes.json'),
  read('地图数据库', 'map_edges.json'),
  loadThirdWinterV2Units((file) => read('data', file)),
  scenarioFile('setup.json'),
  scenarioFile('reinforcements.json'),
  scenarioFile('objectives.json'),
])
const geometry = indexTtwCampaignMap(hexes, edges)
const map = geometry.diagnostics
const area = ttwCampaignPlayArea(scenario)
const playable = area && campaignMapInPlayArea(geometry, area)
const playArea = playable
  ? { status: 'configured', kind: area.kind, availableHexes: playable.availableHexes.size }
  : { status: 'unconfigured' }
if (!Array.isArray(setup.units) || !Array.isArray(arrivals)) throw new Error('Invalid campaign setup or reinforcement rows')

function classifyHex(printed) {
  if (typeof printed !== 'string' || !/^[A-D]\d+\.\d+$/.test(printed)) return 'missing-hex'
  const hex = geometry.canonicalByHex.get(campaignHexKey(printed))
  if (!hex || !geometry.onMapHexes.has(hex)) return 'missing-hex'
  if (playable && !playable.resolveHex(printed)) return 'outside-scenario'
  return null
}

function checkReference(ref, side) {
  const definitions = catalog.aliases.get(ref) ?? []
  if (definitions.length === 1 && definitions[0].kind === 'marker' &&
    (definitions[0].source.side === side || definitions[0].source.side === null)) return 'marker'
  const friendly = definitions.filter(({ source }) => source.side === side)
  if (friendly.length === 1) return null
  return friendly.length > 1 ? 'ambiguous' : definitions.length ? 'wrong-side' : 'missing'
}

const unresolvedSetup = []
const setupMarkers = []
const missingSetupHexes = []
const outsideSetupArea = []
for (const [index, { ref, side, at }] of setup.units.entries()) {
  const row = index + 1
  const issue = checkReference(ref, side)
  if (issue === 'marker') setupMarkers.push({ row, ref, side })
  else if (issue) unresolvedSetup.push({ row, ref, side, issue })
  const printed = at ? `${at.map}${at.col}.${at.row}` : null
  const hexIssue = classifyHex(printed)
  if (hexIssue === 'missing-hex') missingSetupHexes.push({ row, ref, hex: printed })
  if (hexIssue === 'outside-scenario') outsideSetupArea.push({ row, ref, hex: printed })
}
const unresolvedDraws = (setup.random_draws ?? []).flatMap(({ hex, pool }, index) => {
  const issue = classifyHex(hex)
  return issue ? [{ row: index + 1, hex, pool, issue }] : []
})

const channels = new Map()
const unresolvedArrivals = []
const arrivalMarkers = []
const narrativeRows = []
let referencedEntries = 0
for (const [index, group] of arrivals.entries()) {
  const { side, channel, entries } = group
  if (!Array.isArray(entries)) throw new Error(`Invalid campaign reinforcement entries in row ${index + 1}`)
  channels.set(channel, (channels.get(channel) ?? 0) + 1)
  for (const [entryIndex, { ref }] of entries.entries()) {
    const position = { row: index + 1, entry: entryIndex + 1, side, channel }
    if (ref == null) {
      narrativeRows.push(position)
      continue
    }
    referencedEntries++
    const issue = checkReference(ref, side)
    if (issue === 'marker') arrivalMarkers.push({ ...position, ref })
    else if (issue) unresolvedArrivals.push({ ...position, ref, issue })
  }
}

const victory = {
  rule: objectives.campaign_vp?.rule ?? null,
  sourceRows: objectives.vp_sources?.length ?? 0,
  resultBands: objectives.bands?.length ?? 0,
}
const report = { scenario, map, playArea,
  setup: { total: setup.units.length, resolvedNonMarkers: setup.units.length - unresolvedSetup.length - setupMarkers.length,
    randomDraws: setup.random_draws?.length ?? 0, pendingMarkerRows: setupMarkers, unresolvedSetup,
    missingSetupHexes, outsideSetupArea, unresolvedDraws },
  reinforcement: { groups: arrivals.length, referencedEntries, resolvedNonMarkers: referencedEntries - unresolvedArrivals.length - arrivalMarkers.length,
    channels: Object.fromEntries(channels), narrativeRows, pendingMarkerRows: arrivalMarkers, unresolvedArrivals },
  victory,
}
console.log(JSON.stringify(report, null, 2))
if (!playable || unresolvedSetup.length || unresolvedArrivals.length || missingSetupHexes.length ||
  outsideSetupArea.length || unresolvedDraws.length ||
  map.danglingEdges.length || map.selfEdges.length || map.mismatchedHexTwins.length || map.seamTransportDisagreements.length ||
  map.disputedConnections.length || map.seamGroupsWithDifferentEndpoints.length ||
  map.riverState === 'pending' || setupMarkers.length || arrivalMarkers.length || narrativeRows.length ||
  !victory.sourceRows || !victory.resultBands) process.exitCode = 1
