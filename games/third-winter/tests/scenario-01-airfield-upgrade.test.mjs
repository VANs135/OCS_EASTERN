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
import { workCampaignAirfield } from '../src/match/campaign-airfield.ts'

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

test('scenario 01 real Soviet Front HQ upgrades the real B17.29 airbase', async () => {
  const loaded = await scenario01()
  const opened = openCampaignMatch(prepareDnieperBoard(loaded), createRngState(1)).state
  const site = loaded.playable.resolveHex('B17.29')
  const payHex = loaded.playable.resolveHex('B16.28')
  assert.equal(opened.airBases.find((base) => base.hex === site)?.level, 1)
  assert.equal(opened.supplyDumps.soviet[payHex], 4, 'B16.28 holds the real 2 SP dump at the Front HQ')
  const engineerRow = loaded.setup.counters.find((counter) => counter.ref === 'Sov HQ 1st Ukr Front')
  assert.ok(engineerRow)
  const engineerId = Object.keys(opened.counters).find((id) => opened.counters[id].side === 'soviet' &&
    opened.counters[id].definition === engineerRow.definition && opened.counters[id].location.kind === 'map')
  assert.ok(engineerId)
  const nonEngineerRow = loaded.setup.counters.find((counter) => counter.ref === 'Sov 5.Gd Cav Truck')
  assert.ok(nonEngineerRow)
  const nonEngineerId = Object.keys(opened.counters).find((id) => opened.counters[id].side === 'soviet' &&
    opened.counters[id].definition === nonEngineerRow.definition)
  const state = { ...opened, cursor: { first: 'soviet', phasing: 'soviet', phase: 'movement' },
    movementSegment: 'movement', groundMovement: { moved: [], zocLocks: [] } }
  const withinTwo = (from, to) => {
    if (from === to) return true
    const seen = new Set([from])
    let frontier = [from]
    for (let depth = 0; depth < 2; depth++) {
      frontier = frontier.flatMap((hex) => loaded.playable.neighbors(hex)).filter((hex) => !seen.has(hex))
      for (const hex of frontier) seen.add(hex)
      if (seen.has(to)) return true
    }
    return false
  }
  const board = { map: loaded.playable,
    worker(current, id) {
      const counter = current.counters[id]
      if (!counter || counter.location.kind !== 'map') return undefined
      const engineering = loaded.catalog.definitions.get(counter.definition)?.source.abilities?.includes('engineering') === true
      return { hex: counter.location.hex, combat: true, stationary: !(current.groundMovement?.moved ?? []).includes(id),
        re: counter.currentRe ?? 1, engineerAt: (hex) => engineering && withinTwo(counter.location.hex, hex) }
    } }
  const upgrade = { type: 'work-campaign-airfield', operation: 'build', hex: site, unitIds: [engineerId],
    payments: [{ hex: payHex, tokens: 4 }] }
  const after = workCampaignAirfield(state, 'soviet', upgrade, board)
  assert.equal(after.airBases.find((base) => base.hex === site)?.level, 2)
  assert.equal(after.supplyDumps.soviet[payHex] ?? 0, 0)
  assert.equal(after.airfieldBuiltAt[site], state.turn)

  assert.throws(() => workCampaignAirfield(state, 'soviet', { ...upgrade, unitIds: [nonEngineerId] }, board),
    /Illegal airfield work: airfield-engineer-required/)
  assert.throws(() => workCampaignAirfield(state, 'soviet', { ...upgrade, payments: [{ hex: payHex, tokens: 3 }] }, board),
    /Airfield work requires exactly 4 transport points/)
})
