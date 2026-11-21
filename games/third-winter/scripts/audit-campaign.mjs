import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { prepareCampaignSetup, resolveCampaignReference } from '../src/import/campaign-setup.ts'
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
if (!Array.isArray(arrivals)) throw new Error('Invalid campaign reinforcement rows')
const { counters, drawOrders, ...setupChecks } = prepareCampaignSetup(setup, catalog.aliases, geometry, playable)
const { pendingMarkerRows, unresolvedSetup, unresolvedLosses, missingSetupHexes, outsideSetupArea, unresolvedDraws } = setupChecks
const preparedByKind = Map.groupBy(counters, ({ kind }) => kind)

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
    const reference = resolveCampaignReference(catalog.aliases, ref, side)
    if ('issue' in reference) unresolvedArrivals.push({ ...position, ref, issue: reference.issue })
    else if (reference.definition.kind === 'marker') arrivalMarkers.push({ ...position, ref })
  }
}

const victory = {
  rule: objectives.campaign_vp?.rule ?? null,
  sourceRows: objectives.vp_sources?.length ?? 0,
  resultBands: objectives.bands?.length ?? 0,
}
const report = { scenario, map, playArea,
  setup: { ...setupChecks, preparedCounters: counters.length,
    preparedByKind: Object.fromEntries([...preparedByKind].map(([kind, rows]) => [kind, rows.length])),
    explicitLossRows: counters.filter(({ stepsLost }) => stepsLost !== undefined).length,
    randomDraws: drawOrders.length + unresolvedDraws.length, drawOrders },
  reinforcement: { groups: arrivals.length, referencedEntries, resolvedNonMarkers: referencedEntries - unresolvedArrivals.length - arrivalMarkers.length,
    channels: Object.fromEntries(channels), narrativeRows, pendingMarkerRows: arrivalMarkers, unresolvedArrivals },
  victory,
}
console.log(JSON.stringify(report, null, 2))
if (!playable || unresolvedSetup.length || unresolvedArrivals.length || missingSetupHexes.length ||
  outsideSetupArea.length || unresolvedDraws.length || unresolvedLosses.length ||
  map.danglingEdges.length || map.selfEdges.length || map.mismatchedHexTwins.length || map.seamTransportDisagreements.length ||
  map.disputedConnections.length || map.seamGroupsWithDifferentEndpoints.length ||
  map.riverState === 'pending' || pendingMarkerRows.length || arrivalMarkers.length || narrativeRows.length ||
  !victory.sourceRows || !victory.resultBands) process.exitCode = 1
