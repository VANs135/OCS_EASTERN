import assert from 'node:assert/strict'
import { test } from 'node:test'
import { campaignRailStatus } from '../src/match/campaign-rail-transport.ts'
import { kirovogradRailBoard, kirovogradRailCapacity } from '../src/match/kirovograd-rail-board.ts'

test('Scenario 9 rail capacity is zero through the shared rail check', () => {
  const state = { cursor: { phase: 'movement', phasing: 'axis' }, movementSegment: 'movement' }
  const forSide = (side) => ({ ...state, cursor: { ...state.cursor, phasing: side } })
  assert.equal(kirovogradRailCapacity, 0)
  assert.deepEqual(campaignRailStatus(forSide('axis'), 'axis', kirovogradRailBoard()), { capacity: 0, remainingCapacity: 0 })
  assert.deepEqual(campaignRailStatus(forSide('soviet'), 'soviet', kirovogradRailBoard()), { capacity: 0, remainingCapacity: 0 })
})
