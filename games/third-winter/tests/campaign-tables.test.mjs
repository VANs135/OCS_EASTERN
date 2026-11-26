import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { barrageColumn, rollGroundBarrage } from '@ocs-eastern/series/tables/barrage'
import { CRT_TERRAIN_TYPES, crtLookup } from '@ocs-eastern/series/tables/crt'
import { parseCombatResult } from '@ocs-eastern/series/tables/ground-combat'
import { loadCampaignTables, parseCampaignBarrage, parseCampaignCrt } from '../src/import/campaign-tables.ts'

// G15 实值导入：校验随库提交的通规 v4.3 图表 JSON 可被战斗/炮击环直接消费（不改写表值）。
const read = (name) => JSON.parse(readFileSync(new URL(`../data/scorpion-real-library/tables/${name}`, import.meta.url), 'utf8'))
const tables = loadCampaignTables({ crt: read('ocs-v43-crt.json'), barrage: read('ocs-v43-barrage.json'), facility: read('ocs-v43-facility.json') })

test('committed v4.3 CRT parses and every cell resolves to a legal combat result', () => {
  const crt = tables.crt
  assert.equal(crt.diceRows.length, 15)
  for (const terrain of CRT_TERRAIN_TYPES) {
    assert.equal(crt.terrainColumns[terrain].length, 13)
    for (const odds of crt.terrainColumns[terrain]) {
      for (let roll = 1; roll <= 15; roll++) {
        const { code } = crtLookup(roll, terrain, odds, crt)
        assert.doesNotThrow(() => parseCombatResult(code), `${terrain} ${odds} roll ${roll}: ${code}`)
      }
    }
  }
})

test('committed v4.3 barrage table drives column cost and ground barrage rolls', () => {
  const barrage = tables.barrage
  assert.equal(barrage.columns.length, 11)
  assert.equal(barrage.matrix.length, 11)
  for (const [index, strength] of [1, 2, 4, 6, 9, 14, 20, 30, 50, 80, 120].entries()) {
    const { initialColumn, cost } = barrageColumn(barrage, strength)
    assert.equal(cost, barrage.costs[initialColumn])
    assert.equal(initialColumn, index)
  }
  const cells = new Set(barrage.matrix.flat())
  for (const die of [1, 2, 3, 4, 5, 6]) {
    const result = rollGroundBarrage(barrage, 5, { density: 2, terrain: 'Open', hedgehog: 0, spotter: true }, () => die)
    assert.ok(cells.has(result.code))
  }
  assert.equal(tables.facility.columns.length, 8)
  assert.equal(tables.facility.matrix.length, 6)
})

test('malformed tables are rejected rather than silently coerced', () => {
  assert.throws(() => parseCampaignCrt({ diceRows: ['2'], terrainColumns: {}, matrix: [] }), /odds columns/)
  assert.throws(() => parseCampaignCrt({ ...tables.crt, matrix: tables.crt.matrix.slice(1) }), /dimensions/)
  assert.throws(() => parseCampaignBarrage({ ...tables.barrage, costs: tables.barrage.costs.slice(1) }), /costs/)
  assert.throws(() => parseCampaignBarrage({ ...tables.barrage, matrix: tables.barrage.matrix.slice(1) }), /11 dice rows/)
})