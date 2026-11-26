import assert from 'node:assert/strict'
import test from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'

const map = { resolveHex: (h) => h, neighbors: (h) => [`${Number(h) - 1}`, `${Number(h) + 1}`] }
const hqFacts = (patch = {}) => (state, id) => id === 'AG' ? { isArmyGroupHq: true, combatMode: true,
  spStackedAtMovementStart: false, hqHex: '10', throwRadius: 2, ...patch } : undefined

const combat = (patch = {}) => ({ target: '11', attacker: 'axis', attackers: ['A'], defenders: ['D'],
  heldAtStart: { axis: [], soviet: [] }, hedgehog: 0, step: 'attacker-rating', ...patch })

function game(patch = {}, facts = hqFacts()) {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 6, counters: {
    AG: { definition: 'AG', kind: 'hq', side: 'axis', location: { kind: 'map', hex: '10' } },
    A: { definition: 'A', kind: 'land', side: 'axis', location: { kind: 'map', hex: '11' } },
    D: { definition: 'D', kind: 'land', side: 'soviet', location: { kind: 'map', hex: '11' } } } }, 800)
  record.state.cursor = { phase: 'combat', phasing: 'axis', first: 'axis' }
  record.state.combat = combat()
  Object.assign(record.state, patch)
  return { record, facts }
}
let seq = 0
const declare = ({ record, facts }, action, side = 'axis') => submitCampaignMatch(record, side,
  { id: `ag-drm-${seq++}`, expectedRevision: record.revision, action: { type: 'declare-campaign-army-group-drm', ...action } },
  { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: (h) => h, arrivalSites: () => [] },
    groundMovement: { map }, axisHqFacts: facts }).record

test('an Army Group HQ adds a +1 DRM once per game turn before the dice (TTW 2.3c E)', () => {
  const declared = declare(game(), { hqId: 'AG', drm: 1 })
  assert.equal(declared.state.combat.armyGroupDrm, 1)
  assert.equal(declared.state.armyGroupDrmTurn, 6)
  // the same combat never takes a second DRM, and a new combat in the same game turn is refused too
  assert.throws(() => declare({ record: declared, facts: hqFacts() }, { hqId: 'AG', drm: -1 }), /already carries/)
  const second = { ...declared, state: { ...declared.state, combat: combat() } }
  assert.throws(() => declare({ record: second, facts: hqFacts() }, { hqId: 'AG', drm: -1 }), /already used this game turn/)
  const nextTurn = game({ turn: 7 })
  assert.equal(declare(nextTurn, { hqId: 'AG', drm: -1 }).state.combat.armyGroupDrm, -1)
})

test('the DRM needs the dice unthrown, an Axis declarer and a unit in throw range (TTW 2.3c E)', () => {
  const rolled = game({ combat: combat({ roll: { code: 'A1', attacker: {}, defender: {} } }) })
  assert.throws(() => declare(rolled, { hqId: 'AG', drm: 1 }), /before the combat dice/)
  assert.throws(() => declare(game(), { hqId: 'AG', drm: 1 }, 'soviet'), /Only the Axis/)
  const far = game({}, hqFacts({ throwRadius: 0 }))
  assert.throws(() => declare(far, { hqId: 'AG', drm: 1 }), /within the Army Group HQ throw range/)
  const corps = game({}, (state, id) => id === 'AG' ? { isArmyGroupHq: false, combatMode: true, spStackedAtMovementStart: false,
    hqHex: '10', throwRadius: 2 } : undefined)
  assert.throws(() => declare(corps, { hqId: 'AG', drm: 1 }), /Army Group HQ/)
  assert.throws(() => declare(game(), { hqId: 'AG', drm: 2 }), /\+1 or -1/)
})
