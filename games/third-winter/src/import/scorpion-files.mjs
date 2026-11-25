import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadScorpionMap } from './scorpion-map-files.ts'
import { loadScorpionUnits } from './scorpion-unit-sources.ts'
import { readScorpionBreakdownCounts } from './scorpion-breakdown-config.ts'
import { readAggregateCounterPool } from './counter-pool-rows.ts'
import { resolveCampaignReference } from './campaign-reference.ts'

const verifiedSetup = fileURLToPath(new URL('../../data/scorpion-real-library/scenario/setup.json', import.meta.url))

export async function loadScorpionFiles(root, unitRoot, readJson) {
  const units = unitRoot ?? join(root, 'data')
  const schema = unitRoot && !await exists(join(units, 'units_inf_div.json')) ? 'legacy' : 'v2'
  const legacyScenario = join(root, 'data', 'scenarios', '08-scorpion')
  const revisedScenario = join(root, 'scenarios', '08-korsun-pocket')
  const revisedSetup = join(revisedScenario, 'setup.json')
  const useRevisedSetup = schema === 'v2' && await exists(revisedSetup)
  const setupFile = useRevisedSetup ? revisedSetup : schema === 'v2' ? verifiedSetup : join(legacyScenario, 'setup.json')
  const arrivalsFile = schema === 'v2'
    ? join(revisedScenario, 'reinforcements.json')
    : join(legacyScenario, 'reinforcements.json')
  const [catalog, map, setup, arrivals] = await Promise.all([
    loadScorpionUnits((file) => readJson(join(units, file)), schema),
    loadScorpionMap((...parts) => readJson(join(root, ...parts))),
    readJson(setupFile),
    readJson(arrivalsFile),
  ])
  if (useRevisedSetup && setup.meta?.id !== 8) throw new Error('新版瓶中蝎初设不是 8 号剧本')
  const breakdownCounts = useRevisedSetup && setup.pools?.breakdown !== undefined
    ? readScorpionBreakdownCounts(setup.pools.breakdown, catalog.aliases) : undefined
  const remnantPool = useRevisedSetup && setup.pools?.remnants !== undefined
    ? readAggregateCounterPool(setup.pools.remnants, (ref, side) => {
      const match = resolveCampaignReference(catalog.aliases, ref, side)
      const definition = match.definition
      return definition?.kind === 'land' && (!definition.source.instancePool || definition.source.instancePool === 'remnant') ? definition.key : undefined
    }, 'remnant pool') : undefined
  return { catalog, map, setup: useRevisedSetup ? { ...setup, alertPoolCounts: 'remaining' } : setup, arrivals, schema, breakdownCounts, remnantPool }
}

async function exists(file) {
  try {
    await stat(file)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}
