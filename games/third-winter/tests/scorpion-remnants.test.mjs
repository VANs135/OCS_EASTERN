import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createRngState } from '@ocs-eastern/series/rng'
import { deployScorpionGroundCounter } from '../src/import/scorpion-deployment.ts'
import { scorpionMap } from '../src/import/scorpion-map.ts'
import { scorpionModeFace } from '../src/import/scorpion-mode-face.ts'
import { applyScorpionCombatLosses } from '../src/match/scorpion-combat-losses.ts'
import { scorpionRemnantDestinations } from '../src/match/scorpion-remnants.ts'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'
import { scorpionMapStacks } from '../src/view/scorpion-map-counters.ts'
import { localChoices } from '../desktop/local/actions.mjs'
import { localMenu } from '../desktop/local/interaction.mjs'

const origin = 's5.04', middle = 's4.04', west = 's3.04', alternate = 's3.05', attack = 's6.04', flank = 's4.03'
const pairs = [[origin, middle], [middle, west], [middle, alternate], [origin, attack], [middle, flank], [flank, west],
  [west, 's2.03'], ['s2.03', 's1.03']]
const hexes = [...new Set(pairs.flat())]
const makeMap = (edges = pairs) => scorpionMap(hexes.map((hex_id) => ({ hex_id, on_map: true, terrains_present: ['Open'] })),
  edges.map(([hex_a, hex_b]) => ({ hex_a, hex_b, edge_terrain: 'none', road_present: false, rail_present: false, bridge: false })))
const makeUnit = (key, name, options = {}) => {
  const { side = 'axis', kind = 'land', attack = 2, rating = 2, re = 1, move = 3, abilities = [] } = options
  const face = (name, strength, allowance) => ({ asset: `${name}.png`, maColor: 'white',
    stats: { attack: strength, artRange: rating, move: allowance, dropRange: kind === 'hq' ? 5 : null } })
  return { key, kind, source: { name, side, re, category: kind === 'hq' ? 'hq' : 'infantry', abilities,
    faces: { combat: face(key, attack, move), move: face(`${key}-back`, 1, move + 1) } } }
}
const division = makeUnit('division', 'Ge 57 Inf Div', { attack: 16, rating: 4, re: 4 })
const attacker = makeUnit('attacker', 'Sov Rifle Div', { side: 'soviet' })
const HQ = makeUnit('hq', 'Ge HQ 42 Corps', { kind: 'hq' })
const Kessel = makeUnit('kessel', 'Ge HQ 1 Pz Kessel', { kind: 'hq', abilities: ['kessel_supply'] })
const remnants = [makeUnit('land:id:3999', 'Ge Inf Remnant 1'), makeUnit('land:id:4499', 'Ge Inf Remnant 2')]
const badges = new Map(['Out of Supply', 'DG (Disorganized)', 'Low/Exhausted'].map((name) => [name,
  [{ source: { faces: { combat: { asset: `${name}.png` } } } }]]))
const assets = { map: makeMap(), catalog: { aliases: badges,
  definitions: new Map([division, attacker, HQ, Kessel, ...remnants].map((unit) => [unit.key, unit])) } }
const rail = { railGauge: () => 'axis' }
const board = { supplyRail: rail, combat: { table: {} } }
const small = (definition, hex, stepsLost = 0) => deployScorpionGroundCounter(definition, hex, stepsLost)
const remnantId = `remnant:${remnants[0].key}`
const combatRoll = { attacker: { loss: 0, option: 0 }, defender: { loss: 1, option: 0 }, exploit: null }
function fixture(units = {}) {
  return { revision: 0, receipts: [], state: { kind: 'playing', units: { a: small(attacker, attack),
    d: small(division, origin, 3), ...units }, pieces: [], availableAlerts: [], airBases: [], dumps: {},
    rng: createRngState(42), turn: { number: 2, weather: { ground: 'freeze', flight: 'normal' }, step: { kind: 'player-turn' } },
    cursor: { turn: 2, phase: 'combat', first: 'soviet', phasing: 'soviet' }, moved: [], railControl: {},
    pax: { axis: 1, soviet: 0 }, window: null, arrival: { placed: [], mobilized: [], sovietVp: 0 },
    combat: { kind: 'regular', attacker: 'soviet', attackers: ['a'], defenders: ['d'], defenderLeader: 'd', target: origin,
      step: 'defender-result', roll: combatRoll, heldAtStart: { axis: [origin], soviet: [attack] } },
  } }
}
const command = (record, action) => ({ id: `remnants-${record.revision}`, expectedRevision: record.revision, action })
const submit = (record, action) => submitScorpionSession(record, 'axis', command(record, action), assets, board).record
const resolve = { type: 'resolve-combat', optionLosses: 0, lossOrder: ['d'], retreats: [] }

