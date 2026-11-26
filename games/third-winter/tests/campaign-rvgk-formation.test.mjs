import assert from 'node:assert/strict'
import test from 'node:test'
import { openCampaignMatch } from '../src/match/campaign-match.ts'
import { campaignRvgkMinimums } from '../src/match/campaign-rvgk-formation.ts'

const cls = (id) => id.startsWith('tmc') ? 'tankMechCorps' : id.startsWith('cav') ? 'cavalryCorps'
  : id.startsWith('arty') ? 'artyKatyDivisions' : id.startsWith('inf') ? 'infantryDivisions'
  : id.startsWith('tahq') ? 'tankArmyHq' : null
const board = { classify: (s, c) => cls(c.unitId), formationCounts: (s, c) => c.unitId !== 'excluded' }

function game(units) {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 1, counters: {}, supplyDumps: {} }, 210)
  record.state.counters = Object.fromEntries(units.map(([id, box]) => [id,
    { side: 'soviet', unitId: id, steps: 1, location: { kind: 'box', box }, mode: 'strat', internal: 0, formationId: null }]))
  return record
}
const full = [
  ...Array.from({ length: 6 }, (_, i) => [`tmc${i}`, 'rvgk-1']),
  ['cav0', 'rvgk-1'], ['arty0', 'rvgk-2'], ['arty1', 'rvgk-2'],
  ['inf0', 'rvgk-1'], ['inf1', 'rvgk-1'], ['inf2', 'rvgk-2'], ['tahq0', 'rvgk-2'],
]

test('RVGK minimum formation counts both boxes and passes when met (§3.5b)', () => {
  const { counts, ok, missing } = campaignRvgkMinimums(game(full).state, board)
  assert.deepEqual(counts, { tankMechCorps: 6, cavalryCorps: 1, artyKatyDivisions: 2, infantryDivisions: 3, tankArmyHq: 1 })
  assert.equal(ok, true)
  assert.deepEqual(missing, [])
})

test('RVGK minimum formation reports missing classes and excludes non-counting formations', () => {
  // drop one tank/mech corps and the cavalry corps -> short
  const short = full.filter(([id]) => id !== 'tmc5' && id !== 'cav0')
  const r = campaignRvgkMinimums(game(short).state, board)
  assert.equal(r.ok, false)
  assert.deepEqual([...r.missing].sort(), ['cavalryCorps', 'tankMechCorps'])
  // a unit whose formation does not count is excluded even if present
  const withExcluded = game([...full, ['excluded', 'rvgk-1']])
  // 'excluded' classifies to null anyway; use a tmc id that formationCounts rejects
  const b2 = { classify: (s, c) => cls(c.unitId), formationCounts: (s, c) => c.unitId !== 'tmc0' }
  const r2 = campaignRvgkMinimums(game(full).state, b2)
  assert.equal(r2.counts.tankMechCorps, 5)   // tmc0 excluded by formation rule
  assert.equal(r2.ok, false)
})