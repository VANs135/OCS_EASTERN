import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalScorpion } from '../desktop/local/data.mjs'
import { sampleScorpionOpening } from './scorpion-sample-opening.mjs'
import { applyScorpionCombatLosses } from '../src/match/scorpion-combat-losses.ts'
import { scorpionRemnantDestinations, rebuildScorpionRemnant } from '../src/match/scorpion-remnants.ts'
import { scorpionSupplyPosition, scorpionEnemyZoc } from '../src/match/scorpion-supply-position.ts'
import { scorpionSupplyNetwork } from '../src/ttw/scorpion/supply-trace.ts'

// Oracle fixture for the native remnant generation (TTW 2.4d). The TypeScript chain runs forged
// opening situations through combat losses and remnant placement; every unit / dead-pile / remnant
// / VP slice is recorded field by field for the GDScript side to replay. Covers the eligible Axis
// division destroyed with a remnant, a non-division Axis counter, a Soviet counter, a surviving
// division, and the rebuild chain back to the parent.
const dist = fileURLToPath(new URL('../../../dist/', import.meta.url))
const [root, output = join(dist, 'godot', '08-remnant-gen.json'), tables = dist] = process.argv.slice(2)
if (!root) throw new Error('请提供第三冬资料库目录，可另传输出路径和图表目录')

const seed = 19440126
const data = await loadLocalScorpion(resolve(root), resolve(tables))
const opening = sampleScorpionOpening(data.setup, data.assets, seed)
const baseState = JSON.parse(JSON.stringify(opening.started.state))
const { map, catalog } = data.assets

const defName = (id) => catalog.definitions.get(id)?.source.name ?? id
const clone = () => JSON.parse(JSON.stringify(baseState))

const sliceUnits = (state, ids) => Object.fromEntries(ids.filter((id) => state.units[id] !== undefined)
  .map((id) => [id, state.units[id]]))
const slicePieces = (state, ids) => state.pieces.filter((piece) => ids.includes(piece.id))

function findUnit(predicate) {
  const [id, unit] = Object.entries(baseState.units).find(([, unit]) => predicate(unit)) ?? []
  return id ? { id, unit } : null
}

const scenarios = []

// 1. Eligible Axis infantry division eliminated: a remnant battalion lands two hexes west and the
//    division counts 1 Soviet VP (or its full loss steps when out of trace).
{
  const division = findUnit((unit) => defName(unit.definition) === 'Ge 198 Inf Div')
  if (!division) throw new Error('夹具缺少 Ge 198 Inf Div')
  const state = clone()
  const choices = scorpionRemnantDestinations(state, division.unit.hex, data.assets)
  if (choices.length === 0) throw new Error('Ge 198 Inf Div 没有合法残部落点')
  const hex = choices[0]
  const remaining = division.unit.printedRe - division.unit.stepsLost
  const allocation = new Map([[division.id, remaining]])
  const remnants = [{ divisionId: division.id, hex }]
  const base = JSON.parse(JSON.stringify(state))
  const next = applyScorpionCombatLosses(state, allocation, data.assets, undefined, remnants)
  const remnantId = Object.keys(next.units).find((id) => next.units[id]?.remnantOf === division.id)
  scenarios.push({
    name: 'axis-division-remnant',
    note: '合格轴心步兵师打光：两点向西合法格生成残部，母单位进死人堆，阵亡师记 1 VP',
    divisionId: division.id,
    destination: hex,
    base,
    steps: [{
      step: 'combat-losses', actor: 'axis',
      action: { allocation: Object.fromEntries(allocation), remnants },
      units: sliceUnits(next, [division.id, remnantId]),
      pieces: slicePieces(next, [division.id]),
      remnants: remnantId ? [{ divisionId: division.id, remnantId, hex: next.units[remnantId].hex }] : [],
      vp: next.arrival.sovietVp,
    }],
    outcome: { remnantPlaced: remnantId !== undefined, parentInDeadPile: next.pieces
      .some((piece) => piece.id === division.id) },
  })
}

