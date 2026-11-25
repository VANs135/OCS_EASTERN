import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { drawWithoutReplacement } from '../src/pool-draw.ts'
import { createRngState } from '../src/rng.ts'
import { applySetupStep, createSetupState, setupDecision } from '../src/setup-workflow.ts'

const piece = (side, hex) => ({ side, location: hex ? { kind: 'map', hex } : { kind: 'available' } })
const counters = { left: piece('axis', 'A'), right: piece('soviet', 'B'),
  stock1: piece('axis'), stock2: piece('axis'), stock3: piece('axis') }
const rules = { isHex: (hex) => ['A', 'B', 'C'].includes(hex), place: (counter, hex) => ({ ...counter, location: { kind: 'map', hex } }) }
const plan = { pools: { reserve: { side: 'axis', counterIds: ['stock1', 'stock2', 'stock3'] } }, steps: [
  { id: 'position', kind: 'place', side: 'axis', counterId: 'left', destinations: ['A', 'C'] },
  { id: 'draw-first', kind: 'draw', side: 'axis', pool: 'reserve', count: 1, hex: 'A' },
  { id: 'draw-second', kind: 'draw', side: 'axis', pool: 'reserve', count: 1, hex: 'C' },
  { id: 'left-ready', kind: 'confirm', side: 'axis' }, { id: 'right-ready', kind: 'confirm', side: 'soviet' },
] }

test('draws use sequential random states and preserve physical pool order', () => {
  const initial = createRngState(17)
  const pool = ['p1', 'p2', 'p3']
  const result = drawWithoutReplacement(initial, pool, 2)
  assert.equal(new Set(result.draws.map(({ item }) => item)).size, 2)
  assert.equal(result.draws[0].before, 0)
  assert.equal(result.draws[1].before, result.draws[0].after)
  assert.equal(result.rng.drawCount, result.draws[1].after)
  assert.deepEqual(drawWithoutReplacement(initial, pool, 2), result)
  assert.deepEqual(pool, ['p1', 'p2', 'p3'])
  assert.throws(() => drawWithoutReplacement(initial, pool, 4), /Invalid pool/)
})

test('setup enforces step order, sides and destinations, and never draws an instance twice', () => {
  const initial = createSetupState(counters, plan, rules, 17)
  const move = { type: 'setup-place', stepId: 'position', hex: 'C' }
  assert.equal(setupDecision(initial, plan, 'soviet', rules).active, null)
  assert.throws(() => applySetupStep(initial, plan, 'soviet', move, rules), /responding side/)
  assert.throws(() => applySetupStep(initial, plan, 'axis', { ...move, hex: 'B' }, rules), /offered/)
  assert.throws(() => applySetupStep(initial, plan, 'axis', { type: 'setup-confirm', stepId: 'left-ready' }, rules), /current step/)
  const placed = applySetupStep(initial, plan, 'axis', move, rules)
  assert.equal(placed.counters.left.location.hex, 'C')
  assert.equal(placed.rng.drawCount, 0)
  const first = applySetupStep(placed, plan, 'axis', { type: 'setup-draw', stepId: 'draw-first' }, rules)
  assert.equal(setupDecision(first, plan, 'axis', rules).active.remaining, 2)
  const second = applySetupStep(first, plan, 'axis', { type: 'setup-draw', stepId: 'draw-second' }, rules)
  assert.notEqual(second.draws[0].counterId, second.draws[1].counterId)
  assert.equal(second.draws[1].before, second.draws[0].after)
  assert.equal(second.counters[second.draws[1].counterId].location.hex, 'C')
  const confirmed = applySetupStep(second, plan, 'axis', { type: 'setup-confirm', stepId: 'left-ready' }, rules)
  assert.equal(setupDecision(confirmed, plan, 'axis', rules).active, null)
  const complete = applySetupStep(confirmed, plan, 'soviet', { type: 'setup-confirm', stepId: 'right-ready' }, rules)
  assert.equal(setupDecision(complete, plan, 'soviet', rules).actor, null)
  assert.deepEqual(initial.counters, counters)
  assert.equal(initial.rng.drawCount, 0)
})

test('invalid pool membership, oversubscribed draws and partial failed placement are rejected atomically', () => {
  assert.throws(() => createSetupState(counters, { ...plan, pools: { ...plan.pools,
    other: { side: 'axis', counterIds: ['stock1'] } } }, rules, 3), /duplicate setup pool counter/)
  const draw = { id: 'draw', side: 'axis', kind: 'draw', pool: 'reserve', count: 2, hex: 'C' }
  const limited = { ...plan, steps: [draw, plan.steps.at(-1)] }
  assert.throws(() => createSetupState(counters, { ...limited, steps: [{ ...draw, count: 4 }, limited.steps[1]] }, rules, 3), /Invalid setup draw step/)
  const blocked = { ...rules, canPlace: (board, _, hex) => Object.values(board).every((p) => p.location.hex !== hex) }
  const initial = createSetupState(counters, limited, blocked, 3)
  assert.throws(() => applySetupStep(initial, limited, 'axis', { type: 'setup-draw', stepId: 'draw' }, blocked), /Invalid setup destination/)
  assert.deepEqual(initial.counters, counters)
  assert.equal(initial.rng.drawCount, 0)
  assert.deepEqual(initial.draws, [])
})
