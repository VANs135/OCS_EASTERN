import assert from 'node:assert/strict'
import { test } from 'node:test'
import { campaignRailStatus } from '../src/match/campaign-rail-transport.ts'
import { dnieperRailCapacity } from '../src/match/dnieper-rail-capacity.ts'

const rail = {
  capacity: (state, side) => dnieperRailCapacity(side, state.turn),
  ordinaryCargo: () => true,
  controlBlocksAt: () => false,
  trainbustingAt: () => false,
}

function movement(turn, side = 'soviet', spent = 0) {
  return {
    turn,
    cursor: { first: 'soviet', phasing: side, phase: 'movement' },
    movementSegment: 'movement',
    groundMovement: { moved: [], zocLocks: [], railCapacitySpent: spent },
  }
}

test('scenario 01 rail capacity follows the Soviet 7 / 7.5 / 8 / 8.5 schedule', () => {
  assert.equal(dnieperRailCapacity('soviet', 1), 7)
  assert.equal(dnieperRailCapacity('soviet', 5), 7)
  assert.equal(dnieperRailCapacity('soviet', 6), 7.5)
  assert.equal(dnieperRailCapacity('soviet', 23), 7.5)
  assert.equal(dnieperRailCapacity('soviet', 24), 8)
  assert.equal(dnieperRailCapacity('soviet', 57), 8)
  assert.equal(dnieperRailCapacity('soviet', 58), 8.5)
  assert.equal(dnieperRailCapacity('soviet', 63), 8.5)
  assert.equal(dnieperRailCapacity('axis', 6), 10)
})

test('scenario 01 rail status refuses outside the movement window and applies spent capacity', () => {
  assert.deepEqual(campaignRailStatus(movement(6, 'soviet', 2), 'soviet', rail),
    { capacity: 7.5, remainingCapacity: 5.5 })
  assert.equal(campaignRailStatus(movement(58, 'soviet', 8), 'soviet', rail)?.remainingCapacity, 0.5)

  const combat = { ...movement(6), cursor: { first: 'soviet', phasing: 'soviet', phase: 'combat' } }
  assert.equal(campaignRailStatus(combat, 'soviet', rail), null)
  assert.throws(() => dnieperRailCapacity('soviet', 0), /turn out of range/)
  assert.throws(() => dnieperRailCapacity('soviet', 64), /turn out of range/)
})
