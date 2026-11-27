import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalScorpion } from '../desktop/local/data.mjs'
import { sampleScorpionOpening } from './scorpion-sample-opening.mjs'
import {
  declareScorpionCombat, defendScorpionCombat, selectScorpionCombatRating,
  chooseScorpionCombatTerrain,
} from '../src/match/scorpion-combat.ts'
import { resolveScorpionCombat, advanceScorpionCombat } from '../src/match/scorpion-combat-result.ts'
import { remainingSteps } from '../src/match/scorpion-losses.ts'

// Oracle fixture for the native regular-combat seven-step state machine. The TS functions run the
// forged-but-legal opening situation; every expected combat record, roll, loss order and post-state
// slice is recorded here for the GDScript side to replay field by field. No retreat, remnant,
// overrun or capture resolution is fabricated in this slice.
const dist = fileURLToPath(new URL('../../../dist/', import.meta.url))
const [root, output = join(dist, 'godot', '08-combat.json'), tables = dist] = process.argv.slice(2)
if (!root) throw new Error('请提供第三冬资料库目录，可另传输出路径和图表目录')

const seed = 19440126
const data = await loadLocalScorpion(resolve(root), resolve(tables))
const map = data.assets.map
const table = data.board.combat.table

// Deterministic opening pair verified against the seed-19440126 opening: a Soviet leg regiment at
// s1.11 facing an Axis leg regiment at s1.10. The scan below falls back to the first legal pair.
const OPENING = sampleScorpionOpening(data.setup, data.assets, seed)
const started = OPENING.started.state

function forgeBaseState() {
  const state = JSON.parse(JSON.stringify(started))
  state.cursor = { ...state.cursor, phase: 'combat', phasing: 'soviet' }
  state.combatTargets = []
  state.combatAttackers = []
  state.moved = []
  state.combat = null
  state.capture = null
  state.retreat = null
  return state
}

const sliceUnits = (state, ids) => Object.fromEntries(ids.filter((id) => state.units[id] !== undefined)
  .map((id) => [id, state.units[id]]))
const sliceDumps = (state, ids) => Object.fromEntries(ids.filter((id) => state.dumps[id] !== undefined)
  .map((id) => [id, state.dumps[id]]))
const slicePieces = (state, ids) => state.pieces.filter((piece) => ids.includes(piece.id))

function lossOrderFor(state, slots, leader, result) {
  const counts = new Map(slots.map((id) => [id, remainingSteps(state.units[id])]))
  const available = [...counts.values()].reduce((sum, count) => sum + count, 0)
  const hard = Math.min(result.loss, available)
  const ordered = [leader, ...slots.filter((id) => id !== leader)]
  const order = []
  while (order.length < hard + result.option && [...counts.values()].some((count) => count > 0)) {
    for (const id of ordered) {
      if (order.length === hard + result.option) break
      if (counts.get(id) > 0) {
        order.push(id)
        counts.set(id, counts.get(id) - 1)
      }
    }
  }
  return { lossOrder: order, optionLosses: order.length - hard }
}

// Pair A: Soviet 2073 (s1.11) vs Axis 3951 (s1.10) — defender-heavy odds, covers the attacker-loss
// path. Pair B: Soviet 2178 (s2.11) vs Axis 4008:6 (s2.10) — attacker-heavy odds, covers the
// defender-loss and advance path. Both are real opening counters at seed 19440126.
const PAIR_A = { attackerId: 'setup:land:id:2073:1', defenderId: 'setup:land:id:3951:1', target: 's1.10' }
const PAIR_B = { attackerId: 'setup:land:id:2178:1', defenderId: 'setup:land:id:4008:6', target: 's2.10' }

function axisDumpFor(state, defenderId) {
  const dump = Object.keys(state.dumps).find((id) => id.startsWith('axis:hex:') &&
    state.dumps[id].tokens > 0 &&
    Object.values(state.units).some((enemy) => enemy.id === defenderId && enemy.combat))
  return dump ?? 'axis:hex:s3.10'
}

