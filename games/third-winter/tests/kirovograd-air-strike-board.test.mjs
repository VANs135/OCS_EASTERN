import assert from 'node:assert/strict'
import { test } from 'node:test'
import { campaignAirStrikeTargetCandidates } from '../src/match/campaign-air-strike.ts'
import { kirovogradAirStrikeBoard } from '../src/match/kirovograd-air-strike-board.ts'

const map = {
  availableHexes: new Set(['D1.1', 'D1.2', 'D1.3']),
  resolveHex: (hex) => ['D1.1', 'D1.2', 'D1.3'].includes(hex) ? hex : undefined,
  neighbors(hex) {
    const i = ['D1.1', 'D1.2', 'D1.3'].indexOf(hex)
    return i < 0 ? [] : [['D1.1', 'D1.2', 'D1.3'][i - 1], ['D1.1', 'D1.2', 'D1.3'][i + 1]].filter(Boolean)
  },
}
const table = { columns: ['1-2', '3-6', '7-8'], costs: [1, 1, 1], matrix: Array.from({ length: 11 }, () => ['1', '-', '-']) }
const definition = (name, stats, abilities = []) => ({
  source: { name, abilities, faces: {
    combat: { stats },
    move: { stats: { ...stats, airCombat: Math.max(0, (stats.airCombat ?? 0) - 1), bombing: Math.max(0, (stats.bombing ?? 0) - 2) } },
  } },
})
const definitions = new Map([
  ['d', definition('Ge Ju.87D', { airCombat: 1, bombing: 17, range: 95 }, ['barrage'])],
  ['g', definition('Ge Ju.87G', { airCombat: 0, bombing: 4, range: 62 }, ['barrage'])],
  ['aa1', definition('Sov 29 AA Div', { attack: 5, aaMod: '+2' })],
  ['aa2', definition('Ge 32 Flak Bn', { attack: 4, aaMod: '+1' })],
])
const board = kirovogradAirStrikeBoard({ map, table, definitions })

const counter = (definition, overrides = {}) => ({ kind: 'aircraft', side: 'axis', definition,
  location: { kind: 'box', box: '09:axis:air' }, active: true, stepsLost: 0, ...overrides })

test('09 board reads air profiles from the actual face and off-map range', () => {
  const state = { counters: { d: counter('d'), g: counter('g') } }
  assert.deepEqual(board.airProfileOf(state, 'd'), { rangeHexes: 95, printedSteps: 2, airCombat: 1,
    bombing: 17, fighter: false, hipShoot: true, tankBuster: false })
  assert.deepEqual(board.airProfileOf(state, 'g'), { rangeHexes: 62, printedSteps: 2, airCombat: 0,
    bombing: 4, fighter: false, hipShoot: true, tankBuster: true })
  assert.deepEqual(board.airProfileOf({ counters: { d: counter('d', { stepsLost: 1 }) } }, 'd'), {
    rangeHexes: 95, printedSteps: 2, airCombat: 0, bombing: 15, fighter: false, hipShoot: true, tankBuster: false,
  })
  assert.equal(board.rangeHexes(), 3)
  assert.equal(board.distance('D1.1', 'D1.3'), 2)
})

test('09 board uses one AA DRM per hex only in Combat Mode and filters by side', () => {
  const aa = (definition, side, mode = 'combat') => ({ kind: 'land', side, definition,
    location: { kind: 'map', hex: 'D1.2' }, mode })
  const state = { counters: { s1: aa('aa1', 'soviet'), g1: aa('aa2', 'axis') } }
  assert.equal(board.flakValueAt(state, 'D1.2', 'soviet'), 2)
  assert.equal(board.flakValueAt(state, 'D1.2', 'axis'), 1)
  assert.equal(board.flakValueAt({ counters: { s1: aa('aa1', 'soviet', 'move') } }, 'D1.2'), undefined)
})

test('09 target candidates exclude empty hexes and enemy airbases', () => {
  const state = {
    counters: { enemy: { kind: 'land', side: 'soviet', location: { kind: 'map', hex: 'D1.2' } } },
    airBases: [{ side: 'soviet', hex: 'D1.3' }],
  }
  assert.deepEqual(campaignAirStrikeTargetCandidates(state, 'axis', board, 'barrage'), ['D1.2'])
  assert.deepEqual(campaignAirStrikeTargetCandidates(state, 'axis', board, 'hip-shoot'), ['D1.2'])
})
