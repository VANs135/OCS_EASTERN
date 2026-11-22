import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inspectRailRoute, railCapacityCost, transportEquivalentOf } from '@ocs-eastern/series/rail-transport'

const never = () => false
const board = {
  edge: () => ({ usableGauge: true, multiTrack: true }),
  rawEnemyZocAt: never,
  enemyCombatAt: never,
  controlBlocksAt: never,
  trainbustingAt: never,
}
const route = ['a', 'b', 'c']

test('OCS 4.7 uses the printed move-face MA and charges only the transport points for a loaded truck', () => {
  const foot = { kind: 'unit', re: 2, mobility: 'leg', moveMa: 1 }
  assert.deepEqual([0, 1, 6, 7].map((moveMa) => transportEquivalentOf({ ...foot, moveMa })), [2, 1, 1, 2])
  assert.equal(transportEquivalentOf({ ...foot, mobility: 'track' }), 2)
  const cargo = [foot, { kind: 'sp', amount: 0.5 }, { kind: 'transportPoint', size: 1 }]
  const doubleTrack = inspectRailRoute(route, board)
  assert.deepEqual(railCapacityCost(cargo, doubleTrack), { equivalent: 2.5, factor: 0.5, cost: 1.25 })
  const interdicted = inspectRailRoute(route, { ...board, trainbustingAt: (hex) => hex !== 'b' })
  assert.deepEqual(railCapacityCost(cargo, interdicted), { equivalent: 2.5, factor: 1, cost: 2.5 })
  const singleTrack = inspectRailRoute(route, { ...board, edge: (from) => ({ usableGauge: true, multiTrack: from === 'a' }),
    trainbustingAt: (hex) => hex === 'c' })
  assert.deepEqual(railCapacityCost(cargo, singleTrack), { equivalent: 2.5, factor: 2, cost: 5 })
})

test('rail passage requires connected usable gauge, friendly control points, and no raw enemy ZOC or combat unit', () => {
  assert.equal(inspectRailRoute(['a'], board).reason, 'rail-route-too-short')
  assert.equal(inspectRailRoute(['a', 'a'], board).reason, 'rail-not-connected')
  assert.deepEqual(inspectRailRoute(route, { ...board, edge: () => undefined }),
    { ok: false, reason: 'rail-not-connected', hex: 'b' })
  assert.deepEqual(inspectRailRoute(route, { ...board, edge: () => ({ usableGauge: false, multiTrack: true }) }),
    { ok: false, reason: 'rail-wrong-gauge', hex: 'b' })
  assert.deepEqual(inspectRailRoute(route, { ...board, controlBlocksAt: (hex) => hex === 'a' }),
    { ok: false, reason: 'rail-control-blocked', hex: 'a' })
  assert.deepEqual(inspectRailRoute(route, { ...board, enemyCombatAt: (hex) => hex === 'b' }),
    { ok: false, reason: 'rail-enemy-combat', hex: 'b' })
  assert.deepEqual(inspectRailRoute(route, { ...board, rawEnemyZocAt: (hex) => hex === 'c' }),
    { ok: false, reason: 'rail-enemy-zoc', hex: 'c' })
})