// 2. Non-division Axis counter eliminated: no remnant, the counter lands on the dead pile like any
//    other loss; no remnant VP.
{
  const target = findUnit((unit) => unit.side === 'axis' && defName(unit.definition) === 'Ge 320 Inf KG')
  if (!target) throw new Error('夹具缺少 Ge 320 Inf KG')
  const state = clone()
  const remaining = target.unit.printedRe - target.unit.stepsLost
  const allocation = new Map([[target.id, remaining]])
  const base = JSON.parse(JSON.stringify(state))
  const next = applyScorpionCombatLosses(state, allocation, data.assets, undefined, [])
  const remnantId = Object.keys(next.units).find((id) => next.units[id]?.remnantOf === target.id)
  scenarios.push({
    name: 'axis-nondivision-eliminated',
    note: '轴心旅/团级单位打光：不生成残部，进死人堆，不计残部 VP',
    unitId: target.id,
    base,
    steps: [{
      step: 'combat-losses', actor: 'axis',
      action: { allocation: Object.fromEntries(allocation), remnants: [] },
      units: sliceUnits(next, [target.id, remnantId].filter(Boolean)),
      pieces: slicePieces(next, [target.id]),
      remnants: [],
      vp: next.arrival.sovietVp,
    }],
    outcome: { remnantPlaced: false, parentInDeadPile: next.pieces.some((piece) => piece.id === target.id) },
  })
}

// 3. Soviet counter eliminated: Axis remnant rules never apply.
{
  const target = findUnit((unit) => unit.side === 'soviet' && unit.combat && unit.printedRe - unit.stepsLost === 1)
  if (!target) throw new Error('夹具缺少一枚一步存活的苏军战斗单位')
  const state = clone()
  const allocation = new Map([[target.id, 1]])
  const base = JSON.parse(JSON.stringify(state))
  const next = applyScorpionCombatLosses(state, allocation, data.assets, undefined, [])
  scenarios.push({
    name: 'soviet-eliminated',
    note: '苏军单位打光：不生成轴心残部，进死人堆',
    unitId: target.id,
    base,
    steps: [{
      step: 'combat-losses', actor: 'soviet',
      action: { allocation: Object.fromEntries(allocation), remnants: [] },
      units: sliceUnits(next, [target.id]),
      pieces: slicePieces(next, [target.id]),
      remnants: [],
      vp: next.arrival.sovietVp,
    }],
    outcome: { remnantPlaced: false, parentInDeadPile: next.pieces.some((piece) => piece.id === target.id) },
  })
}

// 4. Surviving Axis division: one step of loss leaves the counter on the board; no remnant, no VP.
{
  const division = findUnit((unit) => defName(unit.definition) === 'Ge 57 Inf Div')
  if (!division) throw new Error('夹具缺少 Ge 57 Inf Div')
  const state = clone()
  const allocation = new Map([[division.id, 1]])
  const base = JSON.parse(JSON.stringify(state))
  const next = applyScorpionCombatLosses(state, allocation, data.assets, undefined, [])
  scenarios.push({
    name: 'division-survives',
    note: '轴心师只承受一步损失：存活在盘面上，不生成残部',
    divisionId: division.id,
    base,
    steps: [{
      step: 'combat-losses', actor: 'axis',
      action: { allocation: Object.fromEntries(allocation), remnants: [] },
      units: sliceUnits(next, [division.id]),
      pieces: slicePieces(next, [division.id]),
      remnants: [],
      vp: next.arrival.sovietVp,
    }],
    outcome: { remnantPlaced: false, parentOnMap: next.units[division.id] !== undefined },
  })
}

