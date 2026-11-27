import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRngState } from '@ocs-eastern/series/rng'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { prepareCampaignSetup } from '../src/import/campaign-setup.ts'
import { campaignTerrain } from '../src/import/campaign-terrain.ts'
import { loadThirdWinterV2Units } from '../src/import/unit-v2.ts'
import { campaignMapInPlayArea, ttwCampaignPlayArea } from '../src/ttw/campaign/play-area.ts'
import { prepareDnieperBoard } from '../src/match/dnieper-opening.ts'
import { dnieperGroundMovementBoard } from '../src/match/dnieper-ground-movement.ts'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'

const ROOT = 'D:/war game/OCS各作数据库/OCS第三个冬天'
const SCENARIO = '01-dnepr-battles'
const read = async (...parts) => JSON.parse((await readFile(join(ROOT, ...parts), 'utf8')).replace(/^\uFEFF/, ''))

async function load() {
  const [hexes, edges, catalog, setupRaw] = await Promise.all([
    read('地图数据库', 'map_hexes.json'), read('地图数据库', 'map_edges.json'),
    loadThirdWinterV2Units((file) => read('data', file)), read('scenarios', SCENARIO, 'setup.json'),
  ])
  const geometry = indexTtwCampaignMap(hexes, edges)
  const playable = campaignMapInPlayArea(geometry, ttwCampaignPlayArea(SCENARIO))
  const terrain = campaignTerrain(playable)
  const setup = prepareCampaignSetup(setupRaw, catalog.aliases, geometry, playable)
  return { catalog, setup, setupRaw, playable, terrain, map: geometry }
}

test('scenario 01 complete opening runs first-turn pre-turn, reinforcement, first Soviet move and movement close', async () => {
  const loaded = await load()
  const opening = prepareDnieperBoard(loaded)
  const record = openCampaignMatch(opening, createRngState(2))
  const board = dnieperGroundMovementBoard(loaded.playable, loaded.terrain, loaded.catalog.definitions)
  const configured = {
    groundMovement: board,
    reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: (hex) => hex,
      arrivalSites: () => [], supplyTable: (state) => [{ kind: state.cursor.phasing === 'axis' ? 'axis-supply' : 'soviet-supply',
        tokens: 0 }], supplyPlacementPlan: (state) => {
        const hex = Object.values(state.counters).find((counter) => counter.side === state.cursor.phasing &&
          counter.location.kind === 'map')?.location.hex
        assert(hex, 'the opening board has a friendly map hex for a zero-token supply plan')
        return [{ pool: state.cursor.phasing === 'axis' ? 'axis-supply' : 'soviet-supply', tokens: 0,
          sites: [{ hex, side: state.cursor.phasing, minTokens: 0, maxTokens: 0 }] }]
      }, replacementTable: () => ({ pax: 0, air: 0, eq: [], ally: 0, special: false }),
      specialReplacementTable: () => [] },
    reinforcementBlockers: () => [],
    movementBarrageBlockers: () => [],
  }
  const command = (current, type, fields = {}) => ({ id: `${type}:${current.revision}`, expectedRevision: current.revision,
    action: { type, ...fields } })
  const send = (current, type, fields = {}, side = 'soviet') => submitCampaignMatch(current, side,
    command(current, type, fields), configured).record

  const weather = send(record, 'determine-campaign-weather')
  const event = send(weather, 'roll-campaign-event')
  assert.equal(event.state.cursor.phase, 'aircraft-refit')
  const refit = send(event, 'complete-campaign-refit')
  const atOpening = send(refit, 'complete-campaign-reinforcement-opening')
  const scheduled = send(atOpening, 'complete-scheduled-reinforcements')
  const supplied = send(scheduled, 'roll-campaign-supply')
  const placed = send(supplied, 'place-campaign-supply', { placements: [] })
  const replacements = send(placed, 'roll-campaign-replacements')
  const rebuilt = send(replacements, 'complete-campaign-rebuilds')
  const movementStart = send(rebuilt, 'complete-campaign-reinforcement')
  const breakoutDone = send(movementStart, 'complete-campaign-breakout')
  assert.deepEqual(breakoutDone.state.cursor, { first: 'soviet', phasing: 'soviet', phase: 'movement' })
  assert.equal(breakoutDone.state.movementSegment, 'movement')

  const row = loaded.setup.counters.find((candidate) => candidate.ref === 'Sov 31 Rifle Div')
  assert(row, 'Sov 31 Rifle Div is in the real 01 setup')
  assert.equal(row.hex, 'D39.30')
  const mover = Object.entries(breakoutDone.state.counters).find(([, counter]) =>
    counter.definition === row.definition && counter.location.kind === 'map' && counter.location.hex === 'D39.30')?.[0]
  assert(mover, 'Sov 31 Rifle Div has an engine counter id')
  const moved = send(breakoutDone, 'move-campaign-ground', { movers: [{ id: mover }], path: ['D38.29'] })
  const unit = moved.state.counters[mover]
  assert.deepEqual(unit.location, { kind: 'map', hex: 'D38.29' })
  assert.equal(moved.state.groundMovement.moved.includes(mover), true)
  assert.deepEqual([...new Set(moved.state.groundMovement.moved)], [mover])
  const movementEnded = send(moved, 'complete-campaign-ground-movement')
  assert.equal(movementEnded.state.movementSegment, 'barrage')
  const barrageDone = send(movementEnded, 'complete-campaign-movement-phase')
  assert.equal(barrageDone.state.cursor.phase, 'supply')
  assert.equal(barrageDone.state.movementSegment, undefined)
})
