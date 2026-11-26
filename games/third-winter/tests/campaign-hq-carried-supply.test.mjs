import assert from 'node:assert/strict'
import test from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { campaignPhysicalSupply, spendCampaignSupply } from '../src/match/campaign-supply-ledger.ts'

const map = { resolveHex: (h) => h, neighbors: (h) => [`${Number(h) - 1}`, `${Number(h) + 1}`] }
const facts = (armyGroup = true) => (state, id) => state.counters[id]?.location.kind === 'map'
  ? { isArmyGroupHq: armyGroup, combatMode: false, spStackedAtMovementStart: false,
    hqHex: state.counters[id].location.hex, throwRadius: 3 } : undefined

function game(dump = 8) {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 6, counters: {
    AG: { definition: 'AG HQ', kind: 'hq', side: 'axis', location: { kind: 'map', hex: '10' } } },
  supplyDumps: { axis: { 10: dump }, soviet: {} } }, 901)
  record.state.cursor = { phase: 'movement', phasing: 'axis', first: 'axis' }
  record.state.movementSegment = 'movement'
  return record
}
let seq = 0
const act = (record, action, side = 'axis', hqFacts = facts()) => submitCampaignMatch(record, side,
  { id: `hq-carry-${seq++}`, expectedRevision: record.revision, action }, { reinforcement: {
    schedule: new Map(), bindings: new Map(), resolveHex: (h) => h, arrivalSites: () => [] },
    groundMovement: { map }, axisHqFacts: hqFacts }).record

test('an Army Group HQ loads at most one SP from the dump it stands on (TTW 2.3c D)', () => {
  const loaded = act(game(), { type: 'load-campaign-hq-supply', hqId: 'AG', tokens: 4 })
  assert.equal(loaded.state.counters.AG.carriedSupplyTokens, 4)
  assert.equal(loaded.state.supplyDumps.axis['10'], 4)
  // full carry cannot take a fifth token
  assert.throws(() => act(loaded, { type: 'load-campaign-hq-supply', hqId: 'AG', tokens: 1 }), /at most one SP/)
  // no dump at the HQ hex
  assert.throws(() => act(game(0), { type: 'load-campaign-hq-supply', hqId: 'AG', tokens: 4 }), /no dump/)
  // an ordinary HQ is not an Army Group HQ
  assert.throws(() => act(game(), { type: 'load-campaign-hq-supply', hqId: 'AG', tokens: 4 }, 'axis', facts(false)),
    /Army Group HQ/)
})

test('the HQ drops the carried SP into the hex it stands on (TTW 2.3c D)', () => {
  const loaded = act(game(), { type: 'load-campaign-hq-supply', hqId: 'AG', tokens: 4 })
  const dropped = act(loaded, { type: 'unload-campaign-hq-supply', hqId: 'AG', tokens: 4 })
  assert.equal(dropped.state.counters.AG.carriedSupplyTokens, 0)
  assert.equal(dropped.state.supplyDumps.axis['10'], 8)
  // cannot drop more than is carried
  assert.throws(() => act(loaded, { type: 'unload-campaign-hq-supply', hqId: 'AG', tokens: 8 }), /fewer tokens/)
})

test('carried tokens are a physical supply source that pays like a dump at the HQ hex (TTW 2.3c D)', () => {
  const loaded = act(game(), { type: 'load-campaign-hq-supply', hqId: 'AG', tokens: 4 })
  const sources = campaignPhysicalSupply(loaded.state, 'axis', map)
  const key = 'carried:AG'
  assert.equal(sources.get(key).tokens, 4)
  assert.equal(sources.get(key).hex, '10')
  const paid = spendCampaignSupply(loaded.state, 'axis', sources, new Map([[key, 4]]))
  assert.equal(paid.counters.AG.carriedSupplyTokens, 0)
  assert.equal(paid.supplyDumps.axis['10'], 4)
  // the exhausted source stays visible (zero tokens, like transport) so already-paid RE coverage can still feed
  assert.equal(campaignPhysicalSupply(paid, 'axis', map).get(key).tokens, 0)
})
