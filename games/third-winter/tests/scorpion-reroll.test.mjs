import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createRngState, roll2d6, rollDie, verifyRngState } from '@ocs-eastern/series/rng'
import { scorpionMap } from '../src/import/scorpion-map.ts'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'
import { currentScorpionTurn } from '../src/match/scorpion-round.ts'
import { openScorpionTurn } from '../src/ttw/scorpion/pre-turn.ts'
import { scorpionSessionBoxFrame } from '../src/view/scorpion-boxes.ts'

const from = 's10.01', target = 's10.02'
const map = scorpionMap([from, target].map((hex_id) => ({ hex_id, on_map: true, terrains_present: ['Open'] })),
  [{ hex_a: from, hex_b: target, edge_terrain: 'none', road_present: false, rail_present: false, bridge: false }])
const catalog = { definitions: new Map(), aliases: new Map(['Turn', 'Ground', 'Flight', 'Soviet VPs Tracker', 'Re-Roll Chit']
  .map((name) => [name, [{ kind: 'marker', source: { faces: { combat: { asset: `${name}.png` } } } }]])) }
const assets = { map, catalog }
const board = { supplyRail: { railGauge: () => 'axis' }, reinforcements: () => ({ catalog: [], controlOf: () => null }),
  combat: { table: { terrainColumns: { Open: ['1:1'] }, diceRows: ['2-12'], matrix: [['A DL1']] } },
  barrage: { columns: ['1 or less'], costs: [1], matrix: Array.from({ length: 11 }, () => ['1/2']) } }
const unit = (side, hex) => ({ side, hex, combat: true, printedRe: 1, stepsLost: 0, mobility: 'leg', actionRating: 3,
  attackCapable: true, strength: 4, combatClass: 'other', antiTank: 0 })
const weather = { ground: 'freeze', flight: 'normal', thawSeen: false, endGame: false }
function fixture(phase, seed = 42) {
  return { revision: 0, receipts: [], state: { kind: 'playing', rng: createRngState(seed), rerollHolder: 'soviet',
    turn: { number: 2, weather, vp: 0, step: { kind: 'player-turn', first: 'soviet', retention: 'closed' } },
    cursor: { turn: 2, first: 'soviet', phasing: 'soviet', phase, retention: 'closed' },
    arrival: { placed: [], mobilized: [], sovietVp: 0 }, arrivalsOnMap: [], placedAlerts: [], availableAlerts: [],
    units: {}, pieces: [], airBases: [], dumps: {}, railControl: {}, moved: [], pax: { axis: 0, soviet: 0 }, victory: null,
    combat: null, combatTargets: [], combatAttackers: [], window: null } }
}
const command = (at, action) => ({ id: `reroll-${at.revision}`, expectedRevision: at.revision, action })
const submit = (at, seat, action) => submitScorpionSession(at, seat, command(at, action), assets, board).record
const vote = (decision) => ({ type: 'resolve-reroll', decision })
const site = (record) => record.state.reroll?.current.site.kind
const faces = (record) => record.state.reroll.current.draw.value.faces

test('supply rerolls transfer the counter, survive reload and credit only the accepted pair', () => {
  const scheduled = { type: 'finish-scheduled-arrivals' }
  const start = submit(fixture('aircraft-refit'), 'soviet', { type: 'complete-refit' })
  const first = roll2d6(start.state.rng)
  const second = roll2d6(first.rng)
  const third = roll2d6(second.rng)
  const offered = submit(start, 'soviet', scheduled)
  assert.equal(site(offered), 'supply')
  assert.deepEqual(faces(offered), first.value.faces)
  assert.equal(offered.state.window.stage, 'scheduled')
  assert.equal(offered.state.window.variableTokens, 0)
  assert.throws(() => submit(offered, 'soviet', scheduled), /answer the pending roll/)
  assert.throws(() => submit(offered, 'axis', vote('reroll')), /Only the reroll holder/)
  const use = command(offered, vote('reroll'))
  const axis = submit(offered, 'soviet', use.action)
  assert.equal(axis.state.rerollHolder, 'axis')
  assert.deepEqual(faces(axis), second.value.faces)
  assert.equal(submitScorpionSession(axis, 'soviet', use, assets, board).duplicate, true)
  const view = scorpionSessionBoxFrame(axis.state, catalog, 'soviet')
  assert.equal(view.reroll.asset, 'Re-Roll Chit.png')
  assert.equal(view.reroll.holder, 'axis')
  assert.equal(view.reroll.offer.canAnswer, false)
  assert.equal(scorpionSessionBoxFrame(axis.state, catalog, 'axis').reroll.offer.canAnswer, true)
  const soviet = submit(JSON.parse(JSON.stringify(axis)), 'axis', vote('reroll'))
  assert.equal(soviet.state.rerollHolder, 'soviet')
  assert.deepEqual(faces(soviet), third.value.faces)
  const accepted = submit(soviet, 'soviet', vote('keep'))
  assert.equal(accepted.state.reroll, undefined)
  assert.deepEqual(accepted.state.window.dice, third.value.faces)
  assert.equal(accepted.state.window.variableTokens, 4 * (third.value.total <= 5 ? 5 : third.value.total <= 7 ? 6 : 7))
  assert.deepEqual(accepted.state.rng, third.rng)
  assert.ok(verifyRngState(accepted.state.rng))
  assert.deepEqual(accepted.state.rerollHistory.map(({ side }) => side), ['soviet', 'axis'])
})