const SCENARIOS = [
  {
    ...PAIR_A, name: 'normal', note: '双方按盘上补给正常支付，攻方与守方均有补给',
    mutate: () => undefined,
    defend: (state, ctx) => ({ payments: [{ dumpId: ctx.axisDump, tokens: 2 }], internalUnitIds: [] }),
  },
  {
    ...PAIR_A, name: 'hedgehog', note: '目标格刺猬等级 1：守方反坦克 ≥2，掷骰行再减 1',
    mutate: (state, ctx) => { state.hedgehogs = { ...state.hedgehogs, [ctx.target]: { side: 'axis', level: 1 } } },
    defend: (state, ctx) => ({ payments: [{ dumpId: ctx.axisDump, tokens: 2 }], internalUnitIds: [] }),
  },
  {
    ...PAIR_A, name: 'defender-internal', note: '守方无可领取的盘上补给，消耗自身内部库存（low → exhausted），记未付补给',
    mutate: (state, ctx) => {
      const dumps = { ...state.dumps }
      for (const id of Object.keys(dumps)) {
        if (id.startsWith('axis:hex:')) dumps[id] = { ...dumps[id], tokens: 0 }
      }
      state.dumps = dumps
      state.units = { ...state.units, [ctx.defenderId]: { ...state.units[ctx.defenderId], internalStocks: 'low' } }
    },
    defend: (_state, ctx) => ({ payments: [], internalUnitIds: [ctx.defenderId] }),
  },
  {
    ...PAIR_A, name: 'defender-unpaid', note: '守方既无盘上支付也无内部库存，按未付战斗补给结算',
    mutate: () => undefined,
    defend: () => ({ payments: [], internalUnitIds: [] }),
  },
  {
    ...PAIR_A, name: 'attacker-out-of-supply', note: '攻方带断补标记（仍付盘上补给，进攻强度减半）',
    mutate: (state, ctx) => {
      state.units = { ...state.units, [ctx.attackerId]: { ...state.units[ctx.attackerId], outOfSupply: true } }
    },
    defend: (state, ctx) => ({ payments: [{ dumpId: ctx.axisDump, tokens: 2 }], internalUnitIds: [] }),
  },
  {
    ...PAIR_B, name: 'advance', note: '攻方优势兵力打穿守方，存活攻方进击目标格',
    // Surprise [5,5] lands on the neutral band (8 with the −2 AR modifier), so the column keeps
    // its printed 3:1; combat [6,6] rolls the top row where the CRT awards defender steps.
    dice: { surprise: [5, 5], shift: [3], combat: [6, 6] },
    mutate: () => undefined,
    defend: (state, ctx) => ({ payments: [{ dumpId: ctx.axisDump, tokens: 1 }], internalUnitIds: [] }),
  },
]

const baseState = forgeBaseState()
const scenarios = []

