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
import { workCampaignHedgehog } from '../src/match/campaign-hedgehogs.ts'

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

test('scenario 01 real Soviet engineering HQ and its real 4 SP build a hedgehog', async () => {
  const loaded = await scenario01()
  const opened = openCampaignMatch(prepareDnieperBoard(loaded), createRngState(1)).state
  const site = loaded.playable.resolveHex('B13.17')
  assert.ok(site, 'B13.17 is on the 01 map')
  assert.equal(opened.supplyDumps.soviet[site], 8, 'B13.17 holds the real 4 SP dump at the engineering HQ')
  const engineerRow = loaded.setup.counters.find((counter) => counter.ref === 'Sov HQ 40th Army')
  assert.ok(engineerRow)
  const engineerId = Object.keys(opened.counters).find((id) => opened.counters[id].side === 'soviet' &&
    opened.counters[id].definition === engineerRow.definition && opened.counters[id].location.kind === 'map')
  assert.ok(engineerId)
  const nonCombatRow = loaded.setup.counters.find((counter) => counter.ref === 'Sov 5.Gd Cav Truck')
  assert.ok(nonCombatRow)
  const nonCombatId = Object.keys(opened.counters).find((id) => opened.counters[id].side === 'soviet' &&
    opened.counters[id].definition === nonCombatRow.definition)
  const state = { ...opened, cursor: { first: 'soviet', phasing: 'soviet', phase: 'movement' },
    movementSegment: 'movement', groundMovement: { moved: [], zocLocks: [] } }
  const profiles = campaignMovementProfiles(Object.fromEntries(loaded.catalog.definitions))
  const board = { map: loaded.playable,
    worker(current, id) {
      const counter = current.counters[id]
      if (!counter || counter.location.kind !== 'map') return undefined
      const definition = loaded.catalog.definitions.get(counter.definition)
      const engineering = definition?.source.abilities?.includes('engineering') === true
      return { hex: counter.location.hex, combat: profiles.profileOf(current, id)?.combat === true,
        stationary: !(current.groundMovement?.moved ?? []).includes(id),
        re: counter.currentRe ?? 1, engineerAt: (hex) => hex === counter.location.hex && engineering }
    } }
  const build = { type: 'work-campaign-hedgehog', operation: 'build', hex: site, unitIds: [engineerId],
    payments: [{ hex: site, tokens: 8 }] }
  const after = workCampaignHedgehog(state, 'soviet', build, board)
  assert.deepEqual(after.hedgehogs[site], { side: 'soviet', level: 1 })
  assert.equal(after.supplyDumps.soviet[site] ?? 0, 0)
  assert.equal(after.hedgehogBuiltAt[site], state.turn)

  assert.throws(() => workCampaignHedgehog(state, 'soviet', { ...build, unitIds: [nonCombatId] }, board),
    /Illegal hedgehog work: hedgehog-workers-required/)
  assert.throws(() => workCampaignHedgehog(state, 'soviet', { ...build, payments: [{ hex: site, tokens: 4 }] }, board),
    /Hedgehog work requires exactly 8 transport points/)
})

test('scenario 01 real Soviet engineer upgrades B13.17 to Level 2 next turn', async () => {
  const loaded = await scenario01()
  const opened = openCampaignMatch(prepareDnieperBoard(loaded), createRngState(1)).state
  const site = loaded.playable.resolveHex('B13.17')
  const engineerRow = loaded.setup.counters.find((counter) => counter.ref === 'Sov HQ 40th Army')
  const engineerId = Object.keys(opened.counters).find((id) => opened.counters[id].side === 'soviet' &&
    opened.counters[id].definition === engineerRow.definition && opened.counters[id].location.kind === 'map')
  const state = { ...opened, cursor: { first: 'soviet', phasing: 'soviet', phase: 'movement' },
    movementSegment: 'movement', groundMovement: { moved: [], zocLocks: [] } }
  const profiles = campaignMovementProfiles(Object.fromEntries(loaded.catalog.definitions))
  const board = { map: loaded.playable,
    worker(current, id) {
      const counter = current.counters[id]
      if (!counter || counter.location.kind !== 'map') return undefined
      const engineering = loaded.catalog.definitions.get(counter.definition)?.source.abilities?.includes('engineering') === true
      return { hex: counter.location.hex, combat: profiles.profileOf(current, id)?.combat === true,
        stationary: !(current.groundMovement?.moved ?? []).includes(id),
        re: counter.currentRe ?? 1, engineerAt: (hex) => hex === counter.location.hex && engineering }
    } }
  const build = { type: 'work-campaign-hedgehog', operation: 'build', hex: site, unitIds: [engineerId],
    payments: [{ hex: site, tokens: 8 }] }
  const level1 = workCampaignHedgehog(state, 'soviet', build, board)
  assert.equal(level1.hedgehogs[site]?.level, 1)
  assert.throws(() => workCampaignHedgehog(level1, 'soviet', build, board), /hedgehog-once-per-turn/)

  // 下一回合从真实 HQ 补给堆再投 8T；真实工程 HQ 就地升到 §1.1b 上限 Level 2。
  const next = { ...level1, turn: level1.turn + 1,
    supplyDumps: { ...level1.supplyDumps, soviet: { ...level1.supplyDumps.soviet, [site]: 8 } } }
  const level2 = workCampaignHedgehog(next, 'soviet', build, board)
  assert.equal(level2.hedgehogs[site]?.level, 2)
  assert.equal(level2.supplyDumps.soviet[site] ?? 0, 0)
  assert.equal(level2.hedgehogBuiltAt[site], next.turn)
  const next2 = { ...level2, turn: level2.turn + 1,
    supplyDumps: { ...level2.supplyDumps, soviet: { ...level2.supplyDumps.soviet, [site]: 8 } } }
  assert.throws(() => workCampaignHedgehog(next2, 'soviet', build, board), /hedgehog-level-illegal/)
})
