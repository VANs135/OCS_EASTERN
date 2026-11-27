import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { prepareCampaignSetup } from '../src/import/campaign-setup.ts'
import { loadThirdWinterV2Units } from '../src/import/unit-v2.ts'
import { buildCampaignOpeningChoices, resolveCampaignOpeningChoices } from '../src/match/campaign-opening-choices.ts'

const ROOT = 'D:/war game/OCS各作数据库/OCS第三个冬天'
const read = async (...parts) => JSON.parse((await readFile(join(ROOT, ...parts), 'utf8')).replace(/^\uFEFF/, ''))

async function contextFor(scenario) {
  const [hexes, edges, catalog, setupRaw] = await Promise.all([
    read('地图数据库', 'map_hexes.json'), read('地图数据库', 'map_edges.json'),
    loadThirdWinterV2Units((file) => read('data', file)), read('scenarios', scenario, 'setup.json'),
  ])
  const map = indexTtwCampaignMap(hexes, edges)
  const setup = prepareCampaignSetup(setupRaw, catalog.aliases, map, undefined)
  return {
    setupRaw, catalog, map,
    setup,
  }
}

test('Scenario 02 parses the any-HQ supply/transport pools and blocks the unresolved fortress rule', async () => {
  const loaded = await contextFor('02-gotterdammerung')
  const context = {
    aliases: loaded.catalog.aliases, definitions: loaded.catalog.definitions, map: loaded.map,
    fixedCounters: loaded.setup.counters.map(({ side, definition, hex }) => ({ side, definition, hex })),
    fixedHedgehogs: new Set(loaded.setup.initialHedgehogs.map(({ hex }) => hex)),
  }
  const pools = loaded.setupRaw.pools
  const choices = buildCampaignOpeningChoices({ supply: pools.supply, transport: pools.transport }, context)
  const supply = choices.filter((choice) => choice.kind === 'supply')
  const transports = choices.filter((choice) => choice.kind === 'transport')
  assert.equal(supply.length, 1)
  assert.equal(supply[0].count, 10)
  assert.equal(supply[0].candidates.length, 19)
  assert.equal(transports.length, 2)
  assert.deepEqual(transports.map(({ count }) => count), [10, 10])
  for (const choice of choices) {
    assert.equal(choice.preset.length, choice.count)
    for (const hex of choice.preset) assert.ok(choice.candidates.includes(hex))
  }
  assert.throws(() => buildCampaignOpeningChoices(pools, context),
    /Unresolved setup placement: available; place at fortifications/)
})

test('Scenario 03 turns the any-front-HQ unit pool into one player choice', async () => {
  const loaded = await contextFor('03-red-thunder')
  const choices = buildCampaignOpeningChoices(loaded.setupRaw.pools, {
    aliases: loaded.catalog.aliases, definitions: loaded.catalog.definitions, map: loaded.map,
    fixedCounters: loaded.setup.counters.map(({ side, definition, hex }) => ({ side, definition, hex })),
    fixedHedgehogs: new Set(loaded.setup.initialHedgehogs.map(({ hex }) => hex)),
  })
  assert.equal(choices.length, 1)
  const front = choices[0]
  assert.equal(front.kind, 'unit')
  assert.equal(front.side, 'soviet')
  assert.equal(front.count, 1)
  assert.ok(front.candidates.length >= 1)
  assert.deepEqual(front.preset, [front.candidates[0]])
  const alternate = front.candidates.find((hex) => hex !== front.candidates[0])
  assert.ok(alternate)
  assert.deepEqual(resolveCampaignOpeningChoices(choices, { [front.id]: [alternate] })[front.id], [alternate])
  assert.throws(() => resolveCampaignOpeningChoices(choices, { [front.id]: ['Z99.99'] }),
    /rejects destination/)
})