for (const scenario of SCENARIOS) {
  const state = JSON.parse(JSON.stringify(baseState))
  const axisDump = axisDumpFor(state, scenario.defenderId)
  const ctx = { target: scenario.target, attackerId: scenario.attackerId,
    defenderId: scenario.defenderId, sovDump: 'soviet:hex:s1.14', axisDump }
  scenario.mutate(state, ctx)
  // 变异后的开局快照作为 GDScript 回放起点；步骤切片记录各步落地后的盘面。
  const baseSnapshot = JSON.parse(JSON.stringify(state))

  const dumpIds = [ctx.sovDump, axisDump, 'axis:hex:s8.11'].filter((id) => state.dumps[id] !== undefined)
  const unitIds = [scenario.attackerId, scenario.defenderId]
  const steps = []

  const attackerCost = remainingSteps(state.units[scenario.attackerId])
  const declareAction = {
    target: scenario.target, attackers: [scenario.attackerId],
    payments: [{ unitId: scenario.attackerId, dumpId: ctx.sovDump, tokens: attackerCost }],
    internalUnitIds: [],
  }
  let next = declareScorpionCombat(state, 'soviet', declareAction, map, { table }, undefined)
  steps.push({ step: 'declare', actor: 'soviet', action: declareAction,
    combat: next.combat, units: sliceUnits(next, unitIds), dumps: sliceDumps(next, dumpIds),
    pieces: slicePieces(next, unitIds) })

  const defendAction = scenario.defend(next, ctx)
  next = defendScorpionCombat(next, 'axis', defendAction, map, undefined)
  steps.push({ step: 'defend', actor: 'axis', action: defendAction,
    combat: next.combat, units: sliceUnits(next, unitIds), dumps: sliceDumps(next, dumpIds),
    pieces: slicePieces(next, unitIds) })

  next = selectScorpionCombatRating(next, 'soviet', scenario.attackerId)
  steps.push({ step: 'attacker-rating', actor: 'soviet', action: { unitId: scenario.attackerId },
    combat: next.combat, units: sliceUnits(next, unitIds), dumps: sliceDumps(next, dumpIds),
    pieces: slicePieces(next, unitIds) })

  next = selectScorpionCombatRating(next, 'axis', scenario.defenderId)
  steps.push({ step: 'defender-rating', actor: 'axis', action: { unitId: scenario.defenderId },
    combat: next.combat, units: sliceUnits(next, unitIds), dumps: sliceDumps(next, dumpIds),
    pieces: slicePieces(next, unitIds) })

  const terrain = map.hexes.get(scenario.target).terrains[0]
  const terrainAction = { terrain, attackingTerrain: { [state.units[scenario.attackerId].hex]: terrain } }
  const offer = scenario.dice ? (rng, site, count) => {
    const faces = site.kind === 'surprise' ? scenario.dice.surprise
      : site.kind === 'surprise-shift' ? scenario.dice.shift
      : scenario.dice.combat
    const chosen = faces.slice(0, count)
    return { rng, value: { count, faces: chosen, total: chosen.reduce((a, b) => a + b, 0) } }
  } : undefined
  next = chooseScorpionCombatTerrain(next, 'axis', terrainAction, map, table, offer)
  steps.push({ step: 'defender-terrain', actor: 'axis', action: terrainAction,
    combat: next.combat, roll: next.combat?.roll ?? null,
    units: sliceUnits(next, unitIds), dumps: sliceDumps(next, dumpIds),
    pieces: slicePieces(next, unitIds) })

  // Attacker result window.
  const attackerRoll = next.combat.roll.attacker
  const attackerLoss = lossOrderFor(next, next.combat.attackers, next.combat.attackerLeader, attackerRoll)
  const attackerAction = {
    lossOrder: attackerLoss.lossOrder, optionLosses: attackerLoss.optionLosses,
    ignoreDefenderOption: false, retreats: [], remnants: [],
  }
  next = resolveScorpionCombat(next, 'soviet', attackerAction, data.assets, data.board)
  steps.push({ step: 'attacker-result', actor: 'soviet', action: attackerAction,
    combat: next.combat, result: attackerRoll,
    units: sliceUnits(next, unitIds), dumps: sliceDumps(next, dumpIds),
    pieces: slicePieces(next, unitIds) })

  // Defender result window (skipped only when the match ended on the attacker's result).
  let defenderRoll = null
  let defenderAction = null
  if (next.combat && next.combat.step === 'defender-result') {
    defenderRoll = next.combat.roll.defender
    const defenderLoss = lossOrderFor(next, next.combat.defenders, next.combat.defenderLeader, defenderRoll)
    defenderAction = {
      lossOrder: defenderLoss.lossOrder, optionLosses: defenderLoss.optionLosses,
      ignoreDefenderOption: false, retreats: [], remnants: [],
    }
    next = resolveScorpionCombat(next, 'axis', defenderAction, data.assets, data.board)
    steps.push({ step: 'defender-result', actor: 'axis', action: defenderAction,
      combat: next.combat, result: defenderRoll,
      units: sliceUnits(next, unitIds), dumps: sliceDumps(next, dumpIds),
      pieces: slicePieces(next, unitIds) })
  }

  // Advance window: surviving attackers enter the target hex. Capture/breakdown resolution stays
  // out of this slice; the recorded post-state is what the TS engine produced.
  let entrants = []
  if (next.combat && next.combat.step === 'advance') {
    entrants = next.combat.attackers.filter((id) => next.units[id] !== undefined)
    next = advanceScorpionCombat(next, 'soviet', entrants, data.assets, data.board, [])
    steps.push({ step: 'advance', actor: 'soviet', action: { unitIds: entrants, breakdowns: [] },
      combat: next.combat, entrants,
      units: sliceUnits(next, unitIds), dumps: sliceDumps(next, dumpIds),
      pieces: slicePieces(next, unitIds) })
  }

  scenarios.push({
    name: scenario.name, note: scenario.note, target: scenario.target,
    attackerId: scenario.attackerId, defenderId: scenario.defenderId,
    base: baseSnapshot,
    // 注入骰面的场景在 TS 侧走 offer 分支（不推进 rng）；原生回放要按同样键重放，故随夹具导出。
    offer: scenario.dice ?? null,
    steps,
    outcome: {
      advanced: entrants.length > 0,
      victory: next.victory ?? null,
      retreatPending: next.combat?.retreat !== undefined && next.combat?.retreat !== null,
      capturePending: next.capture !== undefined && next.capture !== null,
      finalCombat: next.combat,
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
console.log(`已导出 08 正规战斗对照 · 场景 ${scenarios.length} · 步骤 ${stepCount} · ${resolve(output)}`)
