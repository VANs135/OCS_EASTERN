import assert from 'node:assert/strict'
import { test } from 'node:test'
import { kirovogradOpeningSovietSide } from '../src/match/kirovograd-initial-front.ts'

const line = Array.from({ length: 11 }, (_, index) => `D${10 + index}.1`)
const map = {
  availableHexes: new Set(line),
  resolveHex: (hex) => line.includes(hex) ? hex : undefined,
  neighbors: (hex) => {
    const index = line.indexOf(hex)
    return index < 0 ? [] : [line[index - 1], line[index + 1]].filter(Boolean)
  },
}
const definitions = new Map([['land', { kind: 'land' }]])

test('opening front assigns hexes to the closer initial land side and ties to the Axis', () => {
  const side = kirovogradOpeningSovietSide({ map, definitions, counters: [
    { side: 'axis', hex: 'D10.1', definition: 'land' },
    { side: 'soviet', hex: 'D20.1', definition: 'land' },
  ]})
  assert.equal(side('D11.1'), false)
  assert.equal(side('D15.1'), false)
  assert.equal(side('D16.1'), true)
})

test('an encircled Soviet railhead keeps its pocket but cannot trace through the ring', () => {
  const side = kirovogradOpeningSovietSide({ map, definitions, counters: [
    { side: 'axis', hex: 'D10.1', definition: 'land' },
    { side: 'axis', hex: 'D13.1', definition: 'land' },
    { side: 'axis', hex: 'D15.1', definition: 'land' },
    { side: 'soviet', hex: 'D14.1', definition: 'land' },
    { side: 'soviet', hex: 'D20.1', definition: 'land' },
  ]})
  assert.equal(side('D14.1'), true)
  assert.equal(side('D13.1'), false)
  assert.equal(side('D15.1'), false)
  assert.equal(side('D16.1'), false)
})