test('rerolled Surprise changes the branch before the shift and combat rolls are offered', () => {
  const seed = Array.from({ length: 200 }, (_, i) => i).find((candidate) => {
    const first = roll2d6(createRngState(candidate))
    const next = roll2d6(first.rng)
    return first.value.total >= 6 && first.value.total <= 9 && next.value.total >= 10
  })
  const start = fixture('combat', seed)
  start.state.units = { a: unit('soviet', from), d: unit('axis', target) }
  start.state.combat = { attacker: 'soviet', target, defenders: ['d'], attackers: ['a'], defenderLeader: 'd',
    attackerLeader: 'a', step: 'defender-terrain', hedgehog: 0, defenseSupplied: true }
  const original = roll2d6(start.state.rng)
  const surprise = roll2d6(original.rng)
  const shift = rollDie(surprise.rng)
  const combat = roll2d6(shift.rng)
  let record = submit(start, 'axis', { type: 'choose-combat-terrain', terrain: 'Open', attackingTerrain: { [from]: 'Open' } })
  assert.equal(site(record), 'surprise')
  record = submit(record, 'soviet', vote('reroll'))
  record = submit(record, 'axis', vote('keep'))
  assert.equal(site(record), 'surprise-shift')
  assert.deepEqual(faces(record), [shift.value])
  record = submit(JSON.parse(JSON.stringify(record)), 'axis', vote('keep'))
  assert.equal(site(record), 'combat')
  assert.deepEqual(faces(record), combat.value.faces)
  assert.equal(record.state.combat.step, 'defender-terrain')
  record = submit(record, 'axis', vote('keep'))
  assert.equal(record.state.combat.step, 'attacker-result')
  assert.deepEqual(record.state.combat.roll.surpriseDice, surprise.value.faces)
  assert.equal(record.state.combat.roll.shift, shift.value)
  assert.deepEqual(record.state.combat.roll.combatDice, combat.value.faces)
  assert.deepEqual(record.state.rng, combat.rng)
})

test('barrage half loss stays separate and no disruption applies before both rolls settle', () => {
  const start = fixture('combat')
  start.state.units = { a: unit('soviet', from), d: { ...unit('axis', target), reserve: 'd' } }
  start.state.barrage = { target, defender: 'axis', batteries: [], initialColumn: 0, strength: 1, cost: 1, hedgehog: 0 }
  const first = submit(start, 'axis', { type: 'choose-barrage-terrain', terrain: 'Open' })
  assert.equal(site(first), 'barrage')
  assert.equal(faces(first).length, 2)
  const half = submit(first, 'soviet', vote('keep'))
  assert.equal(site(half), 'barrage-half-loss')
  assert.equal(faces(half).length, 1)
  assert.equal(half.state.units.d.reserve, 'd')
  const replacement = submit(half, 'soviet', vote('reroll'))
  const settled = submit(replacement, 'axis', vote('keep'))
  assert.equal(settled.state.units.d.disorganized, true)
  assert.deepEqual(settled.state.barrageHistory[0].roll.dice, faces(first))
  assert.equal(settled.state.barrageHistory[0].roll.halfDie, faces(replacement)[0])
})

test('initiative has no reroll window, and the marker point settles only at game end', () => {
  const start = fixture('cleanup')
  start.state.turn.step = { kind: 'roll', retention: 'closed' }
  assert.equal(submit(start, 'soviet', { type: 'roll-initiative' }).state.reroll, undefined)
  const normal = fixture('cleanup')
  normal.state.turn.number = normal.state.cursor.turn = 8
  normal.state.cursor.phasing = 'axis'
  normal.state.rerollHolder = 'axis'
  normal.state.arrival.sovietVp = 5
  assert.equal(currentScorpionTurn(normal.state.turn, normal.state).vp, 5)
  const ended = submit(normal, 'axis', { type: 'complete-cleanup' }).state
  assert.equal(ended.turn.vp, 4)
  assert.deepEqual(ended.victory, { outcome: 'axis', level: 'minor' })
  const sudden = openScorpionTurn(3, weather, 20, 'closed', 0, 'axis')
  assert.equal(sudden.vp, 19)
  assert.deepEqual(sudden.step.result, { outcome: 'soviet', level: 'major' })
  const midTurn = { ...normal.state, arrival: { sovietVp: -5 }, victory: { outcome: 'axis', level: 'major' } }
  assert.equal(currentScorpionTurn(midTurn.turn, midTurn).vp, -6)
})
