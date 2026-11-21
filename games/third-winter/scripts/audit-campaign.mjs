import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { prepareCampaignReinforcements } from '../src/import/campaign-reinforcements.ts'
import { prepareCampaignSetup } from '../src/import/campaign-setup.ts'
import { loadThirdWinterV2Units } from '../src/import/unit-v2.ts'
import { campaignMapInPlayArea, ttwCampaignPlayArea } from '../src/ttw/campaign/play-area.ts'
import { campaignReinforcementWindow } from '../src/ttw/campaign/reinforcement.ts'

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
const { counters, drawOrders, ...setupChecks } = prepareCampaignSetup(setup, catalog.aliases, geometry, playable)
const { pendingMarkerRows, unresolvedSetup, unresolvedLosses, missingSetupHexes, outsideSetupArea, unresolvedDraws } = setupChecks
const preparedByKind = Map.groupBy(counters, ({ kind }) => kind)

const reinforcements = prepareCampaignReinforcements(arrivals, catalog.aliases, geometry, playable)
const pendingOrders = reinforcements.entries.filter(({ status }) => status === 'pending')
const classified = reinforcements.entries.filter(({ status }) => status === 'classified')
const classifiedByOperation = Map.groupBy(classified, ({ operation }) => operation.kind)
const unresolvedReferences = pendingOrders.filter(({ issue }) => ['ambiguous', 'wrong-side', 'missing'].includes(issue))
const firstTurn = Object.fromEntries(['axis', 'soviet'].map((phasing) =>
  [phasing, campaignReinforcementWindow(reinforcements.schedule, { phase: 'reinforcement', turn: 1, phasing })]))

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
  reinforcement: { groups: reinforcements.groups, turns: reinforcements.schedule.size,
    referencedEntries: reinforcements.entries.filter(({ ref }) => ref !== null).length,
    resolvedNonMarkers: reinforcements.entries.filter(({ counterKind }) => counterKind && counterKind !== 'marker').length,
    channels: Object.fromEntries(reinforcements.groupCounts),
    classifiedByOperation: Object.fromEntries([...classifiedByOperation].map(([kind, rows]) => [kind, rows.length])),
    pendingOrders, unresolvedReferences, firstTurn },
  victory,
}
console.log(JSON.stringify(report, null, 2))
if (!playable || unresolvedSetup.length || pendingOrders.length || missingSetupHexes.length ||
  outsideSetupArea.length || unresolvedDraws.length || unresolvedLosses.length ||
  map.danglingEdges.length || map.selfEdges.length || map.mismatchedHexTwins.length || map.seamTransportDisagreements.length ||
  map.disputedConnections.length || map.seamGroupsWithDifferentEndpoints.length ||
  map.riverState === 'pending' || pendingMarkerRows.length ||
  !victory.sourceRows || !victory.resultBands) process.exitCode = 1
