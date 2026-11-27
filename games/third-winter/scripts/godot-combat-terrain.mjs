import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalScorpion } from '../desktop/local/data.mjs'
import { combatStrengthFromFacts, combatTerrainCategory } from '../src/ttw/combat-terrain.ts'
import { combatRating } from '../src/ttw/scorpion/combat-terrain.ts'
import {
  groundModeEffect, resolveModeStats, groundModeMovementFactor, effectiveMode,
} from '@ocs-eastern/series/modes'
import { crtLookup, CRT_TERRAIN_TYPES } from '@ocs-eastern/series/tables/crt'

// Oracle fixture for the native combat-terrain / combat-strength / mode-value layer.
// Every expected value is computed by the TypeScript functions; the GDScript side only replays them.
const dist = fileURLToPath(new URL('../../../dist/', import.meta.url))
const [root, output = join(dist, 'godot', '08-combat-terrain.json'), tables = dist] = process.argv.slice(2)
if (!root) throw new Error('请提供第三冬资料库目录，可另传输出路径和图表目录')

const data = await loadLocalScorpion(resolve(root), resolve(tables))
const table = JSON.parse(readFileSync(join(resolve(tables), 'ocs-v43-crt.json'), 'utf8'))

const TERRAINS = ['Open', 'Hills', 'Woods', 'Forest', 'Rough', 'Mountain', 'Swamp',
  'Village', 'Minor City', 'Major City']
const CLASSES = ['armor', 'mech', 'other']

const baseFacts = (patch = {}) => ({
  attacking: true, terrain: 'Open', frozen: false, supplied: true, enemyAntiTank: 0,
  combatClass: 'other', strength: 6, printedRe: 3, stepsLost: 0, antiTank: 0,
  outOfSupply: false, artilleryDivision: false, attackFactor: 1, defenseFactor: 1, ...patch,
})

// 1) 十种地形 × 三兵种 × 攻/守，含各地形的 CRT 类别。
const terrainRows = []
for (const terrain of TERRAINS) {
  for (const combatClass of CLASSES) {
    for (const attacking of [true, false]) {
      const facts = baseFacts({ terrain, combatClass, attacking })
      terrainRows.push({
        terrain, combatClass, attacking, facts,
        category: combatTerrainCategory(terrain),
        expected: combatStrengthFromFacts(facts),
      })
    }
  }
}

// 2) 河岸地形 × 冻结/解冻 × 三兵种（进攻方口径）。
const riverRows = []
for (const terrain of ['minor-river', 'major-river']) {
  for (const frozen of [true, false]) {
    for (const combatClass of CLASSES) {
      const facts = baseFacts({ terrain, frozen, combatClass })
      riverRows.push({ terrain, frozen, combatClass, facts, expected: combatStrengthFromFacts(facts) })
    }
  }
}

// 3) 开阔地反坦克持平/不足/为零：装甲与机步攻方 ×2，守方反坦克≥攻方时降 ×1.5。
const antiTankRows = []
for (const combatClass of ['armor', 'mech']) {
  for (const antiTank of [0, 1]) {
    for (const enemyAntiTank of [0, 1, 2]) {
      const facts = baseFacts({ terrain: 'Open', combatClass, antiTank, enemyAntiTank })
      antiTankRows.push({ combatClass, antiTank, enemyAntiTank, facts, expected: combatStrengthFromFacts(facts) })
    }
  }
}

// 4) 步损：进攻有步损即减半；防御步损≥印刷一半才减半。
const stepRows = [
  { facts: baseFacts({ stepsLost: 1 }), note: '进攻有步损' },
  { facts: baseFacts({ attacking: false, printedRe: 4, stepsLost: 1 }), note: '防御步损不足一半' },
  { facts: baseFacts({ attacking: false, printedRe: 4, stepsLost: 2 }), note: '防御步损达一半' },
].map(({ facts, note }) => ({ note, facts, expected: combatStrengthFromFacts(facts) }))

// 5) 断补 ×½；未付战斗补给 ×½。
const supplyRows = [
  { facts: baseFacts({ outOfSupply: true }), note: '断补' },
  { facts: baseFacts({ supplied: false }), note: '未付战斗补给' },
].map(({ facts, note }) => ({ note, facts, expected: combatStrengthFromFacts(facts) }))

