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
import { openCampaignMatch, applyCampaignTurn } from '../src/match/campaign-match.ts'
import { dnieperStackingBoard } from '../src/match/dnieper-ground-movement.ts'
import { campaignOverstackedHexes } from '../src/match/campaign-stacking.ts'

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

test('scenario 01 real divisions settle 4.8a by removing a whole chosen counter', async () => {
  const loaded = await scenario01()
  const opened = openCampaignMatch(prepareDnieperBoard(loaded), createRngState(1)).state
  const hex = loaded.playable.resolveHex('D59.29')
  assert.ok(hex, 'D59.29 is on the 01 map')
  const refs = ['Sov 50 Rifle Div', 'Sov 39 Gd Rifle Div', 'Sov 60 Gd Rifle Div',
    'Sov 244 Rifle Div', 'Sov 333 Rifle Div']
  const ids = refs.map((ref) => {
    const row = loaded.setup.counters.find((counter) => counter.ref === ref)
    assert.ok(row, `${ref} is a real 01 unit`)
    const id = Object.keys(opened.counters).find((candidate) => opened.counters[candidate].side === 'soviet' &&
      opened.counters[candidate].definition === row.definition && opened.counters[candidate].location.kind === 'map')
    assert.ok(id, `${ref} is on the board`)
    return id
  })
  const counters = { ...opened.counters }
  for (const id of ids) counters[id] = { ...counters[id], location: { kind: 'map', hex } }
  const state = { ...opened, counters, cursor: { first: 'soviet', phasing: 'soviet', phase: 'movement' },
    movementSegment: 'movement' }
  const board = dnieperStackingBoard(loaded.playable, loaded.catalog.definitions)
  const stack = campaignOverstackedHexes(state, 'soviet', board).find((candidate) => candidate.hex === hex)
  assert.ok(stack)
  assert.equal(stack.re, 13)
  assert.deepEqual(new Set(stack.candidates.map((candidate) => candidate.unitId)), new Set(ids))
  assert.throws(() => applyCampaignTurn(opened, 'soviet', { type: 'settle-campaign-stacking', hex,
    unitIds: [ids[0]] }, { reinforcement: {}, stacking: board }),
  /Stacking is settled at the end of your movement segment/)

  assert.throws(() => applyCampaignTurn(state, 'soviet', { type: 'settle-campaign-stacking', hex,
    unitIds: [ids[3]] }, { reinforcement: {}, stacking: board }),
  /Choose enough whole combat units to reach 10 RE/)
  const after = applyCampaignTurn(state, 'soviet', { type: 'settle-campaign-stacking', hex,
    unitIds: [ids[0]] }, { reinforcement: {}, stacking: board })
  assert.equal(after.counters[ids[0]].location.kind, 'dead-pile')
  assert.equal(after.counters[ids[0]].currentRe, 0)
  for (const id of ids.slice(1)) assert.equal(after.counters[id].location.hex, hex)
  assert.equal(campaignOverstackedHexes(after, 'soviet', board).length, 0)
})
