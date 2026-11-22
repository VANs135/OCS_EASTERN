import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadKirovogradScenario } from '../src/import/kirovograd-scenario.ts'
import { scorpionArrivalCatalog } from '../src/import/scorpion-arrivals.ts'
import { loadScorpionFiles } from '../src/import/scorpion-files.mjs'
import { scorpionFixedSupply } from '../src/ttw/scorpion/fixed-supply.ts'
import { sampleScorpionOpening } from './scorpion-sample-opening.mjs'

const [root, scenario] = process.argv.slice(2)
if (!root || scenario && !['08', '09'].includes(scenario)) {
  throw new Error('Usage: npm run audit:scenario-import --workspace=@ocs-eastern/third-winter -- <TTW directory> [08|09]')
}
const json = async (file) => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''))

async function auditScorpion() {
  const loaded = await loadScorpionFiles(root, undefined, json)
  const { before, started } = sampleScorpionOpening(loaded.setup, loaded)
  const deployment = before.state.opening
  const arrivals = scorpionArrivalCatalog(loaded.arrivals, loaded.catalog.aliases)
  const missingEntries = arrivals.flatMap(({ destinations }) => destinations).filter((hex) => !loaded.map.hexes.has(hex))
  const dataTokens = (loaded.setup.markers ?? []).reduce((sum, { ref, count }) => {
    const tokens = ref === 'Supply Point' ? 4 : Number(/^Supply Ton ([1-3])T$/.exec(ref)?.[1] ?? 0)
    return sum + tokens * (count ?? 1)
  }, 0)
  if (missingEntries.length) process.exitCode = 1
  return { scenario: '08', revisedSetup: loaded.setup.alertPoolCounts === 'remaining', playableHexes: loaded.map.hexes.size,
    sourceGroundRows: loaded.setup.units.length, deployedGroundCounters: Object.keys(deployment.units).length,
    air: deployment.pieces.filter(({ kind }) => kind === 'aircraft').length,
    openingPhase: started.state.cursor.phase, openingSide: started.state.cursor.phasing,
    stepsToChoose: deployment.lossChoices.length, availableAlertsAfterDraw: deployment.availableAlerts.length,
    arrivals: arrivals.length, missingEntries, fixedSupply: scorpionFixedSupply,
    sourceOpeningTokens: loaded.setup.alertPoolCounts === 'remaining' ? dataTokens : null,
    engineOpeningTokens: Object.values(deployment.dumps).reduce((sum, dump) => sum + dump.tokens, 0) }
}

async function auditKirovograd() {
  const data = await loadKirovogradScenario((...parts) => json(join(root, ...parts)))
  const { diagnostics, setup, reinforcement } = data
  const pendingOrders = reinforcement.entries.filter(({ status }) => status === 'pending')
  const pendingSetup = [...setup.unresolvedSetup, ...setup.unresolvedLosses, ...setup.missingSetupHexes,
    ...setup.outsideSetupArea, ...setup.unresolvedDraws, ...setup.pendingMarkerRows]
  if (pendingSetup.length || pendingOrders.length || diagnostics.missingTerrain.length) process.exitCode = 1
  return { scenario: '09', playableHexes: data.map.availableHexes.size, dates: data.dates, opening: data.opening,
    ground: setup.counters.length, setupFormationHeadings: setup.formationHeadings.length,
    explicitLossRows: setup.counters.filter(({ stepsLost }) => stepsLost !== undefined).length,
    freePlacements: data.placements.length, randomDraws: setup.drawOrders.length,
    aircraft: data.aircraft.length, arrivals: reinforcement.entries.length, arrivalFormationHeadings: reinforcement.formationHeadings.length,
    objectives: { sources: data.victory.sources.length, bands: data.victory.bands.length }, pendingSetup, pendingOrders,
    missingTerrain: diagnostics.missingTerrain, unresolvedCrossings: diagnostics.unresolvedCrossings,
    provisionalRivers: diagnostics.provisionalRivers.length }
}

const report = await Promise.all([...(scenario === '09' ? [] : [auditScorpion()]), ...(scenario === '08' ? [] : [auditKirovograd()])])
console.log(JSON.stringify(report, null, 2))