test('a surviving exit requires an Axis choice and creates one VP even when the division had trace', () => {
  const parent = { ...scorpionModeFace(small(division, origin, 3), division, 'move'), disorganized: true, internalStocks: 'low' }
  const start = fixture({ d: parent, hq: small(HQ, west) })
  const plan = { ...resolve, remnants: [{ divisionId: 'd', hex: west }] }
  assert.throws(() => submit(start, resolve), /s3\.04, s3\.05/)
  assert.throws(() => submit(start, { ...plan, remnants: [{ divisionId: 'd', hex: middle }] }), /remnant hex/)
  const placed = submit(start, plan)
  const remnant = placed.state.units[remnantId]
  assert.equal(placed.state.arrival.sovietVp, 1)
  assert.equal(placed.state.units.d, undefined)
  assert.equal(placed.state.pieces.find(({ id }) => id === 'd').location.kind, 'dead-pile')
  assert.equal(placed.state.combat.step, 'advance')
  assert.deepEqual([remnant.hex, remnant.remnantOf, remnant.moveMode, remnant.disorganized, remnant.internalStocks, remnant.stepsLost],
    [west, 'd', true, true, 'low', 0])
  const marker = scorpionMapStacks(placed.state, assets.catalog, []).find(({ hex }) => hex === west).pages.flat()
    .find(({ id }) => id === remnantId)
  assert.equal(marker.asset, `${remnants[0].key}-back.png`)
  const restored = JSON.parse(JSON.stringify(placed))
  assert.equal(submitScorpionSession(restored, 'axis', command(start, plan), assets, board).duplicate, true)
  assert.throws(() => submit(restored, { type: 'rebuild-remnant', remnantId }), /Axis reinforcement Pax/)

  restored.state.cursor = { ...restored.state.cursor, phase: 'reinforcement', phasing: 'axis' }
  restored.state.window = { stage: 'variable' }
  restored.state.combat = null
  const rebuild = { type: 'rebuild-remnant', remnantId }
  const withKessel = { ...restored, state: { ...restored.state, units: { ...restored.state.units, hq: small(Kessel, west) } } }
  assert.throws(() => submit(withKessel, rebuild), /eligible supplied Axis/)
  const data = { assets, board: { ...board, reinforcements: () => ({}) } }
  const menu = (state) => localMenu(state, 'axis', { unitId: remnantId }, { hex: west, unitId: remnantId, ownIds: [remnantId] },
    data, (selection) => localChoices(state, 'axis', selection, data)).filter(({ group }) => group === '重建')
  assert.equal(menu(withKessel.state).length, 0)
  const choices = menu(restored.state)
  assert.equal(choices.length, 2)
  const combat = choices.find(({ actions }) => actions[0].face === 'combat')
  assert.match(combat.label, /Ge 57 Inf Div.*战斗面.*1 人员补充点/)
  const rebuilt = submit(restored, combat.actions[0])
  assert.equal(rebuilt.state.pax.axis, 0)
  assert.equal(rebuilt.state.units[remnantId], undefined)
  assert.equal(rebuilt.state.units.d.hex, west)
  assert.equal(rebuilt.state.units.d.stepsLost, 3)
  assert.ok(!rebuilt.state.pieces.some(({ id }) => id === 'd'))
  assert.equal(rebuilt.state.arrival.sovietVp, 1)
})

test('blocked routes, absent counters and losses outside combat do not create a remnant', () => {
  const start = fixture()
  assert.deepEqual(scorpionRemnantDestinations(start.state, origin, assets), [west, alternate])
  const disconnected = { ...assets, map: makeMap(pairs.slice(1)) }
  assert.deepEqual(scorpionRemnantDestinations(start.state, origin, disconnected), [])
  const hostileZoc = fixture({ flank: small(attacker, flank) })
  assert.deepEqual(scorpionRemnantDestinations(hostileZoc.state, origin, assets), [])
  const negated = fixture({ flank: small(attacker, flank), middle: small(HQ, middle), west: small(HQ, west) })
  assert.deepEqual(scorpionRemnantDestinations(negated.state, origin, assets), [west, alternate])
  const blocked = fixture({ flank: { ...small(attacker, middle), combat: false, attackCapable: false } })
  assert.deepEqual(scorpionRemnantDestinations(blocked.state, origin, assets), [])
  const blockedResult = submit(blocked, resolve)
  assert.equal(blockedResult.state.arrival.sovietVp, 0)
  assert.equal(blockedResult.state.units[remnantId], undefined)
  const exhausted = fixture({ r1: { ...small(remnants[0], west), remnantOf: 'other-1' },
    r2: { ...small(remnants[1], alternate), remnantOf: 'other-2' } })
  assert.equal(submit(exhausted, resolve).state.arrival.sovietVp, 0)
  const barrageLoss = applyScorpionCombatLosses(start.state, new Map([['d', 1]]), assets, rail)
  assert.equal(barrageLoss.units[remnantId], undefined)
  assert.equal(barrageLoss.arrival.sovietVp, 0)
})

test('an isolated division’s last step counts once and a later isolated remnant loss returns the piece and adds one point', () => {
  const start = fixture()
  start.state.railControl['s1.03'] = 'soviet'
  const placed = submit(start, { ...resolve, remnants: [{ divisionId: 'd', hex: west }] })
  assert.equal(placed.state.arrival.sovietVp, 1)
  const eliminated = applyScorpionCombatLosses(placed.state, new Map([[remnantId, 1]]), assets, rail)
  assert.equal(eliminated.arrival.sovietVp, 2)
  assert.equal(eliminated.units[remnantId], undefined)
  assert.ok(!eliminated.pieces.some(({ id }) => id === remnantId))
  const supplied = applyScorpionCombatLosses({ ...placed.state, railControl: {} }, new Map([[remnantId, 1]]), assets, rail)
  assert.equal(supplied.arrival.sovietVp, 1)
  const another = { ...eliminated, units: { ...eliminated.units, second: small(division, origin, 3) } }
  const reused = applyScorpionCombatLosses(another, new Map([['second', 1]]), assets, rail, [{ divisionId: 'second', hex: west }])
  assert.equal(reused.units[remnantId].remnantOf, 'second')
})