// 6) 炮兵师防御按当前 RE、不叠步损减半；进攻口径不享受该特例。
const artilleryRows = []
for (const stepsLost of [0, 1, 2]) {
  const facts = baseFacts({ attacking: false, artilleryDivision: true, strength: 84, printedRe: 3, stepsLost })
  artilleryRows.push({ note: '炮兵师防御 RE%d 步损%d' % [3 - stepsLost, stepsLost], facts, expected: combatStrengthFromFacts(facts) })
}
{
  const facts = baseFacts({ attacking: true, terrain: 'Open', artilleryDivision: true, strength: 84, printedRe: 3, stepsLost: 1 })
  artilleryRows.push({ note: '炮兵单位进攻不按 RE 特例', facts, expected: combatStrengthFromFacts(facts) })
}

// 7) 六种模式 × 三阶段：效果矩阵、改写后数值、移动倍率、生效模式与 AR。
const MODES = [
  { label: 'none', state: { face: 'combat' } },
  { label: 'reserve', state: { face: 'combat', marker: 'reserve' } },
  { label: 'released-reserve', state: { face: 'combat', marker: 'reserve', released: true } },
  { label: 'exploit', state: { face: 'combat', marker: 'exploit' } },
  { label: 'dg', state: { face: 'combat', marker: 'dg' } },
  { label: 'strat', state: { face: 'move', marker: 'strat' } },
]
const PHASES = ['movement', 'reaction', 'exploitation']
// scorpionGroundMode 可识别的盘上标记字段（strat 不落盘，映射回基础面）。
const unitFromState = (state) => ({
  actionRating: 3,
  moveMode: state.face === 'move',
  reserve: state.marker === 'reserve',
  disorganized: state.marker === 'dg',
  exploit: state.marker === 'exploit',
  released: state.released === true,
})
const modeRows = []
for (const { label, state } of MODES) {
  for (const phase of PHASES) {
    const effect = groundModeEffect(state)
    const stats = resolveModeStats({ attack: 6, ar: 3, ma: 4, barrage: 2 }, state, phase)
    // 走 scorpion 层 combatRating：盘上算子 → scorpionGroundMode → 模式效果。
    const rating = combatRating(unitFromState(state))
    modeRows.push({
      label, state, phase,
      effect, stats, rating,
      movementFactor: groundModeMovementFactor(state, phase),
      effectiveMode: effectiveMode(state),
    })
  }
}

// 8) CRT：四类地形 × 全部 odds 列 × 掷骰 1..16（含「1 or less」「15 or more」边界行），
//    另加越界 odds 标签验证夹取到最近边界列。
const crtRows = []
for (const terrain of CRT_TERRAIN_TYPES) {
  for (const odds of table.terrainColumns[terrain]) {
    for (let roll = 1; roll <= 16; roll += 1) {
      crtRows.push({ roll, terrain, odds, expected: crtLookup(roll, terrain, odds, table) })
    }
  }
  for (const odds of ['1:6', '60:1']) {
    for (const roll of [1, 8, 16]) {
      crtRows.push({ roll, terrain, odds, expected: crtLookup(roll, terrain, odds, table) })
    }
  }
}

const fixture = {
  version: 1, scenarioId: '08-korsun-pocket', fingerprint: data.fingerprint,
  terrains: TERRAINS, classes: CLASSES,
  terrainRows, riverRows, antiTankRows, stepRows, supplyRows, artilleryRows,
  modeRows, crtRows,
  crtTable: {
    diceRows: table.diceRows, terrainColumns: table.terrainColumns, matrix: table.matrix,
  },
}

await mkdir(dirname(resolve(output)), { recursive: true })
await writeFile(resolve(output), JSON.stringify(fixture) + '\n')
const total = terrainRows.length + riverRows.length + antiTankRows.length + stepRows.length +
  supplyRows.length + artilleryRows.length + modeRows.length + crtRows.length
console.log(`已导出 08 战斗地形对照 · 强度行 ${terrainRows.length + riverRows.length + antiTankRows.length + stepRows.length + supplyRows.length + artilleryRows.length} · 模式行 ${modeRows.length} · CRT 行 ${crtRows.length} · 共 ${total} 条 · ${resolve(output)}`)
