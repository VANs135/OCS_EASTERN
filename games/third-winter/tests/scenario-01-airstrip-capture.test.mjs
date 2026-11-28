import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRngState } from '@ocs-eastern/series/rng'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { prepareCampaignSetup } from '../src/import/campaign-setup.ts'
import { loadThirdWinterV2Units } from '../src/import/unit-v2.ts'
import { campaignMapInPlayArea, ttwCampaignPlayArea } from '../src/ttw/campaign/play-area.ts'
import { prepareDnieperBoard } from '../src/match/dnieper-opening.ts'
import { openCampaignMatch } from '../src/match/campaign-match.ts'
import { campaignMovementProfiles } from '../src/match/campaign-movement-profiles.ts'
import { workCampaignAirfield } from '../src/match/campaign-airfield.ts'
import { resolveCampaignEntryCapture } from '../src/match/campaign-entry-capture.ts'
import { scorpionAirstripPool } from '../src/match/scorpion-airfield-work.ts'

const ROOT = 'D:/war game/OCS各作数据库/OCS第三个冬天'
const SCENARIO = '01-dnepr-battles'
const read = async (...parts) => JSON.parse((await readFile(join(ROOT, ...parts), 'utf8')).replace(/^\uFEFF/, ''))
async function scenario01() {
  const [hexes, edges, catalog, setupRaw] = await Promise.all([
    read('地图数据库', 'map_hexes.json'), read('地图数据库', 'map_edges.json'),
    loadThirdWinterV2Units((file) => read('data', file)), read('scenarios', SCENARIO, 'setup.json'),
  ])
  const map = indexTtwCampaignMap(hexes, edges)
  const playable = campaignMapInPlayArea(map, ttwCampaignPlayArea(SCENARIO))
  const setup = prepareCampaignSetup(setupRaw, catalog.aliases, map, playable)
  return { map, playable, catalog, setup, setupRaw }
}
const idOf = (state, setup, ref) => {
  const row = setup.counters.find((counter) => counter.ref === ref)
  return Object.keys(state.counters).find((id) => state.counters[id].definition === row.definition)
}

test('scenario 01 Soviet attack occupation returns the real Air Strip to the pool', async () => {
  const loaded = await scenario01()
  const opened = openCampaignMatch(prepareDnieperBoard(loaded), createRngState(1)).state
  const site = loaded.playable.resolveHex('B17.7')
  const engineerId = idOf(opened, loaded.setup, 'Ge HQ 3 Pz Corps')
  const attackerId = idOf(opened, loaded.setup, 'Sov 53 MC Rgt')
  const truckId = idOf(opened, loaded.setup, 'Sov 5.Gd Cav Truck')
  assert.ok(engineerId && attackerId && truckId)
  const profiles = campaignMovementProfiles(Object.fromEntries(loaded.catalog.definitions))
  const axisState = { ...opened, cursor: { first: 'axis', phasing: 'axis', phase: 'movement' },
    movementSegment: 'movement', groundMovement: { moved: [], zocLocks: [] } }
  const board = { map: loaded.playable,
    airstripPool: () => scorpionAirstripPool(axisState, loaded.catalog).map(({ key }) => key),
    worker(current, id) {
      const counter = current.counters[id]
      if (!counter || counter.location.kind !== 'map') return undefined
      return { hex: counter.location.hex, combat: true, stationary: true, re: counter.currentRe ?? 1,
        engineerAt: (hex) => hex === counter.location.hex }
    } }
  const built = workCampaignAirfield(axisState, 'axis', { type: 'work-campaign-airfield', operation: 'build-strip',
    hex: site, unitIds: [engineerId], payments: [{ hex: site, tokens: 1 }] }, board)
  const stripKey = built.airBases.find((base) => base.hex === site)?.strip
  assert.ok(stripKey)
  assert.equal(scorpionAirstripPool(built, loaded.catalog).length, 5)
  const withAttacker = { ...built, counters: { ...built.counters,
    [attackerId]: { ...built.counters[attackerId], location: { kind: 'map', hex: site } } } }
  const entryBoard = (current) => ({ attackCapable: (_state, id) =>
    profiles.profileOf(current, id)?.attackCapable === true, printedHedgehog: () => null })
  const captured = resolveCampaignEntryCapture(withAttacker, 'soviet', site, [attackerId],
    entryBoard(withAttacker))
  assert.deepEqual(captured.airBases.find((base) => base.hex === site), { hex: site, side: 'axis', level: 0 })
  assert.equal(scorpionAirstripPool(captured, loaded.catalog).length, 6)

  const withTruck = { ...built, counters: { ...built.counters,
    [truckId]: { ...built.counters[truckId], location: { kind: 'map', hex: site } } } }
  const refused = resolveCampaignEntryCapture(withTruck, 'soviet', site, [truckId], entryBoard(withTruck))
  assert.equal(refused, withTruck)
  assert.equal(refused.airBases.find((base) => base.hex === site)?.strip, stripKey)
})
