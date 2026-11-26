import assert from 'node:assert/strict'
import test from 'node:test'
import { campaignCatalogAdapter } from '../src/match/campaign-catalog-adapter.ts'
import { campaignEngineeringBoards } from '../src/match/campaign-engineering-boards.ts'
import { campaignSessionHooks } from '../src/match/campaign-session-context.ts'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'

// 直线相邻，便于验证 2 格工程可达
const map = { resolveHex: (h) => h, neighbors: (h) => {
  const n = Number(h)
  return Number.isInteger(n) ? [`${n - 1}`, `${n + 1}`].filter((x) => x !== '9') : []
} }
const def = (patch = {}) => ({ combat: true, engineer: false, re: 4, ...patch })
const board = (catalog, patch = {}) => campaignEngineeringBoards({ catalog, map, passable: () => true, ...patch })

function game(counters = {}, patch = {}) {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 6,
    counters, supplyDumps: { axis: { 10: 16, 11: 8 } } }, 600)
  record.state.cursor = { phase: 'movement', phasing: 'axis', first: 'axis' }
  record.state.movementSegment = 'movement'
  Object.assign(record.state, patch)
  return record
}
let seq = 0
const run = (record, action, boards) => submitCampaignMatch(record, 'axis',
  { id: `engineering-${seq++}`, expectedRevision: record.revision, action },
  { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: (h) => h, arrivalSites: () => [] }, ...boards }).record

test('stationary labour needs combat mode, no movement this phase and no release marks (OCS 16.0b)', () => {
  const { hedgehogWork } = board({ E: def(), U: def({ combat: true, re: 3 }) }, {})
  const state = game({ E: { definition: 'E', kind: 'hq', side: 'axis', location: { kind: 'map', hex: '10' } },
    U: { definition: 'U', kind: 'land', side: 'axis', location: { kind: 'map', hex: '11' } } }).state
  assert.equal(hedgehogWork.worker(state, 'E')?.stationary, true)
  assert.equal(hedgehogWork.worker(state, 'U')?.re, 3)
  const moved = { ...state, counters: { ...state.counters,
    E: { ...state.counters.E, mode: 'move' }, U: { ...state.counters.U, currentRe: 2 } },
    groundMovement: { moved: ['U'], zocLocks: [] } }
  assert.equal(hedgehogWork.worker(moved, 'E')?.stationary, false)
  assert.equal(hedgehogWork.worker(moved, 'U')?.stationary, false)
  assert.equal(hedgehogWork.worker(moved, 'U')?.re, 2)
})

test('engineering ability comes from the data layer and reaches two passable hexes (OCS 13.8d)', () => {
  const sources = { catalog: { ENG: def({ engineer: true }), HQ: def({ engineer: false }) }, map,
    passable: (state, from, to) => !(from === '10' && to === '11') }
  const { hedgehogWork } = campaignEngineeringBoards(sources)
  const state = game({ ENG: { definition: 'ENG', kind: 'hq', side: 'axis', location: { kind: 'map', hex: '10' } },
    HQ: { definition: 'HQ', kind: 'hq', side: 'axis', location: { kind: 'map', hex: '12' } } }).state
  const worker = hedgehogWork.worker(state, 'ENG')
  assert.equal(worker?.engineerAt('10'), true) // same hex
  assert.equal(worker?.engineerAt('11'), false) // the step is not passable
  assert.equal(worker?.engineerAt('12'), false) // 2 away but only through 11
  assert.equal(worker?.engineerAt('13'), false) // 3 away
  const open = campaignEngineeringBoards({ catalog: sources.catalog, map, passable: () => true })
  assert.equal(open.hedgehogWork.worker(state, 'ENG')?.engineerAt('12'), true)
  // a plain HQ without the engineering ability never qualifies
  assert.equal(open.hedgehogWork.worker(state, 'HQ')?.engineerAt('12'), false)
})

test('the session factory supplies both boards and a real hedgehog build settles (OCS 16.0b)', () => {
  const catalog = campaignCatalogAdapter({ definitions: new Map([
    ['hq:id:1', { key: 'hq:id:1', kind: 'hq', sourceFile: 'units_hq.json', sourceId: '1',
      source: { name: 'Ge HQ 1 Pz Army', side: 'axis', re: 4, abilities: ['engineering'],
        faces: { combat: { stats: {} }, move: null }, hqKind: 'pz_army' } }]]) })
  const hooks = campaignSessionHooks({ hqCatalog: catalog.hqCatalog, movementCatalog: catalog.movementCatalog,
    engineering: { catalog: catalog.engineeringCatalog, map, passable: () => true },
    geometry: { map, hexSite: () => ({ villageCity: true, detrainable: false, map: 'A' }), friendlyAirBase: () => false,
      isCombatUnit: () => true, inSupply: () => true },
    posture: { postureBenefitAt: () => undefined, frontOfHex: () => undefined } })
  assert.ok(catalog.engineeringCatalog['hq:id:1'].engineer)
  const record = game({ HQ: { definition: 'hq:id:1', kind: 'hq', side: 'axis', location: { kind: 'map', hex: '10' } } })
  const built = run(record, { type: 'work-campaign-hedgehog', operation: 'build', hex: '11',
    unitIds: ['HQ'], payments: [{ hex: '11', tokens: 8 }] }, hooks)
  assert.equal(built.state.hedgehogs['11'].level, 1)
  assert.equal(built.state.supplyDumps.axis['11'], undefined) // 8T fully spent, the empty dump is dropped
  // an airfield build runs on the same worker facts (4T, level 1)
  const airfield = run(game({ HQ: { definition: 'hq:id:1', kind: 'hq', side: 'axis', location: { kind: 'map', hex: '10' } } }),
    { type: 'work-campaign-airfield', operation: 'build', hex: '10', unitIds: ['HQ'], payments: [{ hex: '10', tokens: 4 }] }, hooks)
  assert.equal(airfield.state.airBases[0].level, 1)
})
