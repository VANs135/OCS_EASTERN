import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  FRONT_COMMAND_RADIUS, FRONT_HQ_FLAK_DRM, assignedArmyHqCanDraw, frontCommandAllows, frontCommandRadius,
  frontHqMustDisplace, frontHqValidHex,
} from '../src/ttw/front-hq.ts'

// TTW §3.3a：Front HQ 指挥半径复用通规 traceReach（含阻挡），性质判定。
const hexes = Array.from({ length: 12 }, (_, i) => `A${i + 1}.1`)
const map = { neighbors: (hex) => { const i = hexes.indexOf(hex); return i < 0 ? [] : [hexes[i - 1], hexes[i + 1]].filter(Boolean) } }
const none = { enemyCombatHexes: new Set(), unnegatedEzocHexes: new Set(), impassableHexes: new Set(), truckImpassableHexes: new Set() }

test('command radius floods ten hexes and stops at blockers (§3.3a E)', () => {
  assert.equal(FRONT_COMMAND_RADIUS, 10)
  const open = frontCommandRadius(map, 'A1.1', frontCommandAllows(none))
  assert.equal(open.size, 11) // A1..A11（10 步）
  assert.equal(open.has('A12.1'), false)
  const blocked = frontCommandRadius(map, 'A1.1', frontCommandAllows({ ...none, enemyCombatHexes: new Set(['A6.1']) }))
  assert.deepEqual([...blocked].sort(), ['A1.1', 'A2.1', 'A3.1', 'A4.1', 'A5.1'])
  const ezoc = frontCommandRadius(map, 'A1.1', frontCommandAllows({ ...none, unnegatedEzocHexes: new Set(['A3.1']) }))
  assert.deepEqual([...ezoc].sort(), ['A1.1', 'A2.1'])
  assert.equal(frontCommandRadius(map, 'A1.1', frontCommandAllows({ ...none, enemyCombatHexes: new Set(['A1.1']) })).size, 0)
})

test('Front HQ qualities: valid hex, displacement, flak and assigned-HQ draw (§3.3a A–E)', () => {
  assert.equal(frontHqValidHex({ railHex: true, sovietGaugeConnected: true }), true)
  assert.equal(frontHqValidHex({ railHex: true, sovietGaugeConnected: false }), false)
  assert.equal(frontHqValidHex({ railHex: false, sovietGaugeConnected: true }), false)
  assert.equal(frontHqMustDisplace({ enemyCombatInHex: true, railConnected: true }), true)
  assert.equal(frontHqMustDisplace({ enemyCombatInHex: false, railConnected: false }), true)
  assert.equal(frontHqMustDisplace({ enemyCombatInHex: false, railConnected: true }), false)
  assert.equal(FRONT_HQ_FLAK_DRM, 2)
  assert.equal(assignedArmyHqCanDraw({ assigned: true, withinRadius: true, isHq: true }), true)
  assert.equal(assignedArmyHqCanDraw({ assigned: true, withinRadius: false, isHq: true }), false)
  assert.equal(assignedArmyHqCanDraw({ assigned: false, withinRadius: true, isHq: true }), false)
  assert.equal(assignedArmyHqCanDraw({ assigned: true, withinRadius: true, isHq: false }), false)
})