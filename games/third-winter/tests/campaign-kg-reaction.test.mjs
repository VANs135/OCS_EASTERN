import assert from 'node:assert/strict'
import test from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { campaignKgReactionOptions } from '../src/match/campaign-kg.ts'

function game({ phase = 'reaction', kampfgruppen = [{ id: 'kg1', hex: '0' }] } = {}) {
  const record = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 5,
    counters: { kg1: { id: 'kg1', side: 'axis', location: { kind: 'map', hex: '0' }, stepsLost: 0, mode: 'combat', kind: 'land', definition: 'pz' } },
    supplyDumps: {} }, 11)
  record.state.cursor = { phase, phasing: 'soviet', first: 'axis' }
  record.state.kampfgruppen = kampfgruppen
  return record
}
const ctx = (moved = true) => ({ reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: (h) => h, arrivalSites: () => [] },
  kgMovedOrAttacked: () => moved })
let seq = 0
const submit = (record, action, context = ctx(), side = 'axis') =>
  submitCampaignMatch(record, side, { id: `kg-react-${seq++}`, expectedRevision: record.revision, action }, context).record

test('Axis reaction rolls one die halved (round down) as the KG allowance, once per turn (§2.4e)', () => {
  const rolled = submit(game(), { type: 'roll-campaign-kg-reaction' })
  const r = rolled.state.kgReaction
  assert.ok(r.die >= 1 && r.die <= 6)
  assert.equal(r.count, Math.floor(r.die / 2))
  assert.equal(r.twoT, null)
  assert.throws(() => submit(rolled, { type: 'roll-campaign-kg-reaction' }), /once per turn/)
  // not in the movement phase
  assert.throws(() => submit(game({ phase: 'movement' }), { type: 'roll-campaign-kg-reaction' }), /Axis reaction phase/)
  const options = campaignKgReactionOptions(rolled.state, 'axis')
  assert.equal(options.rolled, true)
  assert.equal(options.count, r.count)
})

test('2T is placed on one KG that actually moved or attacked this reaction (§2.4e)', () => {
  // before rolling
  assert.throws(() => submit(game(), { type: 'place-campaign-kg-2t', id: 'kg1' }), /Roll the Kampfgruppe reaction first/)
  const rolled = submit(game(), { type: 'roll-campaign-kg-reaction' })
  // a KG that did not move or attack cannot receive 2T
  assert.throws(() => submit(rolled, { type: 'place-campaign-kg-2t', id: 'kg1' }, ctx(false)), /actually moved or attacked/)
  const placed = submit(rolled, { type: 'place-campaign-kg-2t', id: 'kg1' })
  assert.equal(placed.state.kgReaction.twoT, 'kg1')
  // only one KG receives 2T
  assert.throws(() => submit(placed, { type: 'place-campaign-kg-2t', id: 'kg1' }), /Only one Kampfgruppe/)
  // unknown marker
  assert.throws(() => submit(rolled, { type: 'place-campaign-kg-2t', id: 'nope' }), /existing Kampfgruppe/)
})