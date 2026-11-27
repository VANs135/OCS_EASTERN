import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildTransportCaptureGroup, planTransportSplit, transportCaptureClass,
  transportDisplacementCandidates } from '../src/transport-capture.ts'

test('9.14c groups by MA and rounds after summing the whole group', () => {
  assert.equal(transportCaptureClass(11), 'trucks')
  assert.equal(transportCaptureClass(10), 'wagons')
  const group = buildTransportCaptureGroup('trucks', 3, [
    { id: 'a', points: 1, tokens: 0 },
    { id: 'b', points: 1, tokens: 0 },
    { id: 'c', points: 1, tokens: 0 },
  ])
  assert.equal(group.totalPoints, 3)
  assert.equal(group.capturedPoints, 1)
  assert.equal(group.capturedTokens, 0)
})

test('9.14c split chooses the closest subset and reports when the table is not exact', () => {
  const group = buildTransportCaptureGroup('trucks', 3, [
    { id: 'a', points: 2, tokens: 0 },
  ])
  const split = planTransportSplit(group)
  assert.deepEqual(split.capturedIds, [])
  assert.equal(split.capturedPoints, 0)
  assert.equal(split.exact, false)

  const exact = buildTransportCaptureGroup('trucks', 4, [
    { id: 'a', points: 1, tokens: 0 },
    { id: 'b', points: 1, tokens: 0 },
  ])
  assert.equal(planTransportSplit(exact).exact, true)
})

test('9.14c displacement candidates ignore terrain and enemy units, only distance and map membership', () => {
  const hexes = ['A1.1', 'A2.1', 'A3.1', 'A11.1', 'A12.1']
  const distance = (a, b) => Math.abs(Number(b.split('.')[0].slice(1)) - Number(a.split('.')[0].slice(1)))
  assert.deepEqual(transportDisplacementCandidates('A1.1', hexes, distance, 'trucks'), ['A11.1', 'A2.1', 'A3.1'])
  assert.deepEqual(transportDisplacementCandidates('A1.1', hexes, distance, 'wagons'), ['A2.1', 'A3.1'])
})

test('a zero-member group or invalid die is rejected', () => {
  assert.throws(() => buildTransportCaptureGroup('trucks', 0, [{ id: 'a', points: 1, tokens: 0 }]), /1\.\.6/)
  assert.throws(() => buildTransportCaptureGroup('trucks', 3, []), /at least one/)
})
