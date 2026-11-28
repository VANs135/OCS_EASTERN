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

test('scenario 01 real Axis engineering HQ draws a real Air Strip counter', async () => {
  const loaded = await scenario01()
  const opened = openCampaignMatch(prepareDnieperBoard(loaded), createRngState(1)).state
  const site = loaded.playable.resolveHex('B17.7')
  assert.equal(opened.supplyDumps.axis[site], 4)
  assert.equal(opened.airBases.some((base) => base.hex === site), false)
  assert.equal(scorpionAirstripPool(opened, loaded.catalog).length, 6, '01 starts with six real Air Strip markers')
  const engineerRow = loaded.setup.counters.find((counter) => counter.ref === 'Ge HQ 3 Pz Corps')
  const engineerId = Object.keys(opened.counters).find((id) => opened.counters[id].side === 'axis' &&
    opened.counters[id].definition === engineerRow.definition && opened.counters[id].location.kind === 'map')
  const sovietEngineerRow = loaded.setup.counters.find((counter) => counter.ref === 'Sov HQ 40th Army')
  const sovietEngineerId = Object.keys(opened.counters).find((id) => opened.counters[id].side === 'soviet' &&
    opened.counters[id].definition === sovietEngineerRow.definition && opened.counters[id].location.kind === 'map')
  const board = (state, side) => ({ map: loaded.playable, airstripPool: () => scorpionAirstripPool(state, loaded.catalog).map(({ key }) => key),
    worker(current, id) {
      const counter = current.counters[id]
      if (!counter || counter.location.kind !== 'map') return undefined
      const engineering = loaded.catalog.definitions.get(counter.definition)?.source.abilities?.includes('engineering') === true
      return { hex: counter.location.hex, combat: true, stationary: true, re: counter.currentRe ?? 1,
        engineerAt: (hex) => engineering && hex === counter.location.hex }
    } })
  const axisState = { ...opened, cursor: { first: 'axis', phasing: 'axis', phase: 'movement' },
    movementSegment: 'movement', groundMovement: { moved: [], zocLocks: [] } }
  const build = { type: 'work-campaign-airfield', operation: 'build-strip', hex: site, unitIds: [engineerId],
    payments: [{ hex: site, tokens: 1 }] }
  const after = workCampaignAirfield(axisState, 'axis', build, board(axisState))
  const strip = after.airBases.find((base) => base.hex === site)
  assert.equal(strip.level, 0)
  assert.match(strip.strip, /^marker:id:44/)
  assert.equal(after.supplyDumps.axis[site], 3)
  assert.equal(scorpionAirstripPool(after, loaded.catalog).length, 5)
  assert.equal(after.airfieldBuiltAt[site], axisState.turn)

  const sovietState = { ...opened, cursor: { first: 'soviet', phasing: 'soviet', phase: 'movement' },
    movementSegment: 'movement', groundMovement: { moved: [], zocLocks: [] } }
  assert.throws(() => workCampaignAirfield(sovietState, 'soviet',
    { ...build, hex: 'B13.17', unitIds: [sovietEngineerId], payments: [{ hex: 'B13.17', tokens: 1 }] },
    board(sovietState)), /Illegal airfield work: airfield-strip-axis-only/)
  assert.throws(() => workCampaignAirfield(axisState, 'axis', { ...build, payments: [{ hex: site, tokens: 2 }] },
    board(axisState)), /Airfield work requires exactly 1 transport points/)
})
