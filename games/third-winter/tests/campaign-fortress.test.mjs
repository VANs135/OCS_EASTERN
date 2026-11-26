import assert from 'node:assert/strict'
import test from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { fortressExitRefusal, settleCampaignFortressStatus } from '../src/match/campaign-fortress.ts'

const map = { resolveHex: (h) => h }
const city = (hexes, name = 'Kiev') => ({ city: name, hexes })
const board = (patch = {}) => ({ map,
  cityOf: () => city(['24', '25']),
  axisControlsCity: () => true,
  enemyCombatWithin2: () => true,
  fortressUnit: (s, kind) => kind === 'rumanian' ? { definition: 'rum-fort', re: 1 } : { definition: 'ge-fort', re: 1 },
  withinRumania: () => true, ...patch })

function game(patch = {}) {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 4, counters: {}, supplyDumps: {} }, 300)
  record.state.cursor = { phase: 'movement', phasing: 'soviet', first: 'axis' }
  Object.assign(record.state, patch)
  return record
}
let seq = 0
const declare = (record, action, b, side = 'axis') => submitCampaignMatch(record, side,
  { id: `fortress-${seq++}`, expectedRevision: record.revision, action: { type: 'declare-campaign-fortress', ...action } },
  { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: (h) => h, arrivalSites: () => [] }, fortressBoard: b }).record

test('declaring a fortress places the unit and a Level-1 hedgehog, even mid-Soviet movement (§2.4a)', () => {
  const declared = declare(game(), { city: 'Kiev', hex: '24', fortress: 'german' }, board())
  assert.equal(declared.state.counters['fortress:24'].definition, 'ge-fort')
  assert.equal(declared.state.counters['fortress:24'].location.hex, '24')
  assert.equal(declared.state.hedgehogs['24'].level, 1)
  assert.deepEqual(declared.state.fortresses.map(({ city }) => city), ['Kiev'])
  // A second fortress unit is allowed only in Odessa, Kiev or Poltava
  const second = declare(game(), { city: 'Kiev', hex: '24', fortress: 'german', secondHex: '25' }, board())
  assert.equal(second.state.counters['fortress:25'].definition, 'ge-fort')
})

test('declaration is refused off-pool, without the enemy trigger, on an uncontrolled or already-fortress city (§2.4a)', () => {
  const poolEmpty = board({ fortressUnit: () => undefined })
  assert.throws(() => declare(game(), { city: 'Kiev', hex: '24', fortress: 'german' }, poolEmpty), /pool/)
  const noEnemy = board({ enemyCombatWithin2: () => false })
  assert.throws(() => declare(game(), { city: 'Kiev', hex: '24', fortress: 'german' }, noEnemy), /within two hexes/)
  const uncontrolled = board({ axisControlsCity: () => false })
  assert.throws(() => declare(game(), { city: 'Kiev', hex: '24', fortress: 'german' }, uncontrolled), /Axis-controlled/)
  assert.throws(() => declare(game({ fortresses: [{ city: 'Kiev', hexes: ['24', '25'], sinceTurn: 2 }] }),
    { city: 'Kiev', hex: '24', fortress: 'german' }, board()), /already a fortress/)
  // foreign city hex selection
  assert.throws(() => declare(game(), { city: 'Kiev', hex: '30', fortress: 'german' }, board()), /hex of the declared city/)
  // Soviet player cannot declare
  assert.throws(() => declare(game(), { city: 'Kiev', hex: '24', fortress: 'german' }, board(), 'soviet'), /Only the Axis/)
  // second unit outside the three named cities
  const kharkov = board({ cityOf: () => city(['10'], 'Kharkov') })
  assert.throws(() => declare(game(), { city: 'Kharkov', hex: '10', fortress: 'german', secondHex: '11' }, kharkov), /another hex/)
})

test('the Rumanian fortress is confined to Rumania (§2.4a)', () => {
  const outside = board({ withinRumania: () => false })
  assert.throws(() => declare(game(), { city: 'Kiev', hex: '24', fortress: 'rumanian' }, outside), /within two hexes|Axis-controlled|Rumania|pool/)
  const inside = board()
  const declared = declare(game(), { city: 'Kiev', hex: '24', fortress: 'rumanian' }, inside)
  assert.equal(declared.state.counters['fortress:24'].definition, 'rum-fort')
})

test('Axis ground units may not leave a fortress city and status ends when the city is wholly Soviet (§2.4a)', () => {
  const state = { counters: {}, fortresses: [{ city: 'Kiev', hexes: ['24', '25'], sinceTurn: 3 }] }
  assert.equal(fortressExitRefusal(state, '24', '25'), null)
  assert.equal(fortressExitRefusal(state, '24', '30'), 'fortress-city-no-exit')
  assert.equal(fortressExitRefusal(state, '30', '24'), null)
  const partial = settleCampaignFortressStatus(state, (hex) => hex === '24')
  assert.equal(partial.fortresses.length, 1)
  const ended = settleCampaignFortressStatus(state, () => true)
  assert.equal(ended.fortresses.length, 0)
})