// 5. Rebuild chain: the remnant from scenario 1 exchanges with one Axis Pax for the parent back on
//    the board one step down. Re-forges the reinforcement window, a supplied non-Kessel HQ stacked
//    with the remnant outside enemy ZOC, then runs `rebuildScorpionRemnant`.
{
  const division = findUnit((unit) => defName(unit.definition) === 'Ge 198 Inf Div')
  const state = clone()
  const choices = scorpionRemnantDestinations(state, division.unit.hex, data.assets)
  const hex = choices[0]
  const remaining = division.unit.printedRe - division.unit.stepsLost
  const allocation = new Map([[division.id, remaining]])
  const settled = applyScorpionCombatLosses(state, allocation, data.assets, undefined,
    [{ divisionId: division.id, hex }])
  const remnantId = Object.keys(settled.units).find((id) => settled.units[id]?.remnantOf === division.id)
  if (!remnantId) throw new Error('重建链前置：残部未生成')

  // Forge the reinforcement window and a Pax token like the native rebuild fixture.
  settled.cursor = { ...settled.cursor, phasing: 'axis', phase: 'reinforcement' }
  settled.window = { stage: 'variable', variableTokens: 0, fixedTokens: 0 }
  settled.pax = { ...settled.pax, axis: 1 }

  // Pick a traced, enemy-ZOC-free hex; stack a non-Kessel Axis Corps/Army HQ there with the remnant.
  const hqId = Object.keys(settled.units).find((id) => {
    const unit = settled.units[id]
    const hq = unit.headquarters
    return unit.side === 'axis' && hq && hq.kessel !== true &&
      catalog.definitions.get(unit.definition)?.source.name.startsWith('Ge HQ ')
  })
  if (!hqId) throw new Error('重建链前置：找不到可用轴心司令部')
  const position = scorpionSupplyPosition(settled, map, 'axis')
  const network = scorpionSupplyNetwork(map, position)
  const zoc = scorpionEnemyZoc(settled, map, 'axis')
  const tracedHex = [...map.hexes.keys()].sort().find((candidate) =>
    !zoc.has(candidate) && network.hasTrace(candidate))
  if (!tracedHex) throw new Error('重建链前置：找不到有追溯且不在 ZOC 的格')
  settled.units[hqId].hex = tracedHex
  settled.units[remnantId].hex = tracedHex

  const rebuilt = rebuildScorpionRemnant(settled, 'axis',
    { type: 'rebuild-remnant', remnantId, face: 'combat' }, data.assets)
  scenarios.push({
    name: 'rebuild-chain',
    note: '残部在增援阶段与 1 轴心 Pax 交换，母单位降一步回到盘面，残部离场',
    divisionId: division.id,
    remnantId,
    hqId,
    base: JSON.parse(JSON.stringify(settled)),
    steps: [
      {
        step: 'combat-losses', actor: 'axis',
        action: { allocation: Object.fromEntries(allocation), remnants: [{ divisionId: division.id, hex }] },
        units: sliceUnits(settled, [division.id, remnantId]),
        pieces: slicePieces(settled, [division.id]),
        remnants: [{ divisionId: division.id, remnantId, hex }],
        vp: settled.arrival.sovietVp,
      },
      {
        step: 'rebuild', actor: 'axis',
        action: { type: 'rebuild-remnant', remnantId, face: 'combat' },
        units: sliceUnits(rebuilt, [division.id, remnantId, hqId]),
        pieces: slicePieces(rebuilt, [division.id]),
        remnants: [],
        vp: rebuilt.arrival.sovietVp,
        pax: rebuilt.pax,
        rebuilt: {
          id: division.id, stepsLost: rebuilt.units[division.id]?.stepsLost,
          moveMode: rebuilt.units[division.id]?.moveMode ?? false,
        },
      },
    ],
    outcome: {
      remnantGone: rebuilt.units[remnantId] === undefined,
      parentOnMap: rebuilt.units[division.id] !== undefined,
      parentOutOfDeadPile: !rebuilt.pieces.some((piece) => piece.id === division.id),
      paxAxis: rebuilt.pax.axis,
    },
  })
}

const fixture = {
  version: 1, scenarioId: '08-korsun-pocket', seed, fingerprint: data.fingerprint,
  scenarios,
}

await mkdir(dirname(resolve(output)), { recursive: true })
await writeFile(resolve(output), JSON.stringify(fixture) + '\n')
const stepCount = scenarios.reduce((sum, scenario) => sum + scenario.steps.length, 0)
console.log(`已导出 08 残部生成对照 · 场景 ${scenarios.length} · 步骤 ${stepCount} · ${resolve(output)}`)
