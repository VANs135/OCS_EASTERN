import assert from 'node:assert/strict'
import { test } from 'node:test'
import { kirovogradInitialRailGauge, kirovogradRailNetwork } from '../src/match/kirovograd-initial-gauge.ts'

const hexes = ['D10.1', 'D11.1', 'D12.1', 'D13.1', 'D14.1', 'D15.1', 'D16.1', 'D14.2', 'D15.2']
const rail = [
  ['D10.1', 'D11.1'], ['D11.1', 'D12.1'], ['D12.1', 'D13.1'], ['D13.1', 'D14.1'],
  ['D14.1', 'D15.1'], ['D15.1', 'D16.1'], ['D14.1', 'D14.2'], ['D14.2', 'D15.2'],
]
const railSet = new Set(rail.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]))
const map = {
  availableHexes: new Set(hexes),
  resolveHex: (hex) => hexes.includes(hex) ? hex : undefined,
  neighbors: (hex) => hexes.filter((other) => railSet.has(`${hex}|${other}`)),
}
const railheads = [{ ref: 'Railhead', side: 'soviet', count: 1, hex: 'D13.1' }]
const gauge = kirovogradInitialRailGauge({ map, railAt: (from, to) => railSet.has(`${from}|${to}`), railheads })

test('Soviet railhead converts the line east of it, including same-column bends', () => {
  assert.equal(gauge['D10.1|D11.1'], 'standard')
  assert.equal(gauge['D11.1|D12.1'], 'standard')
  assert.equal(gauge['D12.1|D13.1'], 'standard')
  assert.equal(gauge['D13.1|D14.1'], 'broad')
  assert.equal(gauge['D14.1|D15.1'], 'broad')
  assert.equal(gauge['D15.1|D16.1'], 'broad')
  assert.equal(gauge['D14.1|D14.2'], 'broad')
  assert.equal(gauge['D14.2|D15.2'], 'broad')
})

test('Scenario 9 rail network reads gauge and exposes the printed railheads', () => {
  const network = kirovogradRailNetwork({ map, railAt: (from, to) => railSet.has(`${from}|${to}`), railheads })
  assert.deepEqual(network.edge('D13.1', 'D14.1'), { gauge: 'broad', multiTrack: false })
  assert.deepEqual(network.edge('D12.1', 'D13.1'), { gauge: 'standard', multiTrack: false })
  assert.deepEqual(network.initialGaugeJunctions, ['D13.1'])
  assert.equal(network.edge('D10.1', 'D16.1'), undefined)
})

test('railheads must be on the map and need actual rail edges', () => {
  assert.throws(() => kirovogradInitialRailGauge({ map, railAt: () => false,
    railheads: [{ ref: 'Railhead', side: 'soviet', hex: 'D9.99' }] }), /railhead is outside/)
  const empty = { ...map, availableHexes: new Set(['D10.1']), neighbors: () => [] }
  assert.throws(() => kirovogradInitialRailGauge({ map: empty, railAt: () => true,
    railheads: [{ ref: 'Railhead', side: 'soviet', hex: 'D10.1' }] }), /no on-map railway/)
})
