import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadScorpionMap } from './scorpion-map-files.ts'
import { loadScorpionUnits } from './scorpion-unit-sources.ts'

const verifiedSetup = fileURLToPath(new URL('../../data/scorpion-real-library/scenario/setup.json', import.meta.url))

export async function loadScorpionFiles(root, unitRoot, readJson) {
  const units = unitRoot ?? join(root, 'data')
  const schema = unitRoot && !await hasV2Catalog(units) ? 'legacy' : 'v2'
  const legacyScenario = join(root, 'data', 'scenarios', '08-scorpion')
  // The rebuilt setup uses printed coordinates and still needs a deployment audit.
  const setupFile = schema === 'v2' ? verifiedSetup : join(legacyScenario, 'setup.json')
  const arrivalsFile = schema === 'v2'
    ? join(root, 'scenarios', '08-korsun-pocket', 'reinforcements.json')
    : join(legacyScenario, 'reinforcements.json')
  const [catalog, map, setup, arrivals] = await Promise.all([
    loadScorpionUnits((file) => readJson(join(units, file)), schema),
    loadScorpionMap((...parts) => readJson(join(root, ...parts))),
    readJson(setupFile),
    readJson(arrivalsFile),
  ])
  return { catalog, map, setup, arrivals, schema }
}

async function hasV2Catalog(directory) {
  try {
    await stat(join(directory, 'units_inf_div.json'))
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}
