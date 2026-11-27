import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRngState } from '@ocs-eastern/series/rng'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { prepareCampaignSetup } from '../src/import/campaign-setup.ts'
import { loadThirdWinterV2Units } from '../src/import/unit-v2.ts'
import { campaignMapInPlayArea, ttwCampaignPlayArea } from '../src/ttw/campaign/play-area.ts'
import { captureCampaignDump } from '../src/match/campaign-dump-capture.ts'
import { captureCampaignHedgehog } from '../src/match/campaign-hedgehogs.ts'

const ROOT = 'D:/war game/OCS各作数据库/OCS第三个冬天'
const SCENARIO = '01-dnepr-battles'
const read = async (...parts) => JSON.parse((await readFile(join(ROOT, ...parts), 'utf8')).replace(/^\uFEFF/, ''))

async function scenario01() {
  const [hexes, edges, catalog, setupRaw] = await Promise.all([
    read('地图数据库', 'map_hexes.json'), read('地图数据库', 'map_edges.json'),
    loadThirdWinterV2Units((file) => read('data', file)), read('scenarios', SCENARIO, 'setup.json'),
  ])
  const map = indexTtwCampaignMap(hexes, edges)
  const setup = prepareCampaignSetup(setupRaw, catalog.aliases, map, campaignMapInPlayArea(map, ttwCampaignPlayArea(SCENARIO)))
  return { map, catalog, setup, setupRaw }
}

const attackCapable = (catalog, definition) => {
  const attack = catalog.definitions.get(definition)?.source.faces.combat?.stats.attack
  return typeof attack === 'number' && attack > 0
}

test('scenario 01 real hedgehog D35.29 completes 9.14e with a real Soviet regiment', async () => {
  const { map, catalog, setup } = await scenario01()
  const hedgehog = setup.initialHedgehogs.find((row) => row.hex === 'D35.29')
  assert.deepEqual(hedgehog, { hex: 'D35.29', side: 'axis', level: 1 })
  const attacker = setup.counters.find((row) => row.ref === 'Sov 53 MC Rgt')
  assert.ok(attacker)
  // The regiment's printed setup hex is D37.30; D36.29 is a real adjacent hex,
  // used here as an explicit test placement so the entry probe has a legal start.
  const attackerHex = 'D36.29'
  assert.ok(map.neighbors('D35.29').includes(attackerHex))
  const state = { turn: 1, counters: { [attacker.definition]: { side: 'soviet', location: { kind: 'map', hex: attackerHex } } },
    hedgehogs: { 'D35.29': hedgehog } }
  const after = captureCampaignHedgehog(state, 'soviet', 'D35.29', [attacker.definition], {
    attackCapable: (_state, id) => attackCapable(catalog, id),
  })
  assert.equal(after.hedgehogs['D35.29'], null)

  const truck = setup.counters.find((row) => row.ref === 'Sov 5.Gd Cav Truck')
  assert.ok(truck)
  const refused = captureCampaignHedgehog(state, 'soviet', 'D35.29', [truck.definition], {
    attackCapable: (_state, id) => attackCapable(catalog, id),
  })
  assert.equal(refused, state)
})

test('scenario 01 real Soviet supply point D60.19 completes 9.14b with a real Axis attacker', async () => {
  const { map, catalog, setup, setupRaw } = await scenario01()
  const supplyMarker = setupRaw.markers.find((row) => row.ref === 'Supply Point' && row.side === 'soviet')
  assert.ok(supplyMarker)
  const hex = `D${supplyMarker.at.col}.${supplyMarker.at.row}`
  const attacker = setup.counters.find((row) => row.ref === 'Ge 302 Ers Bn')
  assert.ok(attacker)
  // D59.19 is a real neighbor of the real supply hex D60.19; the Axis battalion's
  // printed setup hex is D35.29, so this is an explicit test placement.
  const attackerHex = 'D59.19'
  assert.ok(map.neighbors(hex).includes(attackerHex))
  const state = { turn: 1,
    counters: { [attacker.definition]: { side: 'axis', location: { kind: 'map', hex: attackerHex } } },
    rng: createRngState(623), supplyDumps: { axis: {}, soviet: { [hex]: 8 } } }
  const after = captureCampaignDump(state, 'axis', hex, [attacker.definition], {
    attackCapable: (_state, id) => attackCapable(catalog, id),
  })
  assert.equal(after.supplyDumps.soviet[hex], undefined)
  assert.ok((after.supplyDumps.axis[hex] ?? 0) > 0)
  assert.equal(after.rng.drawCount, state.rng.drawCount + 1)

  const truck = setup.counters.find((row) => row.ref === 'Sov 5.Gd Cav Truck')
  const refused = captureCampaignDump({ ...state, rng: createRngState(623) }, 'axis', hex, [truck.definition], {
    attackCapable: (_state, id) => attackCapable(catalog, id),
  })
  assert.equal(refused.rng.drawCount, 0)
  assert.equal(refused.supplyDumps.soviet[hex], 8)
})